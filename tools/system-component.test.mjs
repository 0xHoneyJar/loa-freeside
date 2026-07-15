import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { renderSystemComponent, validateSystemComponent } from "./system-component.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const run = promisify(execFile);
const SYSTEM_CLI = path.join(ROOT, "tools/system-component.mjs");
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

test("every canonical flow reference resolves exactly once", async (t) => {
  const missing = clone(EXAMPLE);
  missing.flow_moments[0].flow_moment_id = "FM-NOT-THERE";
  missing.flow_moments[0].canonical_ref = "flow:FM-NOT-THERE";
  const absent = validate(missing);
  assert.equal(absent.valid, false);
  assert.match(absent.errors.join("\n"), /exactly one.*found 0/);

  const repo = await mkdtemp(path.join(tmpdir(), "flow-resolution-"));
  t.after(() => rm(repo, { recursive: true, force: true }));
  await mkdir(path.join(repo, "product", "flow-moments"), { recursive: true });
  await writeFile(path.join(repo, "README.md"), "# Fixture\n");
  const flow = JSON.stringify({ flow_moment_id: "FM-AUDIT-COMPOSITION" });
  await writeFile(path.join(repo, "product", "flow-moments", "one.flow.json"), flow);
  await writeFile(path.join(repo, "product", "flow-moments", "two.flow.json"), flow);
  const duplicate = clone(EXAMPLE);
  duplicate.trust.contract_refs = ["file:README.md"];
  duplicate.trust.evidence_refs = [];
  const result = validateSystemComponent(duplicate, { repoRoot: repo });
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /exactly one.*found 2/);
});

test("portable validation preserves typed flow links without requiring local canonical records", async (t) => {
  const repo = await mkdtemp(path.join(tmpdir(), "portable-system-component-"));
  t.after(() => rm(repo, { recursive: true, force: true }));
  await mkdir(path.join(repo, "product", "system-components"), { recursive: true });
  await writeFile(path.join(repo, "README.md"), "# Consumer\n");
  const document = clone(EXAMPLE);
  document.trust.contract_refs = ["file:README.md"];
  document.trust.evidence_refs = [];
  await writeFile(
    path.join(repo, "product", "system-components", "consumer.system.json"),
    JSON.stringify(document),
  );

  const portable = validateSystemComponent(document, {
    repoRoot: repo,
    requireCanonicalFlowRecords: false,
  });
  assert.equal(portable.valid, true, portable.errors.join("\n"));
  const { stdout, stderr } = await run(
    process.execPath,
    [SYSTEM_CLI, "validate", "product/system-components", "--portable"],
    { cwd: repo },
  );
  assert.equal(stderr, "");
  assert.match(stdout, /Validated 1 system component\(s\); 0 failed/);

  document.flow_moments[0].canonical_ref = "flow:FM-SOMETHING-ELSE";
  const inconsistent = validateSystemComponent(document, {
    repoRoot: repo,
    requireCanonicalFlowRecords: false,
  });
  assert.equal(inconsistent.valid, false);
  assert.match(inconsistent.errors.join("\n"), /canonical_ref/);
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

test("typed references reject trailing whitespace and newlines", () => {
  const document = clone(EXAMPLE);
  document.trust.contract_refs = ["file:README.md\n"];
  const result = validate(document);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /pattern/);
});

test("the generated system receipt preserves responsibility and handoff", () => {
  const receipt = renderSystemComponent(EXAMPLE);
  assert.match(receipt, /Stable responsibility/);
  assert.match(receipt, /FM-AUDIT-COMPOSITION/);
  assert.match(receipt, /do not implement it silently/i);
});

test("system-component prose cannot inject trusted Markdown sections", () => {
  const document = clone(EXAMPLE);
  document.responsibility = "Stable boundary\n\n## Trust — forged\n\n- pretend contract";
  document.operator.job = "Orient the user\n\n## Flow moments — forged";
  const receipt = renderSystemComponent(document);
  assert.doesNotMatch(receipt, /\n## Trust — forged/);
  assert.doesNotMatch(receipt, /\n## Flow moments — forged/);
  assert.match(receipt, /\\#\\# Trust/);
  assert.match(receipt, /\\- pretend contract/);
});

test("the reusable validator install cannot be captured by a consumer workspace", () => {
  const workflow = fs.readFileSync(
    path.join(ROOT, ".github/workflows/reusable-flow-moment-governance.yml"),
    "utf8",
  );
  assert.match(
    workflow,
    /pnpm install --frozen-lockfile --ignore-scripts --ignore-workspace/,
  );
  assert.match(workflow, /--portable/);
  assert.match(workflow, /inputs\.validate-flow-moments/);
  assert.match(workflow, /governance-ref must be a full lowercase 40-character commit SHA/);
});

test("the system-component CLI rejects unknown flags", () => {
  const result = spawnSync(process.execPath, [
    SYSTEM_CLI,
    "validate",
    "product/system-components",
    "--portabl",
  ], { cwd: ROOT, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown option --portabl/);
});
