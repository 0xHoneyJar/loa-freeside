/**
 * freeside-cli verb tests — doctor / inspect / list.
 *
 * All network is stubbed via the injectable `fetchBeacon` dep and registry
 * via the `registry` dep, so these are pure + offline.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { doctor } from "../src/verbs/doctor.js";
import { inspectModule } from "../src/verbs/inspect.js";
import { listModules } from "../src/verbs/list.js";
import type { Registry } from "@freeside/freeside-registry";

// ── stub builders ──────────────────────────────────────────────────────────

const entry = (overrides: Record<string, unknown> = {}) => ({
  git_url: "https://github.com/0xHoneyJar/sonar-api.git",
  beacon_url: "https://sonar.0xhoneyjar.xyz/.well-known/beacon.json",
  visibility: "public",
  owner: "0xHoneyJar",
  added: "2026-05-18",
  ...overrides,
});

const reg = (modules: Record<string, unknown>): Registry =>
  ({ version: 1, modules }) as unknown as Registry;

const validBeacon = (slug: string, extra: Record<string, unknown> = {}) => ({
  schema_version: "3",
  slug,
  publisher: "0xHoneyJar",
  is: { one_liner: "Test building one-liner", scope: ["does a", "does b"] },
  is_not: ["Does NOT do x", "Will NOT do y"],
  cycle_state: {
    status: "candidate",
    since: "2026-05-18",
    next_review: "2026-08-18",
  },
  ...extra,
});

const NOW = new Date("2026-06-01T00:00:00Z");

// ── doctor ───────────────────────────────────────────────────────────────

test("doctor: valid beacon → ok, no errors", async () => {
  const report = await doctor({
    registry: reg({ "sonar-api": entry() }),
    fetchBeacon: async () => validBeacon("sonar-api"),
    now: NOW,
  });
  assert.equal(report.summary.error, 0);
  assert.equal(report.summary.ok, 1);
  assert.equal(report.modules_checked, 1);
});

test("doctor: unreachable beacon → warn (not deployed yet)", async () => {
  const report = await doctor({
    registry: reg({ "sonar-api": entry() }),
    fetchBeacon: async () => null,
    now: NOW,
  });
  assert.equal(report.summary.error, 0);
  assert.ok(report.findings.some((f) => f.check === "beacon_fetch" && f.severity === "warn"));
});

test("doctor: malformed beacon → error (validation)", async () => {
  const report = await doctor({
    registry: reg({ "sonar-api": entry() }),
    fetchBeacon: async () => ({ not: "a beacon" }),
    now: NOW,
  });
  assert.ok(report.summary.error >= 1);
  assert.ok(report.findings.some((f) => f.check === "beacon_validate"));
});

test("doctor: beacon slug != registry slug → error", async () => {
  const report = await doctor({
    registry: reg({ "sonar-api": entry() }),
    fetchBeacon: async () => validBeacon("storage-api"),
    now: NOW,
  });
  assert.ok(report.findings.some((f) => f.check === "slug_match" && f.severity === "error"));
});

test("doctor: rename:done but git_url basename != slug → warn", async () => {
  const report = await doctor({
    registry: reg({
      "storage-api": entry({
        git_url: "https://github.com/0xHoneyJar/freeside-storage.git",
        rename: "done",
      }),
    }),
    fetchBeacon: async () => validBeacon("storage-api"),
    now: NOW,
  });
  assert.ok(report.findings.some((f) => f.check === "rename_reconcile" && f.severity === "warn"));
});

test("doctor: non-*-api registry slug → error (convention)", async () => {
  const report = await doctor({
    registry: reg({ sonar: entry() }),
    fetchBeacon: async () => null, // isolate the slug check
    now: NOW,
  });
  assert.ok(report.findings.some((f) => f.check === "slug_convention" && f.severity === "error"));
});

test("doctor: next_review > 180d after since → warn", async () => {
  const report = await doctor({
    registry: reg({ "sonar-api": entry() }),
    fetchBeacon: async () =>
      validBeacon("sonar-api", {
        cycle_state: { status: "candidate", since: "2026-01-01", next_review: "2026-12-31" },
      }),
    now: NOW,
  });
  assert.ok(report.findings.some((f) => f.check === "review_window" && f.severity === "warn"));
});

// ── inspect ────────────────────────────────────────────────────────────────

test("inspect: valid beacon → status valid + parsed beacon", async () => {
  const out = await inspectModule("sonar-api", {
    registry: reg({ "sonar-api": entry() }),
    fetchBeacon: async () => validBeacon("sonar-api"),
  });
  assert.equal(out.status, "valid");
  assert.equal(out.beacon?.slug, "sonar-api");
});

test("inspect: unreachable → status unreachable", async () => {
  const out = await inspectModule("sonar-api", {
    registry: reg({ "sonar-api": entry() }),
    fetchBeacon: async () => null,
  });
  assert.equal(out.status, "unreachable");
  assert.equal(out.beacon, undefined);
});

test("inspect: unknown slug → throws", async () => {
  await assert.rejects(() => inspectModule("nope-api", { registry: reg({}) }));
});

// ── list ─────────────────────────────────────────────────────────────────

test("list: surfaces slug + rename status from the registry", () => {
  const out = listModules({
    registry: reg({ "storage-api": entry({ rename: "pending" }) }),
  });
  assert.equal(out.modules.length, 1);
  assert.equal(out.modules[0].slug, "storage-api");
  assert.equal(out.modules[0].rename, "pending");
});
