import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { renderSystemComponent, validateSystemComponent } from "./system-component.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXAMPLE = JSON.parse(fs.readFileSync(
  path.join(ROOT, "product/system-components/loa-freeside.system.json"),
  "utf8",
));

function clone(value) {
  return structuredClone(value);
}

function validate(document) {
  return validateSystemComponent(document, { repoRoot: ROOT });
}

test("loa-freeside declares an honest composed BFF responsibility", () => {
  const result = validate(EXAMPLE);
  assert.equal(result.valid, true, result.errors.join("\n"));
  assert.equal(EXAMPLE.layer, "orchestrator");
  assert.equal(EXAMPLE.trust.contract_status, "partial");
});

test("an unmapped component must say why it is not joined to a user flow", () => {
  const document = clone(EXAMPLE);
  document.flow_moments = [];
  const result = validate(document);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /unmapped_reason|oneOf/);

  document.unmapped_reason = "No current product flow consumes this building.";
  const repaired = validate(document);
  assert.equal(repaired.valid, true, repaired.errors.join("\n"));
});

test("flow ids and canonical references cannot disagree", () => {
  const document = clone(EXAMPLE);
  document.flow_moments[0].canonical_ref = "flow:FM-SOMETHING-ELSE";
  const result = validate(document);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /canonical_ref/);
});

test("declared local contracts must exist inside the consumer repository", () => {
  const document = clone(EXAMPLE);
  document.trust.contract_refs = ["file:does-not-exist.openapi.yaml"];
  const missing = validate(document);
  assert.equal(missing.valid, false);
  assert.match(missing.errors.join("\n"), /does not exist/);

  document.trust.contract_refs = ["file:../outside-repo"];
  const escape = validate(document);
  assert.equal(escape.valid, false);
  assert.match(escape.errors.join("\n"), /escapes the repository root/);
});

test("missing contract status cannot carry a flattering contract reference", () => {
  const document = clone(EXAMPLE);
  document.trust.contract_status = "missing";
  const result = validate(document);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /more than 0 items|maxItems/);
});

test("the generated system receipt preserves responsibility and handoff", () => {
  const receipt = renderSystemComponent(EXAMPLE);
  assert.match(receipt, /Stable responsibility/);
  assert.match(receipt, /FM-AUDIT-COMPOSITION/);
  assert.match(receipt, /do not implement it silently/i);
});
