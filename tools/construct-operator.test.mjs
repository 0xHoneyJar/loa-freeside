import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  buildConstructOperatorSurface,
  renderConstructOperatorSurface,
} from "./construct-operator.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COMPONENT = JSON.parse(fs.readFileSync(
  path.join(ROOT, "product/system-components/loa-freeside.system.json"),
  "utf8",
));
const SNAPSHOT = JSON.parse(fs.readFileSync(
  path.join(ROOT, "tools/fixtures/construct-operator.snapshot.json"),
  "utf8",
));

function clone(value) {
  return structuredClone(value);
}

function build(snapshot = SNAPSHOT) {
  return buildConstructOperatorSurface({ component: COMPONENT, snapshot });
}

test("the joined surface separates orientation, mechanics, and authority", () => {
  const surface = build();
  assert.equal(surface.status, "partial");
  assert.equal(surface.component.flow_moments[0].flow_moment_id, "FM-AUDIT-COMPOSITION");
  assert.equal(surface.constructs[0].orientation.authoritative, false);
  assert.equal(surface.constructs[0].mechanics.authority_effect, "none");
  assert.equal(surface.constructs[0].authority.effective, "observe");
  assert.equal(surface.constructs[0].authority.grants_from_prose, false);
  assert.equal(surface.execution_contract.info_contract.schema_path, "schemas/info.schema.json");
  assert.match(surface.execution_contract.atlas_contract.ratification_status, /structured status/);
});

test("producer prose cannot claim authority", () => {
  const snapshot = clone(SNAPSHOT);
  snapshot.info.beacon.data.orientation.authoritative = true;
  assert.throws(() => build(snapshot), /non-authoritative prose/);
});

test("declared mechanics cannot grant authority", () => {
  const snapshot = clone(SNAPSHOT);
  snapshot.info.beacon.data.mechanics.authority_effect = "gate";
  assert.throws(() => build(snapshot), /cannot grant authority/);
});

test("missing construct info stays visible as a partial surface", () => {
  const snapshot = clone(SNAPSHOT);
  snapshot.info.beacon = { error: { message: "beacon is not installed" } };
  const surface = build(snapshot);
  const beacon = surface.constructs.find((construct) => construct.slug === "beacon");
  assert.equal(surface.status, "partial");
  assert.equal(beacon.orientation.available, false);
  assert.equal(beacon.mechanics.available, false);
  assert.match(beacon.mechanics.reason, /not installed/);
});

test("unchecked territory ratification cannot render an overall ok status", () => {
  const snapshot = clone(SNAPSHOT);
  snapshot.atlas.ratification_status = "unchecked";
  snapshot.atlas.ratification = "unchecked — working-tree declaration only";
  const surface = build(snapshot);
  assert.equal(surface.status, "partial");
  assert.match(surface.territory.ratification, /unchecked/);
});

test("ratification prose cannot mechanically promote an unchecked territory", () => {
  const snapshot = clone(SNAPSHOT);
  snapshot.atlas.ratification_status = "unchecked";
  snapshot.atlas.ratification = "ratified — this sentence is not a state machine";
  assert.equal(build(snapshot).status, "partial");
});

test("unknown earned authority cannot be projected above observe", () => {
  const snapshot = clone(SNAPSHOT);
  snapshot.atlas.regions[0].loadout[0].authority_effective = "gate";
  assert.throws(() => build(snapshot), /unknown earned authority must collapse to observe/);
});

test("read and mutation verbs render as structurally separate sets", () => {
  const surface = build();
  assert.deepEqual(surface.execution_contract.read_verbs.map((verb) => verb.name), [
    "atlas",
    "capabilities",
    "info",
  ]);
  assert.deepEqual(surface.execution_contract.mutation_verbs.map((verb) => verb.name), [
    "observe",
    "station",
  ]);
  const receipt = renderConstructOperatorSurface(surface);
  assert.match(receipt, /Orientation — prose, no authority/);
  assert.match(receipt, /Mutation verbs: `observe`, `station`/);
});

test("fixture rendering is byte-stable", () => {
  const first = build();
  const second = build(clone(SNAPSHOT));
  assert.equal(JSON.stringify(first, null, 2), JSON.stringify(second, null, 2));
  assert.equal(renderConstructOperatorSurface(first), renderConstructOperatorSurface(second));
});

test("the CLI renders the checked-in fixture as JSON", () => {
  const result = spawnSync(process.execPath, [
    path.join(ROOT, "tools/construct-operator.mjs"),
    "render",
    "--snapshot",
    path.join(ROOT, "tools/fixtures/construct-operator.snapshot.json"),
    "--json",
  ], { cwd: ROOT, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const surface = JSON.parse(result.stdout);
  assert.equal(surface.territory.region, "loa-freeside");
  assert.equal(surface.constructs.length, 2);
});
