import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { CapabilityRegistryVersion, CollectionCandidate } from "@freeside/collection-protocol";
import type {
  AuthorizationScope,
  LocalCapabilitySnapshot,
  ResolutionCreateCommand,
  ResolutionRefreshCommand,
  ResolutionRequestMaterial,
} from "@freeside/collection-resolution-protocol";
import {
  AuthorizationScopeMismatchError,
  CapabilityViewStaleError,
  ConcurrentConfirmationError,
  ContractIntegrityError,
  digestCandidateSnapshot,
  IdempotencyConflictError,
  ImmutableRequestMismatchError,
  isDeepFrozen,
  OrderBindingRejectedError,
  RESOLUTION_TTL_MS,
  ResolutionExpiredError,
  requestMaterialFromCreate,
  SelectionRejectedError,
  SelectionStaleError,
} from "@freeside/collection-resolution-protocol";
import {
  CollectionResolutionService,
  InMemoryResolutionStore,
  type SonarResolveProbePort,
} from "../index.js";

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../protocol/collection-resolution/fixtures",
);

const readJson = (name: string): unknown =>
  JSON.parse(readFileSync(join(fixturesDir, name), "utf8"));

const createCommand = readJson("create-command.valid.json") as ResolutionCreateCommand;
const scope = readJson("authorization-scope.valid.json") as AuthorizationScope;
const evmSnapshot = readJson("candidate-snapshot.valid.json") as {
  candidates: CollectionCandidate[];
  diagnostics: {
    schema_version: 1;
    searched: Array<{
      schema_version: 1;
      network_namespace: "eip155" | "solana";
      network_reference: string;
    }>;
    timed_out: [];
    unavailable: [];
  };
};
const multiSnapshot = readJson("equivalence-candidate-snapshot.valid.json") as {
  candidates: CollectionCandidate[];
  diagnostics: typeof evmSnapshot.diagnostics;
};

const registry: CapabilityRegistryVersion = {
  registry_epoch: "11111111-1111-4111-8111-111111111111",
  registry_sequence: "10",
};

class MutableClock {
  constructor(public now = Date.parse("2026-07-16T08:00:00Z")) {}
  nowMs(): number {
    return this.now;
  }
  advance(ms: number): void {
    this.now += ms;
  }
}

class RecordingSonar implements SonarResolveProbePort {
  probes = 0;
  lastIdentifier: string | undefined;
  nextCandidates: ReadonlyArray<CollectionCandidate> = structuredClone(evmSnapshot.candidates);
  nextDiagnostics = structuredClone(evmSnapshot.diagnostics);
  nextRegistry = structuredClone(registry);
  persistenceTouched = false;

  async resolveProbe(input: {
    readonly identifier: string;
    readonly environment: "mainnet";
    readonly report_type: string;
    readonly report_version: string;
  }): Promise<{
    capability_snapshot_version: CapabilityRegistryVersion;
    candidates: ReadonlyArray<CollectionCandidate>;
    diagnostics: typeof evmSnapshot.diagnostics;
  }> {
    this.probes += 1;
    this.lastIdentifier = input.identifier;
    return {
      capability_snapshot_version: structuredClone(this.nextRegistry),
      candidates: structuredClone(this.nextCandidates),
      diagnostics: structuredClone(this.nextDiagnostics),
    };
  }
}

const snapshotDigestOf = async (
  candidates: ReadonlyArray<CollectionCandidate>,
  diagnostics: {
    schema_version: 1;
    searched: ReadonlyArray<{
      schema_version: 1;
      network_namespace: "eip155" | "solana";
      network_reference: string;
    }>;
    timed_out: ReadonlyArray<unknown>;
    unavailable: ReadonlyArray<unknown>;
  },
) =>
  Effect.runPromise(
    digestCandidateSnapshot({
      schema_version: 1,
      candidates: [...candidates],
      diagnostics: diagnostics as typeof evmSnapshot.diagnostics,
    }),
  );

const localViewFor = (
  candidate: CollectionCandidate,
  overrides: Partial<LocalCapabilitySnapshot["views"][number]> = {},
  registryVersion: CapabilityRegistryVersion = registry,
): LocalCapabilitySnapshot => {
  const deployment = candidate.identity.deployments[0]!;
  return {
    schema_version: 1,
    registry_version: registryVersion,
    receipt_age_ms: 1_000,
    staleness_ceiling_ms: 60_000,
    views: [
      {
        schema_version: 1,
        deployment_id: deployment.deployment_id,
        network_namespace: deployment.network.network_namespace,
        network_reference: deployment.network.network_reference,
        normalized_address: deployment.normalized_address,
        operation: "prepare",
        health: "available",
        supported_standards: [candidate.token_standard.value],
        finality_policy_version: candidate.finality_policies[0]!.finality_policy_version,
        equivalence_revoked: false,
        authorization_valid: true,
        identity_digest: deployment.deployment_id,
        ...overrides,
      },
    ],
  };
};

const makeService = (clock = new MutableClock(), sonar = new RecordingSonar()) => {
  const store = new InMemoryResolutionStore();
  let seq = 0;
  const service = new CollectionResolutionService({
    store,
    sonar,
    clock,
    ids: { nextId: () => `res_test_${++seq}` },
  });
  return { service, store, clock, sonar };
};

const confirmFirst = async (
  service: CollectionResolutionService,
  created: Awaited<ReturnType<CollectionResolutionService["create"]>>,
  key = "confirm-base",
) => {
  const snapshotDigest = await snapshotDigestOf(created.candidates, created.diagnostics);
  return service.confirm(
    created.resolution_id,
    {
      schema_version: 1,
      candidate_snapshot_digest: snapshotDigest,
      selected_deployment_ids: [created.candidates[0]!.identity.deployments[0]!.deployment_id],
      expected_confirmation_version: 0,
      idempotency_key: key,
    },
    scope,
  );
};

describe("CR-006 Ordering resolution service", () => {
  it("strict-decodes Sonar candidate, diagnostics, and registry output before create persistence", async () => {
    const candidateCase = makeService();
    Reflect.set(candidateCase.sonar.nextCandidates[0]!, "recognition", "invented");
    await expect(candidateCase.service.create(createCommand, scope)).rejects.toThrow();
    expect(await candidateCase.store.get("res_test_1")).toBeUndefined();

    const diagnosticsCase = makeService();
    Reflect.set(diagnosticsCase.sonar.nextDiagnostics, "unexpected", true);
    await expect(diagnosticsCase.service.create(createCommand, scope)).rejects.toThrow();
    expect(await diagnosticsCase.store.get("res_test_1")).toBeUndefined();

    const registryCase = makeService();
    Reflect.set(registryCase.sonar.nextRegistry, "unexpected", true);
    await expect(registryCase.service.create(createCommand, scope)).rejects.toThrow();
    expect(await registryCase.store.get("res_test_1")).toBeUndefined();
  });

  it("strict-decodes refreshed probe output before replacing persisted truth", async () => {
    const { service, store, sonar } = makeService();
    const created = await service.create(createCommand, scope);
    const before = await store.get(created.resolution_id);

    Reflect.set(sonar.nextCandidates[0]!, "index_status", "invented");
    await expect(
      service.refresh(
        created.resolution_id,
        {
          schema_version: 1,
          expected_confirmation_version: 0,
          idempotency_key: "refresh-invalid-candidate",
        },
        scope,
      ),
    ).rejects.toThrow();

    expect((await store.get(created.resolution_id))?.candidate_snapshot_digest).toEqual(
      before?.candidate_snapshot_digest,
    );

    sonar.nextCandidates = structuredClone(evmSnapshot.candidates);
    Reflect.set(sonar.nextRegistry, "unexpected", true);
    await expect(
      service.refresh(
        created.resolution_id,
        {
          schema_version: 1,
          expected_confirmation_version: 0,
          idempotency_key: "refresh-invalid-registry",
        },
        scope,
      ),
    ).rejects.toThrow();

    expect((await store.get(created.resolution_id))?.candidate_snapshot_digest).toEqual(
      before?.candidate_snapshot_digest,
    );
  });

  it("retries a generated resolution id collision without replacing the existing session", async () => {
    const store = new InMemoryResolutionStore();
    const sonar = new RecordingSonar();
    const generatedIds = ["res_collision", "res_collision", "res_recovered"];
    let nextId = 0;
    const service = new CollectionResolutionService({
      store,
      sonar,
      ids: {
        nextId: () => generatedIds[nextId++] ?? "res_fallback",
      },
    });

    const first = await service.create(createCommand, scope);
    const second = await service.create(
      { ...createCommand, idempotency_key: "create-after-id-collision" },
      scope,
    );

    expect(first.resolution_id).toBe("res_collision");
    expect(second.resolution_id).toBe("res_recovered");
    expect((await store.get(first.resolution_id))?.original_request).toEqual(
      requestMaterialFromCreate(createCommand),
    );
    expect(await store.get(second.resolution_id)).toBeDefined();
  });

  it("fails with a typed integrity error when unique resolution id allocation is exhausted", async () => {
    const store = new InMemoryResolutionStore();
    const service = new CollectionResolutionService({
      store,
      sonar: new RecordingSonar(),
      ids: { nextId: () => "res_never_unique" },
    });

    await service.create(createCommand, scope);
    await expect(
      service.create(
        { ...createCommand, idempotency_key: "create-exhausted-id-allocation" },
        scope,
      ),
    ).rejects.toBeInstanceOf(ContractIntegrityError);
    expect((await store.get("res_never_unique"))?.original_request).toEqual(
      requestMaterialFromCreate(createCommand),
    );
  });

  it("create replay returns the same resolution; conflicting body yields idempotency conflict", async () => {
    const { service } = makeService();
    const first = await service.create(createCommand, scope);
    const replay = await service.create(createCommand, scope);
    expect(replay.resolution_id).toBe(first.resolution_id);

    await expect(
      service.create({ ...createCommand, report_version: "other.v1" }, scope),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it("concurrent confirms allow one CAS winner and typed loser semantics", async () => {
    const { service } = makeService();
    const created = await service.create(createCommand, scope);
    const deploymentId = created.candidates[0]!.identity.deployments[0]!.deployment_id;
    const snapshotDigest = await snapshotDigestOf(created.candidates, created.diagnostics);

    const winner = await service.confirm(
      created.resolution_id,
      {
        schema_version: 1,
        candidate_snapshot_digest: snapshotDigest,
        selected_deployment_ids: [deploymentId],
        expected_confirmation_version: 0,
        idempotency_key: "confirm-a",
      },
      scope,
    );
    expect(winner.confirmation_version).toBe(1);

    await expect(
      service.confirm(
        created.resolution_id,
        {
          schema_version: 1,
          candidate_snapshot_digest: snapshotDigest,
          selected_deployment_ids: [deploymentId],
          expected_confirmation_version: 0,
          idempotency_key: "confirm-b",
        },
        scope,
      ),
    ).rejects.toBeInstanceOf(ConcurrentConfirmationError);
  });

  it("reviewer probe 1: refresh is bound to the immutable original request", async () => {
    const { service, store, sonar } = makeService();
    const created = await service.create(createCommand, scope);
    await confirmFirst(service, created, "confirm-bind");

    const persisted = await store.get(created.resolution_id);
    expect(persisted?.original_request).toEqual(requestMaterialFromCreate(createCommand));

    // Automatic re-probe uses persisted original request — no client identifier needed.
    const refreshed = await service.refresh(
      created.resolution_id,
      {
        schema_version: 1,
        expected_confirmation_version: 1,
        idempotency_key: "refresh-auto",
      },
      scope,
    );
    expect(sonar.lastIdentifier).toBe(createCommand.identifier);
    expect(refreshed.resolution_id).toBe(created.resolution_id);

    // Supplied request matching original is accepted.
    await service.refresh(
      created.resolution_id,
      {
        schema_version: 1,
        expected_confirmation_version: 2,
        idempotency_key: "refresh-match",
      },
      scope,
      requestMaterialFromCreate(createCommand),
    );

    // Collection B under original identity is refused before probe retarget.
    const probesBefore = sonar.probes;
    const foreign: ResolutionRequestMaterial = {
      ...requestMaterialFromCreate(createCommand),
      identifier: "0xDeadBeefDeadBeefDeadBeefDeadBeefDeadBeef",
    };
    await expect(
      service.refresh(
        created.resolution_id,
        {
          schema_version: 1,
          expected_confirmation_version: 3,
          idempotency_key: "refresh-foreign",
        },
        scope,
        foreign,
      ),
    ).rejects.toBeInstanceOf(ImmutableRequestMismatchError);
    expect(sonar.probes).toBe(probesBefore);
  });

  it("reviewer probe 2: persisted truth is deeply immutable outside Ordering CAS", async () => {
    const { service, store, sonar } = makeService();
    const created = await service.create(createCommand, scope);
    const createdExpires = created.expires_at;
    expect(isDeepFrozen(created)).toBe(true);

    // Mutating create output must throw / no-op and never change store truth.
    expect(() => {
      (created.candidates[0] as { recognition: string }).recognition = "unrecognized";
    }).toThrow();

    const afterMutateOutput = await store.get(created.resolution_id);
    expect(afterMutateOutput?.candidate_snapshot.candidates[0]?.recognition).toBe("recognized");
    expect(afterMutateOutput?.candidate_snapshot.candidates[0]?.identity.name).toBe("Mibera");
    expect(isDeepFrozen(afterMutateOutput)).toBe(true);

    // Mutating Sonar source objects after create must not alias into the store.
    (sonar.nextCandidates[0] as { recognition: string }).recognition = "ambiguous";
    const afterSourceMutate = await store.get(created.resolution_id);
    expect(afterSourceMutate?.candidate_snapshot.candidates[0]?.recognition).toBe("recognized");

    const confirmed = await confirmFirst(service, created, "confirm-immut");
    expect(isDeepFrozen(confirmed)).toBe(true);
    expect(() => {
      (confirmed.candidates[0] as { index_status: string }).index_status = "failed";
    }).toThrow();
    const afterConfirmMutate = await store.get(created.resolution_id);
    expect(afterConfirmMutate?.candidate_snapshot.candidates[0]?.index_status).toBe("indexed");
    expect(afterConfirmMutate?.expires_at).toBe(createdExpires);

    // Nested deployment mutation on a returned clone cannot invalidate store digest.
    const projected = await store.get(created.resolution_id);
    const digestBefore = projected!.candidate_snapshot_digest.digest;
    expect(() => {
      (
        projected!.candidate_snapshot.candidates[0]!.identity.deployments[0] as {
          normalized_address: string;
        }
      ).normalized_address = "0xhijacked";
    }).toThrow();
    const digestAfter = (await store.get(created.resolution_id))!.candidate_snapshot_digest.digest;
    expect(digestAfter).toBe(digestBefore);
  });

  it("reviewer probe 3: every selection-relevant field participates in stale detection", async () => {
    const { service, store, sonar } = makeService();
    const created = await service.create(createCommand, scope);
    await confirmFirst(service, created, "confirm-stale-fields");

    // recognized/indexed/ready -> unrecognized/failed/blocked
    sonar.nextCandidates = structuredClone(evmSnapshot.candidates).map((candidate) => ({
      ...candidate,
      recognition: "unrecognized" as const,
      index_status: "failed" as const,
      report_readiness: "blocked" as const,
      metadata_quality: "unavailable" as const,
    }));

    await expect(
      service.refresh(
        created.resolution_id,
        {
          schema_version: 1,
          expected_confirmation_version: 1,
          idempotency_key: "refresh-readiness",
        },
        scope,
      ),
    ).rejects.toMatchObject({
      _tag: "SelectionStaleError",
      reason: "recognition_changed",
    });

    const persisted = await store.get(created.resolution_id);
    expect(persisted?.selected_deployment_ids).toBeUndefined();
    expect(persisted?.candidate_snapshot.candidates[0]?.recognition).toBe("unrecognized");
  });

  it("reviewer probe 4: compatible newer capability snapshots are checked field-by-field", async () => {
    const { service } = makeService();
    const created = await service.create(createCommand, scope);
    const snapshotDigest = await snapshotDigestOf(created.candidates, created.diagnostics);
    await confirmFirst(service, created, "confirm-cap");

    const admitted = await service.admit(
      {
        schema_version: 1,
        resolution_id: created.resolution_id,
        candidate_snapshot_digest: snapshotDigest,
        community_ref: "community-alpha",
      },
      scope,
      localViewFor(
        created.candidates[0]!,
        {},
        { registry_epoch: registry.registry_epoch, registry_sequence: "11" },
      ),
    );
    expect(admitted.decision).toBe("admit");

    // A recognize snapshot cannot satisfy prepare admission.
    await expect(
      service.admit(
        {
          schema_version: 1,
          resolution_id: created.resolution_id,
          candidate_snapshot_digest: snapshotDigest,
          community_ref: "community-alpha",
        },
        scope,
        localViewFor(created.candidates[0]!, { operation: "recognize" }),
      ),
    ).rejects.toMatchObject({
      _tag: "SelectionStaleError",
      reason: "operation_incompatible",
    });

    // Forged/mismatched identity_digest fails.
    await expect(
      service.admit(
        {
          schema_version: 1,
          resolution_id: created.resolution_id,
          candidate_snapshot_digest: snapshotDigest,
          community_ref: "community-alpha",
        },
        scope,
        localViewFor(created.candidates[0]!, {
          identity_digest: {
            algorithm: "sha-256",
            domain: "collection.deployment",
            major_version: 1,
            digest: "f".repeat(64),
          },
        }),
      ),
    ).rejects.toMatchObject({
      _tag: "SelectionStaleError",
      reason: "identity_digest_mismatch",
    });
  });

  it("reviewer probe 5: refresh idempotency fingerprints the exact command", async () => {
    const { service, clock, sonar } = makeService();
    const created = await service.create(createCommand, scope);
    await confirmFirst(service, created, "confirm-idem");

    clock.advance(RESOLUTION_TTL_MS + 1);
    const first = await service.refresh(
      created.resolution_id,
      {
        schema_version: 1,
        expected_confirmation_version: 1,
        idempotency_key: "refresh-exact",
      },
      scope,
    );
    expect(first.confirmation_version).toBe(2);
    const probesAfterFirst = sonar.probes;

    // Same key + identical canonical command replays without re-probe.
    const replay = await service.refresh(
      created.resolution_id,
      {
        schema_version: 1,
        expected_confirmation_version: 1,
        idempotency_key: "refresh-exact",
      },
      scope,
    );
    expect(replay.confirmation_version).toBe(2);
    expect(sonar.probes).toBe(probesAfterFirst);

    // Same key + any changed field conflicts before probing.
    const probesBeforeConflict = sonar.probes;
    await expect(
      service.refresh(
        created.resolution_id,
        {
          schema_version: 1,
          expected_confirmation_version: 2,
          idempotency_key: "refresh-exact",
        },
        scope,
      ),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    expect(sonar.probes).toBe(probesBeforeConflict);
  });

  it("reviewer probe 6: confirmation never extends expiry", async () => {
    const { service, store, clock } = makeService();
    const created = await service.create(createCommand, scope);
    const createExpires = created.expires_at;
    expect(Date.parse(createExpires) - clock.nowMs()).toBe(RESOLUTION_TTL_MS);

    clock.advance(60_000);
    const confirmed = await confirmFirst(service, created, "confirm-ttl");
    expect(confirmed.expires_at).toBe(createExpires);
    expect(confirmed.confirmation_version).toBe(1);

    const persisted = await store.get(created.resolution_id);
    expect(persisted?.expires_at).toBe(createExpires);

    // Only unchanged expired refresh establishes the next 15-minute expiry.
    clock.advance(RESOLUTION_TTL_MS);
    expect(Date.parse(createExpires)).toBeLessThanOrEqual(clock.nowMs());
    const refreshed = await service.refresh(
      created.resolution_id,
      {
        schema_version: 1,
        expected_confirmation_version: 1,
        idempotency_key: "refresh-extend",
      },
      scope,
    );
    expect(refreshed.confirmation_version).toBe(2);
    expect(Date.parse(refreshed.expires_at)).toBe(clock.nowMs() + RESOLUTION_TTL_MS);
    expect(refreshed.selected_deployment_ids).toEqual(confirmed.selected_deployment_ids);
  });

  it("expired byte-equivalent refresh preserves confirmation and advances CAS", async () => {
    const { service, clock, sonar } = makeService();
    const created = await service.create(createCommand, scope);
    const confirmed = await confirmFirst(service, created, "confirm-keep");

    clock.advance(RESOLUTION_TTL_MS + 1);
    await expect(
      service.confirm(
        created.resolution_id,
        {
          schema_version: 1,
          candidate_snapshot_digest: await snapshotDigestOf(
            created.candidates,
            created.diagnostics,
          ),
          selected_deployment_ids: [
            created.candidates[0]!.identity.deployments[0]!.deployment_id,
          ],
          expected_confirmation_version: 1,
          idempotency_key: "confirm-after-expiry",
        },
        scope,
      ),
    ).rejects.toBeInstanceOf(ResolutionExpiredError);

    const probesBefore = sonar.probes;
    const refreshed = await service.refresh(
      created.resolution_id,
      {
        schema_version: 1,
        expected_confirmation_version: 1,
        idempotency_key: "refresh-unchanged",
      },
      scope,
    );
    expect(sonar.probes).toBe(probesBefore + 1);
    expect(refreshed.confirmation_version).toBe(2);
    expect(refreshed.selected_deployment_ids).toEqual(confirmed.selected_deployment_ids);
    expect(refreshed.confirmed_at).toBe(confirmed.confirmed_at);
    expect(Date.parse(refreshed.expires_at)).toBeGreaterThan(clock.nowMs());
  });

  it("changed deployment grouping yields selection_stale and clears selection", async () => {
    const { service, store, sonar } = makeService();
    const created = await service.create(createCommand, scope);
    await confirmFirst(service, created, "confirm-stale-base");

    sonar.nextCandidates = multiSnapshot.candidates;
    sonar.nextDiagnostics = multiSnapshot.diagnostics;
    const refreshCommand: ResolutionRefreshCommand = {
      schema_version: 1,
      expected_confirmation_version: 1,
      idempotency_key: "refresh-regroup",
    };
    let firstStale: SelectionStaleError | undefined;
    try {
      await service.refresh(
        created.resolution_id,
        refreshCommand,
        scope,
      );
    } catch (error) {
      if (!(error instanceof SelectionStaleError)) throw error;
      firstStale = error;
    }
    if (firstStale === undefined) {
      throw new Error("expected changed deployment grouping to produce selection_stale");
    }

    const probesAfterFirstAttempt = sonar.probes;
    sonar.nextCandidates = evmSnapshot.candidates;
    sonar.nextDiagnostics = evmSnapshot.diagnostics;
    let replayedStale: SelectionStaleError | undefined;
    try {
      await service.refresh(created.resolution_id, refreshCommand, scope);
    } catch (error) {
      if (!(error instanceof SelectionStaleError)) throw error;
      replayedStale = error;
    }
    if (replayedStale === undefined) {
      throw new Error("expected exact refresh retry to replay selection_stale");
    }

    expect(sonar.probes).toBe(probesAfterFirstAttempt);
    expect(replayedStale.reason).toBe(firstStale.reason);
    expect(replayedStale.previous_candidate_snapshot_digest).toEqual(
      firstStale.previous_candidate_snapshot_digest,
    );
    expect(replayedStale.current_candidate_snapshot_digest).toEqual(
      firstStale.current_candidate_snapshot_digest,
    );

    const persisted = await store.get(created.resolution_id);
    expect(persisted?.selected_deployment_ids).toBeUndefined();
    expect(persisted?.confirmation_version).toBe(2);
  });

  it("rejects selection composition attacks and client digest forgery", async () => {
    const { service, sonar } = makeService();
    sonar.nextCandidates = [...evmSnapshot.candidates, ...multiSnapshot.candidates];
    const created = await service.create(
      { ...createCommand, idempotency_key: "create-compose" },
      scope,
    );
    const snapshotDigest = await snapshotDigestOf(created.candidates, created.diagnostics);
    const left = created.candidates[0]!.identity.deployments[0]!.deployment_id;
    const right = created.candidates[1]!.identity.deployments[0]!.deployment_id;
    const composed = [left, right].slice().sort((a, b) =>
      a.digest < b.digest ? -1 : a.digest > b.digest ? 1 : 0,
    );

    await expect(
      service.confirm(
        created.resolution_id,
        {
          schema_version: 1,
          candidate_snapshot_digest: snapshotDigest,
          selected_deployment_ids: composed,
          expected_confirmation_version: 0,
          idempotency_key: "confirm-compose",
        },
        scope,
      ),
    ).rejects.toBeInstanceOf(SelectionRejectedError);

    await expect(
      service.confirm(
        created.resolution_id,
        {
          schema_version: 1,
          candidate_snapshot_digest: { ...snapshotDigest, digest: "f".repeat(64) },
          selected_deployment_ids: [left],
          expected_confirmation_version: 0,
          idempotency_key: "confirm-forge",
        },
        scope,
      ),
    ).rejects.toMatchObject({ reason: "client_digest_forgery" });
  });

  it("scope mismatch, cross-subject replay, and raw candidate order fields fail closed", async () => {
    const { service } = makeService();
    const created = await service.create(createCommand, scope);
    const snapshotDigest = await snapshotDigestOf(created.candidates, created.diagnostics);
    await confirmFirst(service, created, "confirm-auth");

    await expect(
      service.admit(
        {
          schema_version: 1,
          resolution_id: created.resolution_id,
          candidate_snapshot_digest: snapshotDigest,
          community_ref: "community-beta",
        },
        { ...scope, community_ref: "community-beta" },
        localViewFor(created.candidates[0]!),
      ),
    ).rejects.toBeInstanceOf(AuthorizationScopeMismatchError);

    await expect(
      service.admit(
        {
          schema_version: 1,
          resolution_id: created.resolution_id,
          candidate_snapshot_digest: snapshotDigest,
          community_ref: "community-alpha",
        },
        { ...scope, subject_id: "subject-bob" },
        localViewFor(created.candidates[0]!),
      ),
    ).rejects.toBeInstanceOf(AuthorizationScopeMismatchError);

    await expect(
      service.admit(
        {
          schema_version: 1,
          resolution_id: created.resolution_id,
          candidate_snapshot_digest: snapshotDigest,
          community_ref: "community-alpha",
          candidates: created.candidates,
        },
        scope,
        localViewFor(created.candidates[0]!),
      ),
    ).rejects.toBeInstanceOf(Error);
  });

  it("admission accepts compatible newer snapshot and rejects stale/revoked local capability", async () => {
    const { service } = makeService();
    const created = await service.create(createCommand, scope);
    const snapshotDigest = await snapshotDigestOf(created.candidates, created.diagnostics);
    await confirmFirst(service, created, "confirm-admit");

    const admitted = await service.admit(
      {
        schema_version: 1,
        resolution_id: created.resolution_id,
        candidate_snapshot_digest: snapshotDigest,
        community_ref: "community-alpha",
      },
      scope,
      localViewFor(
        created.candidates[0]!,
        {},
        { registry_epoch: registry.registry_epoch, registry_sequence: "11" },
      ),
    );
    expect(admitted.decision).toBe("admit");

    await expect(
      service.admit(
        {
          schema_version: 1,
          resolution_id: created.resolution_id,
          candidate_snapshot_digest: snapshotDigest,
          community_ref: "community-alpha",
        },
        scope,
        { ...localViewFor(created.candidates[0]!), views: [] },
      ),
    ).rejects.toBeInstanceOf(CapabilityViewStaleError);

    await expect(
      service.admit(
        {
          schema_version: 1,
          resolution_id: created.resolution_id,
          candidate_snapshot_digest: snapshotDigest,
          community_ref: "community-alpha",
        },
        scope,
        localViewFor(created.candidates[0]!, { health: "disabled" }),
      ),
    ).rejects.toBeInstanceOf(SelectionStaleError);

    await expect(
      service.admit(
        {
          schema_version: 1,
          resolution_id: created.resolution_id,
          candidate_snapshot_digest: snapshotDigest,
          community_ref: "community-alpha",
        },
        scope,
        localViewFor(created.candidates[0]!, { equivalence_revoked: true }),
      ),
    ).rejects.toBeInstanceOf(SelectionStaleError);

    await expect(
      service.admit(
        {
          schema_version: 1,
          resolution_id: created.resolution_id,
          candidate_snapshot_digest: { ...snapshotDigest, digest: "a".repeat(64) },
          community_ref: "community-alpha",
        },
        scope,
        localViewFor(created.candidates[0]!),
      ),
    ).rejects.toBeInstanceOf(OrderBindingRejectedError);
  });

  it("idempotency retention boundaries evict keys and allow reuse after expiry", async () => {
    const clock = new MutableClock();
    const store = new InMemoryResolutionStore({ idempotency_retention_ms: 1_000 });
    const sonar = new RecordingSonar();
    const service = new CollectionResolutionService({
      store,
      sonar,
      clock,
      ids: { nextId: () => `res_retention_${clock.now}` },
    });

    await service.create(createCommand, scope);
    expect(store.idempotencySize()).toBe(1);

    clock.advance(1_001);
    await store.pruneIdempotency(clock.nowMs(), 1_000);
    expect(store.idempotencySize()).toBe(0);

    const recreated = await service.create(
      { ...createCommand, report_version: "gate-leak.v2" },
      scope,
    );
    expect(recreated.resolution_id).toContain("res_retention_");
  });

  it("standard and authorization drift at admission yield selection_stale", async () => {
    const { service } = makeService();
    const created = await service.create(createCommand, scope);
    const snapshotDigest = await snapshotDigestOf(created.candidates, created.diagnostics);
    await confirmFirst(service, created, "confirm-drift");

    await expect(
      service.admit(
        {
          schema_version: 1,
          resolution_id: created.resolution_id,
          candidate_snapshot_digest: snapshotDigest,
          community_ref: "community-alpha",
        },
        scope,
        localViewFor(created.candidates[0]!, {
          supported_standards: ["erc1155"],
        }),
      ),
    ).rejects.toMatchObject({ _tag: "SelectionStaleError", reason: "standard_changed" });

    await expect(
      service.admit(
        {
          schema_version: 1,
          resolution_id: created.resolution_id,
          candidate_snapshot_digest: snapshotDigest,
          community_ref: "community-alpha",
        },
        scope,
        localViewFor(created.candidates[0]!, {
          authorization_valid: false,
        }),
      ),
    ).rejects.toMatchObject({ _tag: "SelectionStaleError", reason: "authorization_changed" });

    await expect(
      service.admit(
        {
          schema_version: 1,
          resolution_id: created.resolution_id,
          candidate_snapshot_digest: snapshotDigest,
          community_ref: "community-alpha",
        },
        scope,
        localViewFor(created.candidates[0]!, {
          finality_policy_version: "ethereum-finalized.v999",
        }),
      ),
    ).rejects.toMatchObject({ _tag: "SelectionStaleError", reason: "finality_policy_changed" });
  });

  it("canonical confirm replay and concurrent CAS boundaries remain exact", async () => {
    const { service } = makeService();
    const created = await service.create(createCommand, scope);
    const snapshotDigest = await snapshotDigestOf(created.candidates, created.diagnostics);
    const command = {
      schema_version: 1 as const,
      candidate_snapshot_digest: snapshotDigest,
      selected_deployment_ids: [
        created.candidates[0]!.identity.deployments[0]!.deployment_id,
      ],
      expected_confirmation_version: 0,
      idempotency_key: "confirm-canonical-replay",
    };

    const first = await service.confirm(created.resolution_id, command, scope);
    const replay = await service.confirm(created.resolution_id, command, scope);
    expect(replay).toEqual(first);
    expect(replay.expires_at).toBe(created.expires_at);

    await expect(
      service.confirm(
        created.resolution_id,
        { ...command, idempotency_key: "confirm-canonical-conflict", expected_confirmation_version: 0 },
        scope,
      ),
    ).rejects.toBeInstanceOf(ConcurrentConfirmationError);
  });

  it("Sonar probe port never receives store access", async () => {
    const { service, sonar, store } = makeService();
    await service.create(createCommand, scope);
    expect(sonar.persistenceTouched).toBe(false);
    expect(await store.get("res_test_1")).toBeDefined();
  });

  it("revision-2: historical create A→confirm B→replay A returns sealed create response", async () => {
    const { service, store, sonar } = makeService();
    const created = await service.create(createCommand, scope);
    expect(created.confirmation_version).toBe(0);
    expect(created.selected_deployment_ids).toBeUndefined();
    const probesAfterCreate = sonar.probes;

    const confirmed = await confirmFirst(service, created, "confirm-after-a");
    expect(confirmed.confirmation_version).toBe(1);
    expect(confirmed.selected_deployment_ids).toBeDefined();

    const current = await store.get(created.resolution_id);
    expect(current?.confirmation_version).toBe(1);
    expect(current?.selected_deployment_ids).toEqual(confirmed.selected_deployment_ids);

    // Replay create returns exact historical response A — not current B truth.
    const replay = await service.create(createCommand, scope);
    expect(sonar.probes).toBe(probesAfterCreate);
    expect(replay.resolution_id).toBe(created.resolution_id);
    expect(replay.confirmation_version).toBe(0);
    expect(replay.selected_deployment_ids).toBeUndefined();
    expect(replay.confirmed_at).toBeUndefined();
    expect(replay.expires_at).toBe(created.expires_at);
    expect(replay).toEqual(created);

    // Current store truth remains B — replay did not roll state back.
    const stillCurrent = await store.get(created.resolution_id);
    expect(stillCurrent?.confirmation_version).toBe(1);
    expect(stillCurrent?.selected_deployment_ids).toEqual(confirmed.selected_deployment_ids);
    expect(stillCurrent?.confirmed_at).toBe(confirmed.confirmed_at);
  });

  it("revision-2: duplicate capability views fail closed; safe-first/disabled-second never first-matches", async () => {
    const { service } = makeService();
    const created = await service.create(createCommand, scope);
    const snapshotDigest = await snapshotDigestOf(created.candidates, created.diagnostics);
    await confirmFirst(service, created, "confirm-dup-cap");

    const safe = localViewFor(created.candidates[0]!);
    const safeView = safe.views[0]!;
    const disabledView = { ...safeView, health: "disabled" as const };

    // Identical duplicates fail closed.
    await expect(
      service.admit(
        {
          schema_version: 1,
          resolution_id: created.resolution_id,
          candidate_snapshot_digest: snapshotDigest,
          community_ref: "community-alpha",
        },
        scope,
        { ...safe, views: [safeView, { ...safeView }] },
      ),
    ).rejects.toMatchObject({
      _tag: "ContractIntegrityError",
      contract: "LocalCapabilitySnapshot",
    });

    // Contradictory duplicates (safe first, disabled second) fail closed — no first-match.
    await expect(
      service.admit(
        {
          schema_version: 1,
          resolution_id: created.resolution_id,
          candidate_snapshot_digest: snapshotDigest,
          community_ref: "community-alpha",
        },
        scope,
        { ...safe, views: [safeView, disabledView] },
      ),
    ).rejects.toMatchObject({
      _tag: "ContractIntegrityError",
      contract: "LocalCapabilitySnapshot",
    });

    // Unique prepare view still admits.
    const admitted = await service.admit(
      {
        schema_version: 1,
        resolution_id: created.resolution_id,
        candidate_snapshot_digest: snapshotDigest,
        community_ref: "community-alpha",
      },
      scope,
      safe,
    );
    expect(admitted.decision).toBe("admit");
  });

  it("revision-2: reordered create replays without probe; semantic change conflicts before probe", async () => {
    const { service, sonar } = makeService();
    const first = await service.create(createCommand, scope);
    const probesAfterCreate = sonar.probes;

    // Property insertion order cannot alter identity.
    const reordered = {
      idempotency_key: createCommand.idempotency_key,
      community_ref: createCommand.community_ref,
      report_version: createCommand.report_version,
      report_type: createCommand.report_type,
      environment: createCommand.environment,
      identifier: createCommand.identifier,
      schema_version: createCommand.schema_version,
    } as ResolutionCreateCommand;
    const replay = await service.create(reordered, scope);
    expect(sonar.probes).toBe(probesAfterCreate);
    expect(replay).toEqual(first);

    // True semantic change conflicts before Sonar probe.
    const probesBeforeConflict = sonar.probes;
    await expect(
      service.create({ ...createCommand, report_version: "gate-leak.v2" }, scope),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    expect(sonar.probes).toBe(probesBeforeConflict);
  });

  it("revision-2: 1h TTL configuration attempt is ignored in favor of fixed 15m", async () => {
    const clock = new MutableClock();
    const store = new InMemoryResolutionStore();
    const sonar = new RecordingSonar();
    const service = new CollectionResolutionService({
      store,
      sonar,
      clock,
      ids: { nextId: () => "res_ttl_fixed" },
      // Excess/arbitrary ttl_ms must not override protocol RESOLUTION_TTL_MS.
      ...({ ttl_ms: 60 * 60 * 1000 } as object),
    });

    const created = await service.create(createCommand, scope);
    expect(Date.parse(created.expires_at) - clock.nowMs()).toBe(RESOLUTION_TTL_MS);
    expect(Date.parse(created.expires_at) - clock.nowMs()).toBe(900_000);
    expect(Date.parse(created.expires_at) - clock.nowMs()).not.toBe(3_600_000);

    const confirmed = await confirmFirst(service, created, "confirm-ttl-1h");
    expect(confirmed.expires_at).toBe(created.expires_at);

    clock.advance(RESOLUTION_TTL_MS + 1);
    const refreshed = await service.refresh(
      created.resolution_id,
      {
        schema_version: 1,
        expected_confirmation_version: 1,
        idempotency_key: "refresh-ttl-1h",
      },
      scope,
    );
    expect(Date.parse(refreshed.expires_at) - clock.nowMs()).toBe(RESOLUTION_TTL_MS);
  });

  it("revision-2: retention expiry removes historical replay entries at the boundary", async () => {
    const clock = new MutableClock();
    const store = new InMemoryResolutionStore({ idempotency_retention_ms: 500 });
    const sonar = new RecordingSonar();
    const service = new CollectionResolutionService({
      store,
      sonar,
      clock,
      ids: { nextId: () => `res_hist_${clock.now}` },
    });

    const created = await service.create(createCommand, scope);
    await confirmFirst(service, created, "confirm-retention-hist");
    expect(store.idempotencySize()).toBe(2);

    // Within retention: create replay still returns historical unconfirmed snapshot.
    const replayWithin = await service.create(createCommand, scope);
    expect(replayWithin.confirmation_version).toBe(0);
    expect((await store.get(created.resolution_id))?.confirmation_version).toBe(1);

    clock.advance(501);
    await store.pruneIdempotency(clock.nowMs(), 500);
    expect(store.idempotencySize()).toBe(0);

    // After retention eviction, same key is a new command (probe required).
    const probesBefore = sonar.probes;
    const recreated = await service.create(createCommand, scope);
    expect(sonar.probes).toBe(probesBefore + 1);
    expect(recreated.resolution_id).not.toBe(created.resolution_id);
    expect(recreated.confirmation_version).toBe(0);
  });

  it("revision-3: confirm exact-command preflight replays after session expiry without rolling state back", async () => {
    const { service, store, clock } = makeService();
    const created = await service.create(createCommand, scope);
    const snapshotDigest = await snapshotDigestOf(created.candidates, created.diagnostics);
    const confirmCommand = {
      schema_version: 1 as const,
      candidate_snapshot_digest: snapshotDigest,
      selected_deployment_ids: [
        created.candidates[0]!.identity.deployments[0]!.deployment_id,
      ],
      expected_confirmation_version: 0,
      idempotency_key: "confirm-preflight-expiry",
    };

    const confirmed = await service.confirm(created.resolution_id, confirmCommand, scope);
    expect(confirmed.confirmation_version).toBe(1);
    expect(confirmed.expires_at).toBe(created.expires_at);

    clock.advance(RESOLUTION_TTL_MS + 1);
    // Session is expired — fresh confirm with a new key still fails closed.
    await expect(
      service.confirm(
        created.resolution_id,
        { ...confirmCommand, idempotency_key: "confirm-fresh-after-expiry" },
        scope,
      ),
    ).rejects.toBeInstanceOf(ResolutionExpiredError);

    // Identical retained confirm returns sealed historical response before
    // expiry/digest/selection/CAS — current store truth stays expired.
    const replay = await service.confirm(created.resolution_id, confirmCommand, scope);
    expect(replay).toEqual(confirmed);
    expect(replay.confirmation_version).toBe(1);
    expect(replay.expires_at).toBe(created.expires_at);

    const current = await store.get(created.resolution_id);
    expect(current?.confirmation_version).toBe(1);
    expect(current?.expires_at).toBe(created.expires_at);
    expect(Date.parse(current!.expires_at)).toBeLessThanOrEqual(clock.nowMs());
    expect(current?.selected_deployment_ids).toEqual(confirmed.selected_deployment_ids);
  });

  it("revision-3: confirm same-key changed command conflicts before expiry check", async () => {
    const { service, store, clock, sonar } = makeService();
    sonar.nextCandidates = [...evmSnapshot.candidates, ...multiSnapshot.candidates];
    const created = await service.create(
      { ...createCommand, idempotency_key: "create-confirm-conflict-expiry" },
      scope,
    );
    const snapshotDigest = await snapshotDigestOf(created.candidates, created.diagnostics);
    const left = created.candidates[0]!.identity.deployments[0]!.deployment_id;
    const right = created.candidates[1]!.identity.deployments[0]!.deployment_id;

    const first = await service.confirm(
      created.resolution_id,
      {
        schema_version: 1,
        candidate_snapshot_digest: snapshotDigest,
        selected_deployment_ids: [left],
        expected_confirmation_version: 0,
        idempotency_key: "confirm-conflict-after-expiry",
      },
      scope,
    );
    expect(first.confirmation_version).toBe(1);

    clock.advance(RESOLUTION_TTL_MS + 1);

    // Same key + changed canonical selection conflicts before ResolutionExpiredError.
    await expect(
      service.confirm(
        created.resolution_id,
        {
          schema_version: 1,
          candidate_snapshot_digest: snapshotDigest,
          selected_deployment_ids: [right],
          expected_confirmation_version: 0,
          idempotency_key: "confirm-conflict-after-expiry",
        },
        scope,
      ),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);

    // Current store truth is not rolled back by the conflict path.
    const current = await store.get(created.resolution_id);
    expect(current?.confirmation_version).toBe(1);
    expect(current?.selected_deployment_ids).toEqual([left]);
    expect(Date.parse(current!.expires_at)).toBeLessThanOrEqual(clock.nowMs());
  });

  it("revision-3: refresh suppliedRequest excess secret / malformed fail before probe", async () => {
    const { service, sonar } = makeService();
    const created = await service.create(createCommand, scope);
    await confirmFirst(service, created, "confirm-supplied-decode");
    const probesBefore = sonar.probes;
    const original = requestMaterialFromCreate(createCommand);

    await expect(
      service.refresh(
        created.resolution_id,
        {
          schema_version: 1,
          expected_confirmation_version: 1,
          idempotency_key: "refresh-excess-secret",
        },
        scope,
        { ...original, secret: "should-not-enter-fingerprint" },
      ),
    ).rejects.toThrow();
    expect(sonar.probes).toBe(probesBefore);

    await expect(
      service.refresh(
        created.resolution_id,
        {
          schema_version: 1,
          expected_confirmation_version: 1,
          idempotency_key: "refresh-malformed-nested",
        },
        scope,
        {
          ...original,
          environment: { nested: "not-mainnet" },
        },
      ),
    ).rejects.toThrow();
    expect(sonar.probes).toBe(probesBefore);

    await expect(
      service.refresh(
        created.resolution_id,
        {
          schema_version: 1,
          expected_confirmation_version: 1,
          idempotency_key: "refresh-unknown-prop",
        },
        scope,
        { ...original, capability_hint: "prepare" },
      ),
    ).rejects.toThrow();
    expect(sonar.probes).toBe(probesBefore);

    // Changed query/report values that decode still refuse before probe.
    await expect(
      service.refresh(
        created.resolution_id,
        {
          schema_version: 1,
          expected_confirmation_version: 1,
          idempotency_key: "refresh-changed-report",
        },
        scope,
        { ...original, report_version: "gate-leak.v2" },
      ),
    ).rejects.toBeInstanceOf(ImmutableRequestMismatchError);
    expect(sonar.probes).toBe(probesBefore);
  });
});
