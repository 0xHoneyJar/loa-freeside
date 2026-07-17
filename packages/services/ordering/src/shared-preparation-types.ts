/**
 * CR-201A public shared preparation types.
 *
 * T1 controlled public-chain fixtures only. No restricted Discord/identity
 * evidence and no customer Gate Leak artifact semantics in this module.
 */

export const PUBLIC_PREP_CAPABILITIES = [
  "collection_identity.v1",
  "ownership_index.v1",
] as const;

export type PublicPrepCapability = (typeof PUBLIC_PREP_CAPABILITIES)[number];

export const ACTIVE_PUBLIC_WORK_STATES = [
  "queued",
  "preparing",
  "retry_wait",
] as const;

export type ActivePublicWorkState = (typeof ACTIVE_PUBLIC_WORK_STATES)[number];

/** States that may hold a worker lease. retry_wait is active but not leasable. */
export const LEASABLE_PUBLIC_WORK_STATES = ["queued", "preparing"] as const;

export type LeasablePublicWorkState = (typeof LEASABLE_PUBLIC_WORK_STATES)[number];

export const PUBLIC_WORK_STATES = [
  ...ACTIVE_PUBLIC_WORK_STATES,
  "ready",
  "failed",
  "abandoned",
  "superseded",
] as const;

export type PublicWorkState = (typeof PUBLIC_WORK_STATES)[number];

export const EVIDENCE_BOUNDARY_KINDS = [
  "continuous_latest",
  "server_time_bucket",
  "exact_snapshot",
] as const;

export type EvidenceBoundaryKind = (typeof EVIDENCE_BOUNDARY_KINDS)[number];

/** V1 ceilings from sprint.md §4 release gates. */
export const PUBLIC_PREP_LIMITS = {
  maxDeployments: 16,
  maxCapabilities: 8,
  maxRootReferences: 32,
  maxDagNodes: 160,
} as const;

export interface VersionedDigest {
  readonly algorithm: "sha-256";
  readonly domain: string;
  readonly major_version: number;
  readonly digest: string;
}

export interface PublicSourceIdentity {
  readonly schema_version: 1;
  readonly producer: string;
  readonly upstream_evidence_source: string;
}

export interface PublicPreparationWorkKeyMaterial {
  readonly schema_version: 1;
  readonly capability: PublicPrepCapability;
  readonly capability_version: string;
  readonly collection_id: VersionedDigest;
  readonly deployment_ids: readonly VersionedDigest[];
  readonly finality_policies: readonly {
    readonly schema_version: 1;
    readonly network: {
      readonly schema_version: 1;
      readonly network_namespace: string;
      readonly network_reference: string;
    };
    readonly finality_policy_version: string;
  }[];
  readonly scope_class: "deployment";
  readonly scope_digest: string;
  readonly privacy_class: "public_chain";
  readonly source_identity: PublicSourceIdentity;
  readonly evidence_boundary_kind: EvidenceBoundaryKind;
  readonly evidence_boundary_digest?: string;
  readonly readiness_policy_version: string;
  readonly adapter_version: string;
}

export interface ReadinessEvidenceEnvelope {
  readonly schema_version: 1;
  readonly producer: string;
  readonly schema: string;
  readonly adapter: string;
  readonly readiness_policy_version: string;
  readonly privacy_scope: "public_chain";
  readonly deployment_coverage: readonly VersionedDigest[];
  readonly observation_window: {
    readonly observed_at: string;
    readonly as_of: string;
  };
  readonly freshness: {
    readonly qualified: boolean;
    readonly max_age_ms: number;
  };
  readonly source_digest: VersionedDigest;
  readonly evidence_digest: VersionedDigest;
}

export interface SharedPreparationWorkRecord {
  readonly work_id: string;
  readonly work_key_digest: string;
  readonly deployment_set_digest: string;
  readonly capability: PublicPrepCapability;
  readonly capability_version: string;
  readonly scope_class: "deployment";
  readonly scope_digest: string;
  readonly privacy_class: "public_chain";
  readonly source_identity: PublicSourceIdentity;
  readonly readiness_policy_version: string;
  readonly evidence_boundary_kind: EvidenceBoundaryKind;
  readonly evidence_boundary_digest?: string;
  readonly adapter_version: string;
  readonly finality_policy_version: string;
  readonly state: PublicWorkState;
  readonly generation: number;
  readonly readiness_evidence?: ReadinessEvidenceEnvelope;
  readonly attempt: number;
  readonly next_attempt_at_unix_ms?: number;
  readonly retry_deadline_unix_ms?: number;
  readonly lease_until_unix_ms?: number;
  readonly lease_epoch: number;
  readonly failure_reason?: { readonly code: string; readonly reason: string };
  readonly sharing_scope_kind: "public";
  readonly created_at_unix_ms: number;
  readonly updated_at_unix_ms: number;
}

export interface PreparationWorkItemRecord {
  readonly work_item_id: string;
  readonly work_id: string;
  readonly deployment_id: VersionedDigest;
  readonly capability: PublicPrepCapability;
  readonly adapter_version: string;
  readonly external_job_ref?: string;
  readonly state: PublicWorkState;
  readonly attempt: number;
  readonly lease_epoch: number;
  readonly evidence_envelope?: ReadinessEvidenceEnvelope;
  readonly failure_reason?: { readonly code: string; readonly reason: string };
  readonly created_at_unix_ms: number;
  readonly updated_at_unix_ms: number;
}

export interface ReportWorkLinkRecord {
  readonly order_id: string;
  readonly work_id: string;
  readonly joined_at_unix_ms: number;
  readonly detached_at_unix_ms?: number;
  readonly generation: number;
  readonly order_tenant_scope_digest: string;
  readonly sharing_scope_kind: "public";
}

export function isActivePublicWorkState(state: PublicWorkState): state is ActivePublicWorkState {
  return (ACTIVE_PUBLIC_WORK_STATES as readonly string[]).includes(state);
}

export function isLeasablePublicWorkState(
  state: PublicWorkState,
): state is LeasablePublicWorkState {
  return (LEASABLE_PUBLIC_WORK_STATES as readonly string[]).includes(state);
}

export function assertPublicPrepCapability(capability: string): asserts capability is PublicPrepCapability {
  if (!(PUBLIC_PREP_CAPABILITIES as readonly string[]).includes(capability)) {
    throw new Error(`CR-201A rejects non-public capability: ${capability}`);
  }
}
