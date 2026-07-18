/**
 * CR-202 collection-report order admission — resolution revalidation, recipe
 * compilation, and CR-201C admitOrder in one path.
 */

import { createHash, randomUUID } from "node:crypto";
import type {
  AuthorizationScope,
  ConfirmedResolutionRecord,
} from "@freeside/collection-resolution-protocol";
import {
  AuthorizationScopeMismatchError,
  OrderBindingRejectedError,
  ResolutionExpiredError,
  ResolutionNotFoundError,
  SelectionStaleError,
} from "@freeside/collection-resolution-protocol";
import { digestsEqual } from "@freeside/collection-resolution-protocol";
import type { CollectionReportInputs } from "@freeside/ordering-protocol";
import type { CollectionResolutionService } from "./resolution-service.js";
import type { ResolutionStore } from "./resolution-store.js";
import type { PublicAuthorizationService } from "./public-authorization-service.js";
import type { AdmissionCapacityService } from "./admission-capacity-service.js";
import type { OrderStore } from "./store.js";
import { buildLocalCapabilityFromRecord } from "./admission-local-capability.js";
import {
  compileGateLeakRecipe,
  SelectionTooLargeError,
  WorkflowTooLargeError,
} from "./gate-leak-recipe-compiler.js";
import { buildPublicWorkKeyMaterial } from "./shared-preparation-work-key.js";
import type { PublicPreparationWorkKeyMaterial } from "./shared-preparation-types.js";
import { digestOf } from "./digest.js";
import type { RecipeExpansionCertificate } from "./admission-capacity-types.js";

export type CollectionReportAdmissionErrorCode =
  | "invalid_request"
  | "authorization_scope_required"
  | "invalid_authorization_scope"
  | "permission_mismatch"
  | "cross_subject"
  | "scope_tamper"
  | "collection_report_admission_unavailable"
  | "public_authorization_unconfigured"
  | "authorization_denied"
  | "resolution_not_found"
  | "resolution_expired"
  | "selection_stale"
  | "candidate_digest_mismatch"
  | "resolution_scope_mismatch"
  | "selection_too_large"
  | "workflow_too_large"
  | "idempotency_conflict"
  | "capacity_unavailable"
  | "missing_confirmation";

export interface CollectionReportAdmissionDeny {
  readonly status: 400 | 401 | 403 | 409 | 503;
  readonly code: CollectionReportAdmissionErrorCode;
  readonly reason?: string;
}

export interface CollectionReportAdmissionDeps {
  readonly resolutionService: CollectionResolutionService;
  readonly resolutionStore: ResolutionStore;
  readonly publicAuth: PublicAuthorizationService;
  readonly admissionCapacity: AdmissionCapacityService;
  readonly orderStore: OrderStore;
  readonly now: () => number;
}

export interface AdmitCollectionReportInput {
  readonly placed_by: string;
  readonly client_request_id: string;
  readonly binding: CollectionReportInputs;
  readonly authorization_scope: unknown;
}

export type AdmitCollectionReportResult =
  | { readonly kind: "admitted"; readonly order_id: string; readonly replay: boolean }
  | { readonly kind: "deny"; readonly deny: CollectionReportAdmissionDeny };

function communityScopeDigest(communityRef: string): string {
  return createHash("sha256").update(`community:${communityRef}`).digest("hex");
}

function findSelectedCandidate(record: ConfirmedResolutionRecord) {
  const selected = record.selected_deployment_ids ?? [];
  if (selected.length === 0) return undefined;
  const selectedKeys = new Set(selected.map((d) => d.digest));
  for (const candidate of record.candidate_snapshot.candidates) {
    if (
      candidate.identity.deployments.some((d) => selectedKeys.has(d.deployment_id.digest))
    ) {
      return candidate;
    }
  }
  return undefined;
}

export function buildPublicRootWorkKeysFromResolution(
  record: ConfirmedResolutionRecord,
): PublicPreparationWorkKeyMaterial[] {
  const selected = record.selected_deployment_ids ?? [];
  const candidate = findSelectedCandidate(record);
  if (candidate === undefined || selected.length === 0) {
    throw new Error("confirmed resolution missing selected deployments");
  }

  const collectionId =
    record.selected_collection_id ?? candidate.identity.collection_id;
  const shared = {
    collection_id: collectionId,
    deployment_ids: selected,
    finality_policies: candidate.finality_policies,
    source_identity: {
      schema_version: 1 as const,
      producer: "ordering.collection-report.v1",
      upstream_evidence_source: "sonar.public-capability.v1",
    },
    readiness_policy_version: "gate-leak-public-prep.v1",
    adapter_version: "sonar-kitchen.v1",
  };

  return [
    buildPublicWorkKeyMaterial({
      ...shared,
      capability: "collection_identity.v1",
      capability_version: "v1",
    }),
    buildPublicWorkKeyMaterial({
      ...shared,
      capability: "ownership_index.v1",
      capability_version: "v1",
    }),
  ];
}

export function mapCollectionReportAdmissionError(
  err: unknown,
): CollectionReportAdmissionDeny | undefined {
  if (err instanceof ResolutionNotFoundError) {
    return { status: 409, code: "resolution_not_found" };
  }
  if (err instanceof ResolutionExpiredError) {
    return { status: 409, code: "resolution_expired" };
  }
  if (err instanceof SelectionStaleError) {
    return { status: 409, code: "selection_stale", reason: err.reason };
  }
  if (err instanceof OrderBindingRejectedError) {
    if (err.reason === "digest_grafting") {
      return { status: 409, code: "candidate_digest_mismatch", reason: err.detail };
    }
    if (err.reason === "missing_confirmation") {
      return { status: 409, code: "missing_confirmation", reason: err.detail };
    }
    return { status: 409, code: "selection_stale", reason: err.reason };
  }
  if (err instanceof AuthorizationScopeMismatchError) {
    return { status: 403, code: "resolution_scope_mismatch", reason: err.reason };
  }
  if (err instanceof SelectionTooLargeError) {
    return { status: 409, code: "selection_too_large" };
  }
  if (err instanceof WorkflowTooLargeError) {
    return { status: 409, code: "workflow_too_large" };
  }
  return undefined;
}

function primaryNetworkRef(record: ConfirmedResolutionRecord): string {
  const candidate = findSelectedCandidate(record);
  const deployment = candidate?.identity.deployments[0];
  if (deployment === undefined) return "unknown";
  return `${deployment.network.network_namespace}:${deployment.network.network_reference}`;
}

/**
 * Reconstruct the admission body digest using the stored certificate so
 * idempotent replay can detect content conflict without a live resolution row.
 */
function replayBodyDigest(input: {
  readonly placed_by: string;
  readonly client_request_id: string;
  readonly binding: CollectionReportInputs;
  readonly authorization_scope: AuthorizationScope;
  readonly stored_certificate: unknown;
}): string {
  return digestOf({
    product: "collection-report",
    placed_by: input.placed_by,
    client_request_id: input.client_request_id,
    inputs: {
      ...input.binding,
      recipe_expansion_certificate: input.stored_certificate,
    },
    authorization_scope: input.authorization_scope,
  });
}

export async function admitCollectionReportOrder(
  deps: CollectionReportAdmissionDeps,
  input: AdmitCollectionReportInput,
): Promise<AdmitCollectionReportResult> {
  let scope: AuthorizationScope;
  try {
    scope = deps.publicAuth.decodeScope(input.authorization_scope);
  } catch {
    return {
      kind: "deny",
      deny: { status: 400, code: "invalid_authorization_scope" },
    };
  }

  if (scope.permission !== "report:create") {
    return {
      kind: "deny",
      deny: {
        status: 403,
        code: "permission_mismatch",
        reason: "order placement requires report:create",
      },
    };
  }
  if (scope.subject_id !== input.placed_by) {
    return {
      kind: "deny",
      deny: { status: 403, code: "cross_subject", reason: "placed_by must match authorization subject" },
    };
  }
  if (input.binding.community_ref !== scope.community_ref) {
    return {
      kind: "deny",
      deny: { status: 403, code: "scope_tamper", reason: "community_ref must match authorization scope" },
    };
  }

  try {
    deps.publicAuth.acquireLease({
      operation: { resource: "report_order", action: "create" },
      scope,
      authoritativeCommunityRef: input.binding.community_ref,
      authoritativeSubjectId: input.placed_by,
    });
  } catch (err) {
    // F2: public-auth ACL/lease denials are distinct from resolution_scope_mismatch.
    const mapped = deps.publicAuth.mapDenial(err);
    const body = mapped.body as { code?: string; reason?: string };
    return {
      kind: "deny",
      deny: {
        status: mapped.status,
        code: "authorization_denied",
        reason: body.reason ?? body.code,
      },
    };
  }

  // F3: idempotent replay must not require a live resolution row.
  const priorIdem = await deps.admissionCapacity.store.getIdempotency(
    input.placed_by,
    input.client_request_id,
  );
  if (priorIdem !== undefined) {
    const order = await deps.orderStore.get(priorIdem.order_id);
    if (order !== undefined) {
      const storedCert = (order.inputs as { recipe_expansion_certificate?: unknown })
        .recipe_expansion_certificate;
      const candidateDigest = replayBodyDigest({
        placed_by: input.placed_by,
        client_request_id: input.client_request_id,
        binding: input.binding,
        authorization_scope: scope,
        stored_certificate: storedCert,
      });
      if (candidateDigest !== priorIdem.body_digest) {
        return { kind: "deny", deny: { status: 409, code: "idempotency_conflict" } };
      }
      return {
        kind: "admitted",
        order_id: priorIdem.order_id,
        replay: true,
      };
    }
  }

  const record = await deps.resolutionStore.get(input.binding.resolution_id);
  if (record === undefined) {
    return { kind: "deny", deny: { status: 409, code: "resolution_not_found" } };
  }

  const resolutionScope: AuthorizationScope = {
    schema_version: 1,
    subject_id: scope.subject_id,
    community_ref: scope.community_ref,
    permission: "report:create",
  };

  try {
    const localCapability = buildLocalCapabilityFromRecord(record);
    await deps.resolutionService.admit(input.binding, resolutionScope, localCapability);
  } catch (err) {
    const mapped = mapCollectionReportAdmissionError(err);
    if (mapped) return { kind: "deny", deny: mapped };
    return {
      kind: "deny",
      deny: { status: 409, code: "selection_stale", reason: "order_binding_rejected" },
    };
  }

  const deploymentCount = record.selected_deployment_ids?.length ?? 0;
  let compiled;
  try {
    compiled = compileGateLeakRecipe({ deployment_count: deploymentCount, tier: "public" });
  } catch (err) {
    const mapped = mapCollectionReportAdmissionError(err);
    if (mapped) return { kind: "deny", deny: mapped };
    throw err;
  }

  const rootWorkKeys = buildPublicRootWorkKeysFromResolution(record);
  const [primaryWorkKey, ...additionalRootWorkKeys] = rootWorkKeys;
  if (primaryWorkKey === undefined) {
    return {
      kind: "deny",
      deny: { status: 409, code: "missing_confirmation" },
    };
  }

  const certificate: RecipeExpansionCertificate = compiled.certificate;
  const enrichedInputs: Record<string, unknown> = {
    ...input.binding,
    recipe_expansion_certificate: certificate,
  };

  const body = {
    product: "collection-report" as const,
    placed_by: input.placed_by,
    client_request_id: input.client_request_id,
    inputs: enrichedInputs,
    authorization_scope: scope,
  };

  const placed_at_unix = Math.floor(deps.now() / 1000);
  const admitResult = await deps.admissionCapacity.admitOrder({
    requester_subject: input.placed_by,
    client_request_id: input.client_request_id,
    order: {
      product: "collection-report",
      placed_by: input.placed_by,
      inputs: enrichedInputs,
      placed_at_unix,
      inputs_digest: digestOf(enrichedInputs),
      order_id: randomUUID(),
    },
    body,
    certificate,
    work_key: primaryWorkKey,
    additional_root_work_keys: additionalRootWorkKeys,
    order_tenant_scope_digest: communityScopeDigest(input.binding.community_ref),
    pool_scope: {
      network_ref: primaryNetworkRef(record),
      capability: "ownership_index.v1",
    },
  });

  if (admitResult.kind === "idempotency_conflict") {
    return { kind: "deny", deny: { status: 409, code: "idempotency_conflict" } };
  }
  if (admitResult.kind === "capacity_unavailable") {
    return {
      kind: "deny",
      deny: { status: 503, code: "capacity_unavailable", reason: admitResult.reason },
    };
  }

  return {
    kind: "admitted",
    order_id: admitResult.order.order_id,
    replay: admitResult.replay,
  };
}

/** Revalidate binding digest without persisting — used in tests and pre-flight checks. */
export function bindingDigestMatchesRecord(
  binding: CollectionReportInputs,
  record: ConfirmedResolutionRecord,
): boolean {
  return digestsEqual(binding.candidate_snapshot_digest, record.candidate_snapshot_digest);
}
