import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fixturePath, packageRoot } from "./test-helpers.js";

const run = (...args: ReadonlyArray<string>) =>
  spawnSync("pnpm", ["exec", "tsx", "bin/check-gate-manifest.ts", ...args], {
    cwd: packageRoot,
    encoding: "utf8",
  });

describe("check-gate-manifest CLI", () => {
  it("accepts the canonical manifest and source digest", () => {
    const result = run(
      "--manifest",
      fixturePath("manifest", "collection-report.gates.yaml"),
      "--source",
      fixturePath("test-vectors", "source", "task-manifest.yaml"),
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /VALID — 0 findings/);
  });

  it("returns findings for a range fixture", () => {
    const result = run(
      "--manifest",
      fixturePath("test-vectors", "negative", "range-forbidden.yaml"),
    );
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /RANGE_FORBIDDEN/);
  });

  it("accepts an owner-approved manifest only with the pinned keyring", () => {
    const manifest = fixturePath(
      "test-vectors",
      "positive",
      "no-go-preserves-t0-t1.yaml",
    );
    const withoutKeyring = run("--manifest", manifest);
    assert.equal(
      withoutKeyring.status,
      1,
      withoutKeyring.stdout + withoutKeyring.stderr,
    );
    assert.match(withoutKeyring.stdout, /MANIFEST_APPROVAL_INVALID/);

    const withKeyring = run(
      "--manifest",
      manifest,
      "--approval-keyring",
      fixturePath(
        "test-vectors",
        "trust",
        "approval-keyring.yaml",
      ),
    );
    assert.equal(withKeyring.status, 0, withKeyring.stdout + withKeyring.stderr);
    assert.match(withKeyring.stdout, /VALID — 0 findings/);
  });

  it("uses exit code 2 for missing arguments", () => {
    const result = run();
    assert.equal(result.status, 2);
    assert.match(result.stderr, /usage:/);
  });
});
