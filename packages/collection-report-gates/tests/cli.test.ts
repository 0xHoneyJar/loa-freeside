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

  it("requires independent gate and repository-owner trust inputs", () => {
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

    const withGateKeyringOnly = run(
      "--manifest",
      manifest,
      "--approval-keyring",
      fixturePath(
        "test-vectors",
        "trust",
        "approval-keyring.yaml",
      ),
    );
    assert.equal(
      withGateKeyringOnly.status,
      1,
      withGateKeyringOnly.stdout + withGateKeyringOnly.stderr,
    );
    assert.match(withGateKeyringOnly.stdout, /OWNER_ACCEPTANCE_MISSING/);

    const withBothTrustDomains = run(
      "--manifest",
      manifest,
      "--approval-keyring",
      fixturePath("test-vectors", "trust", "approval-keyring.yaml"),
      "--acceptance-receipts",
      fixturePath(
        "test-vectors",
        "positive",
        "repository-acceptance-receipts.yaml",
      ),
      "--acceptance-keyring",
      fixturePath(
        "test-vectors",
        "trust",
        "repository-acceptance-keyring.yaml",
      ),
    );
    assert.equal(
      withBothTrustDomains.status,
      0,
      withBothTrustDomains.stdout + withBothTrustDomains.stderr,
    );
    assert.match(withBothTrustDomains.stdout, /RELEASE READY/);
    assert.match(withBothTrustDomains.stdout, /VALID — 0 findings/);
  });

  it("uses exit code 2 for missing arguments", () => {
    const result = run();
    assert.equal(result.status, 2);
    assert.match(result.stderr, /usage:/);
  });
});
