import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Schema } from "effect";
import {
  decodeGateManifestSync,
  scanRawTaskRefs,
  validateGateManifest,
  type FindingCode,
} from "../src/index.js";
import {
  fixturePath,
  loadManifest,
  loadSourceInventory,
  readYaml,
} from "./test-helpers.js";

const FindingFixture = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  expected_code: Schema.String,
});

const SummaryFixture = Schema.Struct({
  ...FindingFixture.fields,
  tier_id: Schema.String,
  remove_summary_task: Schema.String,
});

const ImplicitSuffixFixture = Schema.Struct({
  ...FindingFixture.fields,
  replace_task: Schema.String,
  with_task: Schema.String,
});

const CheckpointFixture = Schema.Struct({
  ...FindingFixture.fields,
  checkpoint_id: Schema.String,
  earlier_task: Schema.String,
  later_task: Schema.String,
});

const hasCode = (
  findings: ReadonlyArray<{ readonly code: FindingCode }>,
  code: string,
): boolean => findings.some((finding) => finding.code === code);

describe("canonical collection-report gate manifest", () => {
  it("matches the coordinator source inventory and has zero findings", () => {
    const result = validateGateManifest(loadManifest(), {
      source: loadSourceInventory(),
    });
    assert.equal(result.valid, true);
    assert.deepEqual(result.findings, []);
  });

  it("is honestly pending with every release flag disabled", () => {
    const manifest = loadManifest();
    assert.equal(manifest.status, "pending_owner_approval");
    assert.ok(manifest.gates.every((gate) => gate.state === "pending"));
    assert.ok(manifest.flags.every((flag) => flag.enabled === false));
  });

  it("enumerates every source task exactly once", () => {
    const manifest = loadManifest();
    const source = loadSourceInventory();
    assert.equal(manifest.tasks.length, source.tasks.size);
    assert.equal(new Set(manifest.tasks.map((task) => task.id)).size, source.tasks.size);
  });

  it("keeps CR-209A in the corrected C5 DAG stage", () => {
    const checkpoint = loadManifest().checkpoints.find(
      (candidate) => candidate.id === "C5",
    );
    assert.ok(checkpoint);
    assert.ok(checkpoint.serial_spine.some((stage) => stage.includes("CR-209A")));
  });

  it("validates the minimal pending positive fixture", () => {
    const fixture = readYaml(
      fixturePath("test-vectors", "positive", "minimal-pending.yaml"),
    );
    const result = validateGateManifest(decodeGateManifestSync(fixture));
    assert.equal(result.valid, true);
  });
});

describe("Flatline regression fixtures", () => {
  it("catches the T0/G2A summary omission", () => {
    const fixture = Schema.decodeUnknownSync(SummaryFixture)(
      readYaml(
        fixturePath(
          "test-vectors",
          "negative",
          "t0-g2a-summary-not-closed.yaml",
        ),
      ),
    );
    const manifest = loadManifest();
    const mutated = {
      ...manifest,
      tiers: manifest.tiers.map((tier) =>
        tier.id === fixture.tier_id
          ? {
              ...tier,
              summary: {
                ...tier.summary,
                tasks: tier.summary.tasks.filter(
                  (task) => task !== fixture.remove_summary_task,
                ),
              },
            }
          : tier,
      ),
    };
    const result = validateGateManifest(mutated, {
      source: loadSourceInventory(),
    });
    assert.equal(hasCode(result.findings, fixture.expected_code), true);
  });

  it("rejects prose task ranges before schema decoding", () => {
    const result = scanRawTaskRefs(
      readYaml(
        fixturePath("test-vectors", "negative", "range-forbidden.yaml"),
      ),
    );
    assert.equal(hasCode(result, "RANGE_FORBIDDEN"), true);
  });

  it("rejects prose task ranges in tier entry tasks before schema decoding", () => {
    const result = scanRawTaskRefs({
      tiers: [{ entry_tasks: ["CR-101 through CR-107"] }],
    });
    assert.deepEqual(result, [
      {
        code: "RANGE_FORBIDDEN",
        path: "tiers[0].entry_tasks[0]",
        message:
          'range-shaped task reference "CR-101 through CR-107" — the manifest forbids ranges; enumerate every canonical ID explicitly',
      },
    ]);
  });

  it("rejects bare IDs that hide explicit suffixed tasks", () => {
    const fixture = Schema.decodeUnknownSync(ImplicitSuffixFixture)(
      readYaml(
        fixturePath(
          "test-vectors",
          "negative",
          "implicit-suffixed-id.yaml",
        ),
      ),
    );
    const manifest = loadManifest();
    const mutated = {
      ...manifest,
      tasks: manifest.tasks.map((task) => ({
        ...task,
        depends_on: task.depends_on.map((dependency) =>
          dependency === fixture.replace_task ? fixture.with_task : dependency,
        ),
      })),
    };
    const result = validateGateManifest(mutated);
    assert.equal(hasCode(result.findings, fixture.expected_code), true);
  });

  it("rejects checkpoint order that contradicts the task DAG", () => {
    const fixture = Schema.decodeUnknownSync(CheckpointFixture)(
      readYaml(
        fixturePath(
          "test-vectors",
          "negative",
          "checkpoint-contradicts-dag.yaml",
        ),
      ),
    );
    const manifest = loadManifest();
    const mutated = {
      ...manifest,
      checkpoints: manifest.checkpoints.map((checkpoint) =>
        checkpoint.id === fixture.checkpoint_id
          ? {
              ...checkpoint,
              serial_spine: [
                [fixture.earlier_task],
                [fixture.later_task],
              ],
            }
          : checkpoint,
      ),
    };
    const result = validateGateManifest(mutated);
    assert.equal(hasCode(result.findings, fixture.expected_code), true);
  });
});
