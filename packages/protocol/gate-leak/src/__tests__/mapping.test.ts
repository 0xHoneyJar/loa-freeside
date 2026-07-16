import { Predicate, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { VersionedDigest, digestVersioned } from "@freeside/collection-protocol";
import {
  GATE_LEAK_CHURN_POLICY_V1,
  admitGateRule,
  computeGateMappingCommandDigest,
  computeGateMappingConfigDigest,
  decodeGateMappingAggregate,
  decodeGateMappingHypothesis,
  decodeGateMappingVersion,
  decodeRatifyGateMappingCommand,
  decodeRevokeGateMappingCommand,
  evaluateGateLeakOrderChurn,
  mappingPermitsIdentityReveal,
  mappingSatisfiesReadiness,
  ratifyGateMapping as ratifyGateMappingTransition,
  revokeGateMappingVersion,
  verifyGateMappingVersionIntegrity,
} from "../index.js";
import type {
  GateMappingAggregate,
  GateMappingVersion,
  RatifyGateMappingCommand,
  RevokeGateMappingCommand,
} from "../index.js";
import {
  expectEffectFailureTag,
  expectEffectSuccess,
  readFixture,
} from "./test-helpers.js";

const CommunityFixture = Schema.Struct({
  description: Schema.String,
  authoritative_mapping_source: Schema.Literal("shadow-audit.gate-mapping-aggregate"),
  seed_aggregate: Schema.Unknown,
  ratify_command: Schema.optionalWith(Schema.Unknown, { exact: true }),
  expected_mapping_version_id: Schema.optionalWith(VersionedDigest, { exact: true }),
  expected_aggregate_version: Schema.optionalWith(Schema.Number, { exact: true }),
  ratified_version: Schema.optionalWith(Schema.Unknown, { exact: true }),
  legacy_parity: Schema.optionalWith(Schema.Unknown, { exact: true }),
  conflict_command: Schema.optionalWith(Schema.Unknown, { exact: true }),
  revoke_command: Schema.optionalWith(Schema.Unknown, { exact: true }),
  expected_after_revoke: Schema.optionalWith(Schema.Unknown, { exact: true }),
  relink_command: Schema.optionalWith(Schema.Unknown, { exact: true }),
  expected_relinked_mapping_version_id: Schema.optionalWith(VersionedDigest, {
    exact: true,
  }),
  unsupported_legacy_rules: Schema.optionalWith(Schema.Unknown, { exact: true }),
  unauthorized_ratify_command: Schema.optionalWith(Schema.Unknown, { exact: true }),
  out_of_scope_holders: Schema.optionalWith(Schema.Unknown, { exact: true }),
});
const decodeCommunityFixture = Schema.decodeUnknown(CommunityFixture, {
  errors: "all",
  onExcessProperty: "error",
});

const loadCommunity = (name: string) =>
  expectEffectSuccess(decodeCommunityFixture(readFixture(name)));

const mibera = loadCommunity("community-mibera-recorded.valid.json");
const acme = loadCommunity("community-acme-recorded.valid.json");
const sol = loadCommunity("community-sol-recorded.valid.json");

const seedOf = (fixture: { readonly seed_aggregate: unknown }): GateMappingAggregate =>
  expectEffectSuccess(decodeGateMappingAggregate(fixture.seed_aggregate));

const ratifyCommandOf = (raw: unknown): RatifyGateMappingCommand =>
  expectEffectSuccess(decodeRatifyGateMappingCommand(raw));

const ratifyGateMapping = (
  aggregate: GateMappingAggregate,
  command: RatifyGateMappingCommand,
  versionEffectiveTimes: ReadonlyArray<string> = aggregate.versions.map(
    (version) => version.effective_at,
  ),
) =>
  ratifyGateMappingTransition(aggregate, command, {
    schema_version: 1,
    policy_version: GATE_LEAK_CHURN_POLICY_V1.version,
    community_ref: command.community_ref,
    version_effective_times: versionEffectiveTimes,
  });

const integrityMismatchesOf = (tampered: GateMappingVersion): ReadonlyArray<string> => {
  const failure = expectEffectFailureTag(
    verifyGateMappingVersionIntegrity(tampered),
    "MappingIntegrityError",
  );
  if (!Predicate.isTagged(failure, "MappingIntegrityError")) {
    throw new Error("expected MappingIntegrityError");
  }
  expect(failure.reason_code).toBe("mapping_integrity_violation");
  return failure.mismatches;
};

describe("gate_mapping.v1 aggregate", () => {
  it("ratifies deterministically: replaying the recorded command reproduces the pinned version id", () => {
    for (const fixture of [mibera, acme]) {
      const seed = seedOf(fixture);
      const command = ratifyCommandOf(fixture.ratify_command);
      const result = expectEffectSuccess(ratifyGateMapping(seed, command));
      expect(result.idempotent_replay).toBe(false);
      expect(result.version.mapping_version_id).toStrictEqual(
        fixture.expected_mapping_version_id,
      );
      expect(result.aggregate.aggregate_version).toBe(seed.aggregate_version + 1);
      expect(result.aggregate.audit.at(-1)?.event).toBe("ratified");
      expect(result.version.ratifier_permission).toBe("gate-config:ratify");
    }
  });

  it("publishes a strict-decodable immutable version with rule and config digests", () => {
    const version = expectEffectSuccess(
      decodeGateMappingVersion(mibera.ratified_version),
    );
    expect(version.rule_digest.domain).toBe("gate-leak.gate-rule");
    expect(version.config_digest.domain).toBe("gate-leak.mapping-config");
    expect(version.eligibility_rule.kind).toBe("hold_at_least_one");
    expect(version.provenance).toBe("operator_confirmed");
  });

  it("is idempotent on the recorded idempotency key without consuming a new version", () => {
    const seed = seedOf(mibera);
    const command = ratifyCommandOf(mibera.ratify_command);
    const first = expectEffectSuccess(ratifyGateMapping(seed, command));
    const replay = expectEffectSuccess(ratifyGateMapping(first.aggregate, command));
    expect(replay.idempotent_replay).toBe(true);
    expect(replay.aggregate.aggregate_version).toBe(first.aggregate.aggregate_version);
    expect(replay.version.mapping_version_id).toStrictEqual(
      first.version.mapping_version_id,
    );
  });

  it("optimistic concurrency: a stale expected version conflicts and returns the current mapping", () => {
    const seed = seedOf(acme);
    const ratified = expectEffectSuccess(
      ratifyGateMapping(seed, ratifyCommandOf(acme.ratify_command)),
    );
    const conflict = ratifyCommandOf(acme.conflict_command);
    const failure = expectEffectFailureTag(
      ratifyGateMapping(ratified.aggregate, conflict),
      "MappingVersionConflictError",
    );
    expect(failure).toMatchObject({
      current_aggregate_version: 1,
      current_active_version_id: ratified.version.mapping_version_id.digest,
    });
  });

  it("single-active invariant: a NEW distinct ratification while one is active refuses; only revoke-then-relink replaces it", () => {
    const seed = seedOf(acme);
    const command = ratifyCommandOf(acme.ratify_command);
    const ratified = expectEffectSuccess(ratifyGateMapping(seed, command));

    // A distinct command at the CURRENT aggregate version still refuses:
    // this is not a CAS race, it is the single-active invariant.
    const distinct: RatifyGateMappingCommand = {
      ...command,
      idempotency_key: "acme-second-active-attempt",
      expected_aggregate_version: ratified.aggregate.aggregate_version,
      effective_at: "2026-07-16T00:30:00Z",
    };
    const failure = expectEffectFailureTag(
      ratifyGateMapping(ratified.aggregate, distinct),
      "ActiveMappingExistsError",
    );
    expect(failure).toMatchObject({
      active_mapping_version_id: ratified.version.mapping_version_id.digest,
      required_action: "revoke_then_relink",
    });

    // Idempotent replay of the RECORDED command remains permitted.
    const replay = expectEffectSuccess(ratifyGateMapping(ratified.aggregate, command));
    expect(replay.idempotent_replay).toBe(true);

    // History stays immutable: the refused attempt appended nothing.
    expect(ratified.aggregate.versions).toHaveLength(1);
  });

  it("revocation stops pending orders with gate_mapping_revoked and requires explicit relink", () => {
    const seed = seedOf(acme);
    const ratified = expectEffectSuccess(
      ratifyGateMapping(seed, ratifyCommandOf(acme.ratify_command)),
    );
    const revoke = expectEffectSuccess(
      decodeRevokeGateMappingCommand(acme.revoke_command),
    );
    const revoked = expectEffectSuccess(
      revokeGateMappingVersion(ratified.aggregate, revoke),
    );
    expect(revoked.pending_order_directive).toBe("needs_attention:gate_mapping_revoked");
    expect(revoked.version.revoked_at).toBe(revoke.revoked_at);

    // Readiness now reports the revoked state — never a silent replacement.
    const readiness = mappingSatisfiesReadiness(revoked.aggregate);
    expect(readiness).toStrictEqual({
      ready: false,
      reason_code: "gate_mapping_revoked",
    });

    // Explicit relink: the RECORDED relink command against the advanced version.
    const relink = expectEffectSuccess(
      ratifyGateMapping(revoked.aggregate, ratifyCommandOf(acme.relink_command)),
    );
    expect(relink.version.mapping_version_id).toStrictEqual(
      acme.expected_relinked_mapping_version_id,
    );
    const relinked = mappingSatisfiesReadiness(relink.aggregate);
    expect(relinked.ready).toBe(true);
    if (relinked.ready) {
      expect(relinked.version.mapping_version_id).toStrictEqual(
        relink.version.mapping_version_id,
      );
    }
    // Immutable history: the revoked version remains, revoked, in the aggregate.
    expect(relink.aggregate.versions).toHaveLength(2);
    expect(relink.aggregate.versions[0]?.revoked_at).toBe(revoke.revoked_at);

    // Double revocation of the same version is refused.
    expectEffectFailureTag(
      revokeGateMappingVersion(relink.aggregate, {
        ...revoke,
        expected_aggregate_version: relink.aggregate.aggregate_version,
      }),
      "MappingAlreadyRevokedError",
    );
  });

  it("two-active adversarial probe: the persisted shape refuses at decode", () => {
    expectEffectFailureTag(
      decodeGateMappingAggregate(readFixture("malformed/aggregate-two-active.invalid.json")),
      "ParseError",
    );
  });

  it("two-active adversarial probe: an in-process two-active aggregate is malformed for readiness and transitions — never oldest-wins", () => {
    const seed = seedOf(acme);
    const command = ratifyCommandOf(acme.ratify_command);
    const ratified = expectEffectSuccess(ratifyGateMapping(seed, command));
    const revoke = expectEffectSuccess(
      decodeRevokeGateMappingCommand(acme.revoke_command),
    );
    const revoked = expectEffectSuccess(
      revokeGateMappingVersion(ratified.aggregate, revoke),
    );
    const relink = expectEffectSuccess(
      ratifyGateMapping(revoked.aggregate, ratifyCommandOf(acme.relink_command)),
    );
    // Strip the revocation from the first version: two actives, bypassing decode.
    const [first, second] = relink.aggregate.versions;
    if (first === undefined || second === undefined) throw new Error("expected 2 versions");
    const { revoked_at: _stripped, ...reactivated } = first;
    const twoActive: GateMappingAggregate = {
      ...relink.aggregate,
      versions: [reactivated as GateMappingVersion, second],
    };
    // Readiness refuses malformed aggregates; it never selects the oldest.
    expect(mappingSatisfiesReadiness(twoActive)).toStrictEqual({
      ready: false,
      reason_code: "gate_mapping_malformed",
    });
    // Transitions refuse too.
    expectEffectFailureTag(
      ratifyGateMapping(twoActive, {
        ...command,
        idempotency_key: "acme-two-active-ratify",
        expected_aggregate_version: twoActive.aggregate_version,
      }),
      "MalformedMappingAggregateError",
    );
  });

  it("refuses an unauthorized ratifier with gate_config_ratify_required", () => {
    const failure = expectEffectFailureTag(
      ratifyGateMapping(seedOf(sol), ratifyCommandOf(sol.unauthorized_ratify_command)),
      "UnauthorizedRatifierError",
    );
    expect(failure).toMatchObject({ reason_code: "gate_config_ratify_required" });
  });

  it("refuses a second approver who is the ratifier, and a second approver without the privacy permission cannot decode", () => {
    const command = ratifyCommandOf(acme.ratify_command);
    const selfApproved: RatifyGateMappingCommand = {
      ...command,
      idempotency_key: "acme-self-approve",
      identity_reveal_basis: {
        schema_version: 1,
        kind: "second_approver",
        approver_subject: command.ratifier_subject,
        approver_permission: "privacy:approve-gate-audit",
        approved_at: command.effective_at,
      },
    };
    expectEffectFailureTag(
      ratifyGateMapping(seedOf(acme), selfApproved),
      "SecondApproverInvalidError",
    );
    expectEffectFailureTag(
      decodeGateMappingVersion(
        readFixture("malformed/mapping-second-approver-same-subject.invalid.json"),
      ),
      "ParseError",
    );
    // The wrong permission literal is unrepresentable on the wire.
    const rawCommand = acme.ratify_command;
    if (typeof rawCommand !== "object" || rawCommand === null) {
      throw new Error("expected raw ratify command");
    }
    expectEffectFailureTag(
      decodeRatifyGateMappingCommand({
        ...rawCommand,
        identity_reveal_basis: {
          schema_version: 1,
          kind: "second_approver",
          approver_subject: "op:eve",
          approver_permission: "gate-config:ratify",
          approved_at: command.effective_at,
        },
      }),
      "ParseError",
    );
  });

  it("identity reveal: pending mappings cannot reveal rows; evidenced or dual-approved mappings can", () => {
    const seed = seedOf(sol);
    const pendingCommand: RatifyGateMappingCommand = {
      ...ratifyCommandOf(sol.unauthorized_ratify_command),
      ratifier_subject: "op:carol",
      ratifier_permissions: ["gate-config:ratify"],
    };
    const pending = expectEffectSuccess(ratifyGateMapping(seed, pendingCommand));
    expect(mappingPermitsIdentityReveal(pending.version)).toStrictEqual({
      revealable: false,
      reason_code: "identity_reveal_not_authorized",
    });

    const evidenced = expectEffectSuccess(
      ratifyGateMapping(seedOf(mibera), ratifyCommandOf(mibera.ratify_command)),
    );
    expect(mappingPermitsIdentityReveal(evidenced.version)).toStrictEqual({
      revealable: true,
    });
  });

  it("integration evidence is bound: correct versioned domain, exact config digest, authority, and observation time", () => {
    const version = expectEffectSuccess(
      decodeGateMappingVersion(mibera.ratified_version),
    );
    if (version.identity_reveal_basis.kind !== "integration_evidence") {
      throw new Error("expected integration-evidence reveal basis");
    }
    expect(version.identity_reveal_basis.evidence_digest.domain).toBe(
      "gate-leak.integration-evidence",
    );
    expect(version.identity_reveal_basis.bound_config_digest).toStrictEqual(
      version.config_digest,
    );
    expect(version.identity_reveal_basis.authority.length).toBeGreaterThan(0);

    // Unrelated-domain probe: evidence minted under another domain cannot decode.
    expectEffectFailureTag(
      decodeGateMappingVersion(readFixture("malformed/reveal-unrelated-domain.invalid.json")),
      "ParseError",
    );
    // Graft probe: another mapping's config digest cannot back this reveal.
    expectEffectFailureTag(
      decodeGateMappingVersion(readFixture("malformed/reveal-grafted-config.invalid.json")),
      "ParseError",
    );
  });

  it("ratification refuses integration evidence bound to a DIFFERENT configuration", () => {
    const command = ratifyCommandOf(mibera.ratify_command);
    if (command.identity_reveal_basis.kind !== "integration_evidence") {
      throw new Error("expected integration-evidence reveal basis");
    }
    const foreignConfig = expectEffectSuccess(
      computeGateMappingConfigDigest({
        community_ref: command.community_ref,
        guild_ref: command.guild_ref,
        collection_id: command.collection_id,
        deployment_set_digest: command.deployment_set_digest,
        role_ids: ["300000000000000999"],
        eligibility_rule: command.eligibility_rule,
      }),
    );
    expectEffectFailureTag(
      ratifyGateMapping(seedOf(mibera), {
        ...command,
        idempotency_key: "mibera-grafted-evidence",
        identity_reveal_basis: {
          ...command.identity_reveal_basis,
          bound_config_digest: foreignConfig,
        },
      }),
      "IntegrationEvidenceMismatchError",
    );
  });

  it("tamper probe: role_ids, config, evidence, CAS, command digest, or command material changed while retaining old digests/version IDs fail integrity verification", () => {
    // Persisted-shape probe: the tampered fixture decodes structurally but
    // fails digest-integrity verification inside the decoder.
    expectEffectFailureTag(
      decodeGateMappingVersion(
        readFixture("malformed/mapping-version-tampered-roles.invalid.json"),
      ),
      "MappingIntegrityError",
    );

    // In-process probe: each tampered field names its mismatch.
    const version = expectEffectSuccess(
      decodeGateMappingVersion(mibera.ratified_version),
    );
    const tamperedRoles: GateMappingVersion = {
      ...version,
      role_ids: [...version.role_ids, "300000000000000999"],
    };
    expect(integrityMismatchesOf(tamperedRoles)).toEqual(
      expect.arrayContaining(["config_digest", "command_material"]),
    );

    const tamperedConfig: GateMappingVersion = {
      ...version,
      deployment_set_digest: {
        ...version.deployment_set_digest,
        digest: "f".repeat(64),
      },
    };
    expect(integrityMismatchesOf(tamperedConfig)).toEqual(
      expect.arrayContaining(["config_digest", "command_material"]),
    );

    const tamperedReveal: GateMappingVersion = {
      ...version,
      identity_reveal_basis: { schema_version: 1, kind: "pending" },
    };
    expect(integrityMismatchesOf(tamperedReveal)).toEqual(
      expect.arrayContaining(["mapping_version_id", "command_material"]),
    );

    // Graft a changed-command digest onto an otherwise intact version: the
    // stored material still recomputes the original digest, so integrity
    // names command_digest. Updating material+digest together while retaining
    // mapping_version_id is covered by the command_material probe below.
    const graftedDigest: GateMappingVersion = {
      ...version,
      command_digest: {
        ...version.command_digest,
        digest: "a".repeat(64),
      },
    };
    expect(integrityMismatchesOf(graftedDigest)).toContain("command_digest");

    // Rewrite command_material without updating digests / version id.
    const tamperedMaterial: GateMappingVersion = {
      ...version,
      command_material: {
        ...version.command_material,
        role_ids: ["300000000000000999"],
      },
    };
    expect(integrityMismatchesOf(tamperedMaterial)).toEqual(
      expect.arrayContaining(["command_material", "command_digest", "mapping_version_id"]),
    );

    // Update both material and digest to a different command while retaining
    // the original mapping_version_id — the version identity was bound to the
    // original command digest, so this graft fails closed.
    const evilMaterial = {
      ...version.command_material,
      role_ids: ["300000000000000999"] as typeof version.command_material.role_ids,
    };
    const evilDigest = expectEffectSuccess(computeGateMappingCommandDigest(evilMaterial));
    const graftedCommandIdentity: GateMappingVersion = {
      ...version,
      command_material: evilMaterial,
      command_digest: evilDigest,
    };
    expect(integrityMismatchesOf(graftedCommandIdentity)).toEqual(
      expect.arrayContaining(["command_material", "mapping_version_id"]),
    );

    // Aggregate CAS / evidence field tamper on a persisted aggregate shape.
    const ratified = expectEffectSuccess(
      ratifyGateMapping(seedOf(mibera), ratifyCommandOf(mibera.ratify_command)),
    );
    const [stored] = ratified.aggregate.versions;
    if (stored === undefined) throw new Error("expected a version");
    expectEffectFailureTag(
      decodeGateMappingAggregate({
        ...ratified.aggregate,
        versions: [
          {
            ...stored,
            command_digest: { ...stored.command_digest, digest: "b".repeat(64) },
          },
        ],
      }),
      "MappingIntegrityError",
    );
  });

  it("command digest is bound into mapping_version_id: grafting a changed-command digest cannot replay a changed command under the same version", () => {
    const seed = seedOf(mibera);
    const command = ratifyCommandOf(mibera.ratify_command);
    const first = expectEffectSuccess(ratifyGateMapping(seed, command));

    // Exact canonical replay still succeeds.
    const replay = expectEffectSuccess(ratifyGateMapping(first.aggregate, command));
    expect(replay.idempotent_replay).toBe(true);
    expect(replay.version.mapping_version_id).toStrictEqual(
      first.version.mapping_version_id,
    );

    // Ordinary same-key / different-command conflict is unchanged.
    expectEffectFailureTag(
      ratifyGateMapping(first.aggregate, {
        ...command,
        role_ids: ["300000000000000999"],
      }),
      "IdempotencyConflictError",
    );

    // Adversarial graft: replace stored command_digest with the digest of a
    // DIFFERENT command while keeping mapping_version_id. Strict decode must
    // refuse; in-process transitions must refuse MappingIntegrityError BEFORE
    // idempotency lookup — never compare against raw stored command_digest or
    // return replay from an unverified object.
    const evilCommand: RatifyGateMappingCommand = {
      ...command,
      role_ids: ["300000000000000999"],
    };
    const evilDigest = expectEffectSuccess(computeGateMappingCommandDigest(evilCommand));
    const graftedAggregate: GateMappingAggregate = {
      ...first.aggregate,
      versions: [
        {
          ...first.version,
          command_digest: evilDigest,
        },
      ],
    };
    expectEffectFailureTag(
      decodeGateMappingAggregate(graftedAggregate),
      "MappingIntegrityError",
    );
    expectEffectFailureTag(
      ratifyGateMapping(graftedAggregate, evilCommand),
      "MappingIntegrityError",
    );
    expectEffectFailureTag(
      ratifyGateMapping(graftedAggregate, command),
      "MappingIntegrityError",
    );

    // Clean aggregate + changed command: identical verified conflict behavior.
    const conflict = expectEffectFailureTag(
      ratifyGateMapping(first.aggregate, evilCommand),
      "IdempotencyConflictError",
    );
    expect(conflict).toMatchObject({
      stored_mapping_version_id: first.version.mapping_version_id.digest,
      stored_command_digest: first.version.command_digest.digest,
      submitted_command_digest: evilDigest.digest,
    });
  });

  it("in-process grafts of material/version-id/roles/config/evidence fail MappingIntegrityError before any transition branch", () => {
    const seed = seedOf(mibera);
    const command = ratifyCommandOf(mibera.ratify_command);
    const first = expectEffectSuccess(ratifyGateMapping(seed, command));
    const [version] = first.aggregate.versions;
    if (version === undefined) throw new Error("expected a version");

    const probes: ReadonlyArray<{
      readonly label: string;
      readonly graft: GateMappingVersion;
    }> = [
      {
        label: "grafted command_digest",
        graft: {
          ...version,
          command_digest: { ...version.command_digest, digest: "a".repeat(64) },
        },
      },
      {
        label: "grafted command_material",
        graft: {
          ...version,
          command_material: {
            ...version.command_material,
            role_ids: ["300000000000000999"],
          },
        },
      },
      {
        label: "grafted mapping_version_id",
        graft: {
          ...version,
          mapping_version_id: {
            ...version.mapping_version_id,
            digest: "b".repeat(64),
          },
        },
      },
      {
        label: "grafted role_ids",
        graft: {
          ...version,
          role_ids: [...version.role_ids, "300000000000000999"],
        },
      },
      {
        label: "grafted config deployment_set_digest",
        graft: {
          ...version,
          deployment_set_digest: {
            ...version.deployment_set_digest,
            digest: "c".repeat(64),
          },
        },
      },
      {
        label: "grafted identity_reveal_basis",
        graft: {
          ...version,
          identity_reveal_basis: { schema_version: 1, kind: "pending" },
        },
      },
    ];

    for (const probe of probes) {
      const grafted: GateMappingAggregate = {
        ...first.aggregate,
        versions: [probe.graft],
      };
      // Persisted decode and in-process transition refuse identically.
      expectEffectFailureTag(
        decodeGateMappingAggregate(grafted),
        "MappingIntegrityError",
      );
      expectEffectFailureTag(
        ratifyGateMapping(grafted, command),
        "MappingIntegrityError",
      );
      expectEffectFailureTag(
        revokeGateMappingVersion(grafted, {
          schema_version: 1,
          mapping_version_id: version.mapping_version_id,
          revoker_subject: "op:alice",
          revoker_permissions: ["gate-config:ratify"],
          expected_aggregate_version: first.aggregate.aggregate_version,
          revoked_at: "2026-07-16T12:00:00Z",
          reason: `integrity probe: ${probe.label}`,
        }),
        "MappingIntegrityError",
      );
    }
  });

  it("envelope integrity: schema_version 99, aggregate_version -1, malformed audit, and excess keys fail closed before ratify replay or revoke", () => {
    const seed = seedOf(mibera);
    const command = ratifyCommandOf(mibera.ratify_command);
    const first = expectEffectSuccess(ratifyGateMapping(seed, command));
    const revoke: RevokeGateMappingCommand = {
      schema_version: 1,
      mapping_version_id: first.version.mapping_version_id,
      revoker_subject: "op:alice",
      revoker_permissions: ["gate-config:ratify"],
      expected_aggregate_version: first.aggregate.aggregate_version,
      revoked_at: "2026-07-16T12:00:00Z",
      reason: "envelope integrity probe",
    };

    const probes: ReadonlyArray<{
      readonly label: string;
      readonly aggregate: GateMappingAggregate;
    }> = [
      {
        label: "schema_version 99",
        aggregate: {
          ...first.aggregate,
          schema_version: 99,
        } as unknown as GateMappingAggregate,
      },
      {
        label: "aggregate_version -1",
        aggregate: {
          ...first.aggregate,
          aggregate_version: -1,
        } as unknown as GateMappingAggregate,
      },
      {
        label: "malformed audit { rogue: true }",
        aggregate: {
          ...first.aggregate,
          audit: [{ rogue: true }],
        } as unknown as GateMappingAggregate,
      },
      {
        label: "aggregate excess { rogue: true }",
        aggregate: {
          ...first.aggregate,
          rogue: true,
        } as unknown as GateMappingAggregate,
      },
    ];

    for (const probe of probes) {
      expectEffectFailureTag(
        ratifyGateMapping(probe.aggregate, command),
        "ParseError",
      );
      expectEffectFailureTag(
        revokeGateMappingVersion(probe.aggregate, revoke),
        "ParseError",
      );
    }

    // Normal identical replay, changed-command conflict, and revoke CAS remain.
    const replay = expectEffectSuccess(ratifyGateMapping(first.aggregate, command));
    expect(replay.idempotent_replay).toBe(true);
    expect(replay.version.mapping_version_id).toStrictEqual(
      first.version.mapping_version_id,
    );
    expectEffectFailureTag(
      ratifyGateMapping(first.aggregate, {
        ...command,
        role_ids: ["300000000000000999"],
      }),
      "IdempotencyConflictError",
    );
    const revoked = expectEffectSuccess(
      revokeGateMappingVersion(first.aggregate, revoke),
    );
    expect(revoked.version.revoked_at).toBe(revoke.revoked_at);
    expectEffectFailureTag(
      revokeGateMappingVersion(first.aggregate, {
        ...revoke,
        expected_aggregate_version: first.aggregate.aggregate_version + 1,
      }),
      "MappingVersionConflictError",
    );
  });

  it("aggregate decode verifies every version's integrity, not just shape", () => {
    const ratified = expectEffectSuccess(
      ratifyGateMapping(seedOf(mibera), ratifyCommandOf(mibera.ratify_command)),
    );
    const [version] = ratified.aggregate.versions;
    if (version === undefined) throw new Error("expected a version");
    const tampered = {
      ...ratified.aggregate,
      versions: [{ ...version, role_ids: ["300000000000000001", "300000000000000999"] }],
    };
    expectEffectFailureTag(decodeGateMappingAggregate(tampered), "MappingIntegrityError");
  });

  it("enforces the 5-per-24h mapping churn limit across revoke/relink cycles and admits again outside the window", () => {
    let aggregate = seedOf(mibera);
    const base = ratifyCommandOf(mibera.ratify_command);
    const limit = GATE_LEAK_CHURN_POLICY_V1.max_new_mapping_versions_per_community_per_24h;
    for (let index = 0; index < limit; index += 1) {
      const ratified = expectEffectSuccess(
        ratifyGateMapping(aggregate, {
          ...base,
          expected_aggregate_version: aggregate.aggregate_version,
          idempotency_key: `mibera-churn-${index}`,
          effective_at: `2026-07-16T0${index}:00:00Z`,
        }),
      );
      // Revoke each version so the single-active invariant holds; revoked
      // versions still count toward the 24h creation rate.
      aggregate = expectEffectSuccess(
        revokeGateMappingVersion(ratified.aggregate, {
          schema_version: 1,
          mapping_version_id: ratified.version.mapping_version_id,
          revoker_subject: "op:alice",
          revoker_permissions: ["gate-config:ratify"],
          expected_aggregate_version: ratified.aggregate.aggregate_version,
          revoked_at: `2026-07-16T0${index}:30:00Z`,
          reason: "churn-cycle rotation (recorded stand-in)",
        } satisfies RevokeGateMappingCommand),
      ).aggregate;
    }
    const failure = expectEffectFailureTag(
      ratifyGateMapping(aggregate, {
        ...base,
        expected_aggregate_version: aggregate.aggregate_version,
        idempotency_key: "mibera-churn-overflow",
        effective_at: "2026-07-16T05:00:00Z",
      }),
      "MappingChurnLimitError",
    );
    expect(failure).toMatchObject({ reason_code: "mapping_churn_limit_exceeded" });

    const outsideWindow = expectEffectSuccess(
      ratifyGateMapping(aggregate, {
        ...base,
        expected_aggregate_version: aggregate.aggregate_version,
        idempotency_key: "mibera-churn-next-day",
        effective_at: "2026-07-17T01:30:00Z",
      }),
    );
    expect(outsideWindow.idempotent_replay).toBe(false);
  });

  it("enforces mapping churn across sibling aggregates in the same community", () => {
    const aggregate = seedOf(mibera);
    const command = {
      ...ratifyCommandOf(mibera.ratify_command),
      effective_at: "2026-07-16T05:00:00Z",
      idempotency_key: "mibera-community-churn-overflow",
    };
    const communityHistory = Array.from(
      {
        length:
          GATE_LEAK_CHURN_POLICY_V1.max_new_mapping_versions_per_community_per_24h,
      },
      (_, index) => `2026-07-16T0${index}:00:00Z`,
    );
    const failure = expectEffectFailureTag(
      ratifyGateMapping(aggregate, command, communityHistory),
      "MappingChurnLimitError",
    );
    expect(failure).toMatchObject({
      reason_code: "mapping_churn_limit_exceeded",
    });
  });

  it("refuses a community churn window that omits target-aggregate history", () => {
    const command = ratifyCommandOf(mibera.ratify_command);
    const first = expectEffectSuccess(ratifyGateMapping(seedOf(mibera), command));
    const replayFailure = expectEffectFailureTag(
      ratifyGateMappingTransition(first.aggregate, command, {
        schema_version: 1,
        policy_version: GATE_LEAK_CHURN_POLICY_V1.version,
        community_ref: command.community_ref,
        version_effective_times: [],
      }),
      "MappingChurnWindowInvalidError",
    );
    expect(replayFailure).toMatchObject({
      reason_code: "mapping_churn_window_invalid",
    });
  });

  it("scope mismatch: a command for another community/guild cannot touch this aggregate", () => {
    const command = ratifyCommandOf(mibera.ratify_command);
    expectEffectFailureTag(
      ratifyGateMapping(seedOf(acme), command),
      "MappingScopeMismatchError",
    );
  });

  it("inferred mappings are hypotheses: never a ratified version, never readiness", () => {
    const hypothesis = expectEffectSuccess(
      decodeGateMappingHypothesis({
        schema_version: 1,
        provenance: "inferred",
        community_ref: "mibera",
        guild_ref: "200000000000000001",
        collection_id: seedOf(mibera).collection_id,
        role_ids: ["300000000000000001"],
        inferred_from: "role-name similarity (recorded stand-in)",
        observed_at: "2026-07-16T00:00:00Z",
      }),
    );
    expect(hypothesis.provenance).toBe("inferred");
    // The ratified-version schema refuses inferred provenance outright.
    expectEffectFailureTag(
      decodeGateMappingVersion(readFixture("malformed/mapping-version-inferred.invalid.json")),
      "ParseError",
    );
    // An aggregate with no ratified version reports gate_mapping_not_ratified.
    expect(mappingSatisfiesReadiness(seedOf(mibera))).toStrictEqual({
      ready: false,
      reason_code: "gate_mapping_not_ratified",
    });
  });

  it("refuses every recorded unsupported legacy rule with unsupported_gate_rule", () => {
    const rules = sol.unsupported_legacy_rules;
    if (!Array.isArray(rules)) throw new Error("expected recorded unsupported rules");
    expect(rules.length).toBeGreaterThanOrEqual(3);
    for (const rule of rules) {
      const failure = expectEffectFailureTag(admitGateRule(rule), "UnsupportedGateRuleError");
      expect(failure).toMatchObject({ reason_code: "unsupported_gate_rule" });
    }
  });

  it("enforces the 10-per-24h distinct-collection order churn limit", () => {
    const times = Array.from({ length: 10 }, (_, index) => `2026-07-16T0${Math.min(index, 9)}:1${index}:00Z`);
    expect(
      evaluateGateLeakOrderChurn(times, "2026-07-16T10:00:00Z"),
    ).toStrictEqual({ admitted: false, reason_code: "report_churn_limit_exceeded" });
    expect(evaluateGateLeakOrderChurn(times.slice(0, 9), "2026-07-16T10:00:00Z")).toStrictEqual({
      admitted: true,
    });
    expect(
      evaluateGateLeakOrderChurn(times, "2026-07-17T12:00:00Z"),
    ).toStrictEqual({ admitted: true });
    const futureTimes = Array.from(
      { length: 10 },
      (_, index) => `2026-07-17T0${Math.min(index, 9)}:00:00Z`,
    );
    expect(
      evaluateGateLeakOrderChurn(futureTimes, "2026-07-16T10:00:00Z"),
    ).toStrictEqual({ admitted: true });
  });

  it("config digest is deterministic and reproducible from the command material", () => {
    const command = ratifyCommandOf(mibera.ratify_command);
    const version = expectEffectSuccess(
      decodeGateMappingVersion(mibera.ratified_version),
    );
    const recomputed = expectEffectSuccess(computeGateMappingConfigDigest(command));
    expect(recomputed).toStrictEqual(version.config_digest);
    // Different role set, different config digest — no silent aliasing.
    const other = expectEffectSuccess(
      computeGateMappingConfigDigest({ ...command, role_ids: ["300000000000000999"] }),
    );
    expect(other.digest).not.toBe(version.config_digest.digest);
    // Sanity: config digests live in their own domain, distinct from evidence.
    const foreign = expectEffectSuccess(
      digestVersioned("gate-leak.evidence", 1, { any: "material" }),
    );
    expect(foreign.domain).not.toBe(version.config_digest.domain);
  });

  it("idempotency binds the exact command digest: same command replays; any field change conflicts", () => {
    const seed = seedOf(mibera);
    const command = ratifyCommandOf(mibera.ratify_command);
    const first = expectEffectSuccess(ratifyGateMapping(seed, command));
    expect(first.version.command_digest.domain).toBe("gate-leak.mapping-command");
    expect(first.version.command_digest).toStrictEqual(
      expectEffectSuccess(computeGateMappingCommandDigest(command)),
    );

    // Permission-order permutation of the SAME logical command digests identically.
    const twoPerms: RatifyGateMappingCommand = {
      ...command,
      ratifier_permissions: ["gate-config:ratify", "privacy:approve-gate-audit"],
    };
    expect(
      expectEffectSuccess(computeGateMappingCommandDigest(twoPerms)).digest,
    ).toBe(
      expectEffectSuccess(
        computeGateMappingCommandDigest({
          ...twoPerms,
          ratifier_permissions: ["privacy:approve-gate-audit", "gate-config:ratify"],
        }),
      ).digest,
    );

    // Exact replay of the recorded command is idempotent.
    const replay = expectEffectSuccess(ratifyGateMapping(first.aggregate, command));
    expect(replay.idempotent_replay).toBe(true);
    expect(replay.version.mapping_version_id).toStrictEqual(
      first.version.mapping_version_id,
    );

    const conflictProbes: ReadonlyArray<RatifyGateMappingCommand> = [
      { ...command, role_ids: ["300000000000000999"] },
      {
        ...command,
        deployment_set_digest: {
          ...command.deployment_set_digest,
          digest: "a".repeat(64),
        },
      },
      {
        ...command,
        identity_reveal_basis: { schema_version: 1, kind: "pending" },
      },
      {
        ...command,
        expected_aggregate_version: command.expected_aggregate_version + 1,
      },
      { ...command, effective_at: "2026-07-16T00:00:01Z" },
      { ...command, ratifier_subject: "op:other" },
    ];
    for (const conflicted of conflictProbes) {
      const failure = expectEffectFailureTag(
        ratifyGateMapping(first.aggregate, conflicted),
        "IdempotencyConflictError",
      );
      if (!Predicate.isTagged(failure, "IdempotencyConflictError")) {
        throw new Error("expected IdempotencyConflictError");
      }
      expect(failure).toMatchObject({
        idempotency_key: command.idempotency_key,
        stored_mapping_version_id: first.version.mapping_version_id.digest,
        stored_command_digest: first.version.command_digest.digest,
      });
      expect(failure.submitted_command_digest).not.toBe(
        first.version.command_digest.digest,
      );
    }
    // Stored mapping remains unchanged across every conflict probe.
    expect(first.aggregate.versions).toHaveLength(1);
  });
});
