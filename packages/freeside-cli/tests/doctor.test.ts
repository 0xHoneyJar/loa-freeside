/**
 * Unit + CLI tests · freeside-cli doctor (sprint-400 T4)
 *
 * Pure helpers tested inline (variants built by spreading a decoded base beacon
 * — `loadBeacon` does the YAML parse, so the test needs no yaml dep). doctor()
 * integration + the built-CLI exit-code smoke cover G-1/G-2/G-6/G-7.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBeacon, loadRegistry } from "@freeside/freeside-registry";
import type { BeaconV3 } from "@freeside/beacon-schema";
import {
  doctor,
  checkCycleState,
  checkComposesWith,
  checkSealedSchemas,
  recomputeSealedHash,
  readAllowlist,
} from "../src/verbs/doctor.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "fixtures");
const CLI = join(__dirname, "..", "dist", "bin", "freeside-cli.js");
const NOW = new Date("2026-06-01T00:00:00Z");

// decoded base BeaconV3 (loadBeacon parses the YAML — no yaml dep needed here)
const base: BeaconV3 = (() => {
  const r = loadBeacon({ beacon_fixture: "base-v3.yaml", beacon_url: "" }, FIXTURES);
  if (r.kind !== "v3") throw new Error(`base-v3 fixture did not decode as v3: ${r.kind === "error" ? r.error : r.kind}`);
  return r.beacon;
})();
const variant = (over: Record<string, unknown>): BeaconV3 =>
  ({ ...base, ...over } as unknown as BeaconV3);

// ─── checkCycleState ────────────────────────────────────────────────────────

test("checkCycleState · next_review in the past → cycle_review_overdue warn", () => {
  const b = variant({ cycle_state: { status: "active", since: "2026-01-01", next_review: "2026-02-01" } });
  const f = checkCycleState("x", b, NOW);
  assert.ok(f.some((x) => x.check === "cycle_review_overdue" && x.severity === "warn"));
});

test("checkCycleState · review window > 180d → cycle_review_window_exceeded error", () => {
  const b = variant({ cycle_state: { status: "active", since: "2026-01-01", next_review: "2026-12-01" } });
  const f = checkCycleState("x", b, NOW);
  assert.ok(f.some((x) => x.check === "cycle_review_window_exceeded" && x.severity === "error"));
});

test("checkCycleState · fresh + in-window → no findings", () => {
  const b = variant({ cycle_state: { status: "candidate", since: "2026-05-18", next_review: "2026-08-18" } });
  assert.equal(checkCycleState("x", b, NOW).length, 0);
});

// ─── checkComposesWith ──────────────────────────────────────────────────────

test("checkComposesWith · key not a registry slug → compose_unknown_sibling error", () => {
  // base-v3 composes_with freeside-sonar/freeside-storage — NOT slugs in the test registry
  const reg = loadRegistry(join(FIXTURES, "registry-fixture.yaml"));
  const f = checkComposesWith("x", base, reg);
  const unknown = f.filter((x) => x.check === "compose_unknown_sibling" && x.severity === "error");
  assert.ok(unknown.length >= 1, "expected at least one unknown-sibling error");
});

test("checkComposesWith · key IS a registry slug → tag_hash_unverified warn (OD-2)", () => {
  const reg = loadRegistry(join(FIXTURES, "registry-fixture.yaml"));
  const b = variant({ composes_with: { "good-api": { role: "r", tag: "P@1.0.0+a1b2c3d4", required: false } } });
  const f = checkComposesWith("x", b, reg);
  assert.ok(f.some((x) => x.check === "tag_hash_unverified" && x.severity === "warn"));
  assert.ok(!f.some((x) => x.check === "compose_unknown_sibling"));
});

// ─── recomputeSealedHash + checkSealedSchemas ───────────────────────────────

test("recomputeSealedHash · canonicalizes key order (JCS) → same hash", () => {
  const a = recomputeSealedHash('{"b":2,"a":1}');
  const b = recomputeSealedHash('{"a":1,"b":2}');
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{64}$/);
});

test("checkSealedSchemas · all-zeros placeholder hash → sealed_schema_hash_drift error", () => {
  const b = variant({ sealed_schemas: [{ path: "s.json", hash: "0".repeat(64), consumers: [] }] });
  const f = checkSealedSchemas("x", b, () => '{"x":1}');
  assert.ok(f.some((x) => x.check === "sealed_schema_hash_drift" && x.severity === "error"));
});

test("checkSealedSchemas · recomputed hash matches declared → sealed_schema_ok", () => {
  const good = recomputeSealedHash('{"x":1}');
  const b = variant({ sealed_schemas: [{ path: "s.json", hash: good, consumers: [] }] });
  const f = checkSealedSchemas("x", b, (p) => (p === "s.json" ? '{"x":1}' : null));
  assert.ok(f.some((x) => x.check === "sealed_schema_ok" && x.severity === "ok"));
});

test("checkSealedSchemas · declared ≠ recomputed → sealed_schema_hash_drift error", () => {
  const b = variant({ sealed_schemas: [{ path: "s.json", hash: "a".repeat(64), consumers: [] }] });
  const f = checkSealedSchemas("x", b, () => '{"x":1}');
  assert.ok(f.some((x) => x.check === "sealed_schema_hash_drift" && x.severity === "error"));
});

test("checkSealedSchemas · schema unresolvable → sealed_schema_unverified warn", () => {
  const b = variant({ sealed_schemas: [{ path: "s.json", hash: "b".repeat(64), consumers: [] }] });
  const f = checkSealedSchemas("x", b, () => null);
  assert.ok(f.some((x) => x.check === "sealed_schema_unverified" && x.severity === "warn"));
});

// ─── readAllowlist ──────────────────────────────────────────────────────────

test("readAllowlist · parses the flat allowlist shape (slug/id/expires)", () => {
  const dir = mkdtempSync(join(tmpdir(), "doctor-al-"));
  try {
    const p = join(dir, "al.yaml");
    writeFileSync(
      p,
      [
        "# comment",
        "version: 1",
        "allowlist:",
        "  - slug: sonar-api",
        "    id: event_completeness",
        '    expires: "2026-08-30"',
        '    reason: "KF-012 — note with: colons and (parens)"',
        "  - slug: identity-api",
        "    id: audit_replay",
        '    expires: "2026-09-30"',
        "    reason: storage-bound",
      ].join("\n"),
    );
    const al = readAllowlist(p);
    assert.equal(al.length, 2);
    assert.deepEqual(al[0], { slug: "sonar-api", id: "event_completeness", expires: "2026-08-30" });
    assert.equal(al[1].slug, "identity-api");
    assert.equal(al[1].expires, "2026-09-30");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readAllowlist · missing file → empty array (graceful)", () => {
  assert.deepEqual(readAllowlist(join(tmpdir(), "does-not-exist-xyz.yaml")), []);
});

// ─── doctor() integration ───────────────────────────────────────────────────

test("doctor() · audits every module (≥1 finding each) and detects the bad hash", async () => {
  const report = await doctor({
    registryPath: join(FIXTURES, "registry-fixture.yaml"),
    allowlistPath: join(FIXTURES, "no-allowlist.yaml"), // absent → []
    now: NOW,
  });
  assert.equal(report.modules_checked, 2);
  // G-1: each module yields ≥1 finding
  for (const slug of ["good-api", "bad-api"]) {
    assert.ok(report.findings.some((f) => f.slug === slug), `no findings for ${slug}`);
  }
  // G-2: bad-api all-zeros sealed hash → error
  assert.ok(
    report.findings.some((f) => f.slug === "bad-api" && f.check === "sealed_schema_hash_drift" && f.severity === "error"),
  );
  assert.ok(report.summary.error >= 1);
});

test("doctor() · deterministic modulo checked_at (G-7)", async () => {
  const opts = { registryPath: join(FIXTURES, "registry-fixture.yaml"), now: NOW };
  const a = await doctor(opts);
  const b = await doctor(opts);
  const strip = (r: Awaited<ReturnType<typeof doctor>>) => ({ ...r, checked_at: "X" });
  assert.deepEqual(strip(a), strip(b));
});

// ─── built CLI smoke (G-6 exit code) ────────────────────────────────────────

test("CLI · doctor --registry <bad> → exit 1 (sealed_schema_hash_drift)", () => {
  if (!existsSync(CLI)) throw new Error(`CLI not built at ${CLI} — run \`pnpm build\` first`);
  let exitCode = 0;
  try {
    execFileSync("node", [CLI, "doctor", "--registry", join(FIXTURES, "registry-fixture.yaml")], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    exitCode = (e as { status?: number }).status ?? -1;
  }
  assert.equal(exitCode, 1, "expected exit 1 when a module has an error finding");
});
