/**
 * Registry declaration tests · ordering zone (fulfillment-surface S2-T5, FR-9/9a).
 *
 * The `ordering` module is declared in registry.yaml (the "inks the chalk" keystone,
 * transmission.md): visible to list/census, doctor-clean (beacon deferred — same
 * convention as ledger-api), deployment_url = the S1-T0 pinned Railway URL.
 * Probe-classification semantics (FR-9a: 200 → ok, timeout → not-ok) are pinned
 * against doctor's OWN taxonomy via its injectable fetcher.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadRegistry } from "@freeside/freeside-registry";
import { listModules } from "../src/verbs/list.js";
import { doctor, probeBeacon, type BeaconFetcher } from "../src/verbs/doctor.js";

test("registry: ordering module declared with deployed Railway URL", () => {
  const registry = loadRegistry();
  const entry = registry.modules["ordering"];
  assert.ok(entry, "ordering module missing from registry.yaml");
  assert.equal(entry.deployment_url, "https://ordering-service-production.up.railway.app");
  assert.equal(entry.runtime_state, "deployed");
  assert.equal(entry.visibility, "internal");
  assert.match(entry.notes ?? "", /healthz/i, "notes must document the health probe contract (FR-9a)");
});

test("list: ordering appears in the module listing (G-3)", () => {
  const out = listModules();
  assert.ok(out.modules.some((m) => m.slug === "ordering"));
});

test("doctor: ordering entry is processed and contributes NO error (doctor stays green)", async () => {
  const report = await doctor({});
  const orderingFindings = report.findings.filter((f) => f.slug === "ordering");
  assert.ok(orderingFindings.length > 0, "doctor must process the ordering entry");
  assert.ok(
    !orderingFindings.some((f) => f.severity === "error"),
    `ordering entry must not break doctor: ${JSON.stringify(orderingFindings)}`,
  );
});

const ORDERING_BEACON_URL = "https://ordering.0xhoneyjar.xyz/.well-known/beacon.json";

test("probe classification (FR-9a): mocked 200 healthy response → probe status 200, host-pinned", async () => {
  const fetcher: BeaconFetcher = async (url: string) => ({ status: 200, finalUrl: url, body: "{}" });
  const probe = await probeBeacon("ordering", ORDERING_BEACON_URL, fetcher);
  assert.equal(probe.status, 200);
  assert.equal(probe.redirectedOff, false);
});

test("probe classification (FR-9a): mocked timeout/refused → status 0 transport failure", async () => {
  const fetcher: BeaconFetcher = async (url: string) => ({ status: 0, finalUrl: url, body: "", error: "timeout" });
  const probe = await probeBeacon("ordering", ORDERING_BEACON_URL, fetcher);
  assert.equal(probe.status, 0);
  assert.equal(probe.bodyValid, false);
  assert.equal(probe.error, "timeout");
});
