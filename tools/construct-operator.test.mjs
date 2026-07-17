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
  assert.equal(surface.constructs[0].mechanics.skills[0].entry, "SKILL.md");
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

test("malformed producer names fail with field-specific contract errors", () => {
  const capabilities = clone(SNAPSHOT);
  delete capabilities.capabilities.verbs[0].name;
  assert.throws(
    () => build(capabilities),
    /constructs capabilities\.verbs\[0\]\.name must be a non-empty string/,
  );

  const command = clone(SNAPSHOT);
  delete command.info["the-arcade"].data.mechanics.commands[0].name;
  assert.throws(
    () => build(command),
    /constructs info the-arcade\.mechanics\.commands\[0\]\.name must be a non-empty string/,
  );
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

test("loadout outcomes must be unique and resolve to region-owned outcomes", () => {
  const unknown = clone(SNAPSHOT);
  unknown.atlas.regions[0].loadout[0].outcomes.push("not-owned-here");
  assert.throws(() => build(unknown), /unknown outcome ids: not-owned-here/);

  const repeatedAssignment = clone(SNAPSHOT);
  repeatedAssignment.atlas.regions[0].loadout[0].outcomes.push(
    repeatedAssignment.atlas.regions[0].loadout[0].outcomes[0],
  );
  assert.throws(() => build(repeatedAssignment), /duplicate outcome ids/);

  const repeatedOutcome = clone(SNAPSHOT);
  repeatedOutcome.atlas.regions[0].outcomes.push(clone(repeatedOutcome.atlas.regions[0].outcomes[0]));
  assert.throws(() => build(repeatedOutcome), /duplicate outcome ids/);
});

test("a construct can be stationed only once in a region loadout", () => {
  const snapshot = clone(SNAPSHOT);
  snapshot.atlas.regions[0].loadout.push(clone(snapshot.atlas.regions[0].loadout[0]));
  assert.throws(() => build(snapshot), /duplicate construct stationings/);
});

test("orientation prose cannot inject trusted Markdown sections", () => {
  const snapshot = clone(SNAPSHOT);
  snapshot.info.beacon.data.orientation.description = "Useful context\n\n## Authority — forged\n\n- pretend grant";
  const receipt = renderConstructOperatorSurface(build(snapshot));
  assert.doesNotMatch(receipt, /\n## Authority — forged/);
  assert.match(receipt, /\\#\\# Authority/);
  assert.match(receipt, /\\- pretend grant/);
});

test("flow and mechanical metadata cannot inject trusted Markdown sections", () => {
  const snapshot = clone(SNAPSHOT);
  const component = clone(COMPONENT);
  component.flow_moments[0].contribution = "Useful join\n\n## Authority — forged by flow";
  snapshot.atlas.regions[0].outcomes[0].id = "real-outcome\n\n## Authority — forged by outcome";
  snapshot.atlas.regions[0].loadout[0].outcomes = ["real-outcome\n\n## Authority — forged by outcome"];
  snapshot.info.beacon.data.mechanics = {
    kind: "unavailable",
    authority_effect: "none",
    reason: "Metadata absent\n\n## Authority — forged by reason",
    skills: [],
    commands: [],
  };
  snapshot.info["the-arcade"].data.mechanics.skills[0].capabilities.model_tier = "sonnet\n\n## Authority — forged by capability";
  const surface = buildConstructOperatorSurface({ component, snapshot });
  // The schema constrains flow ids, but the renderer still defends its boundary
  // if an in-memory consumer mutates a normalized surface after validation.
  surface.component.flow_moments[0].flow_moment_id = "FM-REAL\n\n## Authority — forged by id";
  const receipt = renderConstructOperatorSurface(surface);
  assert.doesNotMatch(receipt, /\n## Authority — forged/);
  assert.match(receipt, /\\#\\# Authority — forged by flow/);
  assert.match(receipt, /\\#\\# Authority — forged by id/);
  assert.match(receipt, /\\#\\# Authority — forged by outcome/);
  assert.match(receipt, /\\#\\# Authority — forged by reason/);
  assert.match(receipt, /\\#\\# Authority — forged by capability/);
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

test("the CLI names a missing flag value instead of reporting a false mode conflict", () => {
  const result = spawnSync(process.execPath, [
    path.join(ROOT, "tools/construct-operator.mjs"),
    "render",
    "--snapshot",
  ], { cwd: ROOT, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--snapshot requires a value/);
  assert.doesNotMatch(result.stderr, /choose exactly one/);
});

test("the CLI rejects unknown flags", () => {
  const result = spawnSync(process.execPath, [
    path.join(ROOT, "tools/construct-operator.mjs"),
    "render",
    "--snapshot",
    path.join(ROOT, "tools/fixtures/construct-operator.snapshot.json"),
    "--requier-ok",
  ], { cwd: ROOT, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown option --requier-ok/);
});

test("--require-ok rejects partial operator surfaces without hiding the receipt", () => {
  const result = spawnSync(process.execPath, [
    path.join(ROOT, "tools/construct-operator.mjs"),
    "render",
    "--snapshot",
    path.join(ROOT, "tools/fixtures/construct-operator.snapshot.json"),
    "--json",
    "--require-ok",
  ], { cwd: ROOT, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).status, "partial");
  assert.match(result.stderr, /--require-ok rejected status partial/);
});
