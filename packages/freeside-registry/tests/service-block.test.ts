/**
 * ADR-012 Phase 0 · ServiceBlock fixture tests (cadence-ledger sprint-410, task 1.2)
 *
 * Asserts against the SHARED production schema (`_schemas` from src/registry.ts),
 * never a test-local copy — the fixture-tautology guard (sdd.md §8.1).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Schema } from "effect";
import { _schemas } from "../src/registry.js";

const decodeEntry = Schema.decodeUnknownSync(_schemas.ModuleEntry);

const baseEntry = {
  git_url: "https://github.com/0xHoneyJar/example-api.git",
  beacon_url: null,
  visibility: "public",
  owner: "0xHoneyJar",
  added: "2026-07-04",
  deployment_url: "https://example-api-production.up.railway.app",
};

const validService = {
  deployment_url: "https://example-api-production.up.railway.app",
  health_path: "/health",
  expected_status: 200,
  auth_class: "none",
  expected_body_marker: '"service":"example-api"',
  probed_at: "2026-07-05",
  probe_source: "live-probe",
};

test("valid service block decodes", () => {
  const entry = decodeEntry({ ...baseEntry, service: validService });
  assert.equal(entry.service?.health_path, "/health");
  assert.equal(entry.service?.probe_source, "live-probe");
});

test("blockless entry stays valid (G-4: absence is valid forever)", () => {
  const entry = decodeEntry(baseEntry);
  assert.equal(entry.service, undefined);
});

test("expected_body_marker is optional (storage-api serves Playground HTML)", () => {
  const { expected_body_marker: _omit, ...noMarker } = validService;
  const entry = decodeEntry({ ...baseEntry, service: noMarker });
  assert.equal(entry.service?.expected_body_marker, undefined);
});

// ── negatives: each invalid variant fails decode loudly (G-5) ──────────────

const invalidVariants: Record<string, Record<string, unknown>> = {
  "missing deployment_url in-block": (() => {
    const { deployment_url: _omit, ...rest } = validService;
    return rest;
  })(),
  "health_path without leading slash": { ...validService, health_path: "health" },
  "expected_status out of range": { ...validService, expected_status: 42 },
  "non-integer expected_status": { ...validService, expected_status: 200.5 },
  "unknown auth_class": { ...validService, auth_class: "oauth" },
  "missing probed_at provenance": (() => {
    const { probed_at: _omit, ...rest } = validService;
    return rest;
  })(),
  "malformed probed_at": { ...validService, probed_at: "July 5 2026" },
  "missing probe_source provenance": (() => {
    const { probe_source: _omit, ...rest } = validService;
    return rest;
  })(),
  "unknown probe_source": { ...validService, probe_source: "trust-me" },
};

for (const [name, service] of Object.entries(invalidVariants)) {
  test(`invalid service block fails decode: ${name}`, () => {
    assert.throws(() => decodeEntry({ ...baseEntry, service }));
  });
}

test("service.deployment_url ≠ entry deployment_url fails decode (D-6 drift filter)", () => {
  assert.throws(
    () =>
      decodeEntry({
        ...baseEntry,
        deployment_url: "https://example-api-production.up.railway.app",
        service: {
          ...validService,
          deployment_url: "https://example-api-staging.up.railway.app",
        },
      }),
    /deployment_url to be present and equal/,
  );
});

test("service block on a null-URL entry fails decode (C-1: no split-brain with derive-from-absence)", () => {
  assert.throws(
    () =>
      decodeEntry({
        ...baseEntry,
        deployment_url: null,
        service: validService,
      }),
    /deployment_url to be present and equal/,
  );
});

test("service block on an entry with ABSENT deployment_url fails decode (C-1)", () => {
  const { deployment_url: _omit, ...noUrlEntry } = baseEntry;
  assert.throws(
    () => decodeEntry({ ...noUrlEntry, service: validService }),
    /deployment_url to be present and equal/,
  );
});
