import {
  type CanonicalEncodingError,
  DIGEST_DOMAINS as COLLECTION_DIGEST_DOMAINS,
  type DigestComputationError,
  EvmNormalizedAddress,
  SolanaPublicKey,
  VersionIdentifier,
  VersionedDigest,
  digestVersioned,
} from "@freeside/collection-protocol";
import { Data, Effect, type ParseResult, Schema } from "effect";
import {
  DISCORD_CAPTURE_POLICY_V1,
  GATE_LEAK_COVERAGE_POLICY_V1,
  GATE_LEAK_DISCLOSURE_POLICY_V1,
  SUBJECT_COHORT_POLICY_V1,
} from "./capabilities.js";
import { ComputeAttemptPins, type DiscordCaptureAttestation } from "./evidence.js";
import { GATE_LEAK_DIGEST_DOMAINS } from "./gate-rule.js";
import {
  GATE_LEAK_ROW_REASON_CODES,
  GateLeakRowReasonCode,
} from "./reason-codes.js";
import {
  CommunityRef,
  DecimalString,
  DiscordSnowflake,
  IsoTimestamp,
  NonNegativeInt,
  SchemaVersion,
} from "./scalars.js";
import {
  type EmptyDeploymentSelectionError,
  type InvalidDeploymentSetMemberError,
  RoleIdSet,
  SubjectCohortRef,
  validateSelectedDeploymentSet,
} from "./work-keys.js";

/**
 * `gate_leak_compute.v1` — deterministic one-directional classification of
 * the pinned mapped-role cohort, the definitive-coverage rule, and the fixed
 * disclosure bands. Pure functions; the producer executes them under a fenced
 * lease and Ordering owns every surrounding transition.
 */

const NonEmptyString = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(256));

const hasDomain = (value: VersionedDigest, domain: string): boolean =>
  value.algorithm === "sha-256" && value.major_version === 1 && value.domain === domain;

/** Comparison-form wallet address: EVM lowercase or case-sensitive Solana key. */
export const ComparedWalletAddress = Schema.Union(
  EvmNormalizedAddress,
  SolanaPublicKey,
).annotations({ identifier: "ComparedWalletAddress" });
export type ComparedWalletAddress = Schema.Schema.Type<typeof ComparedWalletAddress>;

/* ------------------------------------------------------------------------ */
/* Row contract (artifact allowlist)                                         */
/* ------------------------------------------------------------------------ */

const rowInvariant = (row: {
  readonly eligibility_state: string;
  readonly reason_code: GateLeakRowReasonCode;
  readonly compared_wallets: ReadonlyArray<string>;
}): boolean | string => {
  const entry = GATE_LEAK_ROW_REASON_CODES[row.reason_code];
  if (entry.eligibility_state !== row.eligibility_state) {
    return `reason ${row.reason_code} requires eligibility_state ${entry.eligibility_state}`;
  }
  if (entry.wallets === "forbidden" && row.compared_wallets.length > 0) {
    return `reason ${row.reason_code} forbids compared wallets on the row`;
  }
  if (entry.wallets === "required" && row.compared_wallets.length === 0) {
    return `reason ${row.reason_code} requires at least one compared wallet`;
  }
  return true;
};

/**
 * The row-level allowlist: Discord user ID, mapped role ID, the normalized
 * wallets actually used by the comparison, eligibility state, and versioned
 * reason code. Nothing else can decode (excess properties are errors), and
 * indeterminate rows structurally carry zero wallet identifiers.
 */
export const GateLeakRow = Schema.Struct({
  schema_version: SchemaVersion,
  discord_user_id: DiscordSnowflake,
  role_id: DiscordSnowflake,
  eligibility_state: Schema.Literal("eligible", "proven_ineligible", "indeterminate"),
  reason_code: GateLeakRowReasonCode,
  compared_wallets: Schema.Array(ComparedWalletAddress),
}).pipe(Schema.filter(rowInvariant)).annotations({ identifier: "GateLeakRow" });
export type GateLeakRow = Schema.Schema.Type<typeof GateLeakRow>;

const strictOptions = { errors: "all", onExcessProperty: "error" } as const;
export const decodeGateLeakRow = Schema.decodeUnknown(GateLeakRow, strictOptions);
export const decodeGateLeakRows = Schema.decodeUnknown(
  Schema.Array(GateLeakRow),
  strictOptions,
);

/* ------------------------------------------------------------------------ */
/* Classification                                                            */
/* ------------------------------------------------------------------------ */

/** Per-deployment ownership evidence for one linked wallet. */
export const WalletDeploymentOwnership = Schema.Struct({
  schema_version: SchemaVersion,
  deployment_id: VersionedDigest.pipe(
    Schema.filter(
      (value) =>
        hasDomain(value, COLLECTION_DIGEST_DOMAINS.deployment) ||
        "deployment_id must use the collection.deployment v1 digest domain",
    ),
  ),
  ownership: Schema.Union(
    Schema.Struct({ kind: Schema.Literal("proven"), balance: DecimalString }),
    Schema.Struct({ kind: Schema.Literal("unavailable") }),
  ),
}).annotations({ identifier: "WalletDeploymentOwnership" });
export type WalletDeploymentOwnership = Schema.Schema.Type<
  typeof WalletDeploymentOwnership
>;

export const LinkedWalletEvidence = Schema.Struct({
  schema_version: SchemaVersion,
  address: ComparedWalletAddress,
  deployments: Schema.Array(WalletDeploymentOwnership).pipe(
    Schema.filter((items) => items.length > 0 || "deployments must be non-empty"),
  ),
}).annotations({ identifier: "LinkedWalletEvidence" });
export type LinkedWalletEvidence = Schema.Schema.Type<typeof LinkedWalletEvidence>;

/**
 * Identity input per subject. Consent collapse happens UPSTREAM (Identity
 * API): missing, refused, withdrawn, and revoked all arrive as one
 * `consent_unavailable` state, so this contract cannot distinguish them.
 */
export const SubjectIdentityEvidence = Schema.Union(
  Schema.Struct({ kind: Schema.Literal("link_missing") }),
  Schema.Struct({ kind: Schema.Literal("consent_unavailable") }),
  Schema.Struct({ kind: Schema.Literal("identity_unavailable") }),
  Schema.Struct({ kind: Schema.Literal("authority_unavailable") }),
  Schema.Struct({
    kind: Schema.Literal("linked"),
    wallets: Schema.Array(LinkedWalletEvidence).pipe(
      Schema.filter((items) => items.length > 0 || "linked evidence requires wallets"),
    ),
  }),
).annotations({ identifier: "SubjectIdentityEvidence" });
export type SubjectIdentityEvidence = Schema.Schema.Type<typeof SubjectIdentityEvidence>;

export const SubjectClassificationInput = Schema.Struct({
  schema_version: SchemaVersion,
  discord_user_id: DiscordSnowflake,
  role_id: DiscordSnowflake,
  identity: SubjectIdentityEvidence,
}).annotations({ identifier: "SubjectClassificationInput" });
export type SubjectClassificationInput = Schema.Schema.Type<
  typeof SubjectClassificationInput
>;

export class DuplicateWalletDeploymentError extends Data.TaggedError(
  "DuplicateWalletDeploymentError",
)<{
  readonly wallet_address: string;
  readonly deployment_id: string;
}> {}

export class DuplicateSubjectIdentityError extends Data.TaggedError(
  "DuplicateSubjectIdentityError",
)<{
  readonly discord_user_id: string;
  readonly role_id: string;
}> {}

export const decodeSubjectClassificationInput = Schema.decodeUnknown(
  SubjectClassificationInput,
  strictOptions,
);

const compareStrings = (left: string, right: string): number => {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};

const validateWalletDeploymentUniqueness = (
  subject: SubjectClassificationInput,
): Effect.Effect<SubjectClassificationInput, DuplicateWalletDeploymentError> =>
  Effect.gen(function* () {
    if (subject.identity.kind !== "linked") return subject;
    for (const wallet of subject.identity.wallets) {
      const seen = new Set<string>();
      for (const deployment of wallet.deployments) {
        const deploymentId = deployment.deployment_id.digest;
        if (seen.has(deploymentId)) {
          return yield* Effect.fail(
            new DuplicateWalletDeploymentError({
              wallet_address: wallet.address,
              deployment_id: deploymentId,
            }),
          );
        }
        seen.add(deploymentId);
      }
    }
    return subject;
  });

const validateSubjectIdentityUniqueness = <Subject extends {
  readonly discord_user_id: string;
  readonly role_id: string;
}>(
  subjects: ReadonlyArray<Subject>,
): Effect.Effect<ReadonlyArray<Subject>, DuplicateSubjectIdentityError> =>
  Effect.gen(function* () {
    const seen = new Set<string>();
    for (const subject of subjects) {
      // The cohort is a set of Discord subjects, not subject/role edges. A
      // member holding two mapped roles still contributes exactly one row to
      // the denominator and disclosure bands.
      if (seen.has(subject.discord_user_id)) {
        return yield* Effect.fail(
          new DuplicateSubjectIdentityError({
            discord_user_id: subject.discord_user_id,
            role_id: subject.role_id,
          }),
        );
      }
      seen.add(subject.discord_user_id);
    }
    return subjects;
  });

/**
 * Classification core over an ALREADY-VALIDATED non-empty selection. Kept
 * private so no exported path can quantify over an empty deployment set.
 */
const classifyAgainstValidatedSelection = (
  subject: SubjectClassificationInput,
  selectedDeploymentIds: ReadonlyArray<VersionedDigest>,
): GateLeakRow => {
  const base = {
    schema_version: 1 as const,
    discord_user_id: subject.discord_user_id,
    role_id: subject.role_id,
  };
  const identity = subject.identity;
  if (identity.kind === "link_missing") {
    return {
      ...base,
      eligibility_state: "indeterminate",
      reason_code: "identity_link_missing",
      compared_wallets: [],
    };
  }
  if (identity.kind === "consent_unavailable") {
    return {
      ...base,
      eligibility_state: "indeterminate",
      reason_code: "consent_unavailable",
      compared_wallets: [],
    };
  }
  if (identity.kind === "identity_unavailable") {
    return {
      ...base,
      eligibility_state: "indeterminate",
      reason_code: "identity_unavailable",
      compared_wallets: [],
    };
  }
  if (identity.kind === "authority_unavailable") {
    return {
      ...base,
      eligibility_state: "indeterminate",
      reason_code: "authority_evidence_unavailable",
      compared_wallets: [],
    };
  }

  const selected = selectedDeploymentIds.map((deployment) => deployment.digest);
  const provingWallets: Array<string> = [];
  let everyPairProven = true;
  for (const wallet of identity.wallets) {
    const byDeployment = new Map(
      wallet.deployments.map((entry) => [entry.deployment_id.digest, entry.ownership]),
    );
    let walletProves = false;
    for (const deploymentDigest of selected) {
      const ownership = byDeployment.get(deploymentDigest);
      if (ownership === undefined || ownership.kind === "unavailable") {
        everyPairProven = false;
        continue;
      }
      if (BigInt(ownership.balance) >= 1n) walletProves = true;
    }
    if (walletProves) provingWallets.push(wallet.address);
  }

  if (provingWallets.length > 0) {
    return {
      ...base,
      eligibility_state: "eligible",
      reason_code: "eligible_balance_confirmed",
      compared_wallets: provingWallets.toSorted(compareStrings),
    };
  }
  if (everyPairProven) {
    return {
      ...base,
      eligibility_state: "proven_ineligible",
      reason_code: "proven_zero_balance",
      compared_wallets: identity.wallets
        .map((wallet) => wallet.address)
        .toSorted(compareStrings),
    };
  }
  return {
    ...base,
    eligibility_state: "indeterminate",
    reason_code: "ownership_evidence_unavailable",
    compared_wallets: [],
  };
};

/**
 * Deterministic V1 classification of ONE role-holding subject.
 *
 * - eligible: some wallet holds a proven balance >= 1 on ANY selected
 *   deployment;
 * - proven_ineligible: EVERY (wallet, selected deployment) pair is proven and
 *   every proven balance is zero — the only actionable leak finding;
 * - indeterminate: everything else; never an adverse inference. Missing
 *   coverage of a selected deployment counts as unavailable evidence.
 *
 * The selected deployment set is validated first: an EMPTY selection refuses
 * with `EmptyDeploymentSelectionError` — under an empty set the "every pair
 * proven" quantifier would be vacuously true and an unavailable wallet would
 * become `proven_ineligible` from nothing. That state is unrepresentable.
 *
 * Wallet minimization: eligible rows carry only the proving wallets;
 * proven_ineligible rows carry every compared wallet (each is needed to
 * justify the definitive claim); indeterminate rows carry none.
 */
export const classifyGateLeakSubject = (
  subject: SubjectClassificationInput,
  selectedDeploymentIds: ReadonlyArray<VersionedDigest>,
): Effect.Effect<
  GateLeakRow,
  | EmptyDeploymentSelectionError
  | InvalidDeploymentSetMemberError
  | DuplicateWalletDeploymentError
> =>
  validateSelectedDeploymentSet(selectedDeploymentIds).pipe(
    Effect.flatMap((validated) =>
      validateWalletDeploymentUniqueness(subject).pipe(
        Effect.map((verifiedSubject) =>
          classifyAgainstValidatedSelection(verifiedSubject, validated),
        ),
      ),
    ),
  );

export const classifyGateLeakSubjects = (
  subjects: ReadonlyArray<SubjectClassificationInput>,
  selectedDeploymentIds: ReadonlyArray<VersionedDigest>,
): Effect.Effect<
  ReadonlyArray<GateLeakRow>,
  | EmptyDeploymentSelectionError
  | InvalidDeploymentSetMemberError
  | DuplicateWalletDeploymentError
  | DuplicateSubjectIdentityError
> =>
  validateSelectedDeploymentSet(selectedDeploymentIds).pipe(
    Effect.flatMap((validated) =>
      validateSubjectIdentityUniqueness(subjects).pipe(
        Effect.flatMap((verifiedSubjects) =>
          Effect.forEach(verifiedSubjects, validateWalletDeploymentUniqueness),
        ),
        Effect.map((verifiedSubjects) =>
          verifiedSubjects
            .map((subject) => classifyAgainstValidatedSelection(subject, validated))
            .toSorted(
              (left, right) =>
                compareStrings(left.discord_user_id, right.discord_user_id) ||
                compareStrings(left.role_id, right.role_id),
            ),
        ),
      ),
    ),
  );

/* ------------------------------------------------------------------------ */
/* Disclosure bands and the coverage measure                                 */
/* ------------------------------------------------------------------------ */

export const DisclosureBand = Schema.Literal(
  ...GATE_LEAK_DISCLOSURE_POLICY_V1.bands,
).annotations({ identifier: "DisclosureBand" });
export type DisclosureBand = Schema.Schema.Type<typeof DisclosureBand>;

export const disclosureBand = (count: number): DisclosureBand => {
  if (!Number.isInteger(count) || count < 0) return "0";
  if (count === 0) return "0";
  if (count <= 9) return "1-9";
  if (count <= 24) return "10-24";
  if (count <= 49) return "25-49";
  if (count <= 99) return "50-99";
  return "100+";
};

/**
 * Rounded-DOWN 10-point coverage band, integer arithmetic only (no float
 * rounding can cross the threshold). 799/1000 -> 70; 800/1000 -> 80.
 */
export const coverageBandFloorPercent = (
  definitiveCount: number,
  cohortSize: number,
): number =>
  cohortSize <= 0 ? 0 : Math.floor((definitiveCount * 10) / cohortSize) * 10;

export const meetsCoverageThreshold = (
  definitiveCount: number,
  cohortSize: number,
): boolean =>
  cohortSize > 0 &&
  definitiveCount * 10_000 >=
    GATE_LEAK_COVERAGE_POLICY_V1.minimum_definitive_coverage_basis_points * cohortSize;

const CoverageBandPercent = Schema.Literal(80, 90, 100);

/**
 * Suppression is structural: the insufficient-coverage member has NO
 * actionable field to leak, and the actionable member's coverage band cannot
 * carry a value below the v1 threshold.
 */
export const GateLeakMeasure = Schema.Union(
  Schema.Struct({
    schema_version: SchemaVersion,
    presentation: Schema.Literal("actionable"),
    coverage_policy_version: Schema.Literal(GATE_LEAK_COVERAGE_POLICY_V1.version),
    actionable_leak_band: DisclosureBand,
    coverage_band_floor_percent: CoverageBandPercent,
    cohort_band: DisclosureBand,
    indeterminate_band: DisclosureBand,
    excluded_bot_count: NonNegativeInt,
  }),
  Schema.Struct({
    schema_version: SchemaVersion,
    presentation: Schema.Literal("insufficient_coverage"),
    coverage_policy_version: Schema.Literal(GATE_LEAK_COVERAGE_POLICY_V1.version),
    reason_code: Schema.Literal("insufficient_coverage"),
    cohort_band: DisclosureBand,
    indeterminate_band: DisclosureBand,
    excluded_bot_count: NonNegativeInt,
  }),
).annotations({ identifier: "GateLeakMeasure" });
export type GateLeakMeasure = Schema.Schema.Type<typeof GateLeakMeasure>;

export const decodeGateLeakMeasure = Schema.decodeUnknown(GateLeakMeasure, strictOptions);

/**
 * Definitive coverage is `(eligible + proven_ineligible) / non-bot
 * mapped-role cohort`. The cohort is exactly the classified rows: bots are
 * excluded upstream and reported only as a count. An empty cohort has no
 * definitive coverage and presents as insufficient coverage.
 */
export const computeGateLeakMeasure = (
  rows: ReadonlyArray<GateLeakRow>,
  excludedBotCount: number,
): Effect.Effect<
  GateLeakMeasure,
  ParseResult.ParseError | DuplicateSubjectIdentityError
> =>
  Effect.gen(function* () {
    const verifiedExcludedBotCount = yield* Schema.decodeUnknown(NonNegativeInt)(
      excludedBotCount,
    );
    yield* validateSubjectIdentityUniqueness(rows);
    const cohortSize = rows.length;
    const eligible = rows.filter((row) => row.eligibility_state === "eligible").length;
    const provenIneligible = rows.filter(
      (row) => row.eligibility_state === "proven_ineligible",
    ).length;
    const indeterminate = cohortSize - eligible - provenIneligible;
    const definitive = eligible + provenIneligible;

    if (meetsCoverageThreshold(definitive, cohortSize)) {
      const floorPercent = coverageBandFloorPercent(definitive, cohortSize);
      const coverageBand: 80 | 90 | 100 =
        floorPercent >= 100 ? 100 : floorPercent >= 90 ? 90 : 80;
      return {
        schema_version: 1,
        presentation: "actionable",
        coverage_policy_version: GATE_LEAK_COVERAGE_POLICY_V1.version,
        actionable_leak_band: disclosureBand(provenIneligible),
        coverage_band_floor_percent: coverageBand,
        cohort_band: disclosureBand(cohortSize),
        indeterminate_band: disclosureBand(indeterminate),
        excluded_bot_count: verifiedExcludedBotCount,
      };
    }
    return {
      schema_version: 1,
      presentation: "insufficient_coverage",
      coverage_policy_version: GATE_LEAK_COVERAGE_POLICY_V1.version,
      reason_code: "insufficient_coverage",
      cohort_band: disclosureBand(cohortSize),
      indeterminate_band: disclosureBand(indeterminate),
      excluded_bot_count: verifiedExcludedBotCount,
    };
  });

/* ------------------------------------------------------------------------ */
/* Compute input digest                                                      */
/* ------------------------------------------------------------------------ */

const GateLeakEvidenceDigestField = VersionedDigest.pipe(
  Schema.filter(
    (value) =>
      hasDomain(value, GATE_LEAK_DIGEST_DOMAINS.evidence) ||
      "evidence digests must use the gate-leak.evidence v1 digest domain",
  ),
);

/**
 * The EXACT compute input. It binds, by digest or identifier, every evidence
 * envelope the computation consumed, every governing policy version, AND the
 * full `ComputeAttemptPins` (mapping version, consent policy, tombstone
 * watermark, Gateway and capability-registry positions, authorization
 * watermarks). Because the pins and all restricted evidence refs are INSIDE
 * the digested input, a cached result can never be reused detached from the
 * watermarks and evidence it was computed under.
 */
export const GateLeakComputeInput = Schema.Struct({
  schema_version: SchemaVersion,
  report_type: Schema.Literal("gate_leak"),
  report_version: Schema.Literal("v1"),
  collection_id: VersionedDigest.pipe(
    Schema.filter(
      (value) =>
        hasDomain(value, COLLECTION_DIGEST_DOMAINS.identity) ||
        "collection_id must use the collection.identity v1 digest domain",
    ),
  ),
  deployment_set_digest: VersionedDigest.pipe(
    Schema.filter(
      (value) =>
        hasDomain(value, GATE_LEAK_DIGEST_DOMAINS.deployment_set) ||
        "deployment_set_digest must use the gate-leak.deployment-set v1 digest domain",
    ),
  ),
  collection_identity_evidence_digest: GateLeakEvidenceDigestField,
  ownership_evidence_digest: GateLeakEvidenceDigestField,
  mapping_version_id: VersionedDigest.pipe(
    Schema.filter(
      (value) =>
        hasDomain(value, GATE_LEAK_DIGEST_DOMAINS.mapping_version) ||
        "mapping_version_id must use the gate-leak.mapping-version v1 digest domain",
    ),
  ),
  rule_digest: VersionedDigest.pipe(
    Schema.filter(
      (value) =>
        hasDomain(value, GATE_LEAK_DIGEST_DOMAINS.gate_rule) ||
        "rule_digest must use the gate-leak.gate-rule v1 digest domain",
    ),
  ),
  discord_snapshot_id: NonEmptyString,
  discord_evidence_digest: GateLeakEvidenceDigestField,
  link_snapshot_id: NonEmptyString,
  identity_evidence_digest: GateLeakEvidenceDigestField,
  cohort: SubjectCohortRef,
  pins: ComputeAttemptPins,
  readiness_policy_version: VersionIdentifier,
  coverage_policy_version: Schema.Literal(GATE_LEAK_COVERAGE_POLICY_V1.version),
  disclosure_policy_version: Schema.Literal(GATE_LEAK_DISCLOSURE_POLICY_V1.version),
  consent_policy_version: VersionIdentifier,
  as_of_interval: Schema.Struct({
    start: IsoTimestamp,
    end: IsoTimestamp,
  }),
}).pipe(
  Schema.filter(
    (input) =>
      input.pins.mapping_version_id.digest === input.mapping_version_id.digest ||
      "pins.mapping_version_id must equal the compute input's mapping_version_id",
  ),
  Schema.filter(
    (input) =>
      input.pins.consent_policy_version === input.consent_policy_version ||
      "pins.consent_policy_version must equal the compute input's consent_policy_version",
  ),
).annotations({ identifier: "GateLeakComputeInput" });
export type GateLeakComputeInput = Schema.Schema.Type<typeof GateLeakComputeInput>;

export const decodeGateLeakComputeInput = Schema.decodeUnknown(
  GateLeakComputeInput,
  strictOptions,
);

/**
 * Digest the exact compute input. The value is re-VALIDATED against the
 * strict schema first, so an in-process input with detached pins or foreign
 * digest domains refuses instead of minting a reusable result key.
 */
export const digestGateLeakComputeInput = (
  input: GateLeakComputeInput,
): Effect.Effect<
  VersionedDigest,
  ParseResult.ParseError | CanonicalEncodingError | DigestComputationError
> =>
  Schema.validate(GateLeakComputeInput, strictOptions)(input).pipe(
    Effect.flatMap((validated) =>
      digestVersioned(GATE_LEAK_DIGEST_DOMAINS.compute_input, 1, validated),
    ),
  );

/* ------------------------------------------------------------------------ */
/* Disclosure ledger key (definition here; ledger runtime is Ordering/CR-015) */
/* ------------------------------------------------------------------------ */

/**
 * Disclosure-ledger dimensions. Every logical set is strict-decoded as a
 * sorted unique set (`role_ids` via RoleIdSet), so equivalent permutations
 * cannot mint distinct ledger keys and duplicates refuse — the privacy
 * ledger cannot be fragmented by reordering.
 */
export const GateLeakDisclosureLedgerKey = Schema.Struct({
  schema_version: SchemaVersion,
  community_ref: CommunityRef,
  guild_ref: DiscordSnowflake,
  collection_id: VersionedDigest.pipe(
    Schema.filter(
      (value) =>
        hasDomain(value, COLLECTION_DIGEST_DOMAINS.identity) ||
        "collection_id must use the collection.identity v1 digest domain",
    ),
  ),
  role_ids: RoleIdSet,
  rule_digest: VersionedDigest.pipe(
    Schema.filter(
      (value) =>
        hasDomain(value, GATE_LEAK_DIGEST_DOMAINS.gate_rule) ||
        "rule_digest must use the gate-leak.gate-rule v1 digest domain",
    ),
  ),
  disclosure_policy_version: Schema.Literal(GATE_LEAK_DISCLOSURE_POLICY_V1.version),
  epoch_index: NonNegativeInt,
}).annotations({ identifier: "GateLeakDisclosureLedgerKey" });
export type GateLeakDisclosureLedgerKey = Schema.Schema.Type<
  typeof GateLeakDisclosureLedgerKey
>;

export const decodeGateLeakDisclosureKey = Schema.decodeUnknown(
  GateLeakDisclosureLedgerKey,
  strictOptions,
);

export const digestGateLeakDisclosureKey = (
  key: GateLeakDisclosureLedgerKey,
): Effect.Effect<
  VersionedDigest,
  ParseResult.ParseError | CanonicalEncodingError | DigestComputationError
> =>
  Schema.validate(GateLeakDisclosureLedgerKey, strictOptions)(key).pipe(
    Effect.flatMap((validated) =>
      digestVersioned(GATE_LEAK_DIGEST_DOMAINS.disclosure_key, 1, validated),
    ),
  );

/* ------------------------------------------------------------------------ */
/* Bounded-policy evaluators (regression teeth for the ratified ceilings)    */
/* ------------------------------------------------------------------------ */

export type CohortAdmissionVerdict =
  | { readonly admitted: true }
  | { readonly admitted: false; readonly reason_code: "cohort_too_large" };

/** Oversize cohorts are never truncated; they move the order to remediation. */
export const evaluateCohortAdmission = (
  cardinality: number,
): CohortAdmissionVerdict =>
  cardinality > SUBJECT_COHORT_POLICY_V1.max_human_subjects
    ? { admitted: false, reason_code: "cohort_too_large" }
    : { admitted: true };

export type CaptureCompletenessVerdict =
  | { readonly qualifying: true }
  | {
      readonly qualifying: false;
      readonly reason_code: "capture_contention";
      readonly defects: ReadonlyArray<string>;
    };

/**
 * A role snapshot qualifies only with complete baseline pages, no unresolved
 * Gateway gap, a successful reconciliation within the delta budget, and a
 * capture inside the bounded window/generation policy.
 */
export const evaluateCaptureCompleteness = (
  attestation: DiscordCaptureAttestation,
): CaptureCompletenessVerdict => {
  const defects: Array<string> = [];
  if (!attestation.baseline_pages_complete) defects.push("baseline_pages_incomplete");
  if (attestation.observed_gaps > 0) defects.push("gateway_sequence_gap");
  if (attestation.reconciliation_result !== "reconciled") {
    defects.push("role_reconciliation_failed");
  }
  if (
    attestation.reconciliation_delta_events >
    DISCORD_CAPTURE_POLICY_V1.max_reconciliation_delta_events
  ) {
    defects.push("delta_budget_exceeded");
  }
  const windowSeconds =
    (Date.parse(attestation.capture_window.window_end) -
      Date.parse(attestation.capture_window.window_start)) /
    1000;
  if (windowSeconds > DISCORD_CAPTURE_POLICY_V1.max_capture_window_seconds) {
    defects.push("capture_window_exceeded");
  }
  if (
    attestation.capture_generation > DISCORD_CAPTURE_POLICY_V1.max_capture_generations
  ) {
    defects.push("capture_generations_exhausted");
  }
  return defects.length === 0
    ? { qualifying: true }
    : { qualifying: false, reason_code: "capture_contention", defects };
};
