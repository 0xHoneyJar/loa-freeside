/**
 * CLI smoke test · build-beacon-json
 *
 * Verifies happy path (codex v2 → JSON · exit 0) + invalid-input path
 * (v1-shaped → ParseError on stderr · exit 1) + usage-error path
 * (no flags · exit 2). Run after `pnpm build` populates dist/.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "fixtures");
const CLI = join(__dirname, "..", "dist", "bin", "build-beacon-json.js");

function tmpDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `beacon-schema-${prefix}-`));
}

function ensureBuilt() {
  if (!existsSync(CLI)) {
    throw new Error(
      `CLI not built at ${CLI} · run \`pnpm build\` before running CLI tests`,
    );
  }
}

test("CLI · happy path · codex v2 → JSON · exit 0", () => {
  ensureBuilt();
  const dir = tmpDir("happy");
  try {
    const out = join(dir, "codex.json");
    const stdout = execFileSync("node", [
      CLI,
      "--in",
      join(FIXTURES, "codex-v2.yaml"),
      "--out",
      out,
    ]).toString();
    assert.ok(stdout.includes("→"), "expected progress line on stdout");
    assert.ok(existsSync(out), "expected output file to exist");
    const json = JSON.parse(readFileSync(out, "utf-8"));
    assert.equal(json.schema_version, "2");
    assert.equal(json.mcp.shape, "data");
    assert.equal(json.mcp.auth.kind, "none");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI · invalid input · v1-shaped → exit 1 with ParseError on stderr", () => {
  ensureBuilt();
  const dir = tmpDir("invalid");
  try {
    const out = join(dir, "bad.json");
    let exitCode = 0;
    let stderr = "";
    try {
      execFileSync(
        "node",
        [CLI, "--in", join(FIXTURES, "v1-shaped.yaml"), "--out", out],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (e) {
      const err = e as { status?: number; stderr?: Buffer };
      exitCode = err.status ?? -1;
      stderr = err.stderr?.toString() ?? "";
    }
    assert.equal(exitCode, 1, "expected exit 1 on validation failure");
    assert.ok(
      stderr.includes("ParseError") || stderr.includes("schema validation failed"),
      `expected ParseError in stderr, got: ${stderr}`,
    );
    assert.ok(!existsSync(out), "expected no output file on failure");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI · usage error · no flags → exit 2", () => {
  ensureBuilt();
  let exitCode = 0;
  let stderr = "";
  try {
    execFileSync("node", [CLI], { stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    const err = e as { status?: number; stderr?: Buffer };
    exitCode = err.status ?? -1;
    stderr = err.stderr?.toString() ?? "";
  }
  assert.equal(exitCode, 2, "expected exit 2 on usage error");
  assert.ok(stderr.includes("usage:"), "expected usage hint in stderr");
});
