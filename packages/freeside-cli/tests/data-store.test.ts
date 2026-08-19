/**
 * `loa doctor --data` — the datastore-legibility S1 settle gate (SDD C-3).
 * One cell (ordering) legible end-to-end: registry → self-report → classified row.
 * The network is injected (DataStoreFetcher), so the settle gate uses a fixture and
 * never hits a live cell.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  doctorData,
  classifyDataStore,
  parseCellDataStoreFacts,
  renderDataStoreTable,
  dataStoreTokenEnv,
  type DataStoreFetcher,
} from "../src/verbs/doctor.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY = join(__dirname, "fixtures", "registry-datastore-fixture.yaml");

const ORDERING_FACTS = {
  schema_version: "datastore.report.v1",
  engine: "postgres",
  host_fp: "a1b2c3d4e5f60718",
  reachable: true,
  migrations_applied: null,
  store: "postgres",
};

/** A fetcher that serves a fixed body/status regardless of URL (fixture). */
const serve = (status: number, body: string): DataStoreFetcher => async () => ({ status, body });

test("settle gate: ordering is legible end-to-end → one reported row", async () => {
  const report = await doctorData({
    registryPath: REGISTRY,
    dataCells: ["ordering"],
    fetchDataStore: serve(200, JSON.stringify(ORDERING_FACTS)),
  });
  assert.equal(report.schema_version, "datastore.doctor.v1");
  assert.equal(report.rows.length, 1);
  assert.deepEqual(report.rows[0], {
    slug: "ordering",
    engine: "postgres",
    host_fp: "a1b2c3d4e5f60718",
    reachable: true,
    status: "reported",
  });
  assert.equal(report.summary.reported, 1);
  assert.equal(report.summary.unreachable, 0);
});

test("a cell it can't reach → status unreachable (transport failure)", async () => {
  const report = await doctorData({
    registryPath: REGISTRY,
    dataCells: ["ordering"],
    fetchDataStore: serve(0, ""),
  });
  assert.equal(report.rows[0]?.status, "unreachable");
  assert.equal(report.rows[0]?.reachable, false);
  assert.equal(report.summary.unreachable, 1);
});

test("a cell with no deployment_url → status unreported (endpoint absent)", async () => {
  const report = await doctorData({
    registryPath: REGISTRY,
    dataCells: ["no-store-cell"],
    fetchDataStore: serve(200, JSON.stringify(ORDERING_FACTS)), // never called — no endpoint
  });
  assert.equal(report.rows[0]?.status, "unreported");
  assert.equal(report.summary.unreported, 1);
});

test("a reachable host without the route (404) → unreported, not a fabricated row", async () => {
  const report = await doctorData({
    registryPath: REGISTRY,
    dataCells: ["ordering"],
    fetchDataStore: serve(404, "not found"),
  });
  assert.equal(report.rows[0]?.status, "unreported");
  assert.equal(report.rows[0]?.host_fp, null);
});

test("classifyDataStore — the topology matrix (pure)", () => {
  const facts = parseCellDataStoreFacts(JSON.stringify(ORDERING_FACTS));
  assert.equal(classifyDataStore(false, null, null), "unreported"); // no endpoint
  assert.equal(classifyDataStore(true, { status: 0, body: "" }, null), "unreachable"); // transport fail
  assert.equal(classifyDataStore(true, { status: 500, body: "" }, null), "unreachable"); // 5xx
  assert.equal(classifyDataStore(true, { status: 404, body: "" }, null), "unreported"); // no route
  assert.equal(classifyDataStore(true, { status: 200, body: "{}" }, facts), "reported"); // valid
});

test("parseCellDataStoreFacts — validates the datastore.report.v1 shape", () => {
  assert.ok(parseCellDataStoreFacts(JSON.stringify(ORDERING_FACTS)));
  assert.equal(parseCellDataStoreFacts('{"schema_version":"wrong"}'), null);
  assert.equal(parseCellDataStoreFacts("not json"), null);
  assert.equal(parseCellDataStoreFacts(""), null);
});

test("dataStoreTokenEnv — per-cell service-token env name", () => {
  assert.equal(dataStoreTokenEnv("ordering"), "ORDERING_SERVICE_TOKEN");
  assert.equal(dataStoreTokenEnv("shadow-audit"), "SHADOW_AUDIT_SERVICE_TOKEN");
});

test("renderDataStoreTable — terse table surfaces slug + status", async () => {
  const report = await doctorData({
    registryPath: REGISTRY,
    dataCells: ["ordering"],
    fetchDataStore: serve(200, JSON.stringify(ORDERING_FACTS)),
  });
  const table = renderDataStoreTable(report);
  assert.match(table, /ordering/);
  assert.match(table, /reported/);
  assert.match(table, /a1b2c3d4e5f60718/); // host_fp shown
  assert.doesNotMatch(table, /railway\.app/); // no deployment URL leaks into the table
});
