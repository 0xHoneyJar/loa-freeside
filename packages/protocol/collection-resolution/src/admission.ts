import { Effect } from "effect";
import type {
  CanonicalEncodingError,
  DigestComputationError,
  VersionedDigest,
} from "@freeside/collection-protocol";
import {
  compareCapabilityRegistryVersions,
  type CapabilityRegistryVersion,
  type CollectionCandidate,
} from "@freeside/collection-protocol";
import type {
  AdmissionDecision,
  ConfirmedResolutionRecord,
  LocalCapabilityDeploymentView,
  LocalCapabilitySnapshot,
} from "./contracts.js";
import { digestKey } from "./contracts.js";
import { digestAdmissionDecision, digestsEqual } from "./digests.js";
import {
  CapabilityViewStaleError,
  SelectionStaleError,
} from "./errors.js";
import { COLLECTION_RESOLUTION_SCHEMA_VERSION } from "./version.js";

/**
 * Resolve exactly one `prepare` view for a selected deployment. Capability
 * snapshots are a unique set keyed by (deployment_id, operation); first-match
 * across contradictory duplicates is never used.
 */
const findPrepareView = (
  snapshot: LocalCapabilitySnapshot,
  deploymentId: VersionedDigest,
): LocalCapabilityDeploymentView | undefined =>
  snapshot.views.find(
    (view) =>
      digestsEqual(view.deployment_id, deploymentId) && view.operation === "prepare",
  );

const findSelectedCandidate = (
  record: ConfirmedResolutionRecord,
  selectedIds: ReadonlyArray<VersionedDigest>,
): CollectionCandidate | undefined => {
  const selectedKeys = new Set(selectedIds.map(digestKey));
  for (const candidate of record.candidate_snapshot.candidates) {
    const overlap = candidate.identity.deployments.some((deployment) =>
      selectedKeys.has(digestKey(deployment.deployment_id)),
    );
    if (overlap) return candidate;
  }
  return undefined;
};

type RegistryRelation = "equal" | "newer";

const requireNewerOrEqual = (
  resolutionId: string,
  required: CapabilityRegistryVersion,
  local: CapabilityRegistryVersion,
): Effect.Effect<RegistryRelation, CapabilityViewStaleError> =>
  compareCapabilityRegistryVersions(local, required).pipe(
    Effect.mapError(
      () =>
        new CapabilityViewStaleError({
          resolution_id: resolutionId,
          required,
          local,
          reason: "epoch_mismatch",
        }),
    ),
    Effect.flatMap((relation) => {
      if (relation === "older") {
        return Effect.fail(
          new CapabilityViewStaleError({
            resolution_id: resolutionId,
            required,
            local,
            reason: "older_than_required",
          }),
        );
      }
      const mapped: RegistryRelation = relation === "equal" ? "equal" : "newer";
      return Effect.succeed(mapped);
    }),
  );

const pushUnique = (
  bucket: Array<SelectionStaleError["reason"]>,
  reason: SelectionStaleError["reason"],
): void => {
  if (!bucket.includes(reason)) bucket.push(reason);
};

/**
 * Admission resolves selected deployments against the exact current local
 * capability view. A newer snapshot is compatible only when every declared
 * safety field remains safe: operation, identity_digest, health/state,
 * standard, finality, identity/equivalence/revocation, authorization, and
 * registry source sequence/version. A recognize-only view cannot satisfy
 * prepare admission. No field may be ignored because a UI omits it.
 */
export const evaluateAdmissionCompatibility = (
  record: ConfirmedResolutionRecord,
  local: LocalCapabilitySnapshot,
  orderDigest: VersionedDigest,
): Effect.Effect<
  AdmissionDecision,
  | SelectionStaleError
  | CapabilityViewStaleError
  | CanonicalEncodingError
  | DigestComputationError
> =>
  Effect.gen(function* () {
    if (record.selected_deployment_ids === undefined || record.confirmed_at === undefined) {
      return yield* Effect.fail(
        new SelectionStaleError({
          resolution_id: record.resolution_id,
          reason: "authorization_changed",
          previous_candidate_snapshot_digest: record.candidate_snapshot_digest,
          current_candidate_snapshot_digest: record.candidate_snapshot_digest,
        }),
      );
    }

    if (!digestsEqual(orderDigest, record.candidate_snapshot_digest)) {
      return yield* Effect.fail(
        new SelectionStaleError({
          resolution_id: record.resolution_id,
          reason: "deployment_changed",
          previous_candidate_snapshot_digest: record.candidate_snapshot_digest,
          current_candidate_snapshot_digest: orderDigest,
        }),
      );
    }

    if (local.receipt_age_ms > local.staleness_ceiling_ms) {
      return yield* Effect.fail(
        new CapabilityViewStaleError({
          resolution_id: record.resolution_id,
          required: record.capability_snapshot_version,
          local: local.registry_version,
          reason: "receipt_stale",
        }),
      );
    }

    if (local.views.length === 0) {
      return yield* Effect.fail(
        new CapabilityViewStaleError({
          resolution_id: record.resolution_id,
          required: record.capability_snapshot_version,
          local: null,
          reason: "missing_view",
        }),
      );
    }

    const relation = yield* requireNewerOrEqual(
      record.resolution_id,
      record.capability_snapshot_version,
      local.registry_version,
    );

    const selected = record.selected_deployment_ids;
    const candidate = findSelectedCandidate(record, selected);
    if (candidate === undefined) {
      return yield* Effect.fail(
        new SelectionStaleError({
          resolution_id: record.resolution_id,
          reason: "identity_drift",
          previous_candidate_snapshot_digest: record.candidate_snapshot_digest,
          current_candidate_snapshot_digest: record.candidate_snapshot_digest,
        }),
      );
    }

    const incompatibilities: Array<SelectionStaleError["reason"]> = [];

    for (const deploymentId of selected) {
      const view = findPrepareView(local, deploymentId);
      if (view === undefined) {
        // Missing prepare (recognize-only or absent) cannot satisfy admission.
        const anyView = local.views.find((entry) =>
          digestsEqual(entry.deployment_id, deploymentId),
        );
        pushUnique(
          incompatibilities,
          anyView === undefined
            ? "local_capability_incompatible"
            : "operation_incompatible",
        );
        continue;
      }

      const deployment = candidate.identity.deployments.find((entry) =>
        digestsEqual(entry.deployment_id, deploymentId),
      );
      if (deployment === undefined) {
        pushUnique(incompatibilities, "identity_drift");
        continue;
      }

      if (!digestsEqual(view.identity_digest, deployment.deployment_id)) {
        pushUnique(incompatibilities, "identity_digest_mismatch");
      }

      if (
        view.network_namespace !== deployment.network.network_namespace ||
        view.network_reference !== deployment.network.network_reference ||
        view.normalized_address !== deployment.normalized_address
      ) {
        pushUnique(incompatibilities, "identity_drift");
      }

      if (view.health === "disabled") {
        pushUnique(incompatibilities, "health_rejects_admission");
      } else if (view.health === "degraded" && relation === "newer") {
        pushUnique(incompatibilities, "health_rejects_admission");
      }

      if (!view.supported_standards.includes(candidate.token_standard.value)) {
        pushUnique(incompatibilities, "standard_changed");
      }

      const expectedFinality = candidate.finality_policies.find(
        (policy) =>
          policy.network.network_namespace === deployment.network.network_namespace &&
          policy.network.network_reference === deployment.network.network_reference,
      );
      if (
        expectedFinality !== undefined &&
        view.finality_policy_version !== expectedFinality.finality_policy_version
      ) {
        pushUnique(incompatibilities, "finality_policy_changed");
      }

      if (view.equivalence_revoked) {
        pushUnique(incompatibilities, "equivalence_revoked");
      }

      if (!view.authorization_valid) {
        pushUnique(incompatibilities, "authorization_changed");
      }
    }

    if (incompatibilities.length > 0) {
      return yield* Effect.fail(
        new SelectionStaleError({
          resolution_id: record.resolution_id,
          reason: incompatibilities[0] ?? "local_capability_incompatible",
          previous_candidate_snapshot_digest: record.candidate_snapshot_digest,
          current_candidate_snapshot_digest: record.candidate_snapshot_digest,
        }),
      );
    }

    const compatibilityDigest = yield* digestAdmissionDecision({
      resolution_id: record.resolution_id,
      candidate_snapshot_digest: record.candidate_snapshot_digest,
      selected_deployment_ids: selected,
      selected_collection_id: record.selected_collection_id ?? null,
      admitted_registry_version: local.registry_version,
      views: local.views
        .filter(
          (view) =>
            view.operation === "prepare" &&
            selected.some((id) => digestsEqual(id, view.deployment_id)),
        )
        .map((view) => ({
          deployment_id: view.deployment_id,
          operation: view.operation,
          health: view.health,
          supported_standards: view.supported_standards,
          finality_policy_version: view.finality_policy_version,
          equivalence_revoked: view.equivalence_revoked,
          authorization_valid: view.authorization_valid,
          identity_digest: view.identity_digest,
          network_namespace: view.network_namespace,
          network_reference: view.network_reference,
          normalized_address: view.normalized_address,
        })),
    });

    const decision: AdmissionDecision = {
      schema_version: COLLECTION_RESOLUTION_SCHEMA_VERSION,
      resolution_id: record.resolution_id,
      candidate_snapshot_digest: record.candidate_snapshot_digest,
      selected_deployment_ids: selected,
      admitted_registry_version: local.registry_version,
      compatibility_digest: compatibilityDigest,
      decision: "admit",
      ...(record.selected_collection_id !== undefined
        ? { selected_collection_id: record.selected_collection_id }
        : {}),
    };
    return decision;
  });
