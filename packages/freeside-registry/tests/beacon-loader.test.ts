/**
 * Unit tests · @freeside/freeside-registry beacon-loader + ModuleEntry (sprint-400 T3)
 *
 * Covers the RECOVERED loader (verbatim from the orphaned dist) — path hardening
 * (R-1 traversal rejection), decode-attempt classification, and the OD-1 additive
 * ModuleEntry fields (beacon_fixture / deployment_url / runtime_state / notes).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadRegistry,
  loadBeacon,
  resolveFixturePath,
  classifyBeacon,
} from "../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY_ROOT = join(__dirname, ".."); // packages/freeside-registry

// ─── ModuleEntry OD-1 additive fields ──────────────────────────────────────

test("loadRegistry decodes registry.yaml and KEEPS the OD-1 metadata fields", () => {
  const reg = loadRegistry();
  const slugs = Object.keys(reg.modules);
  assert.ok(slugs.length >= 8, `expected >=8 modules, got ${slugs.length}`);
  const activities = reg.modules["activities-api"];
  assert.equal(activities.runtime_state, "not-built");
  assert.equal(activities.deployment_url, null); // YAML `~`
  assert.ok(typeof activities.notes === "string" && activities.notes.length > 0);
  const sonar = reg.modules["sonar-api"];
  assert.equal(sonar.runtime_state, "deployed");
});

// ─── R-1: path-traversal rejection (the security-critical leg) ──────────────

test("resolveFixturePath rejects '..' traversal BEFORE any fs access (R-1)", () => {
  assert.throws(
    () => resolveFixturePath(REGISTRY_ROOT, "../../../etc/passwd"),
    /traversal rejected/,
  );
});

test("resolveFixturePath resolves an in-package fixture path", () => {
  const p = resolveFixturePath(REGISTRY_ROOT, "tests/fixtures/sample-beacon-v3.yaml");
  assert.ok(p.endsWith("tests/fixtures/sample-beacon-v3.yaml"));
});

// ─── decode-attempt classification (DEVIATION D-S2-1) ───────────────────────

test("loadBeacon with beacon_fixture → kind 'v3' (try-V3-then-V2 classify)", () => {
  const res = loadBeacon(
    { beacon_fixture: "tests/fixtures/sample-beacon-v3.yaml", beacon_url: "unused" },
    REGISTRY_ROOT,
  );
  assert.equal(res.kind, "v3", `expected v3, got ${res.kind === "error" ? res.error : res.kind}`);
});

test("loadBeacon with no beacon_fixture → kind 'error' (remote fetch out of scope, SC-6)", () => {
  const res = loadBeacon({ beacon_url: "https://x.0xhoneyjar.xyz/.well-known/beacon.json" });
  assert.equal(res.kind, "error");
  if (res.kind === "error") assert.ok(/not implemented/.test(res.error));
});

test("loadBeacon with a traversal beacon_fixture → kind 'error' (no throw)", () => {
  const res = loadBeacon({ beacon_fixture: "../../secret.yaml", beacon_url: "x" }, REGISTRY_ROOT);
  assert.equal(res.kind, "error");
  if (res.kind === "error") assert.ok(/traversal rejected/.test(res.error));
});

test("classifyBeacon(malformed) → kind 'error' (neither V3 nor V2)", () => {
  const res = classifyBeacon({ not: "a beacon", random: 42 });
  assert.equal(res.kind, "error");
  if (res.kind === "error") assert.ok(/neither BeaconV3 nor BeaconV2/.test(res.error));
});
