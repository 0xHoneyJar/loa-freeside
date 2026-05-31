/**
 * Unit tests · validateAcvpBindings (sprint-400 T2)
 *
 * Pure core, injected fileExists / resolvePinSchemaVersion / now. Covers the
 * SDD §7.1 fixture matrix + the Flatline-hardened edge cases (FL-B0/HC0/HC1/HC6).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { Effect } from "effect";
import {
  decodeBeaconV3,
  validateAcvpBindings,
  ACVP_L1_SCHEMA_VERSION,
} from "../src/index.js";
import type {
  ValidateAcvpBindingsInput,
  AcvpProofReceipt,
} from "../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// A real decoded BeaconV3 base (everything except acvp_invariants is irrelevant
// to the validator, which only reads beacon.acvp_invariants).
const baseBeacon = (() => {
  const parsed = parse(
    readFileSync(join(__dirname, "fixtures", "freeside-inventory-v3.yaml"), "utf-8"),
  );
  const res = Effect.runSyncExit(decodeBeaconV3(parsed));
  if (res._tag === "Failure") {
    throw new Error(`fixture decode failed: ${JSON.stringify(res.cause)}`);
  }
  return res.value;
})();

const NOW = new Date("2026-06-01T00:00:00Z");

// build an invariant entry with sensible defaults (status active, derived proof path)
const inv = (o: { id: string } & Record<string, unknown>) => ({
  scope: "test scope",
  proof_artifact: `tests/acvp/${o.id}.test.ts`,
  private: false,
  status: "active",
  ...o,
});

function mkInput(
  partial: Partial<ValidateAcvpBindingsInput> & { invariants: unknown[] },
): ValidateAcvpBindingsInput {
  const { invariants, ...rest } = partial;
  return {
    slug: "test-api",
    beacon: { ...baseBeacon, acvp_invariants: invariants } as never,
    moduleRoot: "/tmp/test-api",
    fileExists: () => false,
    eventsPin: null,
    resolvePinSchemaVersion: () => null,
    proofReceipts: null,
    buildingHeadSha: null,
    aspirationalAllowlist: [],
    now: NOW,
    ...rest,
  };
}

const receipt = (o: Partial<AcvpProofReceipt> & { invariant_id: string }): AcvpProofReceipt => ({
  slug: "test-api",
  proof_artifact: `tests/acvp/${o.invariant_id}.test.ts`,
  test_runner: "vitest",
  passed_at: "2026-05-30T00:00:00Z",
  commit_sha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
  ...o,
});

// ─── §7.1 matrix ───────────────────────────────────────────────────────────

test("grounded mediums-style (self-schema + construct-local, proofs exist, no pin) → bound", () => {
  const r = validateAcvpBindings(
    mkInput({
      invariants: [inv({ id: "schema_enforcement" }), inv({ id: "state_machine_totality" })],
      fileExists: () => true,
    }),
  );
  assert.equal(r.contract_status, "bound");
  assert.equal(r.summary.error, 0);
  assert.equal(r.summary.warn, 0);
});

test("dangling sonar-style (proofs absent, status active) → error, broken", () => {
  const r = validateAcvpBindings(
    mkInput({
      invariants: [inv({ id: "event_completeness" }), inv({ id: "monotonicity" })],
      fileExists: () => false,
    }),
  );
  assert.equal(r.contract_status, "broken");
  assert.ok(r.summary.error >= 1);
  assert.ok(r.findings.some((f) => f.check === "acvp_proof:event_completeness" && f.severity === "error"));
});

test("dangling + allowlisted aspirational, pre-expiry → warn, aspirational", () => {
  const r = validateAcvpBindings(
    mkInput({
      invariants: [inv({ id: "event_completeness", status: "aspirational" })],
      fileExists: () => false,
      aspirationalAllowlist: [{ slug: "test-api", id: "event_completeness", expires: "2026-12-31" }],
    }),
  );
  assert.equal(r.contract_status, "aspirational");
  assert.ok(r.summary.warn >= 1);
  assert.equal(r.summary.error, 0);
  assert.ok(r.findings.some((f) => f.aspirational_until === "2026-12-31"));
});

test("aspirational + allowlisted but POST-expiry → error, broken", () => {
  const r = validateAcvpBindings(
    mkInput({
      invariants: [inv({ id: "event_completeness", status: "aspirational" })],
      fileExists: () => false,
      aspirationalAllowlist: [{ slug: "test-api", id: "event_completeness", expires: "2026-01-01" }],
    }),
  );
  assert.equal(r.contract_status, "broken");
  assert.ok(r.findings.some((f) => /EXPIRED/.test(f.message)));
});

test("aspirational NOT in allowlist → error, broken (no silent third option)", () => {
  const r = validateAcvpBindings(
    mkInput({
      invariants: [inv({ id: "event_completeness", status: "aspirational" })],
      fileExists: () => false,
      aspirationalAllowlist: [],
    }),
  );
  assert.equal(r.contract_status, "broken");
  assert.ok(r.findings.some((f) => /NOT in .*allowlist/.test(f.message)));
});

test("hash_chain + no eventsPin (proof exists) → runtime error, broken", () => {
  const r = validateAcvpBindings(
    mkInput({ invariants: [inv({ id: "hash_chain" })], fileExists: () => true, eventsPin: null }),
  );
  assert.equal(r.contract_status, "broken");
  assert.ok(r.findings.some((f) => f.binding === "runtime" && f.severity === "error"));
});

test("hash_chain + eventsPin → acvp-l1-v2 + proof exists → bound", () => {
  const r = validateAcvpBindings(
    mkInput({
      invariants: [inv({ id: "hash_chain" })],
      fileExists: () => true,
      eventsPin: { package: "@freeside/events", sha: "271310a0227510a95eb970b84486efcef0c08888" },
      resolvePinSchemaVersion: () => ACVP_L1_SCHEMA_VERSION,
    }),
  );
  assert.equal(r.contract_status, "bound");
});

test("event_completeness + eventsPin → non-acvp-l1-v2 SHA → runtime error, broken", () => {
  const r = validateAcvpBindings(
    mkInput({
      invariants: [inv({ id: "event_completeness" })],
      fileExists: () => true,
      eventsPin: { package: "@freeside/events", sha: "abc123" },
      resolvePinSchemaVersion: () => "acvp-l1-v1",
    }),
  );
  assert.equal(r.contract_status, "broken");
  assert.ok(r.findings.some((f) => f.binding === "runtime" && /not 'acvp-l1-v2'/.test(f.message)));
});

test("audit_replay + runtime_class:storage, no pin → runtime ok, bound", () => {
  const r = validateAcvpBindings(
    mkInput({
      invariants: [inv({ id: "audit_replay", runtime_class: "storage" })],
      fileExists: () => true,
      eventsPin: null,
    }),
  );
  assert.equal(r.contract_status, "bound");
  assert.ok(r.findings.some((f) => f.binding === "runtime" && f.severity === "ok"));
});

test("audit_replay, no pin, no runtime_class → runtime error (OD default), broken", () => {
  const r = validateAcvpBindings(
    mkInput({ invariants: [inv({ id: "audit_replay" })], fileExists: () => true, eventsPin: null }),
  );
  assert.equal(r.contract_status, "broken");
  assert.ok(r.findings.some((f) => f.binding === "runtime" && f.severity === "error"));
});

test("proof receipt present, head UNKNOWN → warn (aspirational), NOT bound (FAGAN iter-2)", () => {
  const r = validateAcvpBindings(
    mkInput({
      invariants: [inv({ id: "monotonicity" })],
      fileExists: () => false,
      proofReceipts: [receipt({ invariant_id: "monotonicity" })],
      buildingHeadSha: null,
    }),
  );
  // an un-commit-bound (unverifiable) receipt cannot yield `bound` — no silent aspiration
  assert.equal(r.contract_status, "aspirational");
  assert.ok(
    r.findings.some((f) => f.severity === "warn" && /not commit-bound|UNCONFIRMABLE/.test(f.message)),
  );
});

test("proof receipt present, head == commit_sha → fresh, ok", () => {
  const sha = "cafebabecafebabecafebabecafebabecafebabe";
  const r = validateAcvpBindings(
    mkInput({
      invariants: [inv({ id: "monotonicity" })],
      fileExists: () => false,
      proofReceipts: [receipt({ invariant_id: "monotonicity", commit_sha: sha })],
      buildingHeadSha: sha,
    }),
  );
  assert.equal(r.contract_status, "bound");
  assert.ok(r.findings.some((f) => /fresh/.test(f.message)));
});

// ─── FL-B0 restored: checkReceiptFreshness resolver (sprint-400 step 3) ──────

test("receipt + checkReceiptFreshness 'fresh' (proof unchanged since receipt commit) → ok, bound — committed receipt resolves green (FL-B0)", () => {
  const r = validateAcvpBindings(
    mkInput({
      invariants: [inv({ id: "monotonicity" })],
      fileExists: () => false,
      // committed receipt: HEAD has advanced PAST the recorded commit_sha
      proofReceipts: [receipt({ invariant_id: "monotonicity", commit_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" })],
      buildingHeadSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      checkReceiptFreshness: () => "fresh", // CLI git-diff: proof_artifact unchanged since receipt commit
    }),
  );
  assert.equal(r.contract_status, "bound");
  assert.equal(r.summary.error, 0);
  assert.equal(r.summary.warn, 0);
  assert.ok(r.findings.some((f) => f.severity === "ok" && /commit-bound/.test(f.message)));
});

test("receipt + checkReceiptFreshness 'stale' (proof changed since receipt commit) → warn, aspirational", () => {
  const r = validateAcvpBindings(
    mkInput({
      invariants: [inv({ id: "monotonicity" })],
      fileExists: () => false,
      proofReceipts: [receipt({ invariant_id: "monotonicity", commit_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" })],
      buildingHeadSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      checkReceiptFreshness: () => "stale",
    }),
  );
  assert.equal(r.contract_status, "aspirational");
  assert.equal(r.summary.error, 0);
  assert.ok(r.findings.some((f) => f.severity === "warn" && /STALE/.test(f.message)));
});

test("checkReceiptFreshness 'fresh' is IGNORED when buildingHeadSha is null → warn, NOT bound (no pin, no auto-pass — FAGAN composer)", () => {
  let consulted = false;
  const r = validateAcvpBindings(
    mkInput({
      invariants: [inv({ id: "monotonicity" })],
      fileExists: () => false,
      proofReceipts: [receipt({ invariant_id: "monotonicity" })],
      buildingHeadSha: null, // no audited pin → resolver must not be honored
      checkReceiptFreshness: () => {
        consulted = true;
        return "fresh";
      },
    }),
  );
  assert.equal(r.contract_status, "aspirational"); // NOT bound
  assert.equal(consulted, false); // resolver never consulted without a pin
  assert.ok(r.findings.some((f) => f.severity === "warn" && /UNCONFIRMABLE|not commit-bound/.test(f.message)));
});

test("receipt + checkReceiptFreshness 'unknown' → falls back to FAGAN head guard (warn, NOT auto-pass)", () => {
  const r = validateAcvpBindings(
    mkInput({
      invariants: [inv({ id: "monotonicity" })],
      fileExists: () => false,
      proofReceipts: [receipt({ invariant_id: "monotonicity" })],
      buildingHeadSha: null, // unknown → FAGAN guard
      checkReceiptFreshness: () => "unknown",
    }),
  );
  assert.equal(r.contract_status, "aspirational");
  assert.equal(r.summary.error, 0);
  assert.ok(r.findings.some((f) => f.severity === "warn" && /UNCONFIRMABLE|not commit-bound/.test(f.message)));
});

test("exact-HEAD match short-circuits BEFORE the freshness resolver (resolver not consulted)", () => {
  const sha = "cafebabecafebabecafebabecafebabecafebabe";
  let consulted = false;
  const r = validateAcvpBindings(
    mkInput({
      invariants: [inv({ id: "monotonicity" })],
      fileExists: () => false,
      proofReceipts: [receipt({ invariant_id: "monotonicity", commit_sha: sha })],
      buildingHeadSha: sha,
      checkReceiptFreshness: () => {
        consulted = true;
        return "stale";
      },
    }),
  );
  assert.equal(r.contract_status, "bound"); // exact match wins
  assert.equal(consulted, false); // resolver never called — fast path
});

test("hash_chain + eventsPin present but resolver → null → runtime warn (runtime_pin_unresolved), aspirational (FL-HC1)", () => {
  const r = validateAcvpBindings(
    mkInput({
      invariants: [inv({ id: "hash_chain" })],
      fileExists: () => true,
      eventsPin: { package: "@freeside/events", sha: "shallowclone" },
      resolvePinSchemaVersion: () => null,
    }),
  );
  assert.equal(r.contract_status, "aspirational");
  assert.ok(r.summary.warn >= 1);
  assert.equal(r.summary.error, 0);
  assert.ok(r.findings.some((f) => f.binding === "runtime" && f.severity === "warn"));
});

test("proof_artifact with '..' traversal → proof error (path discipline)", () => {
  const r = validateAcvpBindings(
    mkInput({
      invariants: [inv({ id: "monotonicity", proof_artifact: "../../../etc/passwd" })],
      fileExists: () => true,
    }),
  );
  assert.equal(r.contract_status, "broken");
  assert.ok(r.findings.some((f) => /unsafe/.test(f.message)));
});

test("no acvp_invariants → empty findings, bound (vacuously)", () => {
  const r = validateAcvpBindings(mkInput({ invariants: [] }));
  assert.equal(r.contract_status, "bound");
  assert.equal(r.findings.length, 0);
});

// ─── FAGAN fixes ────────────────────────────────────────────────────────────

test("proof receipt for a DIFFERENT slug does NOT satisfy this building (no confused-deputy)", () => {
  const r = validateAcvpBindings(
    mkInput({
      invariants: [inv({ id: "monotonicity" })],
      fileExists: () => false,
      // receipt issued for OTHER-api — same invariant id + proof path, wrong slug
      proofReceipts: [receipt({ invariant_id: "monotonicity", slug: "OTHER-api" })],
      buildingHeadSha: null,
    }),
  );
  assert.equal(r.contract_status, "broken");
  assert.ok(r.findings.some((f) => f.binding === "proof" && f.severity === "error"));
});

test("aspirational + allowlisted with MALFORMED expires → fail-closed (error, treated as expired)", () => {
  const r = validateAcvpBindings(
    mkInput({
      invariants: [inv({ id: "event_completeness", status: "aspirational" })],
      fileExists: () => false,
      aspirationalAllowlist: [{ slug: "test-api", id: "event_completeness", expires: "2026-99-99" }],
    }),
  );
  assert.equal(r.contract_status, "broken");
  assert.ok(r.findings.some((f) => /EXPIRED/.test(f.message)));
});
