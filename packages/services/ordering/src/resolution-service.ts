/**
 * Ordering-owned collection resolution service (CR-006).
 *
 * Creates, confirms, refreshes, and admits durable resolution sessions. Sonar
 * is consulted only as a stateless probe port — it never receives persistence
 * access. Digests are always recomputed server-side. Persisted truth is deeply
 * cloned/frozen at every ingress/egress boundary.
 *
 * EXTERNAL IMPLEMENTATION BLOCKER: no production Postgres adapter.
 * EXTERNAL AUTH/HTTP BLOCKER: no production authorization endpoint wiring.
 */

import { createHash, randomUUID } from "node:crypto";
import { Cause, Effect, Exit } from "effect";
import { canonicalize } from "@freeside/collection-protocol";
import type {
  CapabilityRegistryVersion,
  CollectionCandidate,
} from "@freeside/collection-protocol";
import {
  AuthorizationScopeMismatchError,
  ConcurrentConfirmationError,
  ConfirmationVersionConflictError,
  IdempotencyConflictError,
  ImmutableRequestMismatchError,
  OrderBindingRejectedError,
  RESOLUTION_TTL_MS,
  ResolutionExpiredError,
  ResolutionNotFoundError,
  SelectionRejectedError,
  SelectionStaleError,
  assertNoRawCandidateOrderFields,
  compareCandidateFreshness,
  decodeAuthorizationScope,
  decodeLocalCapabilitySnapshot,
  decodeOrderResolutionBinding,
  decodeResolutionConfirmCommand,
  decodeResolutionCreateCommand,
  decodeResolutionRefreshCommand,
  decodeResolutionRequestMaterial,
  deepCloneFreeze,
  digestCandidateSnapshot,
  digestResolutionRequest,
  digestsEqual,
  evaluateAdmissionCompatibility,
  expiresAtFrom,
  requestMaterialFromCreate,
  requestMaterialsEqual,
  scopesMatch,
  toPublicProjection,
  validateSelection,
  type AdmissionDecision,
  type AuthorizationScope,
  type CandidateSnapshot,
  type ConfirmedResolutionRecord,
  type LocalCapabilitySnapshot,
  type OrderResolutionBinding,
  type ResolutionConfirmCommand,
  type ResolutionCreateCommand,
  type ResolutionPublicProjection,
  type ResolutionRefreshCommand,
  type ResolutionRequestMaterial,
  COLLECTION_RESOLUTION_SCHEMA_VERSION,
} from "@freeside/collection-resolution-protocol";
import type {
  ResolutionSelectionStaleOutcome,
  ResolutionStore,
} from "./resolution-store.js";

const runEffect = async <A, E>(effect: Effect.Effect<A, E>): Promise<A> => {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return exit.value;
  throw Cause.squash(exit.cause);
};

export interface SonarResolveProbePort {
  /**
   * Stateless internal probe. Implementations must not persist resolution
   * sessions or read Ordering resolution storage.
   */
  resolveProbe(input: {
    readonly identifier: string;
    readonly environment: "mainnet";
    readonly report_type: string;
    readonly report_version: string;
  }): Promise<{
    readonly capability_snapshot_version: CapabilityRegistryVersion;
    readonly candidates: ReadonlyArray<CollectionCandidate>;
    readonly diagnostics: CandidateSnapshot["diagnostics"];
  }>;
}

export interface ResolutionServiceClock {
  nowMs(): number;
}

export interface ResolutionIdGenerator {
  nextId(): string;
}

/**
 * Production construction options. Session TTL is fixed at protocol
 * `RESOLUTION_TTL_MS` (15 server minutes). Arbitrary `ttl_ms` is not accepted.
 */
export interface CollectionResolutionServiceOptions {
  readonly store: ResolutionStore;
  readonly sonar: SonarResolveProbePort;
  readonly clock?: ResolutionServiceClock;
  readonly ids?: ResolutionIdGenerator;
}

const defaultClock: ResolutionServiceClock = {
  nowMs: () => Date.now(),
};

const defaultIds: ResolutionIdGenerator = {
  nextId: () => randomUUID(),
};

/**
 * Exact-command fingerprint over strict-decoded, RFC-8785-canonical material.
 * Property insertion order cannot alter identity; raw JSON.stringify is never used.
 */
const commandDigest = async (value: unknown): Promise<string> => {
  const canonical = await runEffect(canonicalize(value));
  return createHash("sha256").update(canonical, "utf8").digest("hex");
};

const emptyDiagnostics = (): CandidateSnapshot["diagnostics"] =>
  deepCloneFreeze({
    schema_version: COLLECTION_RESOLUTION_SCHEMA_VERSION,
    searched: [],
    timed_out: [],
    unavailable: [],
  });

const sealProjection = (record: ConfirmedResolutionRecord, selectionStale?: true) =>
  deepCloneFreeze(
    toPublicProjection(record, selectionStale === true ? { selection_stale: true } : undefined),
  );

const classifyRequestMismatch = (
  resolutionId: string,
  expected: ResolutionRequestMaterial,
  supplied: ResolutionRequestMaterial,
): ImmutableRequestMismatchError => {
  if (expected.identifier !== supplied.identifier) {
    return new ImmutableRequestMismatchError({
      resolution_id: resolutionId,
      reason: "identifier_mismatch",
    });
  }
  if (expected.environment !== supplied.environment) {
    return new ImmutableRequestMismatchError({
      resolution_id: resolutionId,
      reason: "environment_mismatch",
    });
  }
  if (
    expected.report_type !== supplied.report_type ||
    expected.report_version !== supplied.report_version
  ) {
    return new ImmutableRequestMismatchError({
      resolution_id: resolutionId,
      reason: "report_mismatch",
    });
  }
  if (expected.community_ref !== supplied.community_ref) {
    return new ImmutableRequestMismatchError({
      resolution_id: resolutionId,
      reason: "community_mismatch",
    });
  }
  return new ImmutableRequestMismatchError({
    resolution_id: resolutionId,
    reason: "canonical_mismatch",
  });
};

export class CollectionResolutionService {
  private readonly store: ResolutionStore;
  private readonly sonar: SonarResolveProbePort;
  private readonly clock: ResolutionServiceClock;
  private readonly ids: ResolutionIdGenerator;

  constructor(options: CollectionResolutionServiceOptions) {
    this.store = options.store;
    this.sonar = options.sonar;
    this.clock = options.clock ?? defaultClock;
    this.ids = options.ids ?? defaultIds;
  }

  async create(
    command: ResolutionCreateCommand,
    scope: AuthorizationScope,
  ): Promise<ResolutionPublicProjection> {
    const sealedCommand = deepCloneFreeze(
      await runEffect(decodeResolutionCreateCommand(command)),
    );
    const sealedScope = deepCloneFreeze(await runEffect(decodeAuthorizationScope(scope)));

    if (sealedCommand.community_ref !== sealedScope.community_ref) {
      throw new AuthorizationScopeMismatchError({ reason: "community_mismatch" });
    }

    const nowMs = this.clock.nowMs();
    const originalRequest = deepCloneFreeze(requestMaterialFromCreate(sealedCommand));
    const requestDigest = await runEffect(
      digestResolutionRequest(sealedCommand, sealedScope),
    );
    /**
     * Exact create-command fingerprint for pre-probe conflict/replay.
     * Strict-decoded command + scope + immutable request material; key order
     * cannot alter identity.
     */
    const createCommandDigest = await commandDigest({
      operation: "create",
      command: sealedCommand,
      scope: sealedScope,
      original_request: originalRequest,
      request_digest: requestDigest,
    });

    // Exact-command idempotency check BEFORE Sonar probe / rate / cost work.
    const preProbeLookup = await this.store.lookupIdempotency({
      operation: "create",
      subject_id: sealedScope.subject_id,
      idempotency_key: sealedCommand.idempotency_key,
      command_digest: createCommandDigest,
      now_ms: nowMs,
    });
    if (preProbeLookup.kind === "conflict") {
      throw new IdempotencyConflictError({
        operation: "create",
        idempotency_key: sealedCommand.idempotency_key,
        reason: "command_mismatch",
      });
    }
    if (preProbeLookup.kind === "replay") {
      return sealProjection(preProbeLookup.record);
    }

    const probe = await this.sonar.resolveProbe({
      identifier: originalRequest.identifier,
      environment: originalRequest.environment,
      report_type: originalRequest.report_type,
      report_version: originalRequest.report_version,
    });

    // Never store Sonar object references — deep-clone probe outputs at ingress.
    const snapshot: CandidateSnapshot = deepCloneFreeze({
      schema_version: COLLECTION_RESOLUTION_SCHEMA_VERSION,
      candidates: [...probe.candidates],
      diagnostics: probe.diagnostics ?? emptyDiagnostics(),
    });
    const snapshotDigest = await runEffect(digestCandidateSnapshot(snapshot));
    const nowIso = new Date(nowMs).toISOString();
    const record: ConfirmedResolutionRecord = deepCloneFreeze({
      schema_version: COLLECTION_RESOLUTION_SCHEMA_VERSION,
      resolution_id: this.ids.nextId(),
      requester_subject: sealedScope.subject_id,
      authorization_scope: sealedScope,
      original_request: originalRequest,
      request_digest: requestDigest,
      capability_snapshot_version: deepCloneFreeze(probe.capability_snapshot_version),
      candidate_snapshot: snapshot,
      candidate_snapshot_digest: snapshotDigest,
      confirmation_version: 0,
      expires_at: expiresAtFrom(nowMs, RESOLUTION_TTL_MS),
      created_at: nowIso,
      updated_at: nowIso,
    });

    const result = await this.store.createAtomic({
      record,
      command: sealedCommand,
      command_digest: createCommandDigest,
      now_ms: nowMs,
    });

    if (result.kind === "conflict") {
      throw new IdempotencyConflictError({
        operation: "create",
        idempotency_key: sealedCommand.idempotency_key,
        reason: "command_mismatch",
      });
    }
    return sealProjection(result.record);
  }

  async confirm(
    resolutionId: string,
    command: ResolutionConfirmCommand,
    scope: AuthorizationScope,
  ): Promise<ResolutionPublicProjection> {
    const sealedCommand = deepCloneFreeze(
      await runEffect(decodeResolutionConfirmCommand(command)),
    );
    const sealedScope = deepCloneFreeze(await runEffect(decodeAuthorizationScope(scope)));
    const nowMs = this.clock.nowMs();
    /**
     * Exact confirm-command fingerprint for preflight conflict/replay.
     * Client/binding inputs only — must not depend on current mutable session
     * fields (expiry, digest, selection) so retained confirms replay after
     * session expiry or later CAS transitions.
     */
    const confirmCommandDigest = await commandDigest({
      operation: "confirm",
      resolution_id: resolutionId,
      command: sealedCommand,
      scope: sealedScope,
    });

    // Exact-command preflight BEFORE expiry / digest / selection / CAS checks.
    const preflight = await this.store.lookupIdempotency({
      operation: "confirm",
      subject_id: sealedScope.subject_id,
      idempotency_key: sealedCommand.idempotency_key,
      command_digest: confirmCommandDigest,
      now_ms: nowMs,
    });
    if (preflight.kind === "conflict") {
      throw new IdempotencyConflictError({
        operation: "confirm",
        idempotency_key: sealedCommand.idempotency_key,
        reason: "command_mismatch",
      });
    }
    if (preflight.kind === "replay") {
      return sealProjection(preflight.record);
    }

    const current = await this.store.get(resolutionId);
    if (current === undefined) {
      throw new ResolutionNotFoundError({ resolution_id: resolutionId });
    }
    this.assertSubjectScope(current, sealedScope);
    this.assertNotExpired(current, nowMs);

    if (!digestsEqual(sealedCommand.candidate_snapshot_digest, current.candidate_snapshot_digest)) {
      throw new SelectionRejectedError({
        reason: "client_digest_forgery",
        detail: "candidate_snapshot_digest must match the server-computed persisted digest",
      });
    }

    const selection = await runEffect(
      validateSelection(current.candidate_snapshot, sealedCommand.selected_deployment_ids),
    );

    const confirmedAt = new Date(nowMs).toISOString();
    const result = await this.store.confirmCas({
      resolution_id: resolutionId,
      expected_confirmation_version: sealedCommand.expected_confirmation_version,
      command: sealedCommand,
      command_digest: confirmCommandDigest,
      subject_id: sealedScope.subject_id,
      patch: {
        selected_deployment_ids: [...selection.selected_deployment_ids],
        ...(selection.selected_collection_id !== undefined
          ? { selected_collection_id: selection.selected_collection_id }
          : {}),
        confirmed_at: confirmedAt,
        updated_at: confirmedAt,
        confirmation_version: current.confirmation_version + 1,
      },
      now_ms: nowMs,
    });

    if (result.kind === "not_found") {
      throw new ResolutionNotFoundError({ resolution_id: resolutionId });
    }
    if (result.kind === "conflict") {
      throw new IdempotencyConflictError({
        operation: "confirm",
        idempotency_key: sealedCommand.idempotency_key,
        reason: "command_mismatch",
      });
    }
    if (result.kind === "subject_mismatch") {
      throw new AuthorizationScopeMismatchError({ reason: "cross_subject_replay" });
    }
    if (result.kind === "version_conflict") {
      if (result.record.selected_deployment_ids !== undefined) {
        throw new ConcurrentConfirmationError({
          resolution_id: resolutionId,
          expected_confirmation_version: sealedCommand.expected_confirmation_version,
          current_confirmation_version: result.record.confirmation_version,
        });
      }
      throw new ConfirmationVersionConflictError({
        resolution_id: resolutionId,
        expected_confirmation_version: sealedCommand.expected_confirmation_version,
        current_confirmation_version: result.record.confirmation_version,
      });
    }
    return sealProjection(result.record);
  }

  /**
   * Refresh re-probes using the persisted immutable original request.
   * An optional supplied request must match that original byte-for-byte /
   * canonically; collection A can never be refreshed as collection B.
   * `suppliedRequest` is strict-decoded (excess-property-free) before compare.
   */
  async refresh(
    resolutionId: string,
    command: ResolutionRefreshCommand,
    scope: AuthorizationScope,
    suppliedRequest?: unknown,
  ): Promise<ResolutionPublicProjection> {
    const sealedCommand = deepCloneFreeze(
      await runEffect(decodeResolutionRefreshCommand(command)),
    );
    const sealedScope = deepCloneFreeze(await runEffect(decodeAuthorizationScope(scope)));
    // Strict-decode optional supplied request before comparison/probe.
    // Never clone unchecked caller input into fingerprints or logs.
    const sealedSupplied =
      suppliedRequest === undefined
        ? undefined
        : deepCloneFreeze(
            await runEffect(decodeResolutionRequestMaterial(suppliedRequest)),
          );
    const nowMs = this.clock.nowMs();
    const current = await this.store.get(resolutionId);
    if (current === undefined) {
      throw new ResolutionNotFoundError({ resolution_id: resolutionId });
    }
    this.assertSubjectScope(current, sealedScope);

    const effectiveRequest = current.original_request;
    if (sealedSupplied !== undefined) {
      if (!requestMaterialsEqual(effectiveRequest, sealedSupplied)) {
        throw classifyRequestMismatch(resolutionId, effectiveRequest, sealedSupplied);
      }
    }

    const expired = Date.parse(current.expires_at) <= nowMs;
    /**
     * Exact refresh-command fingerprint for pre-probe conflict/replay.
     * Includes every client/binding input that affects acceptance identity:
     * resolution id, expected CAS version, idempotency key, immutable original
     * request, request digest, and auth scope. Post-mutation record fields are
     * intentionally excluded so identical retries replay without re-probe.
     */
    const refreshCommandDigest = await commandDigest({
      operation: "refresh",
      resolution_id: resolutionId,
      expected_confirmation_version: sealedCommand.expected_confirmation_version,
      idempotency_key: sealedCommand.idempotency_key,
      original_request: effectiveRequest,
      request_digest: current.request_digest,
      scope: sealedScope,
      authorization_scope: current.authorization_scope,
    });

    // Exact-command idempotency check BEFORE probing or mutation.
    const preProbeLookup = await this.store.lookupIdempotency({
      operation: "refresh",
      subject_id: sealedScope.subject_id,
      idempotency_key: sealedCommand.idempotency_key,
      command_digest: refreshCommandDigest,
      now_ms: nowMs,
    });
    if (preProbeLookup.kind === "conflict") {
      throw new IdempotencyConflictError({
        operation: "refresh",
        idempotency_key: sealedCommand.idempotency_key,
        reason: "command_mismatch",
      });
    }
    if (preProbeLookup.kind === "replay") {
      return this.mapRefreshResult(resolutionId, sealedCommand, preProbeLookup);
    }

    const probe = await this.sonar.resolveProbe({
      identifier: effectiveRequest.identifier,
      environment: effectiveRequest.environment,
      report_type: effectiveRequest.report_type,
      report_version: effectiveRequest.report_version,
    });

    const nextSnapshot: CandidateSnapshot = deepCloneFreeze({
      schema_version: COLLECTION_RESOLUTION_SCHEMA_VERSION,
      candidates: [...probe.candidates],
      diagnostics: probe.diagnostics ?? emptyDiagnostics(),
    });
    const nextDigest = await runEffect(digestCandidateSnapshot(nextSnapshot));
    const capabilitySnapshot = deepCloneFreeze(probe.capability_snapshot_version);
    const freshness = await runEffect(
      compareCandidateFreshness(
        current.candidate_snapshot,
        current.candidate_snapshot_digest,
        nextSnapshot,
        nextDigest,
      ),
    );

    const updatedAt = new Date(nowMs).toISOString();
    const nextVersion = current.confirmation_version + 1;
    const extendExpiry = freshness.selection_relevant_equal && expired;
    const nextExpiresAt = extendExpiry
      ? expiresAtFrom(nowMs, RESOLUTION_TTL_MS)
      : current.expires_at;

    const acceptedRefreshDigest = await commandDigest({
      input: refreshCommandDigest,
      effective_refresh_query: effectiveRequest,
      next_candidate_snapshot_digest: nextDigest,
      capability_snapshot_version: capabilitySnapshot,
      selection_relevant_equal: freshness.selection_relevant_equal,
      stale_reason: freshness.stale_reason ?? null,
      expires_at: nextExpiresAt,
      server_now_ms: nowMs,
      extend_expiry: extendExpiry,
      session_expired_at_invoke: expired,
      prior_confirmation_version: current.confirmation_version,
      prior_candidate_snapshot_digest: current.candidate_snapshot_digest,
      prior_capability_snapshot_version: current.capability_snapshot_version,
    });

    if (freshness.selection_relevant_equal) {
      const result = await this.store.refreshCas({
        resolution_id: resolutionId,
        expected_confirmation_version: sealedCommand.expected_confirmation_version,
        command: sealedCommand,
        command_digest: refreshCommandDigest,
        accepted_digest: acceptedRefreshDigest,
        subject_id: sealedScope.subject_id,
        patch: {
          candidate_snapshot: nextSnapshot,
          candidate_snapshot_digest: nextDigest,
          capability_snapshot_version: capabilitySnapshot,
          confirmation_version: nextVersion,
          updated_at: updatedAt,
          ...(extendExpiry ? { expires_at: nextExpiresAt } : {}),
          ...(current.selected_deployment_ids !== undefined
            ? { selected_deployment_ids: current.selected_deployment_ids }
            : {}),
          ...(current.selected_collection_id !== undefined
            ? { selected_collection_id: current.selected_collection_id }
            : {}),
          ...(current.confirmed_at !== undefined ? { confirmed_at: current.confirmed_at } : {}),
        },
        now_ms: nowMs,
      });
      return this.mapRefreshResult(resolutionId, sealedCommand, result);
    }

    const selectionStale = deepCloneFreeze({
      reason: freshness.stale_reason ?? "deployment_changed",
      previous_candidate_snapshot_digest: current.candidate_snapshot_digest,
      current_candidate_snapshot_digest: nextDigest,
    });
    const result = await this.store.refreshCas({
      resolution_id: resolutionId,
      expected_confirmation_version: sealedCommand.expected_confirmation_version,
      command: sealedCommand,
      command_digest: refreshCommandDigest,
      accepted_digest: acceptedRefreshDigest,
      selection_stale: selectionStale,
      subject_id: sealedScope.subject_id,
      patch: {
        candidate_snapshot: nextSnapshot,
        candidate_snapshot_digest: nextDigest,
        capability_snapshot_version: capabilitySnapshot,
        confirmation_version: nextVersion,
        updated_at: updatedAt,
        clear_selection: true,
      },
      now_ms: nowMs,
    });

    // Persist and replay the exact externally observed stale outcome.
    return this.mapRefreshResult(resolutionId, sealedCommand, result);
  }

  /**
   * Order admission: bind only resolution_id + candidate_snapshot_digest + scope.
   * Raw client candidate metadata is refused.
   */
  async admit(
    bindingInput: unknown,
    scope: AuthorizationScope,
    localCapability: LocalCapabilitySnapshot,
  ): Promise<AdmissionDecision> {
    const sealedScope = deepCloneFreeze(await runEffect(decodeAuthorizationScope(scope)));
    // Strict-decode + canonicalize views as a unique set by (deployment_id, operation).
    const sealedCapability = deepCloneFreeze(
      await runEffect(decodeLocalCapabilitySnapshot(localCapability)),
    );

    if (
      typeof bindingInput === "object" &&
      bindingInput !== null &&
      !Array.isArray(bindingInput)
    ) {
      await runEffect(
        assertNoRawCandidateOrderFields(bindingInput as Record<string, unknown>),
      );
    }

    const binding: OrderResolutionBinding = deepCloneFreeze(
      await runEffect(decodeOrderResolutionBinding(bindingInput)),
    );

    const nowMs = this.clock.nowMs();
    const record = await this.store.get(binding.resolution_id);
    if (record === undefined) {
      throw new ResolutionNotFoundError({ resolution_id: binding.resolution_id });
    }
    this.assertSubjectScope(record, sealedScope);

    if (binding.community_ref !== sealedScope.community_ref) {
      throw new AuthorizationScopeMismatchError({ reason: "community_mismatch" });
    }
    if (binding.community_ref !== record.authorization_scope.community_ref) {
      throw new AuthorizationScopeMismatchError({ reason: "community_mismatch" });
    }

    if (record.selected_deployment_ids === undefined || record.confirmed_at === undefined) {
      throw new OrderBindingRejectedError({
        reason: "missing_confirmation",
        detail: "order admission requires a confirmed resolution selection",
      });
    }

    this.assertNotExpired(record, nowMs);

    if (!digestsEqual(binding.candidate_snapshot_digest, record.candidate_snapshot_digest)) {
      throw new OrderBindingRejectedError({
        reason: "digest_grafting",
        detail: "order candidate_snapshot_digest must match the persisted server digest",
      });
    }

    const decision = await runEffect(
      evaluateAdmissionCompatibility(
        record,
        sealedCapability,
        binding.candidate_snapshot_digest,
      ),
    );
    return deepCloneFreeze(decision);
  }

  private mapRefreshResult(
    resolutionId: string,
    command: ResolutionRefreshCommand,
    result:
      | {
          readonly kind: "refreshed";
          readonly record: ConfirmedResolutionRecord;
          readonly selection_stale?: ResolutionSelectionStaleOutcome;
        }
      | {
          readonly kind: "replay";
          readonly record: ConfirmedResolutionRecord;
          readonly selection_stale?: ResolutionSelectionStaleOutcome;
        }
      | { readonly kind: "conflict" }
      | { readonly kind: "version_conflict"; readonly record: ConfirmedResolutionRecord }
      | { readonly kind: "subject_mismatch" }
      | { readonly kind: "not_found" },
  ): ResolutionPublicProjection {
    if (result.kind === "not_found") {
      throw new ResolutionNotFoundError({ resolution_id: resolutionId });
    }
    if (result.kind === "conflict") {
      throw new IdempotencyConflictError({
        operation: "refresh",
        idempotency_key: command.idempotency_key,
        reason: "command_mismatch",
      });
    }
    if (result.kind === "subject_mismatch") {
      throw new AuthorizationScopeMismatchError({ reason: "cross_subject_replay" });
    }
    if (result.kind === "version_conflict") {
      throw new ConfirmationVersionConflictError({
        resolution_id: resolutionId,
        expected_confirmation_version: command.expected_confirmation_version,
        current_confirmation_version: result.record.confirmation_version,
      });
    }
    if (result.selection_stale !== undefined) {
      throw new SelectionStaleError({
        resolution_id: resolutionId,
        reason: result.selection_stale.reason,
        previous_candidate_snapshot_digest:
          result.selection_stale.previous_candidate_snapshot_digest,
        current_candidate_snapshot_digest:
          result.selection_stale.current_candidate_snapshot_digest,
      });
    }
    return sealProjection(result.record);
  }

  private assertSubjectScope(
    record: ConfirmedResolutionRecord,
    scope: AuthorizationScope,
  ): void {
    if (record.requester_subject !== scope.subject_id) {
      throw new AuthorizationScopeMismatchError({ reason: "cross_subject_replay" });
    }
    if (!scopesMatch(record.authorization_scope, scope)) {
      if (record.authorization_scope.permission !== scope.permission) {
        throw new AuthorizationScopeMismatchError({ reason: "permission_revoked" });
      }
      throw new AuthorizationScopeMismatchError({ reason: "scope_mismatch" });
    }
  }

  private assertNotExpired(record: ConfirmedResolutionRecord, nowMs: number): void {
    if (Date.parse(record.expires_at) <= nowMs) {
      throw new ResolutionExpiredError({
        resolution_id: record.resolution_id,
        expires_at: record.expires_at,
      });
    }
  }
}
