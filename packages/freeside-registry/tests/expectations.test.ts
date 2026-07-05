/**
 * ADR-012 Phase 0 · expectations[] fixture tests (cadence-ledger sprint-410, task 1.2)
 *
 * Asserts against the SHARED production schema (`_schemas` from src/registry.ts),
 * never a test-local copy — the fixture-tautology guard (sdd.md §8.1).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Schema } from "effect";
import { _schemas } from "../src/registry.js";

const decodeExpectations = Schema.decodeUnknownSync(_schemas.Expectations);
const decodeEntry = Schema.decodeUnknownSync(_schemas.ModuleEntry);

const baseEntry = {
  git_url: "https://github.com/0xHoneyJar/example-api.git",
  beacon_url: null,
  visibility: "public",
  owner: "0xHoneyJar",
  added: "2026-07-04",
};

const httpEntry = {
  probe_kind: "http",
  ref: "edge-health",
  cadence: "15m",
  owner: "zerker",
};

const graphqlLagEntry = {
  probe_kind: "graphql-lag",
  ref: "chain-lag",
  cadence: "15m",
  owner: "zerker",
  target: {
    endpoint: "https://belt-gateway-production.up.railway.app/v1/graphql",
    query: "{ chain_metadata { chain_id latest_processed_block block_height } }",
    rows_path: "data.chain_metadata",
    key: "chain_id",
    minuend: "block_height",
    subtrahend: "latest_processed_block",
  },
  expect: { thresholds: { "80094": 300 } },
};

const eventMaxAgeEntry = {
  probe_kind: "event-max-age",
  ref: "svm-reconcile",
  cadence: "6h",
  owner: "zerker",
  target: {
    endpoint: "https://belt-gateway-production.up.railway.app/v1/graphql",
    query: "{ svm_run_marker { updated_at } }",
    timestamp_path: "data.svm_run_marker.0.updated_at",
  },
  expect: { max_age: "26h" },
};

test("valid http expectation decodes (target/expect optional)", () => {
  const xs = decodeExpectations([httpEntry]);
  assert.equal(xs[0].probe_kind, "http");
});

test("valid graphql-lag expectation decodes", () => {
  const xs = decodeExpectations([graphqlLagEntry]);
  assert.equal(xs[0].probe_kind, "graphql-lag");
});

test("valid event-max-age expectation decodes", () => {
  const xs = decodeExpectations([eventMaxAgeEntry]);
  assert.equal(xs[0].probe_kind, "event-max-age");
});

test("absent expectations array stays valid on ModuleEntry (G-4)", () => {
  const entry = decodeEntry(baseEntry);
  assert.equal(entry.expectations, undefined);
});

test("entry with expectations decodes on ModuleEntry", () => {
  const entry = decodeEntry({
    ...baseEntry,
    expectations: [graphqlLagEntry, eventMaxAgeEntry],
  });
  assert.equal(entry.expectations?.length, 2);
});

// ── CL-410-001: target-less http implies "probe my service block" ──────────

const serviceForHttp = {
  deployment_url: "https://example-api-production.up.railway.app",
  health_path: "/health",
  expected_status: 200,
  auth_class: "none",
  probed_at: "2026-07-05",
  probe_source: "live-probe",
};

test("target-less http expectation WITHOUT a service block fails decode (CL-410-001)", () => {
  assert.throws(
    () => decodeEntry({ ...baseEntry, expectations: [httpEntry] }),
    /requires the cell to declare a service block/,
  );
});

test("target-less http expectation WITH a service block decodes (CL-410-001)", () => {
  const entry = decodeEntry({
    ...baseEntry,
    deployment_url: serviceForHttp.deployment_url,
    service: serviceForHttp,
    expectations: [httpEntry],
  });
  assert.equal(entry.expectations?.[0].probe_kind, "http");
});

test("http expectation with explicit target needs no service block", () => {
  const entry = decodeEntry({
    ...baseEntry,
    expectations: [
      { ...httpEntry, target: { url: "https://status.example.com/up" } },
    ],
  });
  assert.equal(entry.service, undefined);
});

// ── negatives (G-5, FR-3) ───────────────────────────────────────────────────

test("gh-workflow kind fails decode (FR-3: excluded until a consumer exists)", () => {
  assert.throws(() =>
    decodeExpectations([
      {
        probe_kind: "gh-workflow",
        ref: "nightly-run",
        cadence: "1d",
        owner: "zerker",
        target: { workflow: "probe.yml" },
      },
    ]),
  );
});

test("unknown probe_kind fails decode", () => {
  assert.throws(() => decodeExpectations([{ ...httpEntry, probe_kind: "ping" }]));
});

test("missing cadence fails decode", () => {
  const { cadence: _omit, ...rest } = graphqlLagEntry;
  assert.throws(() => decodeExpectations([rest]));
});

test("malformed cadence fails decode", () => {
  assert.throws(() =>
    decodeExpectations([{ ...graphqlLagEntry, cadence: "15 minutes" }]),
  );
});

test("zero-prefixed cadence fails decode", () => {
  assert.throws(() => decodeExpectations([{ ...graphqlLagEntry, cadence: "0h" }]));
});

test("malformed ref (uppercase) fails decode", () => {
  assert.throws(() =>
    decodeExpectations([{ ...graphqlLagEntry, ref: "Chain-Lag" }]),
  );
});

test("empty owner fails decode", () => {
  assert.throws(() => decodeExpectations([{ ...graphqlLagEntry, owner: "" }]));
});

test("duplicate refs within a cell fail decode (D-3 identity)", () => {
  assert.throws(
    () => decodeExpectations([graphqlLagEntry, { ...eventMaxAgeEntry, ref: "chain-lag" }]),
    /unique within a cell/,
  );
});

test("empty thresholds fail decode (D-6 filter #3)", () => {
  assert.throws(
    () =>
      decodeExpectations([
        { ...graphqlLagEntry, expect: { thresholds: {} } },
      ]),
    /at least one key/,
  );
});

test("event-max-age with malformed max_age fails decode", () => {
  assert.throws(() =>
    decodeExpectations([
      { ...eventMaxAgeEntry, expect: { max_age: "twenty-six hours" } },
    ]),
  );
});
