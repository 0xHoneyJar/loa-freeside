import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { renderFlowMoment, validateFlowMoment } from "./flow-moment.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXAMPLE = JSON.parse(fs.readFileSync(
  path.join(ROOT, "product/flow-moments/audit-community-composition.flow.json"),
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

test("Gold proves reusable maturity and enforces the production floor", () => {
  const document = clone(EXAMPLE);
  document.components = [{
    ref: "component:MemberTimeline",
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

test("the generated receipt carries intent without becoming another ledger", () => {
  const receipt = renderFlowMoment(EXAMPLE);
  assert.match(receipt, /Teams|community is composed and changing/i);
  assert.match(receipt, /cant-make-a-conclusion/);
  assert.match(receipt, /inspect, save, export, activate/);
  assert.match(receipt, /Clay People/);
});
