import {
  type CanonicalEncodingError,
  CollectionDeploymentRef,
  ContractIntegrityError,
  DIGEST_DOMAINS as COLLECTION_DIGEST_DOMAINS,
  DuplicateCanonicalSetMemberError,
  TokenStandardValue,
  VersionIdentifier,
  VersionedDigest,
  decodeCollectionDeploymentRef,
  digestVersioned,
  type DigestComputationError,
  sortCanonicalSet,
  CapabilityRegistryVersion,
} from "@freeside/collection-protocol";
import { Data, Effect, type ParseResult, Schema } from "effect";
import {
  CLOCK_SKEW_POLICY_V1,
  DISCORD_SNAPSHOT_FRESHNESS_POLICY_V1,
  EVIDENCE_ALIGNMENT_POLICY_V1,
  IDENTITY_SNAPSHOT_FRESHNESS_POLICY_V1,
  OWNERSHIP_FINALITY_EIP155_FINALIZED_BLOCK_V1,
  OWNERSHIP_FINALITY_POLICY_BY_NAMESPACE_V1,
  OWNERSHIP_FINALITY_SOLANA_FINALIZED_COMMITMENT_V1,
  OWNERSHIP_FRESHNESS_POLICY_V1,
  type OwnershipFinalityPolicyVersionV1,
} from "./capabilities.js";
import { GATE_LEAK_DIGEST_DOMAINS } from "./gate-rule.js";
import {
  CommunityRef,
  COMMUNITY_GATE_AUDIT_PURPOSE,
  DecimalString,
  DiscordSnowflake,
  IsoTimestamp,
  isValidIsoTimestamp,
  NonNegativeInt,
  SchemaVersion,
} from "./scalars.js";
import { RoleIdSet } from "./work-keys.js";

/** Network namespace derived from a verified CR-001 CollectionDeploymentRef. */
export type DeploymentNetworkNamespace = "eip155" | "solana";

/**
 * Exact deployment_id → verified network map built from CR-001 refs. Finality
 * proof consults this map — never a self-declared attestation namespace.
 */
export type VerifiedDeploymentNetworkMap = ReadonlyMap<
  string,
  {
    readonly network_namespace: DeploymentNetworkNamespace;
    readonly network_reference: string;
    readonly deployment_ref: CollectionDeploymentRef;
  }
>;

export const buildVerifiedDeploymentNetworkMap = (
  deployments: ReadonlyArray<CollectionDeploymentRef>,
): Effect.Effect<
  VerifiedDeploymentNetworkMap,
  | ParseResult.ParseError
  | CanonicalEncodingError
  | DigestComputationError
  | ContractIntegrityError
> =>
  Effect.gen(function* () {
    const verified = yield* Effect.forEach(deployments, decodeCollectionDeploymentRef);
    const map = new Map<
      string,
      {
        readonly network_namespace: DeploymentNetworkNamespace;
        readonly network_reference: string;
        readonly deployment_ref: CollectionDeploymentRef;
      }
    >();
    for (const ref of verified) {
      const digest = ref.deployment_id.digest;
      if (map.has(digest)) {
        return yield* Effect.fail(
          new ContractIntegrityError({
            contract: "CollectionDeploymentRef",
            reason: "duplicate deployment_id in verified deployment set",
          }),
        );
      }
      map.set(digest, {
        network_namespace: ref.network.network_namespace,
        network_reference: ref.network.network_reference,
        deployment_ref: ref,
      });
    }
    return map;
  });

/**
 * Evidence observation windows, the five-minute alignment rule, pinned
 * watermarks, restart conditions, and version-invalidation of unsafe reuse.
 * All pure; Ordering executes these decisions against its database clock.
 */

const NonEmptyString = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(256));

export const ObservationWindow = Schema.Struct({
  schema_version: SchemaVersion,
  window_start: IsoTimestamp,
  window_end: IsoTimestamp,
}).pipe(
  Schema.filter(
    (window) =>
      Date.parse(window.window_start) <= Date.parse(window.window_end) ||
      "window_start must not be after window_end",
  ),
).annotations({ identifier: "ObservationWindow" });
export interface ObservationWindow extends Schema.Schema.Type<typeof ObservationWindow> {}

export interface WindowGap {
  readonly left: string;
  readonly right: string;
  readonly gap_seconds: number;
}

export type EvidenceAlignmentVerdict =
  | {
      readonly aligned: true;
      /** The honest as-of interval the artifact must report. */
      readonly as_of_interval: { readonly start: string; readonly end: string };
    }
  | {
      readonly aligned: false;
      readonly reason_code: "evidence_window_misaligned";
      readonly violations: ReadonlyArray<WindowGap>;
    };

const pairGapSeconds = (
  left: ObservationWindow,
  right: ObservationWindow,
): number => {
  const leftStart = Date.parse(left.window_start);
  const leftEnd = Date.parse(left.window_end);
  const rightStart = Date.parse(right.window_start);
  const rightEnd = Date.parse(right.window_end);
  if (leftEnd >= rightStart && rightEnd >= leftStart) return 0;
  return leftEnd < rightStart
    ? (rightStart - leftEnd) / 1000
    : (leftStart - rightEnd) / 1000;
};

/**
 * Ownership, Discord, and Identity windows must pairwise overlap or have
 * nearest boundaries at most five minutes apart. The result is an explicit
 * as-of interval, never an atomic-snapshot claim.
 */
export const checkEvidenceAlignment = (windows: {
  readonly ownership: ObservationWindow;
  readonly discord: ObservationWindow;
  readonly identity: ObservationWindow;
}): EvidenceAlignmentVerdict => {
  const named: ReadonlyArray<readonly [string, ObservationWindow]> = [
    ["ownership", windows.ownership],
    ["discord", windows.discord],
    ["identity", windows.identity],
  ];
  const violations: Array<WindowGap> = [];
  for (let leftIndex = 0; leftIndex < named.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < named.length; rightIndex += 1) {
      const left = named[leftIndex];
      const right = named[rightIndex];
      if (left === undefined || right === undefined) continue;
      const gap = pairGapSeconds(left[1], right[1]);
      if (gap > EVIDENCE_ALIGNMENT_POLICY_V1.max_window_gap_seconds) {
        violations.push({ left: left[0], right: right[0], gap_seconds: gap });
      }
    }
  }
  if (violations.length > 0) {
    return {
      aligned: false,
      reason_code: "evidence_window_misaligned",
      violations,
    };
  }
  const starts = named.map(([, window]) => Date.parse(window.window_start));
  const ends = named.map(([, window]) => Date.parse(window.window_end));
  const start = named[starts.indexOf(Math.min(...starts))];
  const end = named[ends.indexOf(Math.max(...ends))];
  return {
    aligned: true,
    as_of_interval: {
      start: start === undefined ? windows.ownership.window_start : start[1].window_start,
      end: end === undefined ? windows.ownership.window_end : end[1].window_end,
    },
  };
};

/* ------------------------------------------------------------------------ */
/* Evidence envelopes                                                        */
/* ------------------------------------------------------------------------ */

const hasDomain = (value: VersionedDigest, domain: string): boolean =>
  value.algorithm === "sha-256" && value.major_version === 1 && value.domain === domain;

const DeploymentId = VersionedDigest.pipe(
  Schema.filter(
    (value) =>
      hasDomain(value, COLLECTION_DIGEST_DOMAINS.deployment) ||
      "deployment ids must use the collection.deployment v1 digest domain",
  ),
);

/**
 * Every gate-leak evidence envelope digest lives in the gate-leak.evidence v1
 * domain; an evidence reference minted under any other domain cannot decode,
 * so foreign digests cannot be grafted into readiness or compute bindings.
 */
const GateLeakEvidenceDigest = VersionedDigest.pipe(
  Schema.filter(
    (value) =>
      hasDomain(value, GATE_LEAK_DIGEST_DOMAINS.evidence) ||
      "evidence_digest must use the gate-leak.evidence v1 digest domain",
  ),
);

const CollectionIdDigest = VersionedDigest.pipe(
  Schema.filter(
    (value) =>
      hasDomain(value, COLLECTION_DIGEST_DOMAINS.identity) ||
      "collection_id must use the collection.identity v1 digest domain",
  ),
);

const MappingVersionIdDigest = VersionedDigest.pipe(
  Schema.filter(
    (value) =>
      hasDomain(value, GATE_LEAK_DIGEST_DOMAINS.mapping_version) ||
      "mapping_version_id must use the gate-leak.mapping-version v1 digest domain",
  ),
);

const MappingConfigDigest = VersionedDigest.pipe(
  Schema.filter(
    (value) =>
      hasDomain(value, GATE_LEAK_DIGEST_DOMAINS.mapping_config) ||
      "mapping_config_digest must use the gate-leak.mapping-config v1 digest domain",
  ),
);

const isStrictlySortedUniqueByDigest = (
  values: ReadonlyArray<VersionedDigest>,
): boolean => {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous === undefined || current === undefined) return false;
    if (previous.digest >= current.digest) return false;
  }
  return true;
};

export const AuthorizationWatermark = Schema.Struct({
  schema_version: SchemaVersion,
  authority: NonEmptyString,
  epoch: NonNegativeInt,
  sequence: DecimalString,
}).annotations({ identifier: "AuthorizationWatermark" });
export interface AuthorizationWatermark
  extends Schema.Schema.Type<typeof AuthorizationWatermark> {}

/**
 * Stable comparator over every identity field of an authorization watermark.
 * Field order matches JCS key order (authority, epoch, schema_version, sequence)
 * so Schema strict-decode and sortCanonicalSet agree.
 */
export const compareAuthorizationWatermarks = (
  left: AuthorizationWatermark,
  right: AuthorizationWatermark,
): number => {
  if (left.authority < right.authority) return -1;
  if (left.authority > right.authority) return 1;
  if (left.epoch < right.epoch) return -1;
  if (left.epoch > right.epoch) return 1;
  if (left.schema_version < right.schema_version) return -1;
  if (left.schema_version > right.schema_version) return 1;
  if (left.sequence < right.sequence) return -1;
  if (left.sequence > right.sequence) return 1;
  return 0;
};

const isStrictlySortedUniqueAuthorizationWatermarks = (
  marks: ReadonlyArray<AuthorizationWatermark>,
): boolean => {
  for (let index = 1; index < marks.length; index += 1) {
    const previous = marks[index - 1];
    const current = marks[index];
    if (previous === undefined || current === undefined) return false;
    if (compareAuthorizationWatermarks(previous, current) >= 0) return false;
  }
  return true;
};

/**
 * Strict sorted-unique authorization watermark set. Decode rejects duplicates
 * and noncanonical order for stored/wire envelopes. Digest/work-key paths
 * revalidate through this schema so in-process bypasses cannot fragment keys.
 */
export const AuthorizationWatermarkSet = Schema.Array(AuthorizationWatermark).pipe(
  Schema.filter(
    (marks) => marks.length > 0 || "authorization watermarks must be non-empty",
  ),
  Schema.filter(
    (marks) =>
      isStrictlySortedUniqueAuthorizationWatermarks(marks) ||
      "authorization_watermarks are a sorted unique set",
  ),
).annotations({ identifier: "AuthorizationWatermarkSet" });
export type AuthorizationWatermarkSet = Schema.Schema.Type<
  typeof AuthorizationWatermarkSet
>;

const strictOptions = { errors: "all", onExcessProperty: "error" } as const;

/**
 * Canonicalize an arbitrarily ordered authorization watermark set. Duplicates
 * refuse (never silently dedupe). Equivalent permutations produce one sorted
 * form that strict-decodes through `AuthorizationWatermarkSet`.
 */
export const canonicalAuthorizationWatermarkSet = (
  marks: ReadonlyArray<AuthorizationWatermark>,
): Effect.Effect<
  AuthorizationWatermarkSet,
  | ParseResult.ParseError
  | DuplicateCanonicalSetMemberError
  | CanonicalEncodingError
> =>
  sortCanonicalSet(
    marks.map((mark) => ({
      canonical_key: {
        authority: mark.authority,
        epoch: mark.epoch,
        schema_version: mark.schema_version,
        sequence: mark.sequence,
      },
      value: mark,
    })),
  ).pipe(
    Effect.flatMap((sorted) =>
      Schema.decodeUnknown(AuthorizationWatermarkSet, strictOptions)(sorted),
    ),
  );

/** Exact set equality after both sides are known to be canonical sorted unique. */
export const authorizationWatermarkSetsEqual = (
  left: ReadonlyArray<AuthorizationWatermark>,
  right: ReadonlyArray<AuthorizationWatermark>,
): boolean =>
  left.length === right.length &&
  left.every((mark, index) => {
    const other = right[index];
    return other !== undefined && compareAuthorizationWatermarks(mark, other) === 0;
  });

const isStrictlySortedUniqueDeploymentRefs = (
  deployments: ReadonlyArray<CollectionDeploymentRef>,
): boolean => {
  for (let index = 1; index < deployments.length; index += 1) {
    const previous = deployments[index - 1];
    const current = deployments[index];
    if (previous === undefined || current === undefined) return false;
    if (previous.deployment_id.digest >= current.deployment_id.digest) return false;
  }
  return true;
};

/**
 * `collection_identity.v1` evidence: the recognized collection identity and
 * standard covering the selected deployment set, bound to the CR-001
 * capability-registry version that produced it. Deployments are full verified
 * CR-001 refs — digests alone cannot declare a VM for finality.
 */
export const CollectionIdentityEvidence = Schema.Struct({
  schema_version: SchemaVersion,
  capability: Schema.Literal("collection_identity.v1"),
  adapter_version: VersionIdentifier,
  capability_registry: CapabilityRegistryVersion,
  collection_id: CollectionIdDigest,
  deployments: Schema.Array(CollectionDeploymentRef).pipe(
    Schema.filter((items) => items.length > 0 || "deployments must be non-empty"),
    Schema.filter(
      (items) =>
        isStrictlySortedUniqueDeploymentRefs(items) ||
        "deployments are a sorted unique set by deployment_id",
    ),
  ),
  token_standard: TokenStandardValue,
  observation_window: ObservationWindow,
  evidence_digest: GateLeakEvidenceDigest,
}).annotations({ identifier: "CollectionIdentityEvidence" });
export type CollectionIdentityEvidence = Schema.Schema.Type<
  typeof CollectionIdentityEvidence
>;

const DeploymentCoverage = Schema.Struct({
  schema_version: SchemaVersion,
  deployment_id: DeploymentId,
  source_position: DecimalString,
  source_position_kind: Schema.Literal("block", "slot"),
  source_time: IsoTimestamp,
  completeness: Schema.Literal("complete", "partial"),
});

const OwnershipFinalityAttestationDigest = VersionedDigest.pipe(
  Schema.filter(
    (value) =>
      hasDomain(value, GATE_LEAK_DIGEST_DOMAINS.ownership_finality) ||
      "attestation_digest must use the gate-leak.ownership-finality v1 digest domain",
  ),
);

/**
 * Per-deployment EVM finalized-block attestation. Binds a strict CR-001
 * `CollectionDeploymentRef` — network namespace is derived from that verified
 * ref, never self-declared. A boolean alone cannot claim finality.
 */
export const Eip155FinalizedBlockAttestation = Schema.Struct({
  schema_version: SchemaVersion,
  deployment_ref: CollectionDeploymentRef,
  policy_version: Schema.Literal(
    OWNERSHIP_FINALITY_EIP155_FINALIZED_BLOCK_V1.version,
  ),
  finality_status: Schema.Literal("finalized"),
  finalized_block_height: DecimalString,
  finalized_observed_at: IsoTimestamp,
  adapter_version: VersionIdentifier,
  attestation_digest: OwnershipFinalityAttestationDigest,
}).pipe(
  Schema.filter(
    (attestation) =>
      attestation.deployment_ref.network.network_namespace === "eip155" ||
      "eip155 finality attestation requires an eip155 CollectionDeploymentRef",
  ),
).annotations({ identifier: "Eip155FinalizedBlockAttestation" });
export type Eip155FinalizedBlockAttestation = Schema.Schema.Type<
  typeof Eip155FinalizedBlockAttestation
>;

/**
 * Per-deployment Solana finalized-commitment attestation. Same closed-contract
 * rule: exact finalized slot identity + digest bound to a verified Solana
 * CollectionDeploymentRef, never a bare boolean or self-declared namespace.
 */
export const SolanaFinalizedCommitmentAttestation = Schema.Struct({
  schema_version: SchemaVersion,
  deployment_ref: CollectionDeploymentRef,
  policy_version: Schema.Literal(
    OWNERSHIP_FINALITY_SOLANA_FINALIZED_COMMITMENT_V1.version,
  ),
  finality_status: Schema.Literal("finalized"),
  finalized_slot: DecimalString,
  finalized_observed_at: IsoTimestamp,
  adapter_version: VersionIdentifier,
  attestation_digest: OwnershipFinalityAttestationDigest,
}).pipe(
  Schema.filter(
    (attestation) =>
      attestation.deployment_ref.network.network_namespace === "solana" ||
      "solana finality attestation requires a solana CollectionDeploymentRef",
  ),
).annotations({ identifier: "SolanaFinalizedCommitmentAttestation" });
export type SolanaFinalizedCommitmentAttestation = Schema.Schema.Type<
  typeof SolanaFinalizedCommitmentAttestation
>;

export const OwnershipFinalityAttestation = Schema.Union(
  Eip155FinalizedBlockAttestation,
  SolanaFinalizedCommitmentAttestation,
).annotations({ identifier: "OwnershipFinalityAttestation" });
export type OwnershipFinalityAttestation = Schema.Schema.Type<
  typeof OwnershipFinalityAttestation
>;

const attestationDeploymentId = (
  attestation: OwnershipFinalityAttestation,
): VersionedDigest => attestation.deployment_ref.deployment_id;

const attestationNetworkNamespace = (
  attestation: OwnershipFinalityAttestation,
): DeploymentNetworkNamespace =>
  attestation.deployment_ref.network.network_namespace;

const isStrictlySortedUniqueFinalityAttestations = (
  attestations: ReadonlyArray<OwnershipFinalityAttestation>,
): boolean => {
  for (let index = 1; index < attestations.length; index += 1) {
    const previous = attestations[index - 1];
    const current = attestations[index];
    if (previous === undefined || current === undefined) return false;
    if (
      attestationDeploymentId(previous).digest >=
      attestationDeploymentId(current).digest
    ) {
      return false;
    }
  }
  return true;
};

/**
 * Material digested into `attestation_digest` — every field that identifies the
 * finalized source observation, including the verified CR-001 deployment ref
 * (from which network namespace/reference are derived). Excludes the digest
 * itself.
 */
export type OwnershipFinalityAttestationMaterial =
  | {
      readonly schema_version: 1;
      readonly deployment_ref: CollectionDeploymentRef;
      readonly policy_version: typeof OWNERSHIP_FINALITY_EIP155_FINALIZED_BLOCK_V1.version;
      readonly network_namespace: "eip155";
      readonly finality_status: "finalized";
      readonly finalized_block_height: string;
      readonly finalized_observed_at: string;
      readonly adapter_version: string;
    }
  | {
      readonly schema_version: 1;
      readonly deployment_ref: CollectionDeploymentRef;
      readonly policy_version: typeof OWNERSHIP_FINALITY_SOLANA_FINALIZED_COMMITMENT_V1.version;
      readonly network_namespace: "solana";
      readonly finality_status: "finalized";
      readonly finalized_slot: string;
      readonly finalized_observed_at: string;
      readonly adapter_version: string;
    };

export const computeOwnershipFinalityAttestationDigest = (
  material: OwnershipFinalityAttestationMaterial,
): Effect.Effect<
  VersionedDigest,
  ParseResult.ParseError | CanonicalEncodingError | DigestComputationError
> =>
  digestVersioned(GATE_LEAK_DIGEST_DOMAINS.ownership_finality, 1, material);

const attestationMaterialOf = (
  attestation: OwnershipFinalityAttestation,
  verifiedRef: CollectionDeploymentRef,
): OwnershipFinalityAttestationMaterial => {
  const networkNamespace = verifiedRef.network.network_namespace;
  if (networkNamespace === "eip155" && "finalized_block_height" in attestation) {
    return {
      schema_version: 1,
      deployment_ref: verifiedRef,
      policy_version: OWNERSHIP_FINALITY_EIP155_FINALIZED_BLOCK_V1.version,
      network_namespace: "eip155",
      finality_status: "finalized",
      finalized_block_height: attestation.finalized_block_height,
      finalized_observed_at: attestation.finalized_observed_at,
      adapter_version: attestation.adapter_version,
    };
  }
  if (networkNamespace === "solana" && "finalized_slot" in attestation) {
    return {
      schema_version: 1,
      deployment_ref: verifiedRef,
      policy_version: OWNERSHIP_FINALITY_SOLANA_FINALIZED_COMMITMENT_V1.version,
      network_namespace: "solana",
      finality_status: "finalized",
      finalized_slot: attestation.finalized_slot,
      finalized_observed_at: attestation.finalized_observed_at,
      adapter_version: attestation.adapter_version,
    };
  }
  // Unreachable when schema filters + verified-ref checks hold; kept for exhaustiveness.
  return {
    schema_version: 1,
    deployment_ref: verifiedRef,
    policy_version: OWNERSHIP_FINALITY_SOLANA_FINALIZED_COMMITMENT_V1.version,
    network_namespace: "solana",
    finality_status: "finalized",
    finalized_slot: "0",
    finalized_observed_at: attestation.finalized_observed_at,
    adapter_version: attestation.adapter_version,
  };
};

export class OwnershipFinalityIntegrityError extends Data.TaggedError(
  "OwnershipFinalityIntegrityError",
)<{
  readonly reason_code: "ownership_finality_unproven";
  readonly deployment_id: string;
  readonly reason:
    | "attestation_digest_mismatch"
    | "policy_namespace_mismatch"
    | "wrong_vm_policy"
    | "grafted_deployment_ref"
    | "hybrid_deployment_ref"
    | "deployment_ref_integrity";
}> {}

/**
 * Strict-decode/recompute the CR-001 deployment ref, derive the actual VM
 * namespace from that verified ref, then recompute the attestation digest.
 * Self-declared namespaces are not authority — an EIP-155 deployment carrying
 * a Solana policy/slot claim (even with a correctly minted digest over the
 * false claim) fails here.
 */
export const verifyOwnershipFinalityAttestationIntegrity = (
  attestation: OwnershipFinalityAttestation,
): Effect.Effect<
  OwnershipFinalityAttestation,
  | OwnershipFinalityIntegrityError
  | ParseResult.ParseError
  | CanonicalEncodingError
  | DigestComputationError
  | ContractIntegrityError
> =>
  Effect.gen(function* () {
    const verifiedRef = yield* decodeCollectionDeploymentRef(
      attestation.deployment_ref,
    ).pipe(
      Effect.mapError((error) =>
        error instanceof ContractIntegrityError
          ? new OwnershipFinalityIntegrityError({
              reason_code: "ownership_finality_unproven",
              deployment_id: attestation.deployment_ref.deployment_id.digest,
              reason: "grafted_deployment_ref",
            })
          : error,
      ),
    );

    const derivedNamespace = verifiedRef.network.network_namespace;
    const expectedPolicy = OWNERSHIP_FINALITY_POLICY_BY_NAMESPACE_V1[derivedNamespace];

    // Hybrid / cross-VM shape: policy or source fields disagree with the
    // verified CR-001 deployment VM.
    const isEip155Attestation = "finalized_block_height" in attestation;
    const isSolanaAttestation = "finalized_slot" in attestation;
    if (
      (derivedNamespace === "eip155" && !isEip155Attestation) ||
      (derivedNamespace === "solana" && !isSolanaAttestation) ||
      (isEip155Attestation && isSolanaAttestation)
    ) {
      return yield* Effect.fail(
        new OwnershipFinalityIntegrityError({
          reason_code: "ownership_finality_unproven",
          deployment_id: verifiedRef.deployment_id.digest,
          reason: "hybrid_deployment_ref",
        }),
      );
    }
    if (attestation.policy_version !== expectedPolicy.version) {
      return yield* Effect.fail(
        new OwnershipFinalityIntegrityError({
          reason_code: "ownership_finality_unproven",
          deployment_id: verifiedRef.deployment_id.digest,
          reason: "wrong_vm_policy",
        }),
      );
    }
    if (
      (derivedNamespace === "eip155" &&
        expectedPolicy.source_position_kind !== "block") ||
      (derivedNamespace === "solana" &&
        expectedPolicy.source_position_kind !== "slot")
    ) {
      return yield* Effect.fail(
        new OwnershipFinalityIntegrityError({
          reason_code: "ownership_finality_unproven",
          deployment_id: verifiedRef.deployment_id.digest,
          reason: "policy_namespace_mismatch",
        }),
      );
    }

    const material = attestationMaterialOf(attestation, verifiedRef);
    const recomputed = yield* computeOwnershipFinalityAttestationDigest(material);
    if (
      recomputed.algorithm !== attestation.attestation_digest.algorithm ||
      recomputed.domain !== attestation.attestation_digest.domain ||
      recomputed.major_version !== attestation.attestation_digest.major_version ||
      recomputed.digest !== attestation.attestation_digest.digest
    ) {
      return yield* Effect.fail(
        new OwnershipFinalityIntegrityError({
          reason_code: "ownership_finality_unproven",
          deployment_id: verifiedRef.deployment_id.digest,
          reason: "attestation_digest_mismatch",
        }),
      );
    }
    return {
      ...attestation,
      deployment_ref: verifiedRef,
    };
  });

export const OwnershipIndexEvidence = Schema.Struct({
  schema_version: SchemaVersion,
  capability: Schema.Literal("ownership_index.v1"),
  adapter_version: VersionIdentifier,
  /**
   * Exact per-deployment finality attestations under the closed V1 policy
   * vocabulary. Each attestation binds a verified CR-001
   * `CollectionDeploymentRef`; free-form `finality_policy_versions` string
   * arrays and self-declared namespaces are not readiness authority.
   */
  finality_attestations: Schema.Array(OwnershipFinalityAttestation).pipe(
    Schema.filter(
      (items) => items.length > 0 || "finality_attestations must be non-empty",
    ),
    Schema.filter(
      (items) =>
        isStrictlySortedUniqueFinalityAttestations(items) ||
        "finality_attestations are a sorted unique set by deployment_ref.deployment_id",
    ),
  ),
  coverage: Schema.Array(DeploymentCoverage).pipe(
    Schema.filter((items) => items.length > 0 || "coverage must be non-empty"),
  ),
  observation_window: ObservationWindow,
  evidence_digest: GateLeakEvidenceDigest,
}).annotations({ identifier: "OwnershipIndexEvidence" });
export type OwnershipIndexEvidence = Schema.Schema.Type<typeof OwnershipIndexEvidence>;

/**
 * The signed completeness attestation every qualifying Discord role snapshot
 * must carry (SDD/CR-016). A snapshot missing any element is not evidence.
 */
export const DiscordCaptureAttestation = Schema.Struct({
  schema_version: SchemaVersion,
  baseline_method: Schema.Literal("guild_members_pagination"),
  baseline_pages_complete: Schema.Boolean,
  pagination_cursor_count: NonNegativeInt,
  gateway_session_id: NonEmptyString,
  gateway_epoch: NonNegativeInt,
  gateway_resume_sequence: NonNegativeInt,
  observed_gaps: NonNegativeInt,
  reconciliation_result: Schema.Literal("reconciled", "failed"),
  reconciliation_delta_events: NonNegativeInt,
  capture_generation: NonNegativeInt,
  capture_window: ObservationWindow,
  producer_contract_version: VersionIdentifier,
}).annotations({ identifier: "DiscordCaptureAttestation" });
export type DiscordCaptureAttestation = Schema.Schema.Type<
  typeof DiscordCaptureAttestation
>;

/**
 * `discord_role_snapshot.v1` evidence names its community and guild scope and
 * binds the exact ratified mapping version/configuration it was captured for
 * (SDD 6.3); its role set strict-decodes sorted-unique.
 */
export const DiscordRoleSnapshotEvidence = Schema.Struct({
  schema_version: SchemaVersion,
  capability: Schema.Literal("discord_role_snapshot.v1"),
  snapshot_id: NonEmptyString,
  community_ref: CommunityRef,
  guild_ref: DiscordSnowflake,
  role_ids: RoleIdSet,
  mapping_version_id: MappingVersionIdDigest,
  mapping_config_digest: MappingConfigDigest,
  /** Distinct non-bot members in the union of the pinned mapped roles. */
  member_count: NonNegativeInt,
  /** Bots excluded upstream from member_count and the subject cohort. */
  excluded_bot_count: NonNegativeInt,
  attestation: DiscordCaptureAttestation,
  evidence_digest: GateLeakEvidenceDigest,
}).annotations({ identifier: "DiscordRoleSnapshotEvidence" });
export type DiscordRoleSnapshotEvidence = Schema.Schema.Type<
  typeof DiscordRoleSnapshotEvidence
>;

/**
 * Purpose-scoped consent provenance for an identity-link snapshot: the exact
 * versioned `community_gate_audit` purpose, the authoritative grant source,
 * and when the producer verified the grants backing this snapshot.
 */
export const ConsentProvenance = Schema.Struct({
  schema_version: SchemaVersion,
  purpose: Schema.Literal(COMMUNITY_GATE_AUDIT_PURPOSE),
  policy_version: VersionIdentifier,
  grant_source: Schema.Literal("identity_api_grant_ledger"),
  verified_at: IsoTimestamp,
}).annotations({ identifier: "ConsentProvenance" });
export type ConsentProvenance = Schema.Schema.Type<typeof ConsentProvenance>;

/**
 * Invalidation provenance: the versioned Identity API tombstone stream that
 * carries unlink, consent-withdrawal, and subject-deletion events, the
 * gap-free watermark this snapshot incorporated, and when it was verified.
 * `gap_free: false` evidence exists but can never satisfy readiness.
 */
export const InvalidationProvenance = Schema.Struct({
  schema_version: SchemaVersion,
  tombstone_stream: Schema.Literal("identity-api.tombstone.v1"),
  watermark: DecimalString,
  gap_free: Schema.Boolean,
  verified_at: IsoTimestamp,
}).annotations({ identifier: "InvalidationProvenance" });
export type InvalidationProvenance = Schema.Schema.Type<typeof InvalidationProvenance>;

/** The shortest applicable retention policy and its concrete bound. */
export const RetentionBound = Schema.Struct({
  schema_version: SchemaVersion,
  policy: Schema.Literal("shortest_applicable"),
  policy_version: VersionIdentifier,
  retain_until: IsoTimestamp,
}).annotations({ identifier: "RetentionBound" });
export type RetentionBound = Schema.Schema.Type<typeof RetentionBound>;

/**
 * `identity_link_snapshot.v1` evidence is restricted community evidence: it
 * carries its community/guild scope, purpose-scoped consent provenance,
 * unlink/deletion/withdrawal invalidation provenance, the shortest applicable
 * retention bound, and the authorization + tombstone watermarks it pinned.
 * It is an explicit compute input, never an ad-hoc join.
 */
export const IdentityLinkSnapshotEvidence = Schema.Struct({
  schema_version: SchemaVersion,
  capability: Schema.Literal("identity_link_snapshot.v1"),
  adapter_version: VersionIdentifier,
  link_snapshot_id: NonEmptyString,
  community_ref: CommunityRef,
  guild_ref: DiscordSnowflake,
  consent: ConsentProvenance,
  invalidation: InvalidationProvenance,
  retention: RetentionBound,
  authorization_watermarks: AuthorizationWatermarkSet,
  mvcc_token_digest: VersionedDigest.pipe(
    Schema.filter(
      (value) =>
        hasDomain(value, GATE_LEAK_DIGEST_DOMAINS.mvcc_token) ||
        "mvcc_token_digest must use the gate-leak.mvcc-token v1 digest domain",
    ),
  ),
  subject_set_digest: VersionedDigest.pipe(
    Schema.filter(
      (value) =>
        hasDomain(value, GATE_LEAK_DIGEST_DOMAINS.subject_cohort) ||
        "subject_set_digest must use the gate-leak.subject-cohort v1 digest domain",
    ),
  ),
  cohort_cardinality: NonNegativeInt,
  page_root_digest: VersionedDigest.pipe(
    Schema.filter(
      (value) =>
        hasDomain(value, GATE_LEAK_DIGEST_DOMAINS.page_root) ||
        "page_root_digest must use the gate-leak.page-root v1 digest domain",
    ),
  ),
  observation_window: ObservationWindow,
  evidence_digest: GateLeakEvidenceDigest,
}).annotations({ identifier: "IdentityLinkSnapshotEvidence" });
export type IdentityLinkSnapshotEvidence = Schema.Schema.Type<
  typeof IdentityLinkSnapshotEvidence
>;

const decodeStrictOptions = { errors: "all", onExcessProperty: "error" } as const;
const decodeCollectionIdentityEvidenceStruct = Schema.decodeUnknown(
  CollectionIdentityEvidence,
  decodeStrictOptions,
);

/** Strict decode PLUS CR-001 deployment-ref integrity for every deployment. */
export const decodeCollectionIdentityEvidence = (
  input: unknown,
): Effect.Effect<
  CollectionIdentityEvidence,
  | ParseResult.ParseError
  | CanonicalEncodingError
  | DigestComputationError
  | ContractIntegrityError
> =>
  decodeCollectionIdentityEvidenceStruct(input).pipe(
    Effect.flatMap((evidence) =>
      Effect.forEach(evidence.deployments, decodeCollectionDeploymentRef).pipe(
        Effect.map(
          (deployments) =>
            ({
              ...evidence,
              deployments,
            }) satisfies CollectionIdentityEvidence,
        ),
      ),
    ),
  );

const decodeOwnershipIndexEvidenceStruct = Schema.decodeUnknown(
  OwnershipIndexEvidence,
  decodeStrictOptions,
);

/** Strict decode PLUS per-attestation digest/policy/deployment-ref integrity. */
export const decodeOwnershipIndexEvidence = (
  input: unknown,
): Effect.Effect<
  OwnershipIndexEvidence,
  | ParseResult.ParseError
  | OwnershipFinalityIntegrityError
  | CanonicalEncodingError
  | DigestComputationError
  | ContractIntegrityError
> =>
  decodeOwnershipIndexEvidenceStruct(input).pipe(
    Effect.flatMap((evidence) =>
      Effect.forEach(
        evidence.finality_attestations,
        verifyOwnershipFinalityAttestationIntegrity,
      ).pipe(
        Effect.map(
          (finality_attestations) =>
            ({
              ...evidence,
              finality_attestations,
            }) satisfies OwnershipIndexEvidence,
        ),
      ),
    ),
  );

export const decodeDiscordRoleSnapshotEvidence = Schema.decodeUnknown(
  DiscordRoleSnapshotEvidence,
  decodeStrictOptions,
);
export const decodeIdentityLinkSnapshotEvidence = Schema.decodeUnknown(
  IdentityLinkSnapshotEvidence,
  decodeStrictOptions,
);

/* ------------------------------------------------------------------------ */
/* Pinned watermarks and restart conditions                                  */
/* ------------------------------------------------------------------------ */

/**
 * Every compute attempt pins these at lease acquisition and revalidates them
 * immediately before the fulfillment CAS. The pins are part of the exact
 * compute input (see `GateLeakComputeInput.pins`), so a reused result can
 * never detach from the watermarks it was computed under.
 */
export const ComputeAttemptPins = Schema.Struct({
  schema_version: SchemaVersion,
  mapping_version_id: MappingVersionIdDigest,
  consent_policy_version: VersionIdentifier,
  identity_tombstone_watermark: DecimalString,
  gateway_epoch: NonNegativeInt,
  gateway_sequence: DecimalString,
  capability_registry: CapabilityRegistryVersion,
  authorization_watermarks: AuthorizationWatermarkSet,
}).annotations({ identifier: "ComputeAttemptPins" });
export type ComputeAttemptPins = Schema.Schema.Type<typeof ComputeAttemptPins>;

export const decodeComputeAttemptPins = Schema.decodeUnknown(
  ComputeAttemptPins,
  decodeStrictOptions,
);

/** Mutations observed between the pinned cut and finalization. */
export interface ObservedMutations {
  readonly mapping:
    | { readonly kind: "unchanged" }
    | { readonly kind: "new_version_ratified" }
    | { readonly kind: "revoked" };
  readonly consent_policy_version: string;
  readonly identity_tombstone:
    | { readonly kind: "contiguous"; readonly watermark: string }
    | { readonly kind: "gap" };
  readonly gateway:
    | { readonly kind: "same_epoch"; readonly sequence: string }
    | { readonly kind: "epoch_changed" };
  readonly capability_registry: CapabilityRegistryVersion;
  readonly authorization:
    | { readonly kind: "unchanged" }
    | { readonly kind: "watermark_advanced" }
    | { readonly kind: "revoked" };
}

export type WatermarkRestartDecision =
  | { readonly kind: "proceed" }
  | {
      readonly kind: "restart_acquisition";
      readonly reason_code: "watermark_mutation_restart" | "identity_invalidation_stale";
      readonly mutations: ReadonlyArray<string>;
    }
  | {
      readonly kind: "needs_attention";
      readonly reason_code: "gate_mapping_revoked" | "authorization_revoked";
    };

/**
 * Restart conditions: any tracked mutation before finalization invalidates
 * the attempt and restarts acquisition. Two mutations are not restartable:
 * mapping revocation requires explicit operator relink, and authorization
 * revocation detaches restricted work. Neither ever selects a replacement
 * silently.
 */
export const evaluateWatermarkRestart = (
  pins: ComputeAttemptPins,
  observed: ObservedMutations,
): WatermarkRestartDecision => {
  if (observed.mapping.kind === "revoked") {
    return { kind: "needs_attention", reason_code: "gate_mapping_revoked" };
  }
  if (observed.authorization.kind === "revoked") {
    return { kind: "needs_attention", reason_code: "authorization_revoked" };
  }
  if (observed.identity_tombstone.kind === "gap") {
    return {
      kind: "restart_acquisition",
      reason_code: "identity_invalidation_stale",
      mutations: ["identity_tombstone_gap"],
    };
  }

  const mutations: Array<string> = [];
  if (observed.mapping.kind === "new_version_ratified") mutations.push("mapping_version");
  if (observed.consent_policy_version !== pins.consent_policy_version) {
    mutations.push("consent_policy_version");
  }
  if (observed.identity_tombstone.watermark !== pins.identity_tombstone_watermark) {
    mutations.push("identity_tombstone_watermark");
  }
  if (
    observed.gateway.kind === "epoch_changed" ||
    observed.gateway.sequence !== pins.gateway_sequence
  ) {
    mutations.push("gateway_watermark");
  }
  if (
    observed.capability_registry.registry_epoch !== pins.capability_registry.registry_epoch ||
    observed.capability_registry.registry_sequence !==
      pins.capability_registry.registry_sequence
  ) {
    mutations.push("capability_registry_version");
  }
  if (observed.authorization.kind === "watermark_advanced") {
    mutations.push("authorization_watermark");
  }

  return mutations.length === 0
    ? { kind: "proceed" }
    : {
        kind: "restart_acquisition",
        reason_code: "watermark_mutation_restart",
        mutations,
      };
};

/* ------------------------------------------------------------------------ */
/* Version-invalidation of unsafe reuse                                      */
/* ------------------------------------------------------------------------ */

export interface EvidenceReuseCandidate {
  readonly capability: string;
  readonly adapter_version: string;
  readiness_policy_version: string;
  /** Sorted unique closed finality policy versions present on the candidate. */
  readonly finality_policy_versions: ReadonlyArray<OwnershipFinalityPolicyVersionV1>;
  readonly covered_deployment_ids: ReadonlyArray<string>;
  readonly fresh: boolean;
}

export interface EvidenceRequirementContext {
  readonly capability: string;
  readonly minimum_adapter_version: string;
  readonly readiness_policy_version: string;
  /** Sorted unique closed finality policies required by the recipe. */
  readonly finality_policy_versions: ReadonlyArray<OwnershipFinalityPolicyVersionV1>;
  readonly required_deployment_ids: ReadonlyArray<string>;
}

export type EvidenceReuseVerdict =
  | { readonly reuse: true }
  | {
      readonly reuse: false;
      readonly refusals: ReadonlyArray<
        | "capability_mismatch"
        | "adapter_version_changed"
        | "readiness_policy_changed"
        | "finality_policy_changed"
        | "empty_deployment_selection"
        | "partial_deployment_coverage"
        | "stale_evidence"
      >;
    };

/**
 * Ready evidence is reused only while every version matches and coverage plus
 * freshness qualify. Changes to policy or adapter version invalidate reuse
 * rather than silently serving stale semantics. An empty required set is a
 * refusal, never a vacuously covered requirement.
 */
export const qualifiesForReuse = (
  candidate: EvidenceReuseCandidate,
  requirement: EvidenceRequirementContext,
): EvidenceReuseVerdict => {
  const refusals: Array<
    | "capability_mismatch"
    | "adapter_version_changed"
    | "readiness_policy_changed"
    | "finality_policy_changed"
    | "empty_deployment_selection"
    | "partial_deployment_coverage"
    | "stale_evidence"
  > = [];
  if (candidate.capability !== requirement.capability) refusals.push("capability_mismatch");
  if (candidate.adapter_version !== requirement.minimum_adapter_version) {
    refusals.push("adapter_version_changed");
  }
  if (candidate.readiness_policy_version !== requirement.readiness_policy_version) {
    refusals.push("readiness_policy_changed");
  }
  const candidateFinality = candidate.finality_policy_versions.toSorted();
  const requiredFinality = requirement.finality_policy_versions.toSorted();
  if (
    candidateFinality.length !== requiredFinality.length ||
    candidateFinality.some((value, index) => value !== requiredFinality[index])
  ) {
    refusals.push("finality_policy_changed");
  }
  if (requirement.required_deployment_ids.length === 0) {
    refusals.push("empty_deployment_selection");
  }
  const covered = new Set(candidate.covered_deployment_ids);
  if (
    !requirement.required_deployment_ids.every((deploymentId) =>
      covered.has(deploymentId),
    )
  ) {
    refusals.push("partial_deployment_coverage");
  }
  if (!candidate.fresh) refusals.push("stale_evidence");
  return refusals.length === 0 ? { reuse: true } : { reuse: false, refusals };
};

/* ------------------------------------------------------------------------ */
/* Recipe freshness at Ordering `evaluated_at`                               */
/* ------------------------------------------------------------------------ */

/**
 * Age of an observation timestamp relative to Ordering's `evaluated_at`,
 * applying the package clock-skew tolerance: timestamps up to
 * `max_database_clock_skew_seconds` in the future are age zero; farther
 * future-issued timestamps are `future_beyond_skew`.
 */
export const observationAgeSecondsAt = (
  observedAt: string,
  evaluatedAt: string,
  clockSkewToleranceSeconds: number = CLOCK_SKEW_POLICY_V1.max_database_clock_skew_seconds,
): number | "future_beyond_skew" | "invalid_timestamp" => {
  if (!isValidIsoTimestamp(observedAt) || !isValidIsoTimestamp(evaluatedAt)) {
    return "invalid_timestamp";
  }
  const age = (Date.parse(evaluatedAt) - Date.parse(observedAt)) / 1000;
  if (!Number.isFinite(age)) return "invalid_timestamp";
  if (age < -clockSkewToleranceSeconds) return "future_beyond_skew";
  if (age < 0) return 0;
  return age;
};

export type CapabilityFreshnessVerdict =
  | { readonly fresh: true }
  | {
      readonly fresh: false;
      readonly reason_code:
        | "ownership_evidence_stale"
        | "discord_snapshot_stale"
        | "identity_snapshot_stale";
      readonly capability:
        | "ownership_index.v1"
        | "discord_role_snapshot.v1"
        | "identity_link_snapshot.v1";
      readonly observed_at: string;
      readonly evaluated_at: string;
      readonly age_seconds: number | "future_beyond_skew" | "invalid_timestamp";
      readonly max_age_seconds: number;
      readonly remediation: string;
    };

const freshnessFailure = (input: {
  readonly reason_code:
    | "ownership_evidence_stale"
    | "discord_snapshot_stale"
    | "identity_snapshot_stale";
  readonly capability:
    | "ownership_index.v1"
    | "discord_role_snapshot.v1"
    | "identity_link_snapshot.v1";
  readonly observed_at: string;
  readonly evaluated_at: string;
  readonly age_seconds: number | "future_beyond_skew" | "invalid_timestamp";
  readonly max_age_seconds: number;
  readonly remediation: string;
}): CapabilityFreshnessVerdict => ({ fresh: false, ...input });

/**
 * Ownership source currency against `evaluated_at` using the recipe's
 * ownership finality / max-source-age policy. Every coverage `source_time`,
 * every finality attestation `finalized_observed_at`, and the
 * observation-window end must be within the bound (clock-skew safe).
 */
export const evaluateOwnershipFreshnessAt = (
  ownership: OwnershipIndexEvidence,
  evaluatedAt: string,
  maxSourceAgeSeconds: number = OWNERSHIP_FRESHNESS_POLICY_V1.max_source_age_seconds,
): CapabilityFreshnessVerdict => {
  const timestamps: Array<{ readonly label: string; readonly at: string }> = [
    { label: "observation_window.end", at: ownership.observation_window.window_end },
    ...ownership.coverage.map((entry, index) => ({
      label: `coverage[${index}].source_time`,
      at: entry.source_time,
    })),
    ...ownership.finality_attestations.map((attestation, index) => ({
      label: `finality_attestations[${index}].finalized_observed_at`,
      at: attestation.finalized_observed_at,
    })),
  ];
  for (const sample of timestamps) {
    const age = observationAgeSecondsAt(sample.at, evaluatedAt);
    if (
      age === "future_beyond_skew" ||
      age === "invalid_timestamp" ||
      age > maxSourceAgeSeconds
    ) {
      return freshnessFailure({
        reason_code: "ownership_evidence_stale",
        capability: "ownership_index.v1",
        observed_at: sample.at,
        evaluated_at: evaluatedAt,
        age_seconds: age,
        max_age_seconds: maxSourceAgeSeconds,
        remediation:
          "re-acquire ownership_index.v1 against a current source head within the finality/max-source-age policy",
      });
    }
  }
  return { fresh: true };
};

export type OwnershipFinalityReadinessVerdict =
  | { readonly proven: true }
  | {
      readonly proven: false;
      readonly reason_code: "ownership_finality_unproven" | "partial_deployment_coverage";
      readonly detail:
        | "missing_attestation"
        | "duplicate_attestation"
        | "unknown_or_unsupported_policy"
        | "wrong_vm_policy"
        | "wrong_network_reference"
        | "unfinalized_status"
        | "grafted_digest"
        | "grafted_deployment_ref"
        | "hybrid_deployment_ref"
        | "detached_adapter"
        | "detached_source"
        | "coverage_source_mismatch"
        | "attestation_coverage_deployment_mismatch"
        | "deployment_network_unknown";
      readonly deployment_id?: string;
    };

/**
 * Prove ownership finality for the exact selected deployment set from the
 * closed attestation contract: complete coverage, policy/source-position kind
 * matching the VERIFIED CR-001 deployment VM (via
 * `selectedDeploymentNetworks`), digest integrity, adapter/source binding to
 * coverage, and finalized status. Self-declared namespaces are not authority.
 */
export const evaluateOwnershipFinalityProof = (
  ownership: OwnershipIndexEvidence,
  selectedDeploymentNetworks: VerifiedDeploymentNetworkMap,
  supportedFinalityPolicies: ReadonlyArray<OwnershipFinalityPolicyVersionV1>,
): OwnershipFinalityReadinessVerdict => {
  const supported = new Set<string>(supportedFinalityPolicies);
  const seen = new Set<string>();
  const byDeployment = new Map<string, OwnershipFinalityAttestation>();
  const selectedDeploymentIds = [...selectedDeploymentNetworks.keys()];

  for (const attestation of ownership.finality_attestations) {
    const deploymentId = attestationDeploymentId(attestation).digest;
    if (seen.has(deploymentId)) {
      return {
        proven: false,
        reason_code: "ownership_finality_unproven",
        detail: "duplicate_attestation",
        deployment_id: deploymentId,
      };
    }
    seen.add(deploymentId);
    byDeployment.set(deploymentId, attestation);

    if (!supported.has(attestation.policy_version)) {
      return {
        proven: false,
        reason_code: "ownership_finality_unproven",
        detail: "unknown_or_unsupported_policy",
        deployment_id: deploymentId,
      };
    }

    const selected = selectedDeploymentNetworks.get(deploymentId);
    if (selected === undefined) {
      // Attestation for a deployment outside the verified selection — refuse
      // rather than trusting the attestation's own ref as authority.
      return {
        proven: false,
        reason_code: "ownership_finality_unproven",
        detail: "deployment_network_unknown",
        deployment_id: deploymentId,
      };
    }

    const derivedNamespace = attestationNetworkNamespace(attestation);
    const expected = OWNERSHIP_FINALITY_POLICY_BY_NAMESPACE_V1[selected.network_namespace];
    if (
      derivedNamespace !== selected.network_namespace ||
      attestation.policy_version !== expected.version
    ) {
      return {
        proven: false,
        reason_code: "ownership_finality_unproven",
        detail: "wrong_vm_policy",
        deployment_id: deploymentId,
      };
    }
    if (
      attestation.deployment_ref.network.network_reference !==
      selected.network_reference
    ) {
      return {
        proven: false,
        reason_code: "ownership_finality_unproven",
        detail: "wrong_network_reference",
        deployment_id: deploymentId,
      };
    }
    if (attestation.finality_status !== "finalized") {
      return {
        proven: false,
        reason_code: "ownership_finality_unproven",
        detail: "unfinalized_status",
        deployment_id: deploymentId,
      };
    }
    if (attestation.adapter_version !== ownership.adapter_version) {
      return {
        proven: false,
        reason_code: "ownership_finality_unproven",
        detail: "detached_adapter",
        deployment_id: deploymentId,
      };
    }
  }

  for (const deploymentId of selectedDeploymentIds) {
    const selected = selectedDeploymentNetworks.get(deploymentId);
    if (selected === undefined) {
      return {
        proven: false,
        reason_code: "ownership_finality_unproven",
        detail: "deployment_network_unknown",
        deployment_id: deploymentId,
      };
    }
    const attestation = byDeployment.get(deploymentId);
    if (attestation === undefined) {
      return {
        proven: false,
        reason_code: "partial_deployment_coverage",
        detail: "missing_attestation",
        deployment_id: deploymentId,
      };
    }
    const coverage = ownership.coverage.find(
      (entry) => entry.deployment_id.digest === deploymentId,
    );
    if (coverage === undefined) {
      return {
        proven: false,
        reason_code: "ownership_finality_unproven",
        detail: "detached_source",
        deployment_id: deploymentId,
      };
    }
    if (coverage.deployment_id.digest !== attestationDeploymentId(attestation).digest) {
      return {
        proven: false,
        reason_code: "ownership_finality_unproven",
        detail: "attestation_coverage_deployment_mismatch",
        deployment_id: deploymentId,
      };
    }
    const expectedKind =
      OWNERSHIP_FINALITY_POLICY_BY_NAMESPACE_V1[selected.network_namespace]
        .source_position_kind;
    if (coverage.source_position_kind !== expectedKind) {
      return {
        proven: false,
        reason_code: "ownership_finality_unproven",
        detail: "wrong_vm_policy",
        deployment_id: deploymentId,
      };
    }
    const finalizedPosition =
      selected.network_namespace === "eip155" && "finalized_block_height" in attestation
        ? attestation.finalized_block_height
        : selected.network_namespace === "solana" && "finalized_slot" in attestation
          ? attestation.finalized_slot
          : undefined;
    if (finalizedPosition === undefined) {
      return {
        proven: false,
        reason_code: "ownership_finality_unproven",
        detail: "hybrid_deployment_ref",
        deployment_id: deploymentId,
      };
    }
    if (coverage.source_position !== finalizedPosition) {
      return {
        proven: false,
        reason_code: "ownership_finality_unproven",
        detail: "coverage_source_mismatch",
        deployment_id: deploymentId,
      };
    }
    if (coverage.source_time !== attestation.finalized_observed_at) {
      return {
        proven: false,
        reason_code: "ownership_finality_unproven",
        detail: "detached_source",
        deployment_id: deploymentId,
      };
    }
  }

  return { proven: true };
};

/**
 * Discord snapshot freshness: capture-window end vs `evaluated_at`.
 */
export const evaluateDiscordSnapshotFreshnessAt = (
  discord: DiscordRoleSnapshotEvidence,
  evaluatedAt: string,
  maxSnapshotAgeSeconds: number = DISCORD_SNAPSHOT_FRESHNESS_POLICY_V1.max_snapshot_age_seconds,
): CapabilityFreshnessVerdict => {
  const observedAt = discord.attestation.capture_window.window_end;
  const age = observationAgeSecondsAt(observedAt, evaluatedAt);
  if (
    age === "future_beyond_skew" ||
    age === "invalid_timestamp" ||
    age > maxSnapshotAgeSeconds
  ) {
    return freshnessFailure({
      reason_code: "discord_snapshot_stale",
      capability: "discord_role_snapshot.v1",
      observed_at: observedAt,
      evaluated_at: evaluatedAt,
      age_seconds: age,
      max_age_seconds: maxSnapshotAgeSeconds,
      remediation:
        "re-acquire discord_role_snapshot.v1 within the snapshot freshness bound",
    });
  }
  return { fresh: true };
};

/**
 * Identity-link snapshot freshness: observation-window end vs `evaluated_at`
 * within the Identity propagation objective.
 */
export const evaluateIdentitySnapshotFreshnessAt = (
  identity: IdentityLinkSnapshotEvidence,
  evaluatedAt: string,
  maxSnapshotAgeSeconds: number = IDENTITY_SNAPSHOT_FRESHNESS_POLICY_V1.max_snapshot_age_seconds,
): CapabilityFreshnessVerdict => {
  const observedAt = identity.observation_window.window_end;
  const age = observationAgeSecondsAt(observedAt, evaluatedAt);
  if (
    age === "future_beyond_skew" ||
    age === "invalid_timestamp" ||
    age > maxSnapshotAgeSeconds
  ) {
    return freshnessFailure({
      reason_code: "identity_snapshot_stale",
      capability: "identity_link_snapshot.v1",
      observed_at: observedAt,
      evaluated_at: evaluatedAt,
      age_seconds: age,
      max_age_seconds: maxSnapshotAgeSeconds,
      remediation:
        "re-acquire identity_link_snapshot.v1 within the Identity propagation objective",
    });
  }
  return { fresh: true };
};
