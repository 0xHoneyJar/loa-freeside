/**
 * ADR-012 Phase 0 · real-registry decode test (cadence-ledger sprint-410, task 1.4)
 *
 * Decodes the REAL registry.yaml through the shared production schema and pins
 * the cadence-ledger invariants: provenance on every service block, sonar's
 * chain-lag entry, and the score-api 302 anti-transcription tripwire.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadRegistry } from "../src/registry.js";

const registry = loadRegistry(); // default path = the real registry.yaml

test("the real registry.yaml full-decodes through the shared schema", () => {
  assert.equal(registry.version, 1); // D-11: no version bump
  assert.ok(Object.keys(registry.modules).length >= 11);
});

test("every service block carries probed_at + probe_source provenance (NFR-5)", () => {
  const declared = Object.entries(registry.modules).filter(([, e]) => e.service);
  assert.ok(declared.length >= 7, `expected ≥7 declared cells, got ${declared.length}`);
  for (const [slug, e] of declared) {
    assert.match(e.service!.probed_at, /^\d{4}-\d{2}-\d{2}$/, `${slug} missing probed_at`);
    assert.ok(e.service!.probe_source, `${slug} missing probe_source`);
  }
});

test("derive-from-absence cells have NO service block (D-7)", () => {
  for (const slug of ["mint-api", "events-api", "mediums-api", "ledger-api"]) {
    assert.equal(registry.modules[slug]?.service, undefined, `${slug} must stay blockless`);
  }
});

test("sonar-api declares the chain-lag expectation with all six SCALE.md threshold keys (G-3)", () => {
  const exps = registry.modules["sonar-api"]?.expectations;
  assert.ok(exps && exps.length >= 1, "sonar-api must carry ≥1 expectations entry");
  const chainLag = exps.find((x) => x.ref === "chain-lag");
  assert.ok(chainLag, "sonar-api/chain-lag missing");
  assert.equal(chainLag.probe_kind, "graphql-lag");
  if (chainLag.probe_kind === "graphql-lag") {
    const keys = Object.keys(chainLag.expect.thresholds).sort();
    assert.deepEqual(keys, ["1", "10", "42161", "7777777", "80094", "8453"]);
    assert.equal(chainLag.expect.thresholds["80094"], 300); // Berachain strictest SLO
  }
});

test("score-api anti-transcription tripwire: the 302 is never encoded (G-2)", () => {
  const svc = registry.modules["score-api"]?.service;
  assert.ok(svc, "score-api must declare a service block");
  // The failure mode ADR-012 flags DO-NOT-TRANSCRIBE: encoding `/` + 302.
  assert.ok(
    !(svc.health_path === "/" && svc.expected_status === 302),
    "score-api service block transcribed the 302 redirect — resolve the real health path (ADR-012 appendix flag)",
  );
  assert.notEqual(svc.expected_status, 302, "expected_status 302 is a redirect, not a health contract");
});

test("declared service blocks match their entry-level deployment_url (D-6)", () => {
  for (const [slug, e] of Object.entries(registry.modules)) {
    if (e.service && e.deployment_url != null) {
      assert.equal(
        e.service.deployment_url,
        e.deployment_url,
        `${slug}: service.deployment_url drifted from entry-level deployment_url`,
      );
    }
  }
});
