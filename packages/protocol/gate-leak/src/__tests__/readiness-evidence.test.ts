import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  type VersionedDigest,
  digestVersioned,
  makeCollectionDeploymentRef,
} from "@freeside/collection-protocol";
import {
  DISCORD_CAPTURE_POLICY_V1,
  EVIDENCE_ALIGNMENT_POLICY_V1,
  GATE_LEAK_CHURN_POLICY_V1,
  GATE_LEAK_RECIPE_V1,
  GATE_RULE_V1,
  IsoTimestamp,
  OWNERSHIP_FINALITY_EIP155_FINALIZED_BLOCK_V1,
  OWNERSHIP_FINALITY_POLICY_VERSIONS_V1,
  OWNERSHIP_FINALITY_SOLANA_FINALIZED_COMMITMENT_V1,
  SUBJECT_COHORT_POLICY_V1,
  admitGateRule,
  buildVerifiedDeploymentNetworkMap,
  canonicalAuthorizationWatermarkSet,
  checkEvidenceAlignment,
  computeOwnershipFinalityAttestationDigest,
  decodeCollectionIdentityEvidence,
  decodeComputeAttemptPins,
  decodeDiscordRoleSnapshotEvidence,
  decodeGateLeakComputeInput,
  decodeGateMappingAggregate,
  decodeIdentityLinkSnapshotEvidence,
  decodeOwnershipIndexEvidence,
  decodeRatifyGateMappingCommand,
  digestGateLeakComputeInput,
  evaluateCaptureCompleteness,
  evaluateCohortAdmission,
  evaluateDiscordSnapshotFreshnessAt,
  evaluateGateLeakReadiness,
  evaluateIdentitySnapshotFreshnessAt,
  evaluateOwnershipFinalityProof,
  evaluateOwnershipFreshnessAt,
  evaluateWatermarkRestart,
  qualifiesForReuse,
  ratifyGateMapping,
} from "../index.js";
import type {
  CollectionIdentityEvidence,
  ComputeAttemptPins,
  DiscordCaptureAttestation,
  DiscordRoleSnapshotEvidence,
  GateLeakComputeInput,
  GateLeakReadinessContext,
  GateLeakRecipe,
  GateLeakRecipeRequirement,
  GateMappingAggregate,
  GateMappingVersion,
  IdentityLinkSnapshotEvidence,
  ObservationWindow,
  ObservedMutations,
  OwnershipIndexEvidence,
  OwnershipFinalityAttestationMaterial,
  VerifiedDeploymentNetworkMap,
} from "../index.js";
import { deploymentReferenceSetsEqual } from "../readiness.js";
import {
  expectEffectFailureTag,
  expectEffectSuccess,
  readFixture,
} from "./test-helpers.js";

const window = (start: string, end: string): ObservationWindow => ({
  schema_version: 1,
  window_start: start,
  window_end: end,
});

describe("five-minute evidence alignment", () => {
  const base = window("2026-07-16T00:00:00Z", "2026-07-16T00:10:00Z");

  it("overlapping windows align and report the full as-of interval", () => {
    const verdict = checkEvidenceAlignment({
      ownership: base,
      discord: window("2026-07-16T00:05:00Z", "2026-07-16T00:12:00Z"),
      identity: window("2026-07-16T00:08:00Z", "2026-07-16T00:11:00Z"),
    });
    expect(verdict).toStrictEqual({
      aligned: true,
      as_of_interval: { start: "2026-07-16T00:00:00Z", end: "2026-07-16T00:12:00Z" },
    });
  });

  it("a 300-second nearest-boundary gap aligns; 301 seconds does not", () => {
    expect(EVIDENCE_ALIGNMENT_POLICY_V1.max_window_gap_seconds).toBe(300);
    const at300 = checkEvidenceAlignment({
      ownership: base,
      discord: window("2026-07-16T00:15:00Z", "2026-07-16T00:20:00Z"),
      identity: window("2026-07-16T00:10:00Z", "2026-07-16T00:16:00Z"),
    });
    expect(at300.aligned).toBe(true);

    const at301 = checkEvidenceAlignment({
      ownership: base,
      discord: window("2026-07-16T00:15:01Z", "2026-07-16T00:20:00Z"),
      identity: window("2026-07-16T00:10:00Z", "2026-07-16T00:16:00Z"),
    });
    expect(at301.aligned).toBe(false);
    if (at301.aligned) throw new Error("expected misalignment");
    expect(at301.reason_code).toBe("evidence_window_misaligned");
    expect(at301.violations).toContainEqual({
      left: "ownership",
      right: "discord",
      gap_seconds: 301,
    });
  });

  it("every pair is checked: one distant window names both violated pairs", () => {
    const verdict = checkEvidenceAlignment({
      ownership: base,
      discord: base,
      identity: window("2026-07-16T01:00:00Z", "2026-07-16T01:05:00Z"),
    });
    if (verdict.aligned) throw new Error("expected misalignment");
    expect(verdict.violations).toHaveLength(2);
  });
});

const qualifyingAttestation: DiscordCaptureAttestation = {
  schema_version: 1,
  baseline_method: "guild_members_pagination",
  baseline_pages_complete: true,
  pagination_cursor_count: 12,
  gateway_session_id: "session-0001",
  gateway_epoch: 3,
  gateway_resume_sequence: 4200,
  observed_gaps: 0,
  reconciliation_result: "reconciled",
  reconciliation_delta_events: 250,
  capture_generation: 1,
  capture_window: window("2026-07-16T00:05:00Z", "2026-07-16T00:09:00Z"),
  producer_contract_version: "v1",
};

describe("capture completeness and cohort ceilings", () => {
  it("accepts a complete attestation inside the bounded capture policy", () => {
    expect(evaluateCaptureCompleteness(qualifyingAttestation)).toStrictEqual({
      qualifying: true,
    });
  });

  it("names every defect class and refuses with capture_contention", () => {
    const cases: ReadonlyArray<readonly [Partial<DiscordCaptureAttestation>, string]> = [
      [{ baseline_pages_complete: false }, "baseline_pages_incomplete"],
      [{ observed_gaps: 2 }, "gateway_sequence_gap"],
      [{ reconciliation_result: "failed" }, "role_reconciliation_failed"],
      [
        {
          reconciliation_delta_events:
            DISCORD_CAPTURE_POLICY_V1.max_reconciliation_delta_events + 1,
        },
        "delta_budget_exceeded",
      ],
      [
        { capture_window: window("2026-07-16T00:00:00Z", "2026-07-16T00:05:01Z") },
        "capture_window_exceeded",
      ],
      [
        { capture_generation: DISCORD_CAPTURE_POLICY_V1.max_capture_generations + 1 },
        "capture_generations_exhausted",
      ],
    ];
    for (const [override, defect] of cases) {
      const verdict = evaluateCaptureCompleteness({
        ...qualifyingAttestation,
        ...override,
      });
      if (verdict.qualifying) throw new Error(`expected defect ${defect}`);
      expect(verdict.reason_code).toBe("capture_contention");
      expect(verdict.defects).toContain(defect);
    }
  });

  it("admits 50,000 subjects and refuses 50,001 with cohort_too_large — never truncation", () => {
    expect(
      evaluateCohortAdmission(SUBJECT_COHORT_POLICY_V1.max_human_subjects),
    ).toStrictEqual({ admitted: true });
    expect(
      evaluateCohortAdmission(SUBJECT_COHORT_POLICY_V1.max_human_subjects + 1),
    ).toStrictEqual({ admitted: false, reason_code: "cohort_too_large" });
  });
});

/* -------------------------------------------------------------------- */
/* Full evidence bundle: the readiness evaluator proves every capability */
/* -------------------------------------------------------------------- */

const CommunityShape = Schema.Struct({
  seed_aggregate: Schema.Unknown,
  ratify_command: Schema.Unknown,
});
const decodeCommunityShape = Schema.decodeUnknown(CommunityShape);

const community = expectEffectSuccess(
  decodeCommunityShape(readFixture("community-mibera-recorded.valid.json")),
);
const miberaSeed = expectEffectSuccess(
  decodeGateMappingAggregate(community.seed_aggregate),
);
const miberaCommand = expectEffectSuccess(
  decodeRatifyGateMappingCommand(community.ratify_command),
);
const miberaRatified = expectEffectSuccess(
  ratifyGateMapping(miberaSeed, miberaCommand, {
    schema_version: 1,
    policy_version: GATE_LEAK_CHURN_POLICY_V1.version,
    community_ref: miberaCommand.community_ref,
    version_effective_times: [],
  }),
);
const miberaAggregate: GateMappingAggregate = miberaRatified.aggregate;
const miberaVersion: GateMappingVersion = miberaRatified.version;

// The selected deployment is reconstructed from the SAME canonical inputs the
// recorded configuration used — the mapping's deployment_set_digest binds it.
const miberaDeployment = expectEffectSuccess(
  makeCollectionDeploymentRef({
    schema_version: 1,
    network: {
      schema_version: 1,
      network_namespace: "eip155",
      network_reference: "80094",
    },
    address: "0x1111111111111111111111111111111111111111",
  }),
);
const selectedDeployments = [miberaDeployment];
const selectedDeploymentIds: ReadonlyArray<VersionedDigest> = [
  miberaDeployment.deployment_id,
];
const selectedNetworkMap: VerifiedDeploymentNetworkMap = expectEffectSuccess(
  buildVerifiedDeploymentNetworkMap(selectedDeployments),
);

const evidenceDigest = (label: string): VersionedDigest =>
  expectEffectSuccess(digestVersioned("gate-leak.evidence", 1, { envelope: label }));

const registryVersion = {
  registry_epoch: "0f0e0d0c-0b0a-4908-8706-050403020100",
  registry_sequence: "77",
} as const;

const collectionIdentityEvidence: CollectionIdentityEvidence = expectEffectSuccess(
  decodeCollectionIdentityEvidence({
    schema_version: 1,
    capability: "collection_identity.v1",
    adapter_version: "v1",
    capability_registry: registryVersion,
    collection_id: miberaAggregate.collection_id,
    deployments: selectedDeployments,
    token_standard: "erc721",
    observation_window: window("2026-07-16T00:05:00Z", "2026-07-16T00:09:30Z"),
    evidence_digest: evidenceDigest("collection-identity"),
  }),
);

const ownershipEvidence: OwnershipIndexEvidence = expectEffectSuccess(
  decodeOwnershipIndexEvidence({
    schema_version: 1,
    capability: "ownership_index.v1",
    adapter_version: "v1",
    finality_attestations: [
      (() => {
        const material = {
          schema_version: 1 as const,
          deployment_ref: miberaDeployment,
          policy_version: OWNERSHIP_FINALITY_EIP155_FINALIZED_BLOCK_V1.version,
          network_namespace: "eip155" as const,
          finality_status: "finalized" as const,
          finalized_block_height: "12345678",
          finalized_observed_at: "2026-07-16T00:09:00Z",
          adapter_version: "v1",
        };
        return {
          schema_version: 1 as const,
          deployment_ref: miberaDeployment,
          policy_version: OWNERSHIP_FINALITY_EIP155_FINALIZED_BLOCK_V1.version,
          finality_status: "finalized" as const,
          finalized_block_height: "12345678",
          finalized_observed_at: "2026-07-16T00:09:00Z",
          adapter_version: "v1",
          attestation_digest: expectEffectSuccess(
            computeOwnershipFinalityAttestationDigest(material),
          ),
        };
      })(),
    ],
    coverage: [
      {
        schema_version: 1,
        deployment_id: miberaDeployment.deployment_id,
        source_position: "12345678",
        source_position_kind: "block",
        source_time: "2026-07-16T00:09:00Z",
        completeness: "complete",
      },
    ],
    observation_window: window("2026-07-16T00:05:00Z", "2026-07-16T00:09:30Z"),
    evidence_digest: evidenceDigest("ownership-index"),
  }),
);

const discordEvidence: DiscordRoleSnapshotEvidence = expectEffectSuccess(
  decodeDiscordRoleSnapshotEvidence({
    schema_version: 1,
    capability: "discord_role_snapshot.v1",
    snapshot_id: "role-snapshot-0001",
    community_ref: "mibera",
    guild_ref: "200000000000000001",
    role_ids: ["300000000000000001"],
    mapping_version_id: miberaVersion.mapping_version_id,
    mapping_config_digest: miberaVersion.config_digest,
    member_count: 1000,
    excluded_bot_count: 4,
    attestation: qualifyingAttestation,
    evidence_digest: evidenceDigest("discord-role-snapshot"),
  }),
);

const identityLinkEvidence: IdentityLinkSnapshotEvidence = expectEffectSuccess(
  decodeIdentityLinkSnapshotEvidence({
    schema_version: 1,
    capability: "identity_link_snapshot.v1",
    adapter_version: "v1",
    link_snapshot_id: "link-snapshot-0001",
    community_ref: "mibera",
    guild_ref: "200000000000000001",
    consent: {
      schema_version: 1,
      purpose: "community_gate_audit",
      policy_version: "community-gate-audit.v1",
      grant_source: "identity_api_grant_ledger",
      verified_at: "2026-07-16T00:09:30Z",
    },
    invalidation: {
      schema_version: 1,
      tombstone_stream: "identity-api.tombstone.v1",
      watermark: "1200",
      gap_free: true,
      verified_at: "2026-07-16T00:09:30Z",
    },
    retention: {
      schema_version: 1,
      policy: "shortest_applicable",
      policy_version: "identity-retention.v1",
      retain_until: "2026-08-01T00:00:00Z",
    },
    authorization_watermarks: [
      { schema_version: 1, authority: "membership", epoch: 1, sequence: "10" },
    ],
    mvcc_token_digest: expectEffectSuccess(
      digestVersioned("gate-leak.mvcc-token", 1, { token: "mvcc-0001" }),
    ),
    subject_set_digest: expectEffectSuccess(
      digestVersioned("gate-leak.subject-cohort", 1, { cohort: "mibera-0001" }),
    ),
    cohort_cardinality: 1000,
    page_root_digest: expectEffectSuccess(
      digestVersioned("gate-leak.page-root", 1, { root: "page-root-0001" }),
    ),
    observation_window: window("2026-07-16T00:06:00Z", "2026-07-16T00:09:20Z"),
    evidence_digest: evidenceDigest("identity-link-snapshot"),
  }),
);

const pins: ComputeAttemptPins = expectEffectSuccess(
  decodeComputeAttemptPins({
    schema_version: 1,
    mapping_version_id: miberaVersion.mapping_version_id,
    consent_policy_version: "community-gate-audit.v1",
    identity_tombstone_watermark: "1200",
    gateway_epoch: 3,
    gateway_sequence: "4200",
    capability_registry: registryVersion,
    authorization_watermarks: [
      { schema_version: 1, authority: "membership", epoch: 1, sequence: "10" },
    ],
  }),
);

const computeInput: GateLeakComputeInput = expectEffectSuccess(
  decodeGateLeakComputeInput({
    schema_version: 1,
    report_type: "gate_leak",
    report_version: "v1",
    collection_id: miberaAggregate.collection_id,
    deployment_set_digest: miberaVersion.deployment_set_digest,
    collection_identity_evidence_digest: collectionIdentityEvidence.evidence_digest,
    ownership_evidence_digest: ownershipEvidence.evidence_digest,
    mapping_version_id: miberaVersion.mapping_version_id,
    rule_digest: miberaVersion.rule_digest,
    discord_snapshot_id: discordEvidence.snapshot_id,
    discord_evidence_digest: discordEvidence.evidence_digest,
    link_snapshot_id: identityLinkEvidence.link_snapshot_id,
    identity_evidence_digest: identityLinkEvidence.evidence_digest,
    cohort: {
      schema_version: 1,
      subject_set_digest: identityLinkEvidence.subject_set_digest,
      cardinality: 1000,
      inclusion_rule_version: "cohort-inclusion.v1",
      source_role_snapshot_id: discordEvidence.snapshot_id,
      limit_policy_version: "subject-cohort-limit.v1",
    },
    pins,
    readiness_policy_version: "gate-leak-readiness.v1",
    coverage_policy_version: "gate-leak-coverage.v1",
    disclosure_policy_version: "gate-leak-disclosure.v1",
    consent_policy_version: "community-gate-audit.v1",
    as_of_interval: { start: "2026-07-16T00:05:00Z", end: "2026-07-16T00:09:30Z" },
  }),
);

const readyContext = (): GateLeakReadinessContext => ({
  community_ref: "mibera",
  guild_ref: "200000000000000001",
  selected_deployments: selectedDeployments,
  consent_purpose_policy: {
    schema_version: 1,
    policy: "consent-purpose",
    version: "community-gate-audit.v1",
  },
  mapping_aggregate: miberaAggregate,
  collection_identity: collectionIdentityEvidence,
  ownership: ownershipEvidence,
  discord: discordEvidence,
  identity_links: identityLinkEvidence,
  pins,
  compute_input: computeInput,
  evaluated_at: "2026-07-16T00:09:40Z",
});

const evaluate = (context: GateLeakReadinessContext, recipe?: GateLeakRecipe) =>
  expectEffectSuccess(evaluateGateLeakReadiness(context, recipe));

const refusalReasons = (
  context: GateLeakReadinessContext,
  recipe?: GateLeakRecipe,
): ReadonlyArray<string> => {
  const verdict = evaluate(context, recipe);
  if (verdict.ready) throw new Error("expected a readiness refusal");
  return verdict.reason_codes;
};

const recipeWithOwnershipPartialPolicy = (
  partialPolicy: GateLeakRecipeRequirement["partial_policy"],
): GateLeakRecipe => ({
  ...GATE_LEAK_RECIPE_V1,
  requirements: GATE_LEAK_RECIPE_V1.requirements.map((requirement) =>
    requirement.capability === "ownership_index.v1"
      ? { ...requirement, partial_policy: partialPolicy }
      : requirement,
  ),
});

describe("recipe readiness proves all six capabilities from evidence", () => {
  it("is ready with a pinned mapping version, honest as-of interval, and a SERVER-recomputed compute-input digest", () => {
    const verdict = evaluate(readyContext());
    if (!verdict.ready) throw new Error(`expected ready, got ${JSON.stringify(verdict)}`);
    expect(verdict.mapping_version.mapping_version_id).toStrictEqual(
      miberaVersion.mapping_version_id,
    );
    expect(verdict.as_of_interval).toStrictEqual({
      start: "2026-07-16T00:05:00Z",
      end: "2026-07-16T00:09:30Z",
    });
    expect(verdict.disclosed_coverage_gap).toBeUndefined();
    expect(verdict.compute_input_digest).toStrictEqual(
      expectEffectSuccess(digestGateLeakComputeInput(computeInput)),
    );
    // All six recipe capabilities are pinned to reject and present.
    expect(GATE_LEAK_RECIPE_V1.requirements).toHaveLength(6);
    for (const requirement of GATE_LEAK_RECIPE_V1.requirements) {
      expect(requirement.partial_policy).toBe("reject");
    }
  });

  it("an EMPTY selected deployment set fails outright", () => {
    expect(
      refusalReasons({ ...readyContext(), selected_deployments: [] }),
    ).toStrictEqual(["empty_deployment_selection"]);
  });

  it("compares deployment evidence as a logical set, independent of source order", () => {
    const secondDeployment = expectEffectSuccess(
      makeCollectionDeploymentRef({
        schema_version: 1,
        network: {
          schema_version: 1,
          network_namespace: "eip155",
          network_reference: "1",
        },
        address: "0x2222222222222222222222222222222222222222",
      }),
    );
    expect(
      deploymentReferenceSetsEqual(
        [miberaDeployment, secondDeployment],
        [secondDeployment, miberaDeployment],
      ),
    ).toBe(true);
  });

  it("a missing consent-purpose policy is a named admission gap", () => {
    expect(
      refusalReasons({ ...readyContext(), consent_purpose_policy: undefined }),
    ).toContain("purpose_policy_missing");
  });

  it("binds the Discord resume sequence as well as the gateway epoch", () => {
    expect(
      refusalReasons({
        ...readyContext(),
        discord: {
          ...discordEvidence,
          attestation: {
            ...discordEvidence.attestation,
            gateway_resume_sequence:
              discordEvidence.attestation.gateway_resume_sequence + 1,
          },
        },
      }),
    ).toContain("compute_input_binding_mismatch");
  });

  it("readiness cannot be asserted: an unratified aggregate refuses even when every other envelope is presented", () => {
    expect(
      refusalReasons({ ...readyContext(), mapping_aggregate: miberaSeed }),
    ).toContain("gate_mapping_not_ratified");
  });

  it("an otherwise-valid active mapping with pending identity reveal refuses disclosure", () => {
    const pendingRatified = expectEffectSuccess(
      ratifyGateMapping(
        miberaSeed,
        {
          ...miberaCommand,
          identity_reveal_basis: { schema_version: 1, kind: "pending" },
          idempotency_key: "mibera-ratify-pending-reveal-0001",
        },
        {
          schema_version: 1,
          policy_version: GATE_LEAK_CHURN_POLICY_V1.version,
          community_ref: miberaCommand.community_ref,
          version_effective_times: [],
        },
      ),
    );
    const pendingVersion = pendingRatified.version;
    const pendingDiscord = expectEffectSuccess(
      decodeDiscordRoleSnapshotEvidence({
        ...discordEvidence,
        mapping_version_id: pendingVersion.mapping_version_id,
        mapping_config_digest: pendingVersion.config_digest,
      }),
    );
    const pendingPins = expectEffectSuccess(
      decodeComputeAttemptPins({
        ...pins,
        mapping_version_id: pendingVersion.mapping_version_id,
      }),
    );
    const pendingComputeInput = expectEffectSuccess(
      decodeGateLeakComputeInput({
        ...computeInput,
        mapping_version_id: pendingVersion.mapping_version_id,
        rule_digest: pendingVersion.rule_digest,
        discord_snapshot_id: pendingDiscord.snapshot_id,
        discord_evidence_digest: pendingDiscord.evidence_digest,
        pins: pendingPins,
      }),
    );

    expect(
      refusalReasons({
        ...readyContext(),
        mapping_aggregate: pendingRatified.aggregate,
        discord: pendingDiscord,
        pins: pendingPins,
        compute_input: pendingComputeInput,
      }),
    ).toStrictEqual(["identity_reveal_not_authorized"]);
  });

  it("two-active adversarial probe: a malformed aggregate refuses; readiness never chooses an oldest active mapping", () => {
    const active = miberaAggregate.versions[0];
    if (active === undefined) throw new Error("expected active version");
    const twoActive: GateMappingAggregate = {
      ...miberaAggregate,
      versions: [active, { ...active, idempotency_key: "mibera-duplicate-active" }],
    };
    expect(
      refusalReasons({ ...readyContext(), mapping_aggregate: twoActive }),
    ).toContain("gate_mapping_malformed");
  });

  it("tamper probe: an active version with tampered role_ids but retained digests refuses with mapping_integrity_violation", () => {
    const active = miberaAggregate.versions[0];
    if (active === undefined) throw new Error("expected active version");
    const tampered: GateMappingAggregate = {
      ...miberaAggregate,
      versions: [
        { ...active, role_ids: ["300000000000000001", "300000000000000999"] },
      ],
    };
    expect(
      refusalReasons({ ...readyContext(), mapping_aggregate: tampered }),
    ).toContain("mapping_integrity_violation");
  });

  it("readiness verifies inactive mapping history, not only the active version", () => {
    const active = miberaAggregate.versions[0];
    if (active === undefined) throw new Error("expected active version");
    const tamperedInactive = {
      ...active,
      revoked_at: "2026-07-15T23:59:00Z",
      role_ids: ["300000000000000999"],
    };
    expect(
      refusalReasons({
        ...readyContext(),
        mapping_aggregate: {
          ...miberaAggregate,
          versions: [tamperedInactive, active],
        },
      }),
    ).toStrictEqual(["mapping_integrity_violation"]);
  });

  it("readiness strict-decodes the aggregate envelope and rejects excess fields", () => {
    const malformed = {
      ...miberaAggregate,
      unratified_projection: true,
    } as unknown as GateMappingAggregate;
    expect(
      refusalReasons({ ...readyContext(), mapping_aggregate: malformed }),
    ).toStrictEqual(["gate_mapping_malformed"]);
  });

  it("orders public refusal reasons by the fixed protocol registry", () => {
    const foreignCollection = {
      ...collectionIdentityEvidence.collection_id,
      digest: "9".repeat(64),
    };
    expect(
      refusalReasons({
        ...readyContext(),
        collection_identity: {
          ...collectionIdentityEvidence,
          collection_id: foreignCollection,
        },
        consent_purpose_policy: {
          schema_version: 1,
          policy: "consent-purpose",
          version: "community-gate-audit.v2",
        },
      }),
    ).toStrictEqual(["consent_purpose_mismatch", "evidence_scope_mismatch"]);
  });

  it("a mapping ratified for a DIFFERENT deployment set refuses with evidence_scope_mismatch", () => {
    const otherDeployment = expectEffectSuccess(
      makeCollectionDeploymentRef({
        schema_version: 1,
        network: {
          schema_version: 1,
          network_namespace: "eip155",
          network_reference: "1",
        },
        address: "0x9999999999999999999999999999999999999999",
      }),
    );
    expect(
      refusalReasons({
        ...readyContext(),
        selected_deployments: [otherDeployment],
        collection_identity: {
          ...collectionIdentityEvidence,
          deployments: [otherDeployment],
        },
      }),
    ).toContain("evidence_scope_mismatch");
  });

  it("collection-identity evidence must cover every selected deployment and match the collection", () => {
    const foreign = { ...collectionIdentityEvidence.collection_id, digest: "9".repeat(64) };
    expect(
      refusalReasons({
        ...readyContext(),
        collection_identity: { ...collectionIdentityEvidence, collection_id: foreign },
      }),
    ).toContain("evidence_scope_mismatch");
  });

  it("ownership evidence below the recipe adapter floor refuses with evidence_version_below_floor", () => {
    expect(
      refusalReasons({
        ...readyContext(),
        ownership: { ...ownershipEvidence, adapter_version: "v0" },
      }),
    ).toContain("evidence_version_below_floor");
  });

  it("partial ownership coverage refuses under the V1 reject policy — including partial completeness flags", () => {
    const [entry] = ownershipEvidence.coverage;
    if (entry === undefined) throw new Error("expected coverage entry");
    expect(
      refusalReasons({
        ...readyContext(),
        ownership: {
          ...ownershipEvidence,
          coverage: [{ ...entry, completeness: "partial" }],
        },
      }),
    ).toContain("partial_deployment_coverage");
  });

  it("a recipe that permits partial coverage must disclose the exact gap", () => {
    const [entry] = ownershipEvidence.coverage;
    if (entry === undefined) throw new Error("expected coverage entry");
    const verdict = evaluate(
      {
        ...readyContext(),
        ownership: {
          ...ownershipEvidence,
          coverage: [{ ...entry, completeness: "partial" }],
        },
      },
      recipeWithOwnershipPartialPolicy("disclose"),
    );
    if (!verdict.ready) throw new Error(`expected disclosed-partial readiness: ${JSON.stringify(verdict)}`);
    expect(verdict.disclosed_coverage_gap).toStrictEqual({
      partial_policy: "disclose",
      missing_deployment_ids: [miberaDeployment.deployment_id.digest],
    });
  });

  it("applies reject, disclose, and allow consistently when finality is missing", () => {
    const decodedWithoutFinality = expectEffectSuccess(
      decodeOwnershipIndexEvidence({
        ...ownershipEvidence,
        finality_attestations: [],
      }),
    );
    expect(decodedWithoutFinality.finality_attestations).toStrictEqual([]);

    const policies: ReadonlyArray<GateLeakRecipeRequirement["partial_policy"]> = [
      "reject",
      "disclose",
      "allow",
    ];
    for (const policy of policies) {
      const verdict = evaluate(
        {
          ...readyContext(),
          ownership: decodedWithoutFinality,
        },
        recipeWithOwnershipPartialPolicy(policy),
      );
      if (policy === "reject") {
        if (verdict.ready) throw new Error("reject must fail closed");
        expect(verdict.reason_codes).toContain("partial_deployment_coverage");
        continue;
      }
      if (!verdict.ready) {
        throw new Error(`expected ${policy} readiness: ${JSON.stringify(verdict)}`);
      }
      expect(verdict.disclosed_coverage_gap).toStrictEqual({
        partial_policy: policy,
        missing_deployment_ids: [miberaDeployment.deployment_id.digest],
      });
    }
  });

  it("a Discord snapshot for different roles, guild, or mapping version cannot satisfy this order", () => {
    expect(
      refusalReasons({
        ...readyContext(),
        discord: { ...discordEvidence, role_ids: ["300000000000000999"] },
      }),
    ).toContain("evidence_scope_mismatch");
    expect(
      refusalReasons({
        ...readyContext(),
        discord: { ...discordEvidence, guild_ref: "200000000000000099" },
      }),
    ).toContain("evidence_scope_mismatch");
    expect(
      refusalReasons({
        ...readyContext(),
        discord: {
          ...discordEvidence,
          mapping_config_digest: {
            ...discordEvidence.mapping_config_digest,
            digest: "e".repeat(64),
          },
        },
      }),
    ).toContain("evidence_scope_mismatch");
  });

  it("an incomplete Discord capture refuses with capture_contention", () => {
    expect(
      refusalReasons({
        ...readyContext(),
        discord: {
          ...discordEvidence,
          attestation: { ...qualifyingAttestation, observed_gaps: 1 },
        },
      }),
    ).toContain("capture_contention");
  });

  it("binds a 1,000-subject identity cohort to the pinned Discord non-bot member count", () => {
    expect(
      refusalReasons({
        ...readyContext(),
        discord: { ...discordEvidence, member_count: 10 },
      }),
    ).toContain("compute_input_binding_mismatch");
  });

  it("identity-link evidence scoped to another community or with mismatched consent policy refuses", () => {
    expect(
      refusalReasons({
        ...readyContext(),
        identity_links: { ...identityLinkEvidence, community_ref: "other-community" },
      }),
    ).toContain("evidence_scope_mismatch");
    expect(
      refusalReasons({
        ...readyContext(),
        consent_purpose_policy: {
          schema_version: 1,
          policy: "consent-purpose",
          version: "community-gate-audit.v2",
        },
      }),
    ).toContain("consent_purpose_mismatch");
  });

  it("a tombstone gap or watermark drift on identity-link evidence refuses", () => {
    expect(
      refusalReasons({
        ...readyContext(),
        identity_links: {
          ...identityLinkEvidence,
          invalidation: { ...identityLinkEvidence.invalidation, gap_free: false },
        },
      }),
    ).toContain("identity_invalidation_stale");
    expect(
      refusalReasons({
        ...readyContext(),
        identity_links: {
          ...identityLinkEvidence,
          invalidation: { ...identityLinkEvidence.invalidation, watermark: "1300" },
        },
      }),
    ).toContain("compute_input_binding_mismatch");
  });

  it("restricted evidence past its shortest-retention bound refuses with restricted_evidence_expired", () => {
    expect(
      refusalReasons({
        ...readyContext(),
        identity_links: {
          ...identityLinkEvidence,
          retention: {
            ...identityLinkEvidence.retention,
            retain_until: "2026-07-16T00:09:39Z",
          },
        },
      }),
    ).toContain("restricted_evidence_expired");
  });

  it("an oversize cohort refuses with cohort_too_large and is never truncated", () => {
    const oversize = SUBJECT_COHORT_POLICY_V1.max_human_subjects + 1;
    expect(
      refusalReasons({
        ...readyContext(),
        identity_links: { ...identityLinkEvidence, cohort_cardinality: oversize },
      }),
    ).toContain("cohort_too_large");
  });

  it("misaligned envelope windows refuse with evidence_window_misaligned", () => {
    expect(
      refusalReasons({
        ...readyContext(),
        identity_links: {
          ...identityLinkEvidence,
          observation_window: window("2026-07-16T01:00:00Z", "2026-07-16T01:10:00Z"),
        },
      }),
    ).toContain("evidence_window_misaligned");
  });

  it("the compute input must bind the EXACT evidence envelopes: a foreign evidence digest refuses", () => {
    expect(
      refusalReasons({
        ...readyContext(),
        compute_input: {
          ...computeInput,
          ownership_evidence_digest: evidenceDigest("some-other-envelope"),
        },
      }),
    ).toContain("compute_input_binding_mismatch");
  });

  it("the compute input must bind THIS attempt's pins: drifted pins refuse", () => {
    expect(
      refusalReasons({
        ...readyContext(),
        pins: { ...pins, identity_tombstone_watermark: "1300" },
      }),
    ).toContain("compute_input_binding_mismatch");
  });

  it("the compute input's as-of interval must equal the envelope-derived interval", () => {
    expect(
      refusalReasons({
        ...readyContext(),
        compute_input: {
          ...computeInput,
          as_of_interval: { start: "2026-07-16T00:05:00Z", end: "2026-07-16T00:12:00Z" },
        },
      }),
    ).toContain("compute_input_binding_mismatch");
  });

  it("a registry drift between pins and collection-identity evidence refuses", () => {
    expect(
      refusalReasons({
        ...readyContext(),
        collection_identity: {
          ...collectionIdentityEvidence,
          capability_registry: { ...registryVersion, registry_sequence: "78" },
        },
      }),
    ).toContain("compute_input_binding_mismatch");
  });

  it("accumulates every failed requirement as safe reason codes", () => {
    const reasons = refusalReasons({
      ...readyContext(),
      consent_purpose_policy: undefined,
      mapping_aggregate: miberaSeed,
      discord: {
        ...discordEvidence,
        attestation: { ...qualifyingAttestation, observed_gaps: 1 },
      },
      identity_links: {
        ...identityLinkEvidence,
        cohort_cardinality: SUBJECT_COHORT_POLICY_V1.max_human_subjects + 1,
        observation_window: window("2026-07-16T01:00:00Z", "2026-07-16T01:10:00Z"),
      },
    });
    for (const expected of [
      "purpose_policy_missing",
      "gate_mapping_not_ratified",
      "capture_contention",
      "cohort_too_large",
      "evidence_window_misaligned",
      "compute_input_binding_mismatch",
    ]) {
      expect(reasons).toContain(expected);
    }
  });

  it("compute-input decode refuses detached pins and mismatched pin bindings", () => {
    const withoutPins: Record<string, unknown> = { ...computeInput };
    delete withoutPins["pins"];
    expectEffectFailureTag(decodeGateLeakComputeInput(withoutPins), "ParseError");
    expectEffectFailureTag(
      decodeGateLeakComputeInput({
        ...computeInput,
        pins: { ...pins, consent_policy_version: "community-gate-audit.v2" },
      }),
      "ParseError",
    );
    // Different pins (same schema) produce a DIFFERENT compute-input digest:
    // reuse under changed watermarks is a different result identity.
    const otherPins = { ...pins, identity_tombstone_watermark: "1300" };
    const otherInput = expectEffectSuccess(
      decodeGateLeakComputeInput({ ...computeInput, pins: otherPins }),
    );
    expect(
      expectEffectSuccess(digestGateLeakComputeInput(otherInput)).digest,
    ).not.toBe(expectEffectSuccess(digestGateLeakComputeInput(computeInput)).digest);
  });
});

/* -------------------------------------------------------------------- */
/* Watermark pins and restart conditions                                  */
/* -------------------------------------------------------------------- */

describe("watermark pins and restart conditions", () => {
  const unchanged: ObservedMutations = {
    mapping: { kind: "unchanged" },
    consent_policy_version: "community-gate-audit.v1",
    identity_tombstone: { kind: "contiguous", watermark: "1200" },
    gateway: { kind: "same_epoch", sequence: "4200" },
    capability_registry: registryVersion,
    authorization: { kind: "unchanged" },
  };

  it("proceeds when every pinned watermark is unchanged", () => {
    expect(evaluateWatermarkRestart(pins, unchanged)).toStrictEqual({ kind: "proceed" });
  });

  it("restarts acquisition on each tracked mutation, naming it", () => {
    const cases: ReadonlyArray<readonly [ObservedMutations, string]> = [
      [
        { ...unchanged, mapping: { kind: "new_version_ratified" } },
        "mapping_version",
      ],
      [
        { ...unchanged, consent_policy_version: "community-gate-audit.v2" },
        "consent_policy_version",
      ],
      [
        {
          ...unchanged,
          identity_tombstone: { kind: "contiguous", watermark: "1201" },
        },
        "identity_tombstone_watermark",
      ],
      [
        { ...unchanged, gateway: { kind: "same_epoch", sequence: "4300" } },
        "gateway_watermark",
      ],
      [{ ...unchanged, gateway: { kind: "epoch_changed" } }, "gateway_watermark"],
      [
        {
          ...unchanged,
          capability_registry: { ...registryVersion, registry_sequence: "78" },
        },
        "capability_registry_version",
      ],
      [
        { ...unchanged, authorization: { kind: "watermark_advanced" } },
        "authorization_watermark",
      ],
    ];
    for (const [observed, mutation] of cases) {
      const decision = evaluateWatermarkRestart(pins, observed);
      if (decision.kind !== "restart_acquisition") {
        throw new Error(`expected restart for ${mutation}`);
      }
      expect(decision.reason_code).toBe("watermark_mutation_restart");
      expect(decision.mutations).toContain(mutation);
    }
  });

  it("mapping revocation and authorization revocation need attention, never a silent replacement", () => {
    expect(
      evaluateWatermarkRestart(pins, { ...unchanged, mapping: { kind: "revoked" } }),
    ).toStrictEqual({ kind: "needs_attention", reason_code: "gate_mapping_revoked" });
    expect(
      evaluateWatermarkRestart(pins, {
        ...unchanged,
        authorization: { kind: "revoked" },
      }),
    ).toStrictEqual({ kind: "needs_attention", reason_code: "authorization_revoked" });
  });

  it("a tombstone gap is stale invalidation, not adverse evidence", () => {
    const decision = evaluateWatermarkRestart(pins, {
      ...unchanged,
      identity_tombstone: { kind: "gap" },
    });
    if (decision.kind !== "restart_acquisition") throw new Error("expected restart");
    expect(decision.reason_code).toBe("identity_invalidation_stale");
  });
});

describe("version invalidation of unsafe reuse", () => {
  const candidate = {
    capability: "ownership_index.v1",
    adapter_version: "v1",
    readiness_policy_version: "gate-leak-readiness.v1",
    finality_policy_versions: [
      OWNERSHIP_FINALITY_EIP155_FINALIZED_BLOCK_V1.version,
      OWNERSHIP_FINALITY_SOLANA_FINALIZED_COMMITMENT_V1.version,
    ] as const,
    covered_deployment_ids: ["dep-a", "dep-b"],
    fresh: true,
  };
  const requirement = {
    capability: "ownership_index.v1",
    minimum_adapter_version: "v1",
    readiness_policy_version: "gate-leak-readiness.v1",
    finality_policy_versions: [
      OWNERSHIP_FINALITY_SOLANA_FINALIZED_COMMITMENT_V1.version,
      OWNERSHIP_FINALITY_EIP155_FINALIZED_BLOCK_V1.version,
    ] as const,
    required_deployment_ids: ["dep-a", "dep-b"],
  };

  it("reuses qualifying ready evidence", () => {
    expect(qualifiesForReuse(candidate, requirement)).toStrictEqual({ reuse: true });
  });

  it("refuses reuse on any policy, adapter, finality, coverage, or freshness change — and on an EMPTY required set", () => {
    const cases: ReadonlyArray<{
      readonly candidateOverride?: Partial<typeof candidate>;
      readonly requirementOverride?: {
        readonly readiness_policy_version?: string;
        readonly minimum_adapter_version?: string;
        readonly finality_policy_versions?: ReadonlyArray<
          typeof OWNERSHIP_FINALITY_EIP155_FINALIZED_BLOCK_V1.version
          | typeof OWNERSHIP_FINALITY_SOLANA_FINALIZED_COMMITMENT_V1.version
        >;
        readonly required_deployment_ids?: ReadonlyArray<string>;
        readonly capability?: string;
      };
      readonly refusal: string;
    }> = [
      { requirementOverride: { readiness_policy_version: "gate-leak-readiness.v2" }, refusal: "readiness_policy_changed" },
      { requirementOverride: { minimum_adapter_version: "v2" }, refusal: "adapter_version_changed" },
      {
        requirementOverride: {
          finality_policy_versions: [OWNERSHIP_FINALITY_EIP155_FINALIZED_BLOCK_V1.version],
        },
        refusal: "finality_policy_changed",
      },
      {
        requirementOverride: { required_deployment_ids: ["dep-a", "dep-b", "dep-c"] },
        refusal: "partial_deployment_coverage",
      },
      { requirementOverride: { required_deployment_ids: [] }, refusal: "empty_deployment_selection" },
      { candidateOverride: { fresh: false }, refusal: "stale_evidence" },
      { requirementOverride: { capability: "collection_identity.v1" }, refusal: "capability_mismatch" },
    ];
    for (const { candidateOverride, requirementOverride, refusal } of cases) {
      const verdict = qualifiesForReuse(
        { ...candidate, ...candidateOverride },
        { ...requirement, ...requirementOverride },
      );
      if (verdict.reuse) throw new Error(`expected refusal ${refusal}`);
      expect(verdict.refusals).toContain(refusal);
    }
  });
});

describe("V1 gate-rule admission", () => {
  it("admits exactly the hold-at-least-one rule", () => {
    expect(expectEffectSuccess(admitGateRule(GATE_RULE_V1))).toStrictEqual(GATE_RULE_V1);
  });

  it("refuses every named richer rule with unsupported_gate_rule", () => {
    for (const kind of [
      "quantity_threshold",
      "all_of_deployments",
      "token_id_set",
      "trait_filter",
      "time_held",
      "staking",
      "delegation",
      "composite",
    ]) {
      const failure = expectEffectFailureTag(
        admitGateRule({ schema_version: 1, kind }),
        "UnsupportedGateRuleError",
      );
      expect(failure).toMatchObject({
        reason_code: "unsupported_gate_rule",
        requested_kind: kind,
      });
    }
  });

  it("fails closed on quantity>1 smuggled into the V1 shape and on unknown shapes", () => {
    expectEffectFailureTag(
      admitGateRule({
        schema_version: 1,
        kind: "hold_at_least_one",
        minimum_balance: 2,
        deployment_scope: "any_selected_deployment",
        token_scope: "all_collection_tokens",
      }),
      "ParseError",
    );
    expectEffectFailureTag(
      admitGateRule({ schema_version: 1, kind: "hold_and_stake" }),
      "ParseError",
    );
  });
});

/* -------------------------------------------------------------------- */
/* Finding 2: recipe freshness / finality at evaluated_at                 */
/* Finding 3: identity authorization watermarks equal attempt pins        */
/* -------------------------------------------------------------------- */

describe("recipe freshness at evaluated_at (no caller booleans)", () => {
  it("rejects impossible calendar instants and treats raw invalid times as stale", () => {
    expectEffectFailureTag(
      Schema.decodeUnknown(IsoTimestamp)("2026-02-31T00:00:00Z"),
      "ParseError",
    );
    const invalid = evaluateOwnershipFreshnessAt(
      ownershipEvidence,
      "2026-02-31T00:00:00Z",
      300,
    );
    expect(invalid.fresh).toBe(false);
    if (invalid.fresh) throw new Error("expected invalid timestamp refusal");
    expect(invalid.reason_code).toBe("ownership_evidence_stale");
    expect(invalid.age_seconds).toBe("invalid_timestamp");
  });

  it("ownership: exact max-source-age boundary passes; one second over refuses", () => {
    const maxAge = 300;
    // Earliest ownership timestamp is coverage source_time 00:09:00.
    const ownershipAt = evaluateOwnershipFreshnessAt(
      ownershipEvidence,
      "2026-07-16T00:14:00Z",
      maxAge,
    );
    expect(ownershipAt).toStrictEqual({ fresh: true });
    const ownershipOver = evaluateOwnershipFreshnessAt(
      ownershipEvidence,
      "2026-07-16T00:14:01Z",
      maxAge,
    );
    expect(ownershipOver.fresh).toBe(false);
    if (ownershipOver.fresh) throw new Error("expected stale");
    expect(ownershipOver.reason_code).toBe("ownership_evidence_stale");
    expect(ownershipOver.max_age_seconds).toBe(maxAge);
    expect(ownershipOver.age_seconds).toBe(301);
    expect(ownershipOver.observed_at).toBe("2026-07-16T00:09:00Z");
  });

  it("discord: exact snapshot-age boundary passes; one second over refuses", () => {
    const maxAge = 300;
    // capture_window.end = 00:09:00
    expect(
      evaluateDiscordSnapshotFreshnessAt(discordEvidence, "2026-07-16T00:14:00Z", maxAge),
    ).toStrictEqual({ fresh: true });
    const over = evaluateDiscordSnapshotFreshnessAt(
      discordEvidence,
      "2026-07-16T00:14:01Z",
      maxAge,
    );
    expect(over.fresh).toBe(false);
    if (over.fresh) throw new Error("expected stale");
    expect(over.reason_code).toBe("discord_snapshot_stale");
    expect(over.age_seconds).toBe(301);
  });

  it("identity: exact propagation-objective boundary passes; one second over refuses", () => {
    const maxAge = 60;
    // observation_window.end = 00:09:20
    expect(
      evaluateIdentitySnapshotFreshnessAt(
        identityLinkEvidence,
        "2026-07-16T00:10:20Z",
        maxAge,
      ),
    ).toStrictEqual({ fresh: true });
    const over = evaluateIdentitySnapshotFreshnessAt(
      identityLinkEvidence,
      "2026-07-16T00:10:21Z",
      maxAge,
    );
    expect(over.fresh).toBe(false);
    if (over.fresh) throw new Error("expected stale");
    expect(over.reason_code).toBe("identity_snapshot_stale");
    expect(over.age_seconds).toBe(61);
  });

  it("clock-skew safe: evidence up to 2s in the future is age zero; 3s future refuses", () => {
    // ownership window_end 00:09:30 — evaluated 2s earlier is within skew
    expect(
      evaluateOwnershipFreshnessAt(ownershipEvidence, "2026-07-16T00:09:28Z", 300),
    ).toStrictEqual({ fresh: true });
    const beyond = evaluateOwnershipFreshnessAt(
      ownershipEvidence,
      "2026-07-16T00:09:27Z",
      300,
    );
    expect(beyond.fresh).toBe(false);
    if (beyond.fresh) throw new Error("expected future_beyond_skew refusal");
    expect(beyond.age_seconds).toBe("future_beyond_skew");
  });

  it("mutually aligned but arbitrarily stale evidence cannot become ready", () => {
    const reasons = refusalReasons({
      ...readyContext(),
      evaluated_at: "2026-07-16T02:00:00Z",
    });
    expect(reasons).toContain("ownership_evidence_stale");
    expect(reasons).toContain("discord_snapshot_stale");
    expect(reasons).toContain("identity_snapshot_stale");
  });

  it("mapping and collection_identity do not impose max-source-age at evaluated_at", () => {
    // Keep ownership/discord/identity fresh; only collection window is old —
    // recipe freshness for collection_identity is registry-current, not age.
    const oldCollection: CollectionIdentityEvidence = {
      ...collectionIdentityEvidence,
      observation_window: window("2026-07-01T00:00:00Z", "2026-07-01T00:10:00Z"),
    };
    const verdict = evaluate({
      ...readyContext(),
      collection_identity: oldCollection,
    });
    expect(verdict.ready).toBe(true);
  });

  it("readiness projects typed stale reason codes naming the capability", () => {
    expect(
      refusalReasons({
        ...readyContext(),
        evaluated_at: "2026-07-16T00:15:00Z",
      }),
    ).toEqual(
      expect.arrayContaining([
        "ownership_evidence_stale",
        "discord_snapshot_stale",
        "identity_snapshot_stale",
      ]),
    );
  });
});

describe("identity authorization watermarks must equal attempt pins", () => {
  it("ready path requires exact canonical watermark set equality", () => {
    const verdict = evaluate(readyContext());
    expect(verdict.ready).toBe(true);
  });

  it("missing, extra, changed epoch/sequence, or wrong authority refuse readiness", () => {
    const base = identityLinkEvidence.authorization_watermarks[0];
    if (base === undefined) throw new Error("expected watermark");
    const cases: ReadonlyArray<ReadonlyArray<{
      schema_version: 1;
      authority: string;
      epoch: number;
      sequence: string;
    }>> = [
      [], // missing — also fails non-empty decode if re-decoded; in-process empty
      [{ ...base, sequence: "11" }],
      [{ ...base, epoch: 2 }],
      [{ ...base, authority: "other-authority" }],
      [
        base,
        {
          schema_version: 1,
          authority: "extra",
          epoch: 1,
          sequence: "1",
        },
      ],
    ];
    for (const marks of cases) {
      // In-process bypass of decode (empty set) still fails equality.
      const reasons = refusalReasons({
        ...readyContext(),
        identity_links: {
          ...identityLinkEvidence,
          authorization_watermarks: marks as typeof identityLinkEvidence.authorization_watermarks,
        },
      });
      expect(reasons).toContain("compute_input_binding_mismatch");
    }
  });

  it("the compute-input digest continues to bind the verified equal watermark set", () => {
    const otherMarks = expectEffectSuccess(
      canonicalAuthorizationWatermarkSet([
        { schema_version: 1, authority: "membership", epoch: 1, sequence: "99" },
      ]),
    );
    const otherPins = expectEffectSuccess(
      decodeComputeAttemptPins({
        ...pins,
        authorization_watermarks: otherMarks,
      }),
    );
    const otherInput = expectEffectSuccess(
      decodeGateLeakComputeInput({ ...computeInput, pins: otherPins }),
    );
    expect(
      expectEffectSuccess(digestGateLeakComputeInput(otherInput)).digest,
    ).not.toBe(expectEffectSuccess(digestGateLeakComputeInput(computeInput)).digest);
  });
});

describe("ownership finality closed attestation contract", () => {
  it("ready path proves exact per-deployment finalized source identity", () => {
    expect(
      evaluateOwnershipFinalityProof(
        ownershipEvidence,
        selectedNetworkMap,
        OWNERSHIP_FINALITY_POLICY_VERSIONS_V1,
      ),
    ).toStrictEqual({ proven: true });
    expect(evaluate(readyContext()).ready).toBe(true);
  });

  it("preserves valid sorted multi-deployment coverage and finality", () => {
    const secondDeployment = expectEffectSuccess(
      makeCollectionDeploymentRef({
        schema_version: 1,
        network: {
          schema_version: 1,
          network_namespace: "eip155",
          network_reference: "80094",
        },
        address: "0x2222222222222222222222222222222222222222",
      }),
    );
    const secondMaterial: OwnershipFinalityAttestationMaterial = {
      schema_version: 1,
      deployment_ref: secondDeployment,
      policy_version: OWNERSHIP_FINALITY_EIP155_FINALIZED_BLOCK_V1.version,
      network_namespace: "eip155",
      finality_status: "finalized",
      finalized_block_height: "12345679",
      finalized_observed_at: "2026-07-16T00:09:01Z",
      adapter_version: "v1",
    };
    const [firstAttestation] = ownershipEvidence.finality_attestations;
    const [firstCoverage] = ownershipEvidence.coverage;
    if (firstAttestation === undefined || firstCoverage === undefined) {
      throw new Error("expected baseline finality evidence");
    }
    const secondAttestation = {
      schema_version: 1,
      deployment_ref: secondDeployment,
      policy_version: OWNERSHIP_FINALITY_EIP155_FINALIZED_BLOCK_V1.version,
      finality_status: "finalized",
      finalized_block_height: "12345679",
      finalized_observed_at: "2026-07-16T00:09:01Z",
      adapter_version: "v1",
      attestation_digest: expectEffectSuccess(
        computeOwnershipFinalityAttestationDigest(secondMaterial),
      ),
    };
    const secondCoverage = {
      schema_version: 1,
      deployment_id: secondDeployment.deployment_id,
      source_position: "12345679",
      source_position_kind: "block",
      source_time: "2026-07-16T00:09:01Z",
      completeness: "complete",
    };
    const decoded = expectEffectSuccess(
      decodeOwnershipIndexEvidence({
        ...ownershipEvidence,
        finality_attestations: [firstAttestation, secondAttestation].toSorted(
          (left, right) => {
            const leftDigest = left.deployment_ref.deployment_id.digest;
            const rightDigest = right.deployment_ref.deployment_id.digest;
            return leftDigest < rightDigest ? -1 : leftDigest > rightDigest ? 1 : 0;
          },
        ),
        coverage: [firstCoverage, secondCoverage].toSorted((left, right) => {
          const leftDigest = left.deployment_id.digest;
          const rightDigest = right.deployment_id.digest;
          return leftDigest < rightDigest ? -1 : leftDigest > rightDigest ? 1 : 0;
        }),
      }),
    );
    const networkMap = expectEffectSuccess(
      buildVerifiedDeploymentNetworkMap([miberaDeployment, secondDeployment]),
    );
    expect(
      evaluateOwnershipFinalityProof(
        decoded,
        networkMap,
        OWNERSHIP_FINALITY_POLICY_VERSIONS_V1,
      ),
    ).toStrictEqual({ proven: true });
  });

  it("rejects split-authority duplicate coverage at decode and readiness", () => {
    const [coverage] = ownershipEvidence.coverage;
    if (coverage === undefined) throw new Error("expected coverage entry");
    const duplicateCoverage: OwnershipIndexEvidence["coverage"] = [
      { ...coverage, completeness: "partial" },
      { ...coverage, completeness: "complete", source_position: "99999999" },
    ];

    expectEffectFailureTag(
      decodeOwnershipIndexEvidence({
        ...ownershipEvidence,
        coverage: duplicateCoverage,
      }),
      "ParseError",
    );
    expect(
      evaluateOwnershipFinalityProof(
        { ...ownershipEvidence, coverage: duplicateCoverage },
        selectedNetworkMap,
        OWNERSHIP_FINALITY_POLICY_VERSIONS_V1,
      ),
    ).toMatchObject({
      proven: false,
      detail: "duplicate_coverage",
    });
    expect(
      refusalReasons({
        ...readyContext(),
        ownership: { ...ownershipEvidence, coverage: duplicateCoverage },
      }),
    ).toContain("ownership_finality_unproven");
  });

  it("unknown policy strings cannot decode; wrong-VM policy fails typed readiness", () => {
    expectEffectFailureTag(
      decodeOwnershipIndexEvidence({
        ...ownershipEvidence,
        finality_attestations: [
          {
            ...ownershipEvidence.finality_attestations[0],
            policy_version: "bera-finality.v1",
          },
        ],
      }),
      "ParseError",
    );

    const [attestation] = ownershipEvidence.finality_attestations;
    if (attestation === undefined || !("finalized_block_height" in attestation)) {
      throw new Error("expected eip155 attestation");
    }
    // Cross-VM reviewer probe: keep the EIP-155 deployment_id digest, attach a
    // Solana policy/slot claim, and mint a correct digest over the false claim.
    // Integrity must refuse — self-declared namespace is not authority.
    const wrongVmMaterial = {
      schema_version: 1 as const,
      deployment_ref: attestation.deployment_ref,
      policy_version: OWNERSHIP_FINALITY_SOLANA_FINALIZED_COMMITMENT_V1.version,
      network_namespace: "solana" as const,
      finality_status: "finalized" as const,
      finalized_slot: attestation.finalized_block_height,
      finalized_observed_at: attestation.finalized_observed_at,
      adapter_version: "v1",
    };
    const wrongVm = {
      ...ownershipEvidence,
      finality_attestations: [
        {
          schema_version: 1 as const,
          deployment_ref: attestation.deployment_ref,
          policy_version: OWNERSHIP_FINALITY_SOLANA_FINALIZED_COMMITMENT_V1.version,
          finality_status: "finalized" as const,
          finalized_slot: attestation.finalized_block_height,
          finalized_observed_at: attestation.finalized_observed_at,
          adapter_version: "v1",
          attestation_digest: expectEffectSuccess(
            computeOwnershipFinalityAttestationDigest(wrongVmMaterial),
          ),
        },
      ],
    };
    // Schema filter: solana attestation requires solana CollectionDeploymentRef.
    expectEffectFailureTag(decodeOwnershipIndexEvidence(wrongVm), "ParseError");
    expect(
      refusalReasons({ ...readyContext(), ownership: wrongVm as OwnershipIndexEvidence }),
    ).toContain("ownership_finality_unproven");
  });

  it("EIP-155 deployment with Solana policy/slot attestation (correctly minted digest) fails; inverse fails", () => {
    const solanaDeployment = expectEffectSuccess(
      makeCollectionDeploymentRef({
        schema_version: 1,
        network: {
          schema_version: 1,
          network_namespace: "solana",
          network_reference: "mainnet-beta",
        },
        address: "So11111111111111111111111111111111111111112",
      }),
    );
    const [eip155Attestation] = ownershipEvidence.finality_attestations;
    if (eip155Attestation === undefined || !("finalized_block_height" in eip155Attestation)) {
      throw new Error("expected eip155 attestation");
    }

    // Graft eip155 deployment_id onto a solana-shaped ref — CR-001 integrity fails.
    const graftedRef = {
      ...solanaDeployment,
      deployment_id: miberaDeployment.deployment_id,
    };
    const graftedMaterial = {
      schema_version: 1 as const,
      deployment_ref: graftedRef,
      policy_version: OWNERSHIP_FINALITY_SOLANA_FINALIZED_COMMITMENT_V1.version,
      network_namespace: "solana" as const,
      finality_status: "finalized" as const,
      finalized_slot: "987654321",
      finalized_observed_at: "2026-07-16T00:09:00Z",
      adapter_version: "v1",
    };
    expectEffectFailureTag(
      decodeOwnershipIndexEvidence({
        ...ownershipEvidence,
        finality_attestations: [
          {
            schema_version: 1,
            deployment_ref: graftedRef,
            policy_version: OWNERSHIP_FINALITY_SOLANA_FINALIZED_COMMITMENT_V1.version,
            finality_status: "finalized",
            finalized_slot: "987654321",
            finalized_observed_at: "2026-07-16T00:09:00Z",
            adapter_version: "v1",
            attestation_digest: expectEffectSuccess(
              computeOwnershipFinalityAttestationDigest(graftedMaterial),
            ),
          },
        ],
      }),
      "OwnershipFinalityIntegrityError",
    );

    // Inverse: solana deployment with eip155 block attestation / policy.
    const inverseMaterial = {
      schema_version: 1 as const,
      deployment_ref: solanaDeployment,
      policy_version: OWNERSHIP_FINALITY_EIP155_FINALIZED_BLOCK_V1.version,
      network_namespace: "eip155" as const,
      finality_status: "finalized" as const,
      finalized_block_height: "12345678",
      finalized_observed_at: "2026-07-16T00:09:00Z",
      adapter_version: "v1",
    };
    expectEffectFailureTag(
      decodeOwnershipIndexEvidence({
        ...ownershipEvidence,
        finality_attestations: [
          {
            schema_version: 1,
            deployment_ref: solanaDeployment,
            policy_version: OWNERSHIP_FINALITY_EIP155_FINALIZED_BLOCK_V1.version,
            finality_status: "finalized",
            finalized_block_height: "12345678",
            finalized_observed_at: "2026-07-16T00:09:00Z",
            adapter_version: "v1",
            attestation_digest: expectEffectSuccess(
              computeOwnershipFinalityAttestationDigest(inverseMaterial),
            ),
          },
        ],
      }),
      "ParseError",
    );
  });

  it("rejects detached/grafted full refs, hybrid refs, wrong network reference, and attestation/coverage mismatch", () => {
    const [attestation] = ownershipEvidence.finality_attestations;
    const [coverage] = ownershipEvidence.coverage;
    if (attestation === undefined || coverage === undefined) {
      throw new Error("expected attestation and coverage");
    }

    // Grafted full ref: change address but retain old deployment_id.
    const graftedFullRef = {
      ...miberaDeployment,
      address: "0x2222222222222222222222222222222222222222",
      normalized_address: "0x2222222222222222222222222222222222222222",
    };
    const graftedFullMaterial = {
      schema_version: 1 as const,
      deployment_ref: graftedFullRef,
      policy_version: OWNERSHIP_FINALITY_EIP155_FINALIZED_BLOCK_V1.version,
      network_namespace: "eip155" as const,
      finality_status: "finalized" as const,
      finalized_block_height: "12345678",
      finalized_observed_at: "2026-07-16T00:09:00Z",
      adapter_version: "v1",
    };
    const graftedFullFailure = expectEffectFailureTag(
      decodeOwnershipIndexEvidence({
        ...ownershipEvidence,
        finality_attestations: [
          {
            ...attestation,
            deployment_ref: graftedFullRef,
            attestation_digest: expectEffectSuccess(
              computeOwnershipFinalityAttestationDigest(graftedFullMaterial),
            ),
          },
        ],
      }),
      "OwnershipFinalityIntegrityError",
    );
    expect(graftedFullFailure).toMatchObject({ reason: "grafted_deployment_ref" });
    expect(
      evaluateOwnershipFinalityProof(
        {
          ...ownershipEvidence,
          finality_attestations: [
            {
              ...attestation,
              deployment_ref: graftedFullRef,
              attestation_digest: expectEffectSuccess(
                computeOwnershipFinalityAttestationDigest(graftedFullMaterial),
              ),
            },
          ],
        },
        selectedNetworkMap,
        OWNERSHIP_FINALITY_POLICY_VERSIONS_V1,
      ),
    ).toMatchObject({
      proven: false,
      detail: "grafted_deployment_ref",
    });

    // Wrong network_reference (eip155:1 vs eip155:80094) with grafted digest id.
    const wrongNetworkRef = expectEffectSuccess(
      makeCollectionDeploymentRef({
        schema_version: 1,
        network: {
          schema_version: 1,
          network_namespace: "eip155",
          network_reference: "1",
        },
        address: "0x1111111111111111111111111111111111111111",
      }),
    );
    const wrongNetworkMaterial = {
      schema_version: 1 as const,
      deployment_ref: wrongNetworkRef,
      policy_version: OWNERSHIP_FINALITY_EIP155_FINALIZED_BLOCK_V1.version,
      network_namespace: "eip155" as const,
      finality_status: "finalized" as const,
      finalized_block_height: "12345678",
      finalized_observed_at: "2026-07-16T00:09:00Z",
      adapter_version: "v1",
    };
    const wrongNetworkOwnership = expectEffectSuccess(
      decodeOwnershipIndexEvidence({
        ...ownershipEvidence,
        finality_attestations: [
          {
            schema_version: 1,
            deployment_ref: wrongNetworkRef,
            policy_version: OWNERSHIP_FINALITY_EIP155_FINALIZED_BLOCK_V1.version,
            finality_status: "finalized",
            finalized_block_height: "12345678",
            finalized_observed_at: "2026-07-16T00:09:00Z",
            adapter_version: "v1",
            attestation_digest: expectEffectSuccess(
              computeOwnershipFinalityAttestationDigest(wrongNetworkMaterial),
            ),
          },
        ],
        coverage: [
          {
            ...coverage,
            deployment_id: wrongNetworkRef.deployment_id,
          },
        ],
      }),
    );
    expect(
      evaluateOwnershipFinalityProof(
        wrongNetworkOwnership,
        selectedNetworkMap,
        OWNERSHIP_FINALITY_POLICY_VERSIONS_V1,
      ),
    ).toMatchObject({
      proven: false,
      detail: "deployment_network_unknown",
    });

    // Attestation/coverage deployment mismatch.
    const foreignCoverageDeployment = expectEffectSuccess(
      makeCollectionDeploymentRef({
        schema_version: 1,
        network: {
          schema_version: 1,
          network_namespace: "eip155",
          network_reference: "80094",
        },
        address: "0x3333333333333333333333333333333333333333",
      }),
    );
    expect(
      evaluateOwnershipFinalityProof(
        {
          ...ownershipEvidence,
          coverage: [
            {
              ...coverage,
              deployment_id: foreignCoverageDeployment.deployment_id,
            },
          ],
        },
        selectedNetworkMap,
        OWNERSHIP_FINALITY_POLICY_VERSIONS_V1,
      ),
    ).toMatchObject({
      proven: false,
      detail: "detached_source",
    });

    // Coverage source_position_kind slot on an eip155 selected deployment.
    expect(
      evaluateOwnershipFinalityProof(
        {
          ...ownershipEvidence,
          coverage: [{ ...coverage, source_position_kind: "slot" }],
        },
        selectedNetworkMap,
        OWNERSHIP_FINALITY_POLICY_VERSIONS_V1,
      ),
    ).toMatchObject({
      proven: false,
      detail: "wrong_vm_policy",
    });
  });

  it("missing or duplicate deployment attestations refuse readiness", () => {
    expect(
      evaluateOwnershipFinalityProof(
        { ...ownershipEvidence, finality_attestations: [] },
        selectedNetworkMap,
        OWNERSHIP_FINALITY_POLICY_VERSIONS_V1,
      ),
    ).toMatchObject({
      proven: false,
      detail: "missing_attestation",
    });

    const [attestation] = ownershipEvidence.finality_attestations;
    if (attestation === undefined) throw new Error("expected attestation");
    expect(
      evaluateOwnershipFinalityProof(
        {
          ...ownershipEvidence,
          finality_attestations: [attestation, attestation],
        },
        selectedNetworkMap,
        OWNERSHIP_FINALITY_POLICY_VERSIONS_V1,
      ),
    ).toMatchObject({
      proven: false,
      detail: "duplicate_attestation",
    });
  });

  it("grafted attestation digest, detached adapter, or detached/mismatched source refuse", () => {
    const [attestation] = ownershipEvidence.finality_attestations;
    const [coverage] = ownershipEvidence.coverage;
    if (attestation === undefined || coverage === undefined) {
      throw new Error("expected attestation and coverage");
    }

    const forgedDigestOwnership: OwnershipIndexEvidence = {
      ...ownershipEvidence,
      finality_attestations: [
        {
          ...attestation,
          attestation_digest: {
            ...attestation.attestation_digest,
            digest: "c".repeat(64),
          },
        },
      ],
    };
    expectEffectFailureTag(
      decodeOwnershipIndexEvidence(forgedDigestOwnership),
      "OwnershipFinalityIntegrityError",
    );
    expect(
      evaluateOwnershipFinalityProof(
        forgedDigestOwnership,
        selectedNetworkMap,
        OWNERSHIP_FINALITY_POLICY_VERSIONS_V1,
      ),
    ).toMatchObject({
      proven: false,
      detail: "grafted_digest",
    });
    expect(
      refusalReasons({
        ...readyContext(),
        ownership: forgedDigestOwnership,
      }),
    ).toContain("ownership_finality_unproven");

    expect(
      refusalReasons({
        ...readyContext(),
        ownership: {
          ...ownershipEvidence,
          finality_attestations: [{ ...attestation, adapter_version: "v9" }],
        },
      }),
    ).toContain("ownership_finality_unproven");

    expect(
      evaluateOwnershipFinalityProof(
        {
          ...ownershipEvidence,
          coverage: [{ ...coverage, source_position: "99999999" }],
        },
        selectedNetworkMap,
        OWNERSHIP_FINALITY_POLICY_VERSIONS_V1,
      ),
    ).toMatchObject({
      proven: false,
      detail: "coverage_source_mismatch",
    });

    expect(
      evaluateOwnershipFinalityProof(
        {
          ...ownershipEvidence,
          coverage: [{ ...coverage, source_time: "2026-07-16T00:08:00Z" }],
        },
        selectedNetworkMap,
        OWNERSHIP_FINALITY_POLICY_VERSIONS_V1,
      ),
    ).toMatchObject({
      proven: false,
      detail: "detached_source",
    });
  });

  it("finality observation age and future-beyond-skew refuse at evaluated_at", () => {
    expect(
      evaluateOwnershipFreshnessAt(ownershipEvidence, "2026-07-16T00:20:00Z", 300).fresh,
    ).toBe(false);
    expect(
      evaluateOwnershipFreshnessAt(ownershipEvidence, "2026-07-16T00:08:50Z", 300).fresh,
    ).toBe(false);
    expect(
      evaluateOwnershipFreshnessAt(ownershipEvidence, "2026-07-16T00:14:00Z", 300).fresh,
    ).toBe(true);
  });
});
