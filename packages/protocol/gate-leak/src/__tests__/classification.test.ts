import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { VersionedDigest } from "@freeside/collection-protocol";
import {
  GATE_LEAK_ORDER_REASON_CODES,
  GATE_LEAK_ROW_REASON_CODES,
  GATE_LEAK_SCOPE_STATEMENT,
  GateLeakMeasure,
  GateLeakRow,
  SubjectClassificationInput,
  classifyGateLeakSubject,
  classifyGateLeakSubjects,
  computeGateLeakMeasure,
  coverageBandFloorPercent,
  decodeGateLeakMeasure,
  decodeGateLeakRow,
  decodeGateLeakRows,
  decodeLegacyGateLeakRecord,
  disclosureBand,
  meetsCoverageThreshold,
  migrateLegacyGateLeakRecord,
} from "../index.js";
import {
  expectEffectFailureTag,
  expectEffectSuccess,
  readFixture,
} from "./test-helpers.js";

const GoldenFixture = Schema.Struct({
  description: Schema.String,
  selected_deployment_ids: Schema.Array(VersionedDigest),
  subjects: Schema.Array(SubjectClassificationInput),
  excluded_bot_count: Schema.Number,
  out_of_scope_holders: Schema.optionalWith(
    Schema.Array(
      Schema.Struct({
        wallet: Schema.String,
        holds: Schema.Array(
          Schema.Struct({ deployment_id: VersionedDigest, balance: Schema.String }),
        ),
        note: Schema.String,
      }),
    ),
    { exact: true },
  ),
  expected_rows: Schema.Array(GateLeakRow),
  expected_measure: GateLeakMeasure,
});
const decodeGolden = Schema.decodeUnknown(GoldenFixture, {
  errors: "all",
  onExcessProperty: "error",
});

const golden = expectEffectSuccess(
  decodeGolden(readFixture("golden-classification.valid.json")),
);
const actionable = expectEffectSuccess(
  decodeGolden(readFixture("golden-measure-actionable.valid.json")),
);

describe("gate_leak_compute.v1 golden classification", () => {
  it("reproduces the golden rows deterministically from the published subjects", () => {
    const rows = expectEffectSuccess(
      classifyGateLeakSubjects(golden.subjects, golden.selected_deployment_ids),
    );
    expect(rows).toStrictEqual(golden.expected_rows);
    expectEffectSuccess(decodeGateLeakRows(rows));
  });

  it("golden case 1: a role holder proven to no longer own is the ONLY actionable V1 leak", () => {
    const leak = golden.expected_rows.filter(
      (row) => row.eligibility_state === "proven_ineligible",
    );
    expect(leak).toHaveLength(1);
    const first = leak[0];
    expect(first?.discord_user_id).toBe("400000000000000001");
    expect(first?.reason_code).toBe("proven_zero_balance");
    expect(first?.compared_wallets.length).toBeGreaterThan(0);
    expect(GATE_LEAK_ROW_REASON_CODES.proven_zero_balance.actionable).toBe(true);
  });

  it("golden case 2: unavailable consent is indeterminate, never adverse, never a wallet", () => {
    const row = golden.expected_rows.find(
      (candidate) => candidate.discord_user_id === "400000000000000002",
    );
    expect(row?.eligibility_state).toBe("indeterminate");
    expect(row?.reason_code).toBe("consent_unavailable");
    expect(row?.compared_wallets).toStrictEqual([]);
    expect(GATE_LEAK_ROW_REASON_CODES.consent_unavailable.actionable).toBe(false);
  });

  it("golden case 3: an eligible holder without the role appears NOWHERE — one-directional scope", () => {
    const holders = golden.out_of_scope_holders ?? [];
    expect(holders.length).toBeGreaterThan(0);
    for (const holder of holders) {
      for (const row of golden.expected_rows) {
        expect(row.compared_wallets).not.toContain(holder.wallet);
      }
    }
    // The measure denominator counts exactly the mapped-role cohort.
    expect(golden.expected_rows).toHaveLength(golden.subjects.length);
    expect(GATE_LEAK_SCOPE_STATEMENT.out_of_scope).toContain("lack the Discord role");
  });

  it("missing links, deleted identity, and stale ownership are explicit indeterminate reasons", () => {
    const reasonOf = (id: string) =>
      golden.expected_rows.find((row) => row.discord_user_id === id)?.reason_code;
    expect(reasonOf("400000000000000005")).toBe("identity_link_missing");
    expect(reasonOf("400000000000000006")).toBe("identity_unavailable");
    expect(reasonOf("400000000000000007")).toBe("ownership_evidence_unavailable");
  });

  it("below 80% definitive coverage the actionable band is structurally suppressed", () => {
    const measure = computeGateLeakMeasure(golden.expected_rows, golden.excluded_bot_count);
    expect(measure).toStrictEqual(golden.expected_measure);
    expect(measure.presentation).toBe("insufficient_coverage");
    expect(Object.keys(measure)).not.toContain("actionable_leak_band");
    expect(Object.keys(measure)).not.toContain("coverage_band_floor_percent");
  });

  it("at or above 80% the actionable band carries the rounded-down 10-point coverage band", () => {
    const rows = expectEffectSuccess(
      classifyGateLeakSubjects(actionable.subjects, actionable.selected_deployment_ids),
    );
    expect(rows).toStrictEqual(actionable.expected_rows);
    const measure = computeGateLeakMeasure(rows, actionable.excluded_bot_count);
    expect(measure).toStrictEqual(actionable.expected_measure);
    if (measure.presentation !== "actionable") throw new Error("expected actionable");
    expect(measure.coverage_band_floor_percent).toBe(90);
    expect(measure.actionable_leak_band).toBe("1-9");
    expect(measure.cohort_band).toBe("10-24");
  });

  it("threshold arithmetic is integer-exact at the 80% boundary", () => {
    expect(meetsCoverageThreshold(799, 1000)).toBe(false);
    expect(meetsCoverageThreshold(800, 1000)).toBe(true);
    expect(meetsCoverageThreshold(8, 10)).toBe(true);
    expect(meetsCoverageThreshold(7, 9)).toBe(false);
    expect(meetsCoverageThreshold(0, 0)).toBe(false);
    expect(coverageBandFloorPercent(799, 1000)).toBe(70);
    expect(coverageBandFloorPercent(800, 1000)).toBe(80);
    expect(coverageBandFloorPercent(899, 1000)).toBe(80);
    expect(coverageBandFloorPercent(999, 1000)).toBe(90);
    expect(coverageBandFloorPercent(1000, 1000)).toBe(100);
  });

  it("an exactly-80% cohort presents actionable with the 80 band", () => {
    const rows = expectEffectSuccess(
      classifyGateLeakSubjects(
        actionable.subjects.slice(0, 10),
        actionable.selected_deployment_ids,
      ),
    );
    // Swap one definitive subject for an indeterminate one: 8 of 10 definitive.
    const adjusted = [...rows];
    const definitiveIndex = adjusted.findIndex(
      (row) => row.eligibility_state === "eligible",
    );
    const target = adjusted[definitiveIndex];
    if (target === undefined) throw new Error("expected an eligible row");
    adjusted[definitiveIndex] = {
      ...target,
      eligibility_state: "indeterminate",
      reason_code: "identity_link_missing",
      compared_wallets: [],
    };
    const measure = computeGateLeakMeasure(adjusted, 0);
    if (measure.presentation !== "actionable") throw new Error("expected actionable");
    expect(measure.coverage_band_floor_percent).toBe(80);
  });

  it("an empty cohort presents insufficient coverage with the 0 band", () => {
    const measure = computeGateLeakMeasure([], 3);
    expect(measure.presentation).toBe("insufficient_coverage");
    expect(measure.cohort_band).toBe("0");
    expect(measure.excluded_bot_count).toBe(3);
  });

  it("uses exactly the fixed disclosure bands at their boundaries", () => {
    const cases: ReadonlyArray<readonly [number, string]> = [
      [0, "0"],
      [1, "1-9"],
      [9, "1-9"],
      [10, "10-24"],
      [24, "10-24"],
      [25, "25-49"],
      [49, "25-49"],
      [50, "50-99"],
      [99, "50-99"],
      [100, "100+"],
      [12_345, "100+"],
    ];
    for (const [count, band] of cases) {
      expect(disclosureBand(count), String(count)).toBe(band);
    }
  });

  it("rejects rows outside the allowlist: extra fields, forbidden wallets, missing wallets, unknown reasons", () => {
    for (const name of [
      "malformed/row-excess-property.invalid.json",
      "malformed/row-consent-wallet.invalid.json",
      "malformed/row-eligible-no-wallet.invalid.json",
      "malformed/row-unknown-reason.invalid.json",
    ]) {
      expectEffectFailureTag(decodeGateLeakRow(readFixture(name)), "ParseError");
    }
  });

  it("rejects a measure claiming actionable below the v1 coverage floor", () => {
    expectEffectFailureTag(
      decodeGateLeakMeasure(
        readFixture("malformed/measure-actionable-below-threshold.invalid.json"),
      ),
      "ParseError",
    );
  });

  it("registry invariants: only proven_zero_balance is actionable; indeterminate codes carry no wallets and no adverse inference", () => {
    for (const [code, entry] of Object.entries(GATE_LEAK_ROW_REASON_CODES)) {
      expect(entry.adverse_inference, code).toBe(false);
      expect(entry.actionable, code).toBe(code === "proven_zero_balance");
      if (entry.eligibility_state === "indeterminate") {
        expect(entry.wallets, code).toBe("forbidden");
      }
    }
    for (const [code, entry] of Object.entries(GATE_LEAK_ORDER_REASON_CODES)) {
      expect(entry.safe_public_copy.length, code).toBeGreaterThan(0);
    }
  });
});

describe("vacuous truth is unrepresentable: empty deployment selections refuse", () => {
  const linkedButUnavailable: SubjectClassificationInput = {
    schema_version: 1,
    discord_user_id: "400000000000000042",
    role_id: "300000000000000002",
    identity: {
      kind: "linked",
      wallets: [
        {
          schema_version: 1,
          address: "0x00000000000000000000000000000000000000aa",
          deployments: [
            {
              schema_version: 1,
              deployment_id: {
                algorithm: "sha-256",
                domain: "collection.deployment",
                major_version: 1,
                digest: "c".repeat(64),
              },
              ownership: { kind: "unavailable" },
            },
          ],
        },
      ],
    },
  };

  it("an unavailable wallet can NEVER become proven_ineligible from an empty selection — the call refuses with a tagged error", () => {
    const failure = expectEffectFailureTag(
      classifyGateLeakSubject(linkedButUnavailable, []),
      "EmptyDeploymentSelectionError",
    );
    expect(failure).toMatchObject({ reason_code: "empty_deployment_selection" });
  });

  it("batch classification refuses an empty selection with the same tagged error", () => {
    expectEffectFailureTag(
      classifyGateLeakSubjects(golden.subjects, []),
      "EmptyDeploymentSelectionError",
    );
  });

  it("duplicate and wrong-domain selected deployments refuse instead of skewing the quantifier", () => {
    const [deployment] = golden.selected_deployment_ids;
    if (deployment === undefined) throw new Error("expected a deployment id");
    expectEffectFailureTag(
      classifyGateLeakSubjects(golden.subjects, [deployment, deployment]),
      "InvalidDeploymentSetMemberError",
    );
    expectEffectFailureTag(
      classifyGateLeakSubjects(golden.subjects, [
        { ...deployment, domain: "collection.identity" },
      ]),
      "InvalidDeploymentSetMemberError",
    );
  });

  it("with a valid selection, an unavailable wallet is indeterminate — never proven_ineligible", () => {
    const row = expectEffectSuccess(
      classifyGateLeakSubject(linkedButUnavailable, [
        {
          algorithm: "sha-256",
          domain: "collection.deployment",
          major_version: 1,
          digest: "c".repeat(64),
        },
      ]),
    );
    expect(row.eligibility_state).toBe("indeterminate");
    expect(row.reason_code).toBe("ownership_evidence_unavailable");
    expect(row.compared_wallets).toStrictEqual([]);
  });
});

describe("existing Mibera Gate Leak migration", () => {
  const MigrationEntry = Schema.Struct({
    record: Schema.Unknown,
    expected: Schema.Unknown,
  });
  const decodeMigrationEntries = Schema.decodeUnknown(Schema.Array(MigrationEntry), {
    errors: "all",
    onExcessProperty: "error",
  });
  const Expectation = Schema.Union(
    Schema.Struct({
      in_scope: Schema.Literal(true),
      eligibility_state: Schema.Literal("eligible", "proven_ineligible", "indeterminate"),
      replaces_legacy_leak_treatment: Schema.Boolean,
    }),
    Schema.Struct({
      in_scope: Schema.Literal(false),
      disposition: Schema.Literal("out_of_scope_direction"),
    }),
  );
  const decodeExpectation = Schema.decodeUnknown(Expectation, {
    errors: "all",
    onExcessProperty: "error",
  });

  const LegacyContainer = Schema.Struct({ legacy_parity: Schema.Unknown });
  const decodeLegacyContainer = Schema.decodeUnknown(LegacyContainer);

  it("maps definitive legacy evidence to the same verdicts and replaces missing-authority leaks with indeterminate", () => {
    const container = expectEffectSuccess(
      decodeLegacyContainer(readFixture("community-mibera-recorded.valid.json")),
    );
    const parity = expectEffectSuccess(decodeMigrationEntries(container.legacy_parity));
    expect(parity.length).toBeGreaterThanOrEqual(5);
    let replaced = 0;
    for (const entry of parity) {
      const record = expectEffectSuccess(decodeLegacyGateLeakRecord(entry.record));
      const expected = expectEffectSuccess(decodeExpectation(entry.expected));
      const migrated = migrateLegacyGateLeakRecord(record);
      if (expected.in_scope) {
        if (!migrated.in_scope) throw new Error("expected in-scope migration");
        expect(migrated.eligibility_state).toBe(expected.eligibility_state);
        expect(migrated.replaces_legacy_leak_treatment).toBe(
          expected.replaces_legacy_leak_treatment,
        );
        if (migrated.replaces_legacy_leak_treatment) replaced += 1;
      } else {
        if (migrated.in_scope) throw new Error("expected out-of-scope migration");
        expect(migrated.disposition).toBe("out_of_scope_direction");
      }
    }
    // The intentional contract change is present in the recorded parity set.
    expect(replaced).toBeGreaterThanOrEqual(2);
  });

  it("the legacy promotion direction (holdings without role) is out of scope, not a false negative", () => {
    const migrated = migrateLegacyGateLeakRecord({
      schema_version: 1,
      band: "missing",
      evidence: "definitive",
    });
    expect(migrated).toStrictEqual({
      in_scope: false,
      disposition: "out_of_scope_direction",
    });
  });
});
