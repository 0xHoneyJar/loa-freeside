import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { renderFlowMoment, validateFlowMoment } from "./flow-moment.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXAMPLE = JSON.parse(fs.readFileSync(
  path.join(ROOT, "product/flow-moments/audit-community-composition.flow.json"),
  "utf8",
));
const SYSTEM_EXAMPLE = JSON.parse(fs.readFileSync(
  path.join(ROOT, "product/system-components/loa-freeside.system.json"),
  "utf8",
));
const TODAY = "2026-07-14";

function clone(value) {
  return structuredClone(value);
}

function validate(document) {
  return validateFlowMoment(document, { today: TODAY });
}

test("the Audit community-composition hypothesis is valid but unproven", () => {
  const result = validate(EXAMPLE);
  assert.equal(result.valid, true, result.errors.join("\n"));
  assert.equal(EXAMPLE.hivemind.learning_status, "cant-make-a-conclusion");
  assert.equal(EXAMPLE.exposure.state, "dark");
});

test("the Hivemind label layer remains actionless", () => {
  const document = clone(EXAMPLE);
  document.hivemind.action = "launch-campaign";
  const result = validate(document);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /additional properties|must NOT have additional properties/i);
});

test("exposed research requires a real feature-flag reference", () => {
  const document = clone(EXAMPLE);
  document.exposure.state = "internal";
  const result = validate(document);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /flag_ref/);

  document.exposure.flag_ref = "env:FREESIDE_AUDIT_COMPOSITION";
  const repaired = validate(document);
  assert.equal(repaired.valid, true, repaired.errors.join("\n"));
});

test("default-on research cannot outrun its evidence and operator decision", () => {
  const document = clone(EXAMPLE);
  document.exposure.state = "default-on";
  document.exposure.flag_ref = "env:FREESIDE_AUDIT_COMPOSITION";
  const result = validate(document);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /decision_refs|learning_refs|outcome evidence/);
});

test("evidence confidence claims require observations", () => {
  const document = clone(EXAMPLE);
  document.hivemind.learning_status = "strongly-validated";
  document.evidence_contract.learning_refs = ["github:0xHoneyJar/loa-freeside#learning"];
  const result = validate(document);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /two observations|behavioral and qualitative/);
});

test("references carry a typed provenance scheme", () => {
  const document = clone(EXAMPLE);
  document.decision_refs = ["some issue somebody mentioned"];
  const result = validate(document);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /pattern/);
});

test("typed references reject trailing newlines rather than prefix-matching", () => {
  const document = clone(EXAMPLE);
  document.decision_refs = ["github:0xHoneyJar/loa-freeside#468\n"];
  const result = validate(document);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /pattern/);
});

test("Gold proves reusable maturity and enforces the production floor", () => {
  const document = clone(EXAMPLE);
  document.components = [{
    ref: "component:loa-freeside",
    resolution: "local",
    maturity: "gold",
    intent: "Let a manager inspect the history behind a member classification.",
    feel: "Calm, factual, and compact.",
    inspiration: ["operator-reference:mobbin/clay-people-2026-07-14"],
    rejected: ["Essay-like summary without event provenance."],
    graduation: {
      taste_owner: "Freeside product",
      production_since: "2026-07-10",
      no_regressions: true,
      active_use: true,
      evidence_refs: ["github:0xHoneyJar/freeside-dashboard#111"],
    },
  }];

  const premature = validate(document);
  assert.equal(premature.valid, false);
  assert.match(premature.errors.join("\n"), /requires 14 production days/);

  document.components[0].graduation.production_since = "2026-06-01";
  const mature = validate(document);
  assert.equal(mature.valid, true, mature.errors.join("\n"));
  assert.equal(document.hivemind.learning_status, "cant-make-a-conclusion");
});

test("the Gold clock cannot be bypassed with an impossible as-of date", () => {
  const result = validateFlowMoment(EXAMPLE, { today: "2026-99-99" });
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /real calendar date/);
});

test("Gold maturity uses the record as-of date instead of the wall clock", () => {
  const document = clone(EXAMPLE);
  document.as_of = "2026-07-10";
  document.components = [{
    ref: "component:loa-freeside",
    resolution: "local",
    maturity: "gold",
    intent: "Let a manager inspect the history behind a member classification.",
    feel: "Calm, factual, and compact.",
    inspiration: ["operator-reference:mobbin/clay-people-2026-07-14"],
    rejected: ["Essay-like summary without event provenance."],
    graduation: {
      taste_owner: "Freeside product",
      production_since: "2026-07-01",
      no_regressions: true,
      active_use: true,
      evidence_refs: ["github:0xHoneyJar/freeside-dashboard#111"],
    },
  }];
  const premature = validateFlowMoment(document, { today: "2026-07-15" });
  assert.equal(premature.valid, false);
  assert.match(premature.errors.join("\n"), /requires 14 production days/);

  document.as_of = "2026-07-15";
  const mature = validateFlowMoment(document, { today: "2026-07-15" });
  assert.equal(mature.valid, true, mature.errors.join("\n"));
});

test("a record cannot self-certify maturity against a future as-of date", () => {
  const document = clone(EXAMPLE);
  document.as_of = "2026-07-16";
  const result = validateFlowMoment(document, { today: "2026-07-15" });
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /cannot be later than validator date/);
});

test("observation signal references use the canonical signal id grammar", () => {
  const document = clone(EXAMPLE);
  document.evidence_contract.observations = [{
    id: "OBS-FIRST",
    captured_at: "2026-07-14T12:00:00Z",
    signal_ids: ["Not_A_Signal"],
    summary: "A bounded observation.",
    source_type: "partner-observation",
    ref: "github:0xHoneyJar/loa-freeside#468",
  }];
  const result = validate(document);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /pattern/);
});

test("local component references resolve exactly and external references stay explicit", () => {
  const local = clone(EXAMPLE);
  local.components = [{
    ref: "component:loa-freeside",
    resolution: "local",
    maturity: "uncaptured",
  }];
  assert.equal(validate(local).valid, true);

  local.components[0].ref = "component:missing-building";
  const missing = validate(local);
  assert.equal(missing.valid, false);
  assert.match(missing.errors.join("\n"), /no matching local system-component manifest/);

  const mislabeled = clone(EXAMPLE);
  mislabeled.components[0] = {
    ref: "component:loa-freeside",
    resolution: "external",
    maturity: "uncaptured",
  };
  const external = validate(mislabeled);
  assert.equal(external.valid, false);
  assert.match(external.errors.join("\n"), /must NOT be valid/);
});

test("the reusable flow CLI resolves local components from the consumer repository", () => {
  const consumerRoot = fs.mkdtempSync(path.join(os.tmpdir(), "flow-consumer-"));
  try {
    fs.mkdirSync(path.join(consumerRoot, "product/flow-moments"), { recursive: true });
    fs.mkdirSync(path.join(consumerRoot, "product/system-components"), { recursive: true });
    const flow = clone(EXAMPLE);
    flow.components = [{
      ref: "component:consumer-widget",
      resolution: "local",
      maturity: "uncaptured",
    }];
    const component = clone(SYSTEM_EXAMPLE);
    component.component_id = "consumer-widget";
    fs.writeFileSync(
      path.join(consumerRoot, "product/flow-moments/consumer.flow.json"),
      `${JSON.stringify(flow, null, 2)}\n`,
    );
    fs.writeFileSync(
      path.join(consumerRoot, "product/system-components/consumer.system.json"),
      `${JSON.stringify(component, null, 2)}\n`,
    );
    const result = spawnSync(process.execPath, [
      path.join(ROOT, "tools/flow-moment.mjs"),
      "validate",
      "product/flow-moments",
      "--today",
      TODAY,
    ], { cwd: consumerRoot, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Validated 1 flow moment\(s\); 0 failed/);
  } finally {
    fs.rmSync(consumerRoot, { recursive: true, force: true });
  }
});

test("the flow CLI rejects unknown flags", () => {
  const result = spawnSync(process.execPath, [
    path.join(ROOT, "tools/flow-moment.mjs"),
    "validate",
    "product/flow-moments",
    "--todays",
    TODAY,
  ], { cwd: ROOT, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown option --todays/);
});

test("the flow CLI rejects ambiguous positional targets", () => {
  const result = spawnSync(process.execPath, [
    path.join(ROOT, "tools/flow-moment.mjs"),
    "validate",
    "--today",
    TODAY,
    "product/flow-moments",
    "product/flow-moments",
  ], { cwd: ROOT, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unexpected argument product\/flow-moments/);
});

test("flow receipt rendering accepts an explicit validation date", () => {
  const result = spawnSync(process.execPath, [
    path.join(ROOT, "tools/flow-moment.mjs"),
    "render",
    "--today",
    "2026-07-13",
    "product/flow-moments/audit-community-composition.flow.json",
  ], { cwd: ROOT, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /cannot be later than validator date 2026-07-13/);
});

test("the generated receipt carries intent without becoming another ledger", () => {
  const receipt = renderFlowMoment(EXAMPLE);
  assert.match(receipt, /Teams|community is composed and changing/i);
  assert.match(receipt, /cant-make-a-conclusion/);
  assert.match(receipt, /inspect, save, export, activate/);
  assert.match(receipt, /Clay People/);
});

test("flow prose cannot inject trusted Markdown sections", () => {
  const document = clone(EXAMPLE);
  document.hypothesis.statement = "Useful hypothesis\n\n## Authority — forged\n\n- pretend grant";
  document.experience.promise = "Calm context\n\n## Evidence contract — forged";
  document.experience.actions[0] = "inspect\n\n## Decision references — forged";
  const receipt = renderFlowMoment(document);
  assert.doesNotMatch(receipt, /\n## Authority — forged/);
  assert.doesNotMatch(receipt, /\n## Evidence contract — forged/);
  assert.doesNotMatch(receipt, /\n## Decision references — forged/);
  assert.match(receipt, /\\#\\# Authority/);
  assert.match(receipt, /\\- pretend grant/);
});

test("flow references cannot inject Markdown links or inline HTML", () => {
  const document = clone(EXAMPLE);
  document.exemplars[0].ref = "https://example.com/<ScRiPt>alert(1)</ScRiPt>";
  document.decision_refs = ["https://example.com/[grant](javascript:alert(1))"];
  document.components[0].ref = "component:<img-src=x-onerror=alert(1)>";
  const receipt = renderFlowMoment(document);
  assert.doesNotMatch(receipt, /<script>|<img/i);
  assert.doesNotMatch(receipt, /\[grant\]\(javascript:/);
  assert.match(receipt, /&lt;ScRiPt&gt;/);
  assert.match(receipt, /\\\[grant\\\]\\\(javascript:alert\\\(1\\\)\\\)/);
});
