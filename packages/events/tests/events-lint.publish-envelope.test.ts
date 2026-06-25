// TEETH TEST — must be RED on the unpatched lint (base commit 59656d5a).
// This test FAILS before the detection pattern is added (exit code is NOT 1,
// or output does NOT contain "publishEnvelope-bypass"). The RED→GREEN transition
// is the falsification proof that the bypass hole was real (G-3).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

// Resolve the binary path relative to this file — always points to the one true
// binary at packages/events/bin/events-lint.mjs (G-2: no reimplementation).
const BIN = fileURLToPath(new URL("../bin/events-lint.mjs", import.meta.url));

describe("events-lint — publishEnvelope-bypass detection (T-1 TEETH TEST)", () => {
  it("exits 1 and emits publishEnvelope-bypass when a file outside the events package imports publishEnvelope", () => {
    assert.ok(existsSync(BIN), `Binary not found: ${BIN}`);

    const tmpDir = mkdtempSync(join(tmpdir(), "events-lint-pe-"));
    try {
      const fixtureDir = join(tmpDir, "bypass-fixture");
      mkdirSync(fixtureDir);

      // Fixture: a direct publishEnvelope import — the bypass that skips schema
      // validation. Must NOT be inside packages/events/src (which is exempt).
      writeFileSync(
        join(fixtureDir, "bypass.ts"),
        [
          `import { publishEnvelope } from "@0xhoneyjar/events";`,
          `// direct bypass — no schema validation`,
          `publishEnvelope({ nats: {} as any, subject: "test", payload: {},`,
          `                  emittedBy: "test", signer: {} as any,`,
          `                  prevHashStore: {} as any });`,
        ].join("\n"),
        "utf8",
      );

      const result = spawnSync(process.execPath, [BIN, "--root", fixtureDir, "--enforce"], {
        encoding: "utf8",
        timeout: 15_000,
      });

      const output = (result.stdout ?? "") + (result.stderr ?? "");

      assert.strictEqual(
        result.status,
        1,
        `Expected exit code 1 (detection fired), got ${result.status}.\nOutput:\n${output}`,
      );
      assert.ok(
        output.includes("publishEnvelope-bypass"),
        `Expected output to contain "publishEnvelope-bypass".\nOutput:\n${output}`,
      );
    } finally {
      // AC-8 (test isolation): temp dir removed on pass OR fail.
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("does NOT flag import type { publishEnvelope } (type-only import guard)", () => {
    assert.ok(existsSync(BIN), `Binary not found: ${BIN}`);

    const tmpDir = mkdtempSync(join(tmpdir(), "events-lint-pe-type-"));
    try {
      const fixtureDir = join(tmpDir, "bypass-fixture");
      mkdirSync(fixtureDir);

      writeFileSync(
        join(fixtureDir, "type-only.ts"),
        `import type { publishEnvelope } from "@0xhoneyjar/events";\n// type-only import — no capability, no bypass\n`,
        "utf8",
      );

      const result = spawnSync(process.execPath, [BIN, "--root", fixtureDir, "--enforce"], {
        encoding: "utf8",
        timeout: 15_000,
      });

      const output = (result.stdout ?? "") + (result.stderr ?? "");

      assert.strictEqual(
        result.status,
        0,
        `Expected exit code 0 for type-only import, got ${result.status}.\nOutput:\n${output}`,
      );
      assert.ok(
        !output.includes("publishEnvelope-bypass"),
        `Expected no publishEnvelope-bypass finding for type-only import.\nOutput:\n${output}`,
      );
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
