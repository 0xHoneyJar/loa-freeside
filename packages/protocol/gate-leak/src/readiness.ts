import {
  type CanonicalEncodingError,
  type CollectionDeploymentRef,
  ContractIntegrityError,
  type DigestComputationError,
  DuplicateCanonicalSetMemberError,
  VersionedDigest,
  canonicalize,
  decodeCollectionDeploymentRef,
} from "@freeside/collection-protocol";
import { Effect, type ParseResult } from "effect";
import type {
  GateLeakRecipe,
  GateLeakRecipeRequirement,
  PartialPolicy,
  PolicyVersionRef,
} from "./capabilities.js";
import { GATE_LEAK_RECIPE_V1 } from "./capabilities.js";
import {
  digestGateLeakComputeInput,
  evaluateCaptureCompleteness,
  evaluateCohortAdmission,
  type GateLeakComputeInput,
} from "./compute.js";
import type {
  CollectionIdentityEvidence,
  ComputeAttemptPins,
  DiscordRoleSnapshotEvidence,
  IdentityLinkSnapshotEvidence,
  OwnershipIndexEvidence,
} from "./evidence.js";
import {
  authorizationWatermarkSetsEqual,
  buildVerifiedDeploymentNetworkMap,
  checkEvidenceAlignment,
  evaluateDiscordSnapshotFreshnessAt,
  evaluateIdentitySnapshotFreshnessAt,
  evaluateOwnershipFinalityProof,
  evaluateOwnershipFreshnessAt,
  verifyOwnershipFinalityAttestationIntegrity,
} from "./evidence.js";
import type { GateMappingAggregate, GateMappingVersion } from "./mapping.js";
import { decodeGateMappingAggregate, mappingSatisfiesReadiness } from "./mapping.js";
import type { GateLeakOrderReasonCode } from "./reason-codes.js";
import { orderGateLeakOrderReasonCodes } from "./reason-codes.js";
import type { CommunityRef, DiscordSnowflake, IsoTimestamp } from "./scalars.js";
import {
  digestDeploymentSet,
  type EmptyDeploymentSelectionError,
  type InvalidDeploymentSetMemberError,
} from "./work-keys.js";

/**
 * Recipe-level readiness composition. Ordering owns admission and the order
 * lifecycle; this pure evaluator answers one question: do the presented
 * EVIDENCE ENVELOPES prove every capability of the ratified Gate Leak recipe
 * for this exact selection, and if not, with which safe reason codes?
 *
 * Nothing here is a caller assertion. Every capability is proven from its
 * decoded evidence envelope; scope, versions, digests, watermarks, and the
 * compute-input bindings are cross-checked against each other; the compute
 * input digest is RECOMPUTED and returned server-side, never accepted.
 */

export interface GateLeakReadinessContext {
  /** Order scope (server-derived from the confirmed resolution + community). */
  readonly community_ref: CommunityRef;
  readonly guild_ref: DiscordSnowflake;
  /**
   * The confirmed selected deployments as verified CR-001
   * `CollectionDeploymentRef`s. Digests alone are not finality authority —
   * readiness derives the deployment_id → network map from these refs.
   */
  readonly selected_deployments: ReadonlyArray<CollectionDeploymentRef>;
  /**
   * The versioned community_gate_audit consent-purpose policy configured for
   * this community; undefined means the named prerequisite is missing.
   */
  readonly consent_purpose_policy: PolicyVersionRef | undefined;
  /** The Shadow Audit gate-mapping aggregate for community+guild+collection. */
  readonly mapping_aggregate: GateMappingAggregate;
  /** capability 1/6: collection_identity.v1 evidence envelope. */
  readonly collection_identity: CollectionIdentityEvidence;
  /** capability 2/6: ownership_index.v1 evidence envelope. */
  readonly ownership: OwnershipIndexEvidence;
  /** capability 4/6: discord_role_snapshot.v1 evidence envelope. */
  readonly discord: DiscordRoleSnapshotEvidence;
  /** capability 5/6: identity_link_snapshot.v1 evidence envelope. */
  readonly identity_links: IdentityLinkSnapshotEvidence;
  /** The watermarks this compute attempt pinned at lease acquisition. */
  readonly pins: ComputeAttemptPins;
  /** capability 6/6: the exact compute input claimed for this attempt. */
  readonly compute_input: GateLeakComputeInput;
  /** Ordering database-clock time of this evaluation (retention bound). */
  readonly evaluated_at: IsoTimestamp;
}

export interface CoverageGapDisclosure {
  readonly partial_policy: Exclude<PartialPolicy, "reject">;
  readonly missing_deployment_ids: ReadonlyArray<string>;
}

export type GateLeakReadinessVerdict =
  | {
      readonly ready: true;
      readonly mapping_version: GateMappingVersion;
      readonly as_of_interval: { readonly start: string; readonly end: string };
      /** Server-recomputed digest of the validated exact compute input. */
      readonly compute_input_digest: VersionedDigest;
      /**
       * Present exactly when the recipe permitted partial coverage; the
       * artifact MUST disclose it. Absent means full coverage.
       */
      readonly disclosed_coverage_gap?: CoverageGapDisclosure;
    }
  | {
      readonly ready: false;
      readonly reason_codes: ReadonlyArray<GateLeakOrderReasonCode>;
    };

export type GateLeakReadinessEvaluationError =
  | ParseResult.ParseError
  | CanonicalEncodingError
  | DigestComputationError
  | DuplicateCanonicalSetMemberError
  | EmptyDeploymentSelectionError
  | InvalidDeploymentSetMemberError
  | ContractIntegrityError;

const requirementFor = (
  requirements: ReadonlyArray<GateLeakRecipeRequirement>,
  capability: GateLeakRecipeRequirement["capability"],
): GateLeakRecipeRequirement | undefined =>
  requirements.find((requirement) => requirement.capability === capability);

const digestsEqual = (left: VersionedDigest, right: VersionedDigest): boolean =>
  left.algorithm === right.algorithm &&
  left.domain === right.domain &&
  left.major_version === right.major_version &&
  left.digest === right.digest;

const sortedSetsEqual = (
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const compareDeploymentIds = (
  first: CollectionDeploymentRef,
  second: CollectionDeploymentRef,
): number => {
  if (first.deployment_id.digest < second.deployment_id.digest) return -1;
  if (first.deployment_id.digest > second.deployment_id.digest) return 1;
  return 0;
};

/** Order-insensitive equality for already integrity-verified deployment sets. */
export const deploymentReferenceSetsEqual = (
  left: ReadonlyArray<CollectionDeploymentRef>,
  right: ReadonlyArray<CollectionDeploymentRef>,
): boolean => {
  const sortedLeft = left.toSorted(compareDeploymentIds);
  const sortedRight = right.toSorted(compareDeploymentIds);
  return (
    sortedLeft.length === sortedRight.length &&
    sortedLeft.every(
      (deployment, index) =>
        sortedRight[index] !== undefined &&
        digestsEqual(deployment.deployment_id, sortedRight[index]!.deployment_id) &&
        deployment.network.network_namespace ===
          sortedRight[index]!.network.network_namespace &&
        deployment.network.network_reference ===
          sortedRight[index]!.network.network_reference,
    )
  );
};

type MappingAggregateReadinessVerification =
  | { readonly verified: true; readonly aggregate: GateMappingAggregate }
  | {
      readonly verified: false;
      readonly reason_code: "gate_mapping_malformed" | "mapping_integrity_violation";
    };

const verifyMappingAggregateForReadiness = (
  input: unknown,
): Effect.Effect<
  MappingAggregateReadinessVerification,
  CanonicalEncodingError | DigestComputationError
> =>
  decodeGateMappingAggregate(input).pipe(
    Effect.map(
      (aggregate): MappingAggregateReadinessVerification => ({
        verified: true,
        aggregate,
      }),
    ),
    Effect.catchTag("ParseError", () =>
      Effect.succeed<MappingAggregateReadinessVerification>({
        verified: false,
        reason_code: "gate_mapping_malformed",
      }),
    ),
    Effect.catchTag("MappingIntegrityError", () =>
      Effect.succeed<MappingAggregateReadinessVerification>({
        verified: false,
        reason_code: "mapping_integrity_violation",
      }),
    ),
  );

export const evaluateGateLeakReadiness = (
  context: GateLeakReadinessContext,
  recipe: GateLeakRecipe = GATE_LEAK_RECIPE_V1,
): Effect.Effect<GateLeakReadinessVerdict, GateLeakReadinessEvaluationError> =>
  Effect.gen(function* () {
    const reasons = new Set<GateLeakOrderReasonCode>();

    /* -- selection: an empty deployment set fails before anything else ---- */
    if (context.selected_deployments.length === 0) {
      return {
        ready: false,
        reason_codes: ["empty_deployment_selection"],
      } satisfies GateLeakReadinessVerdict;
    }

    // Verify every selected CR-001 ref and build the exact deployment_id →
    // verified network map that finality proof consults.
    const verifiedSelected = yield* Effect.forEach(
      context.selected_deployments,
      decodeCollectionDeploymentRef,
    );
    const selectedNetworkMap = yield* buildVerifiedDeploymentNetworkMap(verifiedSelected);
    const selectedDeploymentIds = verifiedSelected.map(
      (deployment) => deployment.deployment_id,
    );
    const selectedSetDigest = yield* digestDeploymentSet(selectedDeploymentIds);
    const selectedDigests = selectedDeploymentIds.map((deployment) => deployment.digest);

    /* -- consent-purpose prerequisite ------------------------------------- */
    if (context.consent_purpose_policy === undefined) {
      reasons.add("purpose_policy_missing");
    }

    /* -- capability 3/6: gate_mapping.v1 ---------------------------------- */
    const aggregateVerification = yield* verifyMappingAggregateForReadiness(
      context.mapping_aggregate,
    );
    if (!aggregateVerification.verified) {
      return {
        ready: false,
        reason_codes: [aggregateVerification.reason_code],
      } satisfies GateLeakReadinessVerdict;
    }
    const aggregate = aggregateVerification.aggregate;
    if (
      aggregate.community_ref !== context.community_ref ||
      aggregate.guild_ref !== context.guild_ref
    ) {
      reasons.add("evidence_scope_mismatch");
    }
    const mappingVerdict = mappingSatisfiesReadiness(aggregate);
    let mappingVersion: GateMappingVersion | undefined;
    if (!mappingVerdict.ready) {
      reasons.add(mappingVerdict.reason_code);
    } else {
      mappingVersion = mappingVerdict.version;
      if (!digestsEqual(mappingVersion.deployment_set_digest, selectedSetDigest)) {
        reasons.add("evidence_scope_mismatch");
      }
    }

    const requirements = recipe.requirements;
    const computeInput = context.compute_input;

    /* -- capability 1/6: collection_identity.v1 --------------------------- */
    const identityRequirement = requirementFor(requirements, "collection_identity.v1");
    const collectionIdentity = context.collection_identity;
    if (
      identityRequirement !== undefined &&
      collectionIdentity.adapter_version !== identityRequirement.minimum_adapter_version
    ) {
      reasons.add("evidence_version_below_floor");
    }
    if (collectionIdentity.collection_id.digest !== aggregate.collection_id.digest) {
      reasons.add("evidence_scope_mismatch");
    }
    const verifiedIdentityDeployments = yield* Effect.forEach(
      collectionIdentity.deployments,
      decodeCollectionDeploymentRef,
    );
    if (!deploymentReferenceSetsEqual(verifiedIdentityDeployments, verifiedSelected)) {
      reasons.add("evidence_scope_mismatch");
    }
    const identityCovered = new Set(
      verifiedIdentityDeployments.map((deployment) => deployment.deployment_id.digest),
    );
    if (!selectedDigests.every((digest) => identityCovered.has(digest))) {
      reasons.add("partial_deployment_coverage");
    }
    if (
      collectionIdentity.capability_registry.registry_epoch !==
        context.pins.capability_registry.registry_epoch ||
      collectionIdentity.capability_registry.registry_sequence !==
        context.pins.capability_registry.registry_sequence
    ) {
      reasons.add("compute_input_binding_mismatch");
    }

    /* -- capability 2/6: ownership_index.v1 ------------------------------- */
    const ownershipRequirement = requirementFor(requirements, "ownership_index.v1");
    const ownership = context.ownership;
    if (
      ownershipRequirement !== undefined &&
      ownership.adapter_version !== ownershipRequirement.minimum_adapter_version
    ) {
      reasons.add("evidence_version_below_floor");
    }
    const ownershipCovered = new Set(
      ownership.coverage
        .filter((entry) => entry.completeness === "complete")
        .map((entry) => entry.deployment_id.digest),
    );
    const missingOwnership = selectedDigests.filter(
      (digest) => !ownershipCovered.has(digest),
    );
    const ownershipPolicy = ownershipRequirement?.partial_policy ?? "reject";
    if (missingOwnership.length > 0 && ownershipPolicy === "reject") {
      reasons.add("partial_deployment_coverage");
    }

    const supportedFinality =
      ownershipRequirement?.freshness.kind === "ownership_finality_max_source_age"
        ? ownershipRequirement.freshness.supported_finality_policies
        : [];
    const attestationIntegrity = yield* Effect.forEach(
      ownership.finality_attestations,
      (attestation) =>
        verifyOwnershipFinalityAttestationIntegrity(attestation).pipe(
          Effect.map(() => ({ ok: true as const })),
          Effect.catchTag("OwnershipFinalityIntegrityError", (error) =>
            Effect.succeed({
              ok: false as const,
              reason: error.reason,
            }),
          ),
          Effect.catchTag("ContractIntegrityError", () =>
            Effect.succeed({
              ok: false as const,
              reason: "grafted_deployment_ref" as const,
            }),
          ),
        ),
    );
    if (attestationIntegrity.some((result) => !result.ok)) {
      reasons.add("ownership_finality_unproven");
    } else {
      const finalityProof = evaluateOwnershipFinalityProof(
        ownership,
        selectedNetworkMap,
        supportedFinality,
      );
      if (!finalityProof.proven) {
        reasons.add(finalityProof.reason_code);
      }
    }

    if (ownershipRequirement?.freshness.kind === "ownership_finality_max_source_age") {
      const ownershipFreshness = evaluateOwnershipFreshnessAt(
        ownership,
        context.evaluated_at,
        ownershipRequirement.freshness.max_source_age_seconds,
      );
      if (!ownershipFreshness.fresh) reasons.add(ownershipFreshness.reason_code);
    }

    /* -- capability 4/6: discord_role_snapshot.v1 ------------------------- */
    const discordRequirement = requirementFor(requirements, "discord_role_snapshot.v1");
    const discord = context.discord;
    if (
      discordRequirement !== undefined &&
      discord.attestation.producer_contract_version !==
        discordRequirement.minimum_adapter_version
    ) {
      reasons.add("evidence_version_below_floor");
    }
    if (
      discord.community_ref !== context.community_ref ||
      discord.guild_ref !== context.guild_ref
    ) {
      reasons.add("evidence_scope_mismatch");
    }
    if (mappingVersion !== undefined) {
      if (
        !digestsEqual(discord.mapping_version_id, mappingVersion.mapping_version_id) ||
        !digestsEqual(discord.mapping_config_digest, mappingVersion.config_digest) ||
        !sortedSetsEqual(discord.role_ids, mappingVersion.role_ids)
      ) {
        reasons.add("evidence_scope_mismatch");
      }
    }
    if (
      discord.attestation.gateway_epoch !== context.pins.gateway_epoch ||
      String(discord.attestation.gateway_resume_sequence) !==
        context.pins.gateway_sequence
    ) {
      reasons.add("compute_input_binding_mismatch");
    }
    const captureVerdict = evaluateCaptureCompleteness(discord.attestation);
    if (!captureVerdict.qualifying) reasons.add(captureVerdict.reason_code);
    if (discordRequirement?.freshness.kind === "discord_snapshot_max_age") {
      const discordFreshness = evaluateDiscordSnapshotFreshnessAt(
        discord,
        context.evaluated_at,
        discordRequirement.freshness.max_snapshot_age_seconds,
      );
      if (!discordFreshness.fresh) reasons.add(discordFreshness.reason_code);
    }

    /* -- capability 5/6: identity_link_snapshot.v1 ------------------------ */
    const linksRequirement = requirementFor(requirements, "identity_link_snapshot.v1");
    const identityLinks = context.identity_links;
    if (
      linksRequirement !== undefined &&
      identityLinks.adapter_version !== linksRequirement.minimum_adapter_version
    ) {
      reasons.add("evidence_version_below_floor");
    }
    if (
      identityLinks.community_ref !== context.community_ref ||
      identityLinks.guild_ref !== context.guild_ref
    ) {
      reasons.add("evidence_scope_mismatch");
    }
    if (
      context.consent_purpose_policy !== undefined &&
      identityLinks.consent.policy_version !== context.consent_purpose_policy.version
    ) {
      reasons.add("consent_purpose_mismatch");
    }
    if (identityLinks.consent.policy_version !== context.pins.consent_policy_version) {
      reasons.add("consent_purpose_mismatch");
    }
    if (!identityLinks.invalidation.gap_free) {
      reasons.add("identity_invalidation_stale");
    }
    if (
      identityLinks.invalidation.watermark !==
      context.pins.identity_tombstone_watermark
    ) {
      reasons.add("compute_input_binding_mismatch");
    }
    if (
      !authorizationWatermarkSetsEqual(
        identityLinks.authorization_watermarks,
        context.pins.authorization_watermarks,
      )
    ) {
      reasons.add("compute_input_binding_mismatch");
    }
    if (
      Date.parse(identityLinks.retention.retain_until) <
      Date.parse(context.evaluated_at)
    ) {
      reasons.add("restricted_evidence_expired");
    }
    if (linksRequirement?.freshness.kind === "identity_mvcc_propagation") {
      const identityFreshness = evaluateIdentitySnapshotFreshnessAt(
        identityLinks,
        context.evaluated_at,
        linksRequirement.freshness.max_snapshot_age_seconds,
      );
      if (!identityFreshness.fresh) reasons.add(identityFreshness.reason_code);
    }
    const cohortVerdict = evaluateCohortAdmission(identityLinks.cohort_cardinality);
    if (!cohortVerdict.admitted) reasons.add(cohortVerdict.reason_code);

    /* -- five-minute evidence alignment, from the envelopes themselves ---- */
    const alignment = checkEvidenceAlignment({
      ownership: ownership.observation_window,
      discord: discord.attestation.capture_window,
      identity: identityLinks.observation_window,
    });
    if (!alignment.aligned) reasons.add(alignment.reason_code);

    /* -- capability 6/6: the exact compute input binds everything --------- */
    const binds =
      computeInput.collection_id.digest === aggregate.collection_id.digest &&
      digestsEqual(computeInput.deployment_set_digest, selectedSetDigest) &&
      digestsEqual(
        computeInput.collection_identity_evidence_digest,
        collectionIdentity.evidence_digest,
      ) &&
      digestsEqual(computeInput.ownership_evidence_digest, ownership.evidence_digest) &&
      computeInput.discord_snapshot_id === discord.snapshot_id &&
      digestsEqual(computeInput.discord_evidence_digest, discord.evidence_digest) &&
      computeInput.link_snapshot_id === identityLinks.link_snapshot_id &&
      digestsEqual(
        computeInput.identity_evidence_digest,
        identityLinks.evidence_digest,
      ) &&
      digestsEqual(computeInput.cohort.subject_set_digest, identityLinks.subject_set_digest) &&
      computeInput.cohort.cardinality === identityLinks.cohort_cardinality &&
      computeInput.cohort.source_role_snapshot_id === discord.snapshot_id &&
      computeInput.readiness_policy_version === recipe.readiness_policy_version &&
      computeInput.consent_policy_version === identityLinks.consent.policy_version;
    if (!binds) reasons.add("compute_input_binding_mismatch");
    if (
      mappingVersion !== undefined &&
      (!digestsEqual(computeInput.mapping_version_id, mappingVersion.mapping_version_id) ||
        !digestsEqual(computeInput.rule_digest, mappingVersion.rule_digest))
    ) {
      reasons.add("compute_input_binding_mismatch");
    }
    if (
      alignment.aligned &&
      (computeInput.as_of_interval.start !== alignment.as_of_interval.start ||
        computeInput.as_of_interval.end !== alignment.as_of_interval.end)
    ) {
      reasons.add("compute_input_binding_mismatch");
    }
    const contextPinsCanonical = yield* canonicalize(context.pins);
    const inputPinsCanonical = yield* canonicalize(computeInput.pins);
    if (contextPinsCanonical !== inputPinsCanonical) {
      reasons.add("compute_input_binding_mismatch");
    }

    if (reasons.size > 0 || mappingVersion === undefined || !alignment.aligned) {
      return {
        ready: false,
        reason_codes: orderGateLeakOrderReasonCodes(reasons),
      } satisfies GateLeakReadinessVerdict;
    }

    /* -- ready: recompute the exact compute-input digest server-side ------ */
    const computeInputDigest = yield* digestGateLeakComputeInput(computeInput);

    if (missingOwnership.length > 0) {
      return {
        ready: true,
        mapping_version: mappingVersion,
        as_of_interval: alignment.as_of_interval,
        compute_input_digest: computeInputDigest,
        disclosed_coverage_gap: {
          partial_policy: ownershipPolicy === "allow" ? "allow" : "disclose",
          missing_deployment_ids: missingOwnership,
        },
      } satisfies GateLeakReadinessVerdict;
    }
    return {
      ready: true,
      mapping_version: mappingVersion,
      as_of_interval: alignment.as_of_interval,
      compute_input_digest: computeInputDigest,
    } satisfies GateLeakReadinessVerdict;
  });
