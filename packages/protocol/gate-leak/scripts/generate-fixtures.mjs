/**
 * Deterministic fixture generator for @freeside/gate-leak-protocol.
 *
 * Every digest in the committed fixtures is computed through the canonical
 * CR-001 encoder — never hand-typed. Golden EXPECTATIONS (eligibility states,
 * reasons, measure presentation) are hand-stated from the sprint acceptance
 * text and asserted here: if the implementation disagrees with the ratified
 * semantics, generation fails instead of snapshotting the bug.
 *
 * Regenerate: pnpm build && node scripts/generate-fixtures.mjs
 *
 * Addresses, guild IDs, and subject IDs are recorded-SHAPE stand-ins for the
 * three representative community configurations; they are deliberately
 * synthetic, must never be treated as production identifiers, and do NOT
 * satisfy the external three-live-community G1 evidence gate.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import {
  digestVersioned,
  makeCollectionDeploymentRef,
  makeCollectionIdentity,
} from "@freeside/collection-protocol";
import {
  GATE_RULE_V1,
  classifyGateLeakSubjects,
  computeGateLeakMeasure,
  computeGateMappingConfigDigest,
  digestDeploymentSet,
  digestGateLeakWorkKey,
  migrateLegacyGateLeakRecord,
  ratifyGateMapping,
  revokeGateMappingVersion,
} from "../dist/index.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixturesRoot = join(packageRoot, "fixtures");
mkdirSync(join(fixturesRoot, "malformed"), { recursive: true });

const run = (effect) => Effect.runSync(effect);
const write = (name, value) => {
  writeFileSync(join(fixturesRoot, name), `${JSON.stringify(value, null, 2)}\n`);
  console.log(`wrote fixtures/${name}`);
};
const assert = (condition, message) => {
  if (!condition) throw new Error(`golden expectation failed: ${message}`);
};

const G1_DISCLAIMER =
  "Recorded-SHAPE stand-in with synthetic identifiers. Does NOT satisfy the external three-live-community G1 evidence gate; live operator-supplied exports remain the open external evidence.";

/* ---------------------------------------------------------------- */
/* Shared identities (recorded-shape stand-ins)                      */
/* ---------------------------------------------------------------- */

const deployment = (namespace, reference, address) =>
  run(
    makeCollectionDeploymentRef({
      schema_version: 1,
      network: {
        schema_version: 1,
        network_namespace: namespace,
        network_reference: reference,
      },
      address,
    }),
  );

const miberaDeployment = deployment(
  "eip155",
  "80094",
  "0x1111111111111111111111111111111111111111",
);
const acmeMainnet = deployment(
  "eip155",
  "1",
  "0x2222222222222222222222222222222222222222",
);
const acmeBase = deployment(
  "eip155",
  "8453",
  "0x2222222222222222222222222222222222222222",
);
const solDeployment = deployment(
  "solana",
  "mainnet-beta",
  "So11111111111111111111111111111111111111112",
);

const miberaIdentity = run(
  makeCollectionIdentity({
    schema_version: 1,
    name: "Mibera (recorded stand-in)",
    deployments: [miberaDeployment],
    equivalence_basis: { schema_version: 1, kind: "single_deployment" },
  }),
);

const acmeAssertion = run(
  digestVersioned("collection.evidence", 1, {
    registry: "inventory",
    assertion: "acme-club cross-chain equivalence (recorded stand-in)",
  }),
);
const sortedAcmeDeployments = [acmeMainnet, acmeBase].toSorted((left, right) =>
  left.deployment_id.digest < right.deployment_id.digest ? -1 : 1,
);
const acmeIdentity = run(
  makeCollectionIdentity({
    schema_version: 1,
    name: "Acme Club (recorded stand-in)",
    deployments: sortedAcmeDeployments,
    equivalence_basis: {
      schema_version: 1,
      kind: "registry",
      assertion_digest: acmeAssertion,
    },
  }),
);

const solIdentity = run(
  makeCollectionIdentity({
    schema_version: 1,
    name: "Sol Guild (recorded stand-in)",
    deployments: [solDeployment],
    equivalence_basis: { schema_version: 1, kind: "single_deployment" },
  }),
);

const sortedDeploymentIds = (identity) =>
  identity.deployments.map((entry) => entry.deployment_id);

const miberaSet = run(digestDeploymentSet(sortedDeploymentIds(miberaIdentity)));
const acmeSet = run(digestDeploymentSet(sortedDeploymentIds(acmeIdentity)));
const solSet = run(digestDeploymentSet(sortedDeploymentIds(solIdentity)));

// Finding 6 regression at generation time: permutation-invariant set digests.
const acmeSetPermuted = run(
  digestDeploymentSet(sortedDeploymentIds(acmeIdentity).toReversed()),
);
assert(
  acmeSetPermuted.digest === acmeSet.digest,
  "deployment-set digest is permutation-invariant",
);

const T0 = "2026-07-16T00:00:00Z";
const T1 = "2026-07-16T01:00:00Z";
const T2 = "2026-07-16T02:00:00Z";

const emptyAggregate = (community_ref, guild_ref, collection_id) => ({
  schema_version: 1,
  community_ref,
  guild_ref,
  collection_id,
  aggregate_version: 0,
  versions: [],
  audit: [],
});

/* ---------------------------------------------------------------- */
/* Community A — Mibera (migration + parity, integration evidence)   */
/* ---------------------------------------------------------------- */

const miberaSeed = emptyAggregate("mibera", "200000000000000001", miberaIdentity.collection_id);
const miberaConfigMaterial = {
  community_ref: "mibera",
  guild_ref: "200000000000000001",
  collection_id: miberaIdentity.collection_id,
  deployment_set_digest: miberaSet,
  role_ids: ["300000000000000001"],
  eligibility_rule: GATE_RULE_V1,
};
const miberaConfigDigest = run(computeGateMappingConfigDigest(miberaConfigMaterial));
const miberaRatify = {
  schema_version: 1,
  ...miberaConfigMaterial,
  provenance: "operator_confirmed",
  identity_reveal_basis: {
    schema_version: 1,
    kind: "integration_evidence",
    evidence_digest: run(
      digestVersioned("gate-leak.integration-evidence", 1, {
        integration: "existing-gate-integration-config",
        bound_config_digest: miberaConfigDigest,
        note: "matching-digest evidence from the active gate integration (recorded stand-in)",
      }),
    ),
    bound_config_digest: miberaConfigDigest,
    authority: "shadow-audit.gate-integration (recorded stand-in)",
    observed_at: T0,
  },
  ratifier_subject: "op:alice",
  ratifier_permissions: ["gate-config:ratify"],
  expected_aggregate_version: 0,
  effective_at: T0,
  idempotency_key: "mibera-ratify-0001",
};
const miberaRatified = run(
  ratifyGateMapping(miberaSeed, miberaRatify, {
    schema_version: 1,
    policy_version: "gate-leak-churn.v1",
    community_ref: miberaRatify.community_ref,
    version_effective_times: [],
  }),
);

const legacyRecords = [
  {
    record: { schema_version: 1, band: "ok", evidence: "definitive" },
    expected: { in_scope: true, eligibility_state: "eligible", replaces_legacy_leak_treatment: false },
  },
  {
    record: { schema_version: 1, band: "stale", evidence: "definitive" },
    expected: {
      in_scope: true,
      eligibility_state: "proven_ineligible",
      replaces_legacy_leak_treatment: false,
    },
  },
  {
    record: { schema_version: 1, band: "stale", evidence: "identity_link_missing" },
    expected: {
      in_scope: true,
      eligibility_state: "indeterminate",
      replaces_legacy_leak_treatment: true,
    },
  },
  {
    record: { schema_version: 1, band: "stale", evidence: "consent_unavailable" },
    expected: {
      in_scope: true,
      eligibility_state: "indeterminate",
      replaces_legacy_leak_treatment: true,
    },
  },
  {
    record: { schema_version: 1, band: "ok", evidence: "ownership_evidence_unavailable" },
    expected: {
      in_scope: true,
      eligibility_state: "indeterminate",
      replaces_legacy_leak_treatment: false,
    },
  },
  {
    record: { schema_version: 1, band: "missing", evidence: "definitive" },
    expected: { in_scope: false, disposition: "out_of_scope_direction" },
  },
];
for (const { record, expected } of legacyRecords) {
  const migrated = migrateLegacyGateLeakRecord(record);
  if (expected.in_scope) {
    assert(
      migrated.in_scope === true &&
        migrated.eligibility_state === expected.eligibility_state &&
        migrated.replaces_legacy_leak_treatment === expected.replaces_legacy_leak_treatment,
      `legacy ${record.band}/${record.evidence}`,
    );
  } else {
    assert(
      migrated.in_scope === false && migrated.disposition === expected.disposition,
      `legacy ${record.band}/${record.evidence}`,
    );
  }
}

write("community-mibera-recorded.valid.json", {
  description:
    `Representative recorded configuration A (Mibera-shaped, single EVM deployment on eip155:80094). Authoritative mapping source is the Shadow Audit gate-map aggregate; reveal basis is matching-digest integration evidence bound to the exact mapping config digest. ${G1_DISCLAIMER}`,
  authoritative_mapping_source: "shadow-audit.gate-mapping-aggregate",
  seed_aggregate: miberaSeed,
  ratify_command: miberaRatify,
  expected_mapping_version_id: miberaRatified.version.mapping_version_id,
  expected_aggregate_version: miberaRatified.aggregate.aggregate_version,
  ratified_version: miberaRatified.version,
  legacy_parity: legacyRecords,
});

/* ---------------------------------------------------------------- */
/* Community B — Acme (multichain, second approver, revoke/relink)   */
/* ---------------------------------------------------------------- */

const acmeSeed = emptyAggregate("acme-club", "200000000000000002", acmeIdentity.collection_id);
const acmeRatify = {
  schema_version: 1,
  community_ref: "acme-club",
  guild_ref: "200000000000000002",
  collection_id: acmeIdentity.collection_id,
  deployment_set_digest: acmeSet,
  role_ids: ["300000000000000002", "300000000000000003"],
  eligibility_rule: GATE_RULE_V1,
  provenance: "operator_confirmed",
  identity_reveal_basis: {
    schema_version: 1,
    kind: "second_approver",
    approver_subject: "op:dana",
    approver_permission: "privacy:approve-gate-audit",
    approved_at: T0,
  },
  ratifier_subject: "op:bob",
  ratifier_permissions: ["gate-config:ratify"],
  expected_aggregate_version: 0,
  effective_at: T0,
  idempotency_key: "acme-ratify-0001",
};
const acmeRatified = run(ratifyGateMapping(acmeSeed, acmeRatify));
const acmeRevoke = {
  schema_version: 1,
  mapping_version_id: acmeRatified.version.mapping_version_id,
  revoker_subject: "op:bob",
  revoker_permissions: ["gate-config:ratify"],
  expected_aggregate_version: 1,
  revoked_at: T1,
  reason: "role deleted in guild (recorded stand-in)",
};
const acmeRevoked = run(revokeGateMappingVersion(acmeRatified.aggregate, acmeRevoke));
assert(
  acmeRevoked.pending_order_directive === "needs_attention:gate_mapping_revoked",
  "revocation directs pending orders to needs_attention:gate_mapping_revoked",
);
const acmeRelink = {
  ...acmeRatify,
  expected_aggregate_version: acmeRevoked.aggregate.aggregate_version,
  effective_at: T2,
  idempotency_key: "acme-relink-0001",
};
const acmeRelinked = run(ratifyGateMapping(acmeRevoked.aggregate, acmeRelink));
assert(
  acmeRelinked.version.config_digest.digest === acmeRatified.version.config_digest.digest,
  "relink of the identical configuration reproduces the same config digest",
);
assert(
  acmeRelinked.version.mapping_version_id.digest !==
    acmeRatified.version.mapping_version_id.digest,
  "relink mints a NEW immutable mapping version id",
);

write("community-acme-recorded.valid.json", {
  description:
    `Representative recorded configuration B (two-deployment EVM logical collection, registry equivalence, second-approver reveal basis). Proves ratify, optimistic-concurrency conflict, single-active refusal, and revoke-then-explicit-relink behavior. ${G1_DISCLAIMER}`,
  authoritative_mapping_source: "shadow-audit.gate-mapping-aggregate",
  seed_aggregate: acmeSeed,
  ratify_command: acmeRatify,
  expected_mapping_version_id: acmeRatified.version.mapping_version_id,
  conflict_command: {
    ...acmeRatify,
    idempotency_key: "acme-ratify-0002",
    expected_aggregate_version: 5,
  },
  revoke_command: acmeRevoke,
  expected_after_revoke: {
    aggregate_version: acmeRevoked.aggregate.aggregate_version,
    pending_order_directive: acmeRevoked.pending_order_directive,
  },
  relink_command: acmeRelink,
  expected_relinked_mapping_version_id: acmeRelinked.version.mapping_version_id,
});

/* ---------------------------------------------------------------- */
/* Community C — Sol Guild (refusals: rule, authorization)           */
/* ---------------------------------------------------------------- */

const solSeed = emptyAggregate("sol-guild", "200000000000000003", solIdentity.collection_id);
write("community-sol-recorded.valid.json", {
  description:
    `Representative recorded configuration C (Solana mainnet collection). Proves migration REFUSAL: the legacy trait-gated configuration cannot map onto V1 and is refused with unsupported_gate_rule, never approximated; and an unauthorized caller cannot ratify. ${G1_DISCLAIMER}`,
  authoritative_mapping_source: "shadow-audit.gate-mapping-aggregate",
  seed_aggregate: solSeed,
  unsupported_legacy_rules: [
    { schema_version: 1, kind: "trait_filter" },
    { schema_version: 1, kind: "quantity_threshold" },
    { schema_version: 1, kind: "composite" },
  ],
  unauthorized_ratify_command: {
    schema_version: 1,
    community_ref: "sol-guild",
    guild_ref: "200000000000000003",
    collection_id: solIdentity.collection_id,
    deployment_set_digest: solSet,
    role_ids: ["300000000000000004"],
    eligibility_rule: GATE_RULE_V1,
    provenance: "operator_confirmed",
    identity_reveal_basis: { schema_version: 1, kind: "pending" },
    ratifier_subject: "op:mallory",
    ratifier_permissions: [],
    expected_aggregate_version: 0,
    effective_at: T0,
    idempotency_key: "sol-ratify-0001",
  },
});

/* ---------------------------------------------------------------- */
/* Golden classification fixture                                     */
/* ---------------------------------------------------------------- */

const [depA, depB] = sortedDeploymentIds(acmeIdentity);
const wallet = (suffix) => `0x00000000000000000000000000000000000000${suffix}`;

const proven = (deploymentId, balance) => ({
  schema_version: 1,
  deployment_id: deploymentId,
  ownership: { kind: "proven", balance },
});
const unavailable = (deploymentId) => ({
  schema_version: 1,
  deployment_id: deploymentId,
  ownership: { kind: "unavailable" },
});

const subjects = [
  {
    schema_version: 1,
    discord_user_id: "400000000000000007",
    role_id: "300000000000000002",
    identity: {
      kind: "linked",
      wallets: [
        {
          schema_version: 1,
          address: wallet("a7"),
          deployments: [proven(depA, "0"), unavailable(depB)],
        },
      ],
    },
  },
  {
    schema_version: 1,
    discord_user_id: "400000000000000001",
    role_id: "300000000000000002",
    identity: {
      kind: "linked",
      wallets: [
        {
          schema_version: 1,
          address: wallet("a1"),
          deployments: [proven(depA, "0"), proven(depB, "0")],
        },
        {
          schema_version: 1,
          address: wallet("b1"),
          deployments: [proven(depA, "0"), proven(depB, "0")],
        },
      ],
    },
  },
  {
    schema_version: 1,
    discord_user_id: "400000000000000004",
    role_id: "300000000000000002",
    identity: {
      kind: "linked",
      wallets: [
        {
          schema_version: 1,
          address: wallet("a4"),
          deployments: [proven(depA, "0"), proven(depB, "2")],
        },
      ],
    },
  },
  {
    schema_version: 1,
    discord_user_id: "400000000000000002",
    role_id: "300000000000000002",
    identity: { kind: "consent_unavailable" },
  },
  {
    schema_version: 1,
    discord_user_id: "400000000000000005",
    role_id: "300000000000000002",
    identity: { kind: "link_missing" },
  },
  {
    schema_version: 1,
    discord_user_id: "400000000000000006",
    role_id: "300000000000000002",
    identity: { kind: "identity_unavailable" },
  },
];

const selected = [depA, depB];
const rows = run(classifyGateLeakSubjects(subjects, selected));
const byId = new Map(rows.map((row) => [row.discord_user_id, row]));

// Sprint golden case 1: role holder proven to no longer own -> the ONLY V1 leak.
assert(
  byId.get("400000000000000001").eligibility_state === "proven_ineligible" &&
    byId.get("400000000000000001").reason_code === "proven_zero_balance" &&
    byId.get("400000000000000001").compared_wallets.length === 2,
  "proven non-owner is proven_ineligible with every compared wallet",
);
// Sprint golden case 2: role holder with unavailable consent -> indeterminate, no wallet.
assert(
  byId.get("400000000000000002").eligibility_state === "indeterminate" &&
    byId.get("400000000000000002").reason_code === "consent_unavailable" &&
    byId.get("400000000000000002").compared_wallets.length === 0,
  "consent-unavailable member is indeterminate and never exposes a wallet",
);
assert(
  byId.get("400000000000000004").eligibility_state === "eligible" &&
    byId.get("400000000000000004").compared_wallets.length === 1,
  "holder on ANY selected deployment is eligible with minimized wallets",
);
assert(
  byId.get("400000000000000005").reason_code === "identity_link_missing" &&
    byId.get("400000000000000006").reason_code === "identity_unavailable" &&
    byId.get("400000000000000007").reason_code === "ownership_evidence_unavailable",
  "coverage gaps are explicit indeterminate reasons",
);

const measure = run(computeGateLeakMeasure(rows, 1));
// 2 definitive of 6 (33%) -> below the 80% threshold: actionable band suppressed.
assert(
  measure.presentation === "insufficient_coverage" &&
    measure.reason_code === "insufficient_coverage" &&
    !("actionable_leak_band" in measure),
  "below-threshold measure suppresses the actionable band structurally",
);

write("golden-classification.valid.json", {
  description:
    `Sprint CR-002 golden fixtures. Case 1: a role holder proven to no longer own (the only V1 leak). Case 2: a role holder with unavailable consent (indeterminate, never adverse). Case 3: an eligible holder WITHOUT the role — out of scope: absent from subjects, rows, and every denominator. ${G1_DISCLAIMER}`,
  selected_deployment_ids: selected,
  subjects,
  excluded_bot_count: 1,
  out_of_scope_holders: [
    {
      wallet: wallet("e3"),
      holds: [{ deployment_id: depA, balance: "5" }],
      note: "Sprint golden case 3: eligible holder without the mapped role. Must never appear in rows, bands, or coverage denominators.",
    },
  ],
  expected_rows: rows,
  expected_measure: measure,
});

/* ---------------------------------------------------------------- */
/* Actionable-coverage fixture (>=80%)                                */
/* ---------------------------------------------------------------- */

const actionableSubjects = [];
for (let index = 0; index < 10; index += 1) {
  const id = `4100000000000000${String(10 + index)}`;
  if (index < 6) {
    actionableSubjects.push({
      schema_version: 1,
      discord_user_id: id,
      role_id: "300000000000000001",
      identity: {
        kind: "linked",
        wallets: [
          {
            schema_version: 1,
            address: wallet(`c${index}`),
            deployments: [proven(miberaDeployment.deployment_id, "1")],
          },
        ],
      },
    });
  } else if (index < 9) {
    actionableSubjects.push({
      schema_version: 1,
      discord_user_id: id,
      role_id: "300000000000000001",
      identity: {
        kind: "linked",
        wallets: [
          {
            schema_version: 1,
            address: wallet(`d${index}`),
            deployments: [proven(miberaDeployment.deployment_id, "0")],
          },
        ],
      },
    });
  } else {
    actionableSubjects.push({
      schema_version: 1,
      discord_user_id: id,
      role_id: "300000000000000001",
      identity: { kind: "link_missing" },
    });
  }
}
const actionableRows = run(
  classifyGateLeakSubjects(actionableSubjects, [miberaDeployment.deployment_id]),
);
const actionableMeasure = run(computeGateLeakMeasure(actionableRows, 0));
// 9 definitive of 10 (90%): actionable, floor band 90, leak band 1-9.
assert(
  actionableMeasure.presentation === "actionable" &&
    actionableMeasure.coverage_band_floor_percent === 90 &&
    actionableMeasure.actionable_leak_band === "1-9" &&
    actionableMeasure.cohort_band === "10-24" &&
    actionableMeasure.indeterminate_band === "1-9",
  "90% coverage presents the actionable band with a rounded-down 10-point band",
);

write("golden-measure-actionable.valid.json", {
  description:
    `At 90% definitive coverage the actionable leak band appears with the rounded-down 10-point coverage band plus cohort/indeterminate disclosure bands. ${G1_DISCLAIMER}`,
  subjects: actionableSubjects,
  selected_deployment_ids: [miberaDeployment.deployment_id],
  excluded_bot_count: 0,
  expected_rows: actionableRows,
  expected_measure: actionableMeasure,
});

/* ---------------------------------------------------------------- */
/* Work-key digest vectors                                            */
/* ---------------------------------------------------------------- */

const ownershipKey = (overrides = {}) => ({
  schema_version: 1,
  capability: "ownership_index.v1",
  scope_class: "global_deployment_set",
  privacy_class: "public_chain",
  source_identity: "sonar-ownership-adapter",
  readiness_policy_version: "gate-leak-readiness.v1",
  adapter_version: "v1",
  collection: {
    schema_version: 1,
    capability: "ownership_index",
    capability_version: "v1",
    collection_id: acmeIdentity.collection_id,
    deployment_ids: sortedDeploymentIds(acmeIdentity),
    finality_policies: [
      {
        schema_version: 1,
        network: {
          schema_version: 1,
          network_namespace: "eip155",
          network_reference: "1",
        },
        finality_policy_version: "ownership-finality.eip155-finalized-block.v1",
      },
      {
        schema_version: 1,
        network: {
          schema_version: 1,
          network_namespace: "eip155",
          network_reference: "8453",
        },
        finality_policy_version: "ownership-finality.eip155-finalized-block.v1",
      },
    ],
  },
  evidence_boundary: { kind: "continuous_latest" },
  ...overrides,
});

const mappingKey = (community_ref, guild_ref, mappingVersionId) => ({
  schema_version: 1,
  capability: "gate_mapping.v1",
  scope_class: "community_guild",
  privacy_class: "restricted_community",
  source_identity: "shadow-audit",
  readiness_policy_version: "gate-leak-readiness.v1",
  adapter_version: "v1",
  community_ref,
  guild_ref,
  collection_id: acmeIdentity.collection_id,
  deployment_set_digest: acmeSet,
  evidence_boundary: {
    kind: "immutable_mapping_version",
    mapping_version_id: mappingVersionId,
  },
});

const cohortDigest = run(
  digestVersioned("gate-leak.subject-cohort", 1, {
    subjects: ["400000000000000001", "400000000000000002"],
  }),
);

/**
 * SDD 6.3: Discord snapshot acquisition AND exact-snapshot consumption keys
 * bind the ratified mapping version + configuration digest.
 */
const discordKey = (boundary, overrides = {}) => ({
  schema_version: 1,
  capability: "discord_role_snapshot.v1",
  scope_class: "community_guild",
  privacy_class: "restricted_community",
  source_identity: "shadow-audit",
  readiness_policy_version: "gate-leak-readiness.v1",
  adapter_version: "v1",
  community_ref: "acme-club",
  guild_ref: "200000000000000002",
  role_ids: ["300000000000000002", "300000000000000003"],
  mapping_version_id: acmeRatified.version.mapping_version_id,
  mapping_config_digest: acmeRatified.version.config_digest,
  evidence_boundary: boundary,
  ...overrides,
});

const identityKey = (overrides = {}) => ({
  schema_version: 1,
  capability: "identity_link_snapshot.v1",
  scope_class: "community_subjects",
  privacy_class: "restricted_community",
  source_identity: "identity-api",
  readiness_policy_version: "gate-leak-readiness.v1",
  adapter_version: "v1",
  community_ref: "acme-club",
  guild_ref: "200000000000000002",
  consent_policy_version: "community-gate-audit.v1",
  cohort: {
    schema_version: 1,
    subject_set_digest: cohortDigest,
    cardinality: 2,
    inclusion_rule_version: "cohort-inclusion.v1",
    source_role_snapshot_id: "snapshot-0001",
    limit_policy_version: "subject-cohort-limit.v1",
  },
  evidence_boundary: { kind: "exact_snapshot", snapshot_id: "link-snapshot-0001" },
  ...overrides,
});

const computeInputDigest = run(
  digestVersioned("gate-leak.compute-input", 1, { placeholder: "vector" }),
);
const computeKey = (result_scope) => ({
  schema_version: 1,
  capability: "gate_leak_compute.v1",
  scope_class: "order_result",
  privacy_class: "restricted_community",
  source_identity: "shadow-audit",
  readiness_policy_version: "gate-leak-readiness.v1",
  adapter_version: "v1",
  community_ref: "acme-club",
  guild_ref: "200000000000000002",
  result_scope,
  compute_input_digest: computeInputDigest,
});

const acquisitionBoundary = {
  kind: "acquisition",
  capture_policy_version: "discord-capture.v1",
  authorization_epoch: 3,
  acquisition_generation: 1,
};

const vectorInputs = [
  ["ownership-base", ownershipKey()],
  ["ownership-policy-bump", ownershipKey({ readiness_policy_version: "gate-leak-readiness.v2" })],
  ["ownership-adapter-bump", ownershipKey({ adapter_version: "v2" })],
  [
    "ownership-finality-bump",
    ownershipKey({
      collection: {
        ...ownershipKey().collection,
        finality_policies: [
          {
            schema_version: 1,
            network: {
              schema_version: 1,
              network_namespace: "eip155",
              network_reference: "1",
            },
            finality_policy_version: "ownership-finality.eip155-finalized-block.v2",
          },
          {
            schema_version: 1,
            network: {
              schema_version: 1,
              network_namespace: "eip155",
              network_reference: "8453",
            },
            finality_policy_version: "ownership-finality.eip155-finalized-block.v1",
          },
        ],
      },
    }),
  ],
  [
    "ownership-single-deployment",
    ownershipKey({
      collection: {
        ...ownershipKey().collection,
        collection_id: miberaIdentity.collection_id,
        deployment_ids: sortedDeploymentIds(miberaIdentity),
        finality_policies: [
          {
            schema_version: 1,
            network: {
              schema_version: 1,
              network_namespace: "eip155",
              network_reference: "80094",
            },
            finality_policy_version: "ownership-finality.eip155-finalized-block.v1",
          },
        ],
      },
    }),
  ],
  ["mapping-acme", mappingKey("acme-club", "200000000000000002", acmeRatified.version.mapping_version_id)],
  ["mapping-acme-other-guild", mappingKey("acme-club", "200000000000000009", acmeRatified.version.mapping_version_id)],
  ["mapping-other-community", mappingKey("acme-club2", "200000000000000002", acmeRatified.version.mapping_version_id)],
  ["mapping-mibera-version", mappingKey("acme-club", "200000000000000002", miberaRatified.version.mapping_version_id)],
  ["mapping-boundary-a", mappingKey("team-a", "123456789012345678", acmeRatified.version.mapping_version_id)],
  ["mapping-boundary-b", mappingKey("team-a1", "23456789012345678", acmeRatified.version.mapping_version_id)],
  ["discord-acquisition", discordKey(acquisitionBoundary)],
  [
    "discord-acquisition-epoch-bump",
    discordKey({ ...acquisitionBoundary, authorization_epoch: 4 }),
  ],
  ["discord-exact-snapshot", discordKey({ kind: "exact_snapshot", snapshot_id: "role-snapshot-0001" })],
  // SDD 6.3 same/different vectors: the ratified mapping identity is in the key.
  [
    "discord-acquisition-relinked-mapping",
    discordKey(acquisitionBoundary, {
      mapping_version_id: acmeRelinked.version.mapping_version_id,
      mapping_config_digest: acmeRelinked.version.config_digest,
    }),
  ],
  [
    "discord-acquisition-other-config",
    discordKey(acquisitionBoundary, {
      role_ids: ["300000000000000001"],
      mapping_version_id: miberaRatified.version.mapping_version_id,
      mapping_config_digest: miberaRatified.version.config_digest,
    }),
  ],
  ["identity-base", identityKey()],
  ["identity-consent-bump", identityKey({ consent_policy_version: "community-gate-audit.v2" })],
  ["compute-order-a", computeKey({ kind: "order", order_id: "order-000a" })],
  ["compute-order-b", computeKey({ kind: "order", order_id: "order-000b" })],
  ["compute-result-cache", computeKey({ kind: "result_cache" })],
];

const vectors = vectorInputs.map(([name, input]) => ({
  name,
  input,
  work_key_digest: run(digestGateLeakWorkKey(input)),
}));

const digestOf = (name) => vectors.find((vector) => vector.name === name).work_key_digest.digest;
assert(
  digestOf("mapping-boundary-a") !== digestOf("mapping-boundary-b"),
  "field-separated community/guild scopes cannot collide by concatenation",
);
assert(
  digestOf("discord-acquisition-relinked-mapping") !== digestOf("discord-acquisition"),
  "a relinked (new) mapping version changes the Discord acquisition key",
);
assert(
  digestOf("discord-acquisition-other-config") !== digestOf("discord-acquisition"),
  "a different ratified configuration changes the Discord acquisition key",
);
assert(
  new Set(vectors.map((vector) => vector.work_key_digest.digest)).size === vectors.length,
  "every distinct scope/policy/version input yields a distinct work key",
);

write("work-key-digest-vectors.valid.json", vectors);

/* ---------------------------------------------------------------- */
/* Malformed fixtures                                                 */
/* ---------------------------------------------------------------- */

const validRow = rows.find((row) => row.eligibility_state === "proven_ineligible");
write("malformed/row-excess-property.invalid.json", {
  ...validRow,
  username: "smuggled-profile-field",
});
write("malformed/row-consent-wallet.invalid.json", {
  schema_version: 1,
  discord_user_id: "400000000000000002",
  role_id: "300000000000000002",
  eligibility_state: "indeterminate",
  reason_code: "consent_unavailable",
  compared_wallets: [wallet("a2")],
});
write("malformed/row-eligible-no-wallet.invalid.json", {
  schema_version: 1,
  discord_user_id: "400000000000000004",
  role_id: "300000000000000002",
  eligibility_state: "eligible",
  reason_code: "eligible_balance_confirmed",
  compared_wallets: [],
});
write("malformed/row-unknown-reason.invalid.json", {
  schema_version: 1,
  discord_user_id: "400000000000000009",
  role_id: "300000000000000002",
  eligibility_state: "indeterminate",
  reason_code: "role_missing",
  compared_wallets: [],
});
write("malformed/measure-actionable-below-threshold.invalid.json", {
  schema_version: 1,
  presentation: "actionable",
  coverage_policy_version: "gate-leak-coverage.v1",
  actionable_leak_band: "1-9",
  coverage_band_floor_percent: 70,
  cohort_band: "10-24",
  indeterminate_band: "1-9",
  excluded_bot_count: 0,
});
write("malformed/work-key-global-with-community.invalid.json", {
  ...ownershipKey(),
  community_ref: "smuggled-tenant",
});
write("malformed/mapping-version-inferred.invalid.json", {
  ...miberaRatified.version,
  provenance: "inferred",
});
write("malformed/mapping-second-approver-same-subject.invalid.json", {
  ...acmeRatified.version,
  identity_reveal_basis: {
    schema_version: 1,
    kind: "second_approver",
    approver_subject: acmeRatified.version.ratifier_subject,
    approver_permission: "privacy:approve-gate-audit",
    approved_at: T0,
  },
});

// Finding 2 probe: an aggregate persisting TWO active versions (the revoked
// version's revoked_at stripped) must refuse at decode.
const [firstAcmeVersion, secondAcmeVersion] = acmeRelinked.aggregate.versions;
const { revoked_at: _stripped, ...firstReactivated } = firstAcmeVersion;
write("malformed/aggregate-two-active.invalid.json", {
  ...acmeRelinked.aggregate,
  versions: [firstReactivated, secondAcmeVersion],
});

// Finding 4 probe: role_ids tampered while retaining every old digest and the
// version ID. Structurally valid; integrity verification must refuse.
write("malformed/mapping-version-tampered-roles.invalid.json", {
  ...miberaRatified.version,
  role_ids: ["300000000000000001", "300000000000000999"],
});

// Finding 4 probe: reveal evidence minted under an UNRELATED digest domain.
write("malformed/reveal-unrelated-domain.invalid.json", {
  ...miberaRatified.version,
  identity_reveal_basis: {
    ...miberaRatified.version.identity_reveal_basis,
    evidence_digest: run(
      digestVersioned("collection.provenance", 1, { note: "unrelated-domain graft" }),
    ),
  },
});

// Finding 4 probe: integration evidence GRAFTED from another mapping's config.
write("malformed/reveal-grafted-config.invalid.json", {
  ...miberaRatified.version,
  identity_reveal_basis: {
    ...miberaRatified.version.identity_reveal_basis,
    bound_config_digest: acmeRatified.version.config_digest,
  },
});

// Finding 6 probe: permuted (unsorted) role set on a disclosure-ledger key.
write("malformed/disclosure-key-unsorted-roles.invalid.json", {
  schema_version: 1,
  community_ref: "acme-club",
  guild_ref: "200000000000000002",
  collection_id: acmeIdentity.collection_id,
  role_ids: ["300000000000000003", "300000000000000002"],
  rule_digest: acmeRatified.version.rule_digest,
  disclosure_policy_version: "gate-leak-disclosure.v1",
  epoch_index: 0,
});

console.log("all golden expectations held");
