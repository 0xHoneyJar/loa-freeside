import { Schema } from "effect";
import { SchemaVersion } from "./scalars.js";

/**
 * The six ratified Gate Leak recipe capabilities (sprint section 3 / SDD 7.x).
 * IDs carry their major version; a v2 is a new literal, never a mutation.
 */
export const GateLeakCapabilityId = Schema.Literal(
  "collection_identity.v1",
  "ownership_index.v1",
  "gate_mapping.v1",
  "discord_role_snapshot.v1",
  "identity_link_snapshot.v1",
  "gate_leak_compute.v1",
).annotations({ identifier: "GateLeakCapabilityId" });
export type GateLeakCapabilityId = Schema.Schema.Type<typeof GateLeakCapabilityId>;

/** Who may share a capability's evidence. Global public work never carries tenant identity. */
export const ShareabilityScope = Schema.Literal(
  "global",
  "global_freshness_qualified",
  "community",
  "community_guild",
  "community_subjects",
  "order_or_result_digest",
).annotations({ identifier: "ShareabilityScope" });
export type ShareabilityScope = Schema.Schema.Type<typeof ShareabilityScope>;

export const PrivacyClass = Schema.Literal(
  "public_chain",
  "restricted_community",
).annotations({ identifier: "PrivacyClass" });
export type PrivacyClass = Schema.Schema.Type<typeof PrivacyClass>;

/**
 * SDD 6.3 server-derived evidence-boundary derivations. The derivation is part
 * of the capability contract; callers can neither supply nor choose it.
 */
export const EvidenceBoundaryDerivation = Schema.Literal(
  "continuous_latest",
  "immutable_mapping_version",
  "acquisition_then_exact_snapshot",
  "exact_input_digest",
).annotations({ identifier: "EvidenceBoundaryDerivation" });
export type EvidenceBoundaryDerivation = Schema.Schema.Type<
  typeof EvidenceBoundaryDerivation
>;

export const PartialPolicy = Schema.Literal("reject", "disclose", "allow").annotations({
  identifier: "PartialPolicy",
});
export type PartialPolicy = Schema.Schema.Type<typeof PartialPolicy>;

/** Which deployments a capability's evidence must span for this recipe. */
export const DeploymentCoverageRequirement = Schema.Literal(
  "single_deployment",
  "selected_deployment_set",
  "full_logical_collection",
).annotations({ identifier: "DeploymentCoverageRequirement" });
export type DeploymentCoverageRequirement = Schema.Schema.Type<
  typeof DeploymentCoverageRequirement
>;

export interface GateLeakCapabilityDeclaration {
  readonly capability: GateLeakCapabilityId;
  readonly shareability: ShareabilityScope;
  readonly privacy_class: PrivacyClass;
  readonly evidence_boundary: EvidenceBoundaryDerivation;
  /** Producer / source-of-truth identity, per the SDD capability-owner table. */
  readonly producer: string;
  /** Freshness or invalidation authority, stated (not enforced) here. */
  readonly freshness_authority: string;
  /** Named retention rule; the enforcement sites are the producer and Ordering. */
  readonly retention: string;
}

export const GATE_LEAK_CAPABILITIES: Readonly<
  Record<GateLeakCapabilityId, GateLeakCapabilityDeclaration>
> = Object.freeze({
  "collection_identity.v1": {
    capability: "collection_identity.v1",
    shareability: "global",
    privacy_class: "public_chain",
    evidence_boundary: "continuous_latest",
    producer: "sonar-resolver+inventory-enrichment",
    freshness_authority: "sonar capability registry version and equivalence revocation",
    retention: "public evidence; superseded by newer identity versions, never rewritten",
  },
  "ownership_index.v1": {
    capability: "ownership_index.v1",
    shareability: "global_freshness_qualified",
    privacy_class: "public_chain",
    evidence_boundary: "continuous_latest",
    producer: "sonar-ownership-adapter",
    freshness_authority: "sonar adapter policy and observed block/slot coverage",
    retention: "public evidence; freshness-bounded by adapter policy; not copied into artifacts",
  },
  "gate_mapping.v1": {
    capability: "gate_mapping.v1",
    shareability: "community_guild",
    privacy_class: "restricted_community",
    evidence_boundary: "immutable_mapping_version",
    producer: "loa-freeside/packages/services/shadow-audit gate-mapping aggregate",
    freshness_authority: "authorized community operator and shadow-audit service",
    retention: "community configuration; immutable versions retained as audit history",
  },
  "discord_role_snapshot.v1": {
    capability: "discord_role_snapshot.v1",
    shareability: "community_guild",
    privacy_class: "restricted_community",
    evidence_boundary: "acquisition_then_exact_snapshot",
    producer: "loa-freeside/packages/services/shadow-audit discord gateway capture",
    freshness_authority: "shadow-audit service and declared capture threshold",
    retention:
      "restricted evidence; shortest applicable community policy; deletion-propagating",
  },
  "identity_link_snapshot.v1": {
    capability: "identity_link_snapshot.v1",
    shareability: "community_subjects",
    privacy_class: "restricted_community",
    evidence_boundary: "acquisition_then_exact_snapshot",
    producer: "identity-api authorized community-link projection",
    freshness_authority: "identity-api link revocation and consent/version policy",
    retention:
      "restricted evidence; the SHORTEST applicable retention; invalidated by unlink, consent withdrawal, subject deletion, or policy version change; deletion-propagating",
  },
  "gate_leak_compute.v1": {
    capability: "gate_leak_compute.v1",
    shareability: "order_or_result_digest",
    privacy_class: "restricted_community",
    evidence_boundary: "exact_input_digest",
    producer: "shadow-audit report producer",
    freshness_authority: "versioned gate-leak recipe",
    retention:
      "order artifact retention (30-day ceiling per CR-007B) governs results; source evidence keeps its own shorter policy",
  },
});

/**
 * Structured freshness requirement declared by the recipe. Readiness evaluates
 * these against `evaluated_at` — callers never supply a freshness boolean.
 */
export type RecipeFreshnessRequirement =
  | {
      readonly kind: "capability_registry_current";
      readonly description: string;
    }
  | {
      readonly kind: "ownership_finality_max_source_age";
      readonly policy_version: string;
      readonly max_source_age_seconds: number;
      /** Closed V1 finality vocabulary bound into the recipe. */
      readonly supported_finality_policies: ReadonlyArray<OwnershipFinalityPolicyVersionV1>;
      readonly description: string;
    }
  | {
      readonly kind: "immutable_mapping_version";
      readonly description: string;
    }
  | {
      readonly kind: "discord_snapshot_max_age";
      readonly policy_version: string;
      readonly max_snapshot_age_seconds: number;
      readonly description: string;
    }
  | {
      readonly kind: "identity_mvcc_propagation";
      readonly policy_version: string;
      readonly max_snapshot_age_seconds: number;
      readonly description: string;
    }
  | {
      readonly kind: "exact_input_digest";
      readonly description: string;
    };

export interface GateLeakRecipeRequirement {
  readonly capability: GateLeakCapabilityId;
  /** Adapter/schema floor for qualifying evidence. */
  readonly minimum_adapter_version: string;
  readonly deployment_coverage: DeploymentCoverageRequirement;
  /** Structured freshness rule evaluated at Ordering's `evaluated_at`. */
  readonly freshness: RecipeFreshnessRequirement;
  readonly partial_policy: PartialPolicy;
}

export interface GateLeakRecipe {
  readonly report_type: string;
  readonly report_version: string;
  readonly readiness_policy_version: string;
  readonly requirements: ReadonlyArray<GateLeakRecipeRequirement>;
}

/**
 * Database-clock skew tolerance (sprint Authority threshold). Evidence issued
 * up to this far ahead of `evaluated_at` is treated as age zero; farther
 * future-issued timestamps refuse rather than becoming "fresh".
 */
export const CLOCK_SKEW_POLICY_V1 = Object.freeze({
  version: "clock-skew.v1",
  max_database_clock_skew_seconds: 2,
});

/**
 * Ownership source-currency policy: every coverage `source_time` and the
 * observation window end must be within this age of Ordering's `evaluated_at`
 * (after clock-skew tolerance). Changing the bound requires a new version.
 */
export const OWNERSHIP_FRESHNESS_POLICY_V1 = Object.freeze({
  version: "ownership-freshness.v1",
  /** Continuous-latest max source age relative to `evaluated_at`. */
  max_source_age_seconds: 300,
});

/**
 * Supported V1 ownership finality policies, closed by network namespace /
 * adapter contract. Free-form finality version strings are unrepresentable;
 * each selected deployment must present an exact attestation under one of
 * these policies (see `OwnershipFinalityAttestation`).
 */
export const OWNERSHIP_FINALITY_EIP155_FINALIZED_BLOCK_V1 = Object.freeze({
  version: "ownership-finality.eip155-finalized-block.v1" as const,
  network_namespace: "eip155" as const,
  source_position_kind: "block" as const,
  description:
    "EVM finalized-block finality: ownership evidence binds the exact finalized block height observed by the sonar ownership adapter",
});

export const OWNERSHIP_FINALITY_SOLANA_FINALIZED_COMMITMENT_V1 = Object.freeze({
  version: "ownership-finality.solana-finalized-commitment.v1" as const,
  network_namespace: "solana" as const,
  source_position_kind: "slot" as const,
  description:
    "Solana finalized-commitment finality: ownership evidence binds the exact finalized slot observed by the sonar ownership adapter",
});

export const OWNERSHIP_FINALITY_POLICY_VERSIONS_V1 = Object.freeze([
  OWNERSHIP_FINALITY_EIP155_FINALIZED_BLOCK_V1.version,
  OWNERSHIP_FINALITY_SOLANA_FINALIZED_COMMITMENT_V1.version,
] as const);

export type OwnershipFinalityPolicyVersionV1 =
  (typeof OWNERSHIP_FINALITY_POLICY_VERSIONS_V1)[number];

export const OwnershipFinalityPolicyVersion = Schema.Literal(
  ...OWNERSHIP_FINALITY_POLICY_VERSIONS_V1,
).annotations({ identifier: "OwnershipFinalityPolicyVersion" });
export type OwnershipFinalityPolicyVersion = Schema.Schema.Type<
  typeof OwnershipFinalityPolicyVersion
>;

/**
 * Recipe → network-namespace map for the supported V1 finality policies.
 * Wrong-VM policy selection is refused against the VERIFIED CR-001
 * CollectionDeploymentRef's network namespace (never a self-declared
 * attestation field).
 */
export const OWNERSHIP_FINALITY_POLICY_BY_NAMESPACE_V1 = Object.freeze({
  eip155: OWNERSHIP_FINALITY_EIP155_FINALIZED_BLOCK_V1,
  solana: OWNERSHIP_FINALITY_SOLANA_FINALIZED_COMMITMENT_V1,
} as const);

/**
 * Discord snapshot freshness: capture-window end must be within this age of
 * `evaluated_at`. Matches the capture-policy window bound so a snapshot cannot
 * outlive the window that qualified it.
 */
export const DISCORD_SNAPSHOT_FRESHNESS_POLICY_V1 = Object.freeze({
  version: "discord-snapshot-freshness.v1",
  max_snapshot_age_seconds: 300,
});

/**
 * Identity-link snapshot freshness: observation-window end must be within the
 * 60-second Identity invalidation propagation objective of `evaluated_at`.
 */
export const IDENTITY_SNAPSHOT_FRESHNESS_POLICY_V1 = Object.freeze({
  version: "identity-snapshot-freshness.v1",
  max_snapshot_age_seconds: 60,
});

const GATE_LEAK_RECIPE_REQUIREMENTS_V1: ReadonlyArray<GateLeakRecipeRequirement> =
  Object.freeze([
    Object.freeze({
      capability: "collection_identity.v1",
      minimum_adapter_version: "v1",
      deployment_coverage: "selected_deployment_set",
      freshness: Object.freeze({
        kind: "capability_registry_current" as const,
        description:
          "current capability-registry version; invalidated by equivalence revocation",
      }),
      partial_policy: "reject",
    }),
    Object.freeze({
      capability: "ownership_index.v1",
      minimum_adapter_version: "v1",
      deployment_coverage: "selected_deployment_set",
      freshness: Object.freeze({
        kind: "ownership_finality_max_source_age" as const,
        policy_version: OWNERSHIP_FRESHNESS_POLICY_V1.version,
        max_source_age_seconds: OWNERSHIP_FRESHNESS_POLICY_V1.max_source_age_seconds,
        supported_finality_policies: OWNERSHIP_FINALITY_POLICY_VERSIONS_V1,
        description:
          "continuous_latest within the closed per-deployment finality attestation contract and max-source-age policy",
      }),
      partial_policy: "reject",
    }),
    Object.freeze({
      capability: "gate_mapping.v1",
      minimum_adapter_version: "v1",
      deployment_coverage: "selected_deployment_set",
      freshness: Object.freeze({
        kind: "immutable_mapping_version" as const,
        description: "pinned immutable ratified version; revocation stops the order",
      }),
      partial_policy: "reject",
    }),
    Object.freeze({
      capability: "discord_role_snapshot.v1",
      minimum_adapter_version: "v1",
      deployment_coverage: "selected_deployment_set",
      freshness: Object.freeze({
        kind: "discord_snapshot_max_age" as const,
        policy_version: DISCORD_SNAPSHOT_FRESHNESS_POLICY_V1.version,
        max_snapshot_age_seconds:
          DISCORD_SNAPSHOT_FRESHNESS_POLICY_V1.max_snapshot_age_seconds,
        description: "producer-issued snapshot within the capture policy window",
      }),
      partial_policy: "reject",
    }),
    Object.freeze({
      capability: "identity_link_snapshot.v1",
      minimum_adapter_version: "v1",
      deployment_coverage: "selected_deployment_set",
      freshness: Object.freeze({
        kind: "identity_mvcc_propagation" as const,
        policy_version: IDENTITY_SNAPSHOT_FRESHNESS_POLICY_V1.version,
        max_snapshot_age_seconds:
          IDENTITY_SNAPSHOT_FRESHNESS_POLICY_V1.max_snapshot_age_seconds,
        description:
          "MVCC snapshot with gap-free tombstone watermark within propagation objective",
      }),
      partial_policy: "reject",
    }),
    Object.freeze({
      capability: "gate_leak_compute.v1",
      minimum_adapter_version: "v1",
      deployment_coverage: "selected_deployment_set",
      freshness: Object.freeze({
        kind: "exact_input_digest" as const,
        description: "exact input digests matching the pinned evidence envelopes",
      }),
      partial_policy: "reject",
    }),
  ]);

/**
 * The ratified Gate Leak V1 recipe. `partial_policy: reject` for every
 * capability: the report refuses partial deployment coverage because no
 * requirement declares `disclose`/`allow`, and a future recipe that does must
 * also disclose the gap (see `evaluateGateLeakReadiness`).
 *
 * `ownership_index.v1` names its answer to the sprint question directly:
 * the FULL SELECTED deployment set is required — every deployment in the
 * confirmed selection needs qualifying ownership evidence. The ratified
 * mapping binds that same set by digest, so the selected set is the ratified
 * basis, not an ad-hoc subset.
 */
export const GATE_LEAK_RECIPE_V1: GateLeakRecipe = Object.freeze({
  report_type: "gate_leak",
  report_version: "v1",
  readiness_policy_version: "gate-leak-readiness.v1",
  requirements: GATE_LEAK_RECIPE_REQUIREMENTS_V1,
});

/**
 * Versioned release policies. Numbers here are ratified thresholds; changing
 * one requires a NEW version identifier plus fresh load/privacy evidence and
 * release-gate approval — never an environment override (sprint section 4).
 */
export const GATE_LEAK_COVERAGE_POLICY_V1 = Object.freeze({
  version: "gate-leak-coverage.v1",
  /** Actionable measure requires >=80% definitive coverage (basis points). */
  minimum_definitive_coverage_basis_points: 8000,
  /** Coverage discloses as a rounded-DOWN 10-point band. */
  coverage_band_width_percent: 10,
});

export const GATE_LEAK_DISCLOSURE_POLICY_V1 = Object.freeze({
  version: "gate-leak-disclosure.v1",
  bands: Object.freeze(["0", "1-9", "10-24", "25-49", "50-99", "100+"] as const),
  epoch_days: 7,
});

export const GATE_LEAK_CHURN_POLICY_V1 = Object.freeze({
  version: "gate-leak-churn.v1",
  max_new_mapping_versions_per_community_per_24h: 5,
  max_distinct_collection_orders_per_community_per_24h: 10,
});

export const DISCORD_CAPTURE_POLICY_V1 = Object.freeze({
  version: "discord-capture.v1",
  max_reconciliation_delta_events: 1000,
  max_capture_window_seconds: 300,
  max_capture_generations: 3,
});

export const SUBJECT_COHORT_POLICY_V1 = Object.freeze({
  version: "subject-cohort-limit.v1",
  max_human_subjects: 50_000,
  page_size: 500,
});

export const EVIDENCE_ALIGNMENT_POLICY_V1 = Object.freeze({
  version: "evidence-alignment.v1",
  /** Windows must overlap or have nearest boundaries at most this far apart. */
  max_window_gap_seconds: 300,
});

/** Wire schema for naming a policy version inside keys, evidence, and artifacts. */
export const PolicyVersionRef = Schema.Struct({
  schema_version: SchemaVersion,
  policy: Schema.Literal(
    "gate-leak-readiness",
    "gate-leak-coverage",
    "gate-leak-disclosure",
    "gate-leak-churn",
    "discord-capture",
    "discord-snapshot-freshness",
    "ownership-freshness",
    "ownership-finality.eip155-finalized-block",
    "ownership-finality.solana-finalized-commitment",
    "identity-snapshot-freshness",
    "clock-skew",
    "subject-cohort-limit",
    "evidence-alignment",
    "consent-purpose",
  ),
  version: Schema.String.pipe(Schema.pattern(/^[a-z0-9][a-z0-9._-]{0,127}$/)),
}).annotations({ identifier: "PolicyVersionRef" });
export interface PolicyVersionRef extends Schema.Schema.Type<typeof PolicyVersionRef> {}
