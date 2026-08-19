// TEETH TEST — must be RED on the unpatched lint (base commit 59656d5a).
// This test FAILS before the detection pattern is added (exit code is NOT 1,
// or output does NOT contain "publishEnvelope-bypass"). The RED→GREEN transition
// is the falsification proof that the bypass hole was real (G-3).
//
// FAGAN-hardened (events #255 F1–F3): the line-by-line matcher was trivially
// evaded by multi-line imports (F1) and namespace member access (F2), and its
// comment-skip was insufficient (F3). These cases shell the REAL binary against
// fixtures the test writes at runtime — never a mock.

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

// Write a single fixture file into a fresh tmp dir and run the REAL binary with
// --enforce against it. Returns { status, output } and removes the dir.
function runFixture(filename: string, contents: string): { status: number | null; output: string } {
  assert.ok(existsSync(BIN), `Binary not found: ${BIN}`);
  const tmpDir = mkdtempSync(join(tmpdir(), "events-lint-pe-"));
  try {
    const fixtureDir = join(tmpDir, "bypass-fixture");
    mkdirSync(fixtureDir);
    writeFileSync(join(fixtureDir, filename), contents, "utf8");
    const result = spawnSync(process.execPath, [BIN, "--root", fixtureDir, "--enforce"], {
      encoding: "utf8",
      timeout: 15_000,
    });
    return { status: result.status, output: (result.stdout ?? "") + (result.stderr ?? "") };
  } finally {
    // AC-8 (test isolation): temp dir removed on pass OR fail.
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

function assertFlagged(filename: string, contents: string) {
  const { status, output } = runFixture(filename, contents);
  assert.strictEqual(status, 1, `Expected exit 1 (detection fired) for ${filename}, got ${status}.\nOutput:\n${output}`);
  assert.ok(
    output.includes("publishEnvelope-bypass"),
    `Expected output to contain "publishEnvelope-bypass" for ${filename}.\nOutput:\n${output}`,
  );
}

function assertClean(filename: string, contents: string) {
  const { status, output } = runFixture(filename, contents);
  assert.strictEqual(status, 0, `Expected exit 0 (no finding) for ${filename}, got ${status}.\nOutput:\n${output}`);
  assert.ok(
    !output.includes("publishEnvelope-bypass"),
    `Expected NO publishEnvelope-bypass finding for ${filename}.\nOutput:\n${output}`,
  );
}

describe("events-lint — publishEnvelope-bypass detection (T-1 TEETH TEST)", () => {
  // ── POSITIVES (must flag → exit 1) ──────────────────────────────────────
  it("flags a single-line value import of publishEnvelope", () => {
    assertFlagged(
      "bypass.ts",
      [
        `import { publishEnvelope } from "@0xhoneyjar/events";`,
        `// direct bypass — no schema validation`,
        `publishEnvelope({ nats: {} as any, subject: "test", payload: {},`,
        `                  emittedBy: "test", signer: {} as any,`,
        `                  prevHashStore: {} as any });`,
      ].join("\n"),
    );
  });

  it("flags a MULTI-LINE value import of publishEnvelope (F1 — was a total miss)", () => {
    // Prettier's normal shape for multi-binding imports. publishEnvelope and the
    // `from` clause land on different lines → the old same-line matcher missed it.
    assertFlagged(
      "multiline.ts",
      [
        `import {`,
        `  someOther,`,
        `  publishEnvelope,`,
        `} from "@0xhoneyjar/events";`,
        ``,
        `publishEnvelope({} as any);`,
      ].join("\n"),
    );
  });

  it("flags a NAMESPACE import + member call (F2 — was a miss)", () => {
    // Import line has `from` but not the token; call site has the token but not
    // `from`. The old single-line AND-of-two-regexes never fired.
    assertFlagged(
      "namespace.ts",
      [
        `import * as events from "@0xhoneyjar/events";`,
        ``,
        `events.publishEnvelope({} as any);`,
      ].join("\n"),
    );
  });

  // ── NEGATIVES (must NOT flag → exit 0) ──────────────────────────────────
  it("does NOT flag a mention inside an inline trailing comment (F3)", () => {
    assertClean(
      "inline-comment.ts",
      `const x = 1; // never import publishEnvelope from "@0xhoneyjar/events"\nexport const y = x;\n`,
    );
  });

  it("does NOT flag a mention inside a single-line block comment (F3)", () => {
    assertClean(
      "block-comment.ts",
      `/* publishEnvelope from "@0xhoneyjar/events" forbidden */\nexport const z = 1;\n`,
    );
  });

  it("does NOT flag a type-only re-export: export type { publishEnvelope } (F3)", () => {
    assertClean(
      "export-type.ts",
      `export type { publishEnvelope } from "@0xhoneyjar/events";\n`,
    );
  });

  it("does NOT flag an inline type modifier: import { type publishEnvelope } (F3)", () => {
    assertClean(
      "inline-type.ts",
      `import { type publishEnvelope } from "@0xhoneyjar/events";\n// type-only binding — no runnable value\n`,
    );
  });

  it("does NOT flag a statement-level type-only import: import type { publishEnvelope }", () => {
    assertClean(
      "type-only.ts",
      `import type { publishEnvelope } from "@0xhoneyjar/events";\n// type-only import — no capability, no bypass\n`,
    );
  });

  // ── NF1 (statement-isolation): an interface/object member named publishEnvelope
  //    sitting next to a @events import must NOT be swept into the import clause.
  it("does NOT flag an interface member `publishEnvelope` next to a @events import (NF1)", () => {
    assertClean(
      "iface-member.ts",
      [
        `export interface Foo { publishEnvelope: () => void }`,
        `import { makeEmitter } from "@0xhoneyjar/events";`,
        `export const e = makeEmitter;`,
      ].join("\n") + "\n",
    );
  });

  it("does NOT flag an object key `publishEnvelope` next to a @events re-export (NF1)", () => {
    assertClean(
      "object-key.ts",
      [
        `export const cfg = { publishEnvelope: true };`,
        `export { makeEmitter } from "@0xhoneyjar/events";`,
      ].join("\n") + "\n",
    );
  });

  // ── NF2 (regex-literal state): a quote-bearing regex must not desync the
  //    comment-stripper and leave a commented-out import un-stripped → flagged.
  it("does NOT flag a commented-out import after a quote-bearing regex literal (NF2)", () => {
    assertClean(
      "regex-then-comment.ts",
      [
        // a regex containing both quote chars — exactly the desync trigger
        "const RX = /[\"']@0xhoneyjar\\/events[\"']/;",
        '// import { publishEnvelope } from "@0xhoneyjar/events";',
        "export const y = RX;",
      ].join("\n") + "\n",
    );
  });

  // ── NF6 (keyword barrier): a no-semicolon local `export { publishEnvelope }`
  //    (ASI, no `from`) immediately before a @events import must NOT be swept
  //    into the import clause on a no-semicolon codebase.
  it("does NOT flag a no-semicolon local `export { publishEnvelope }` next to a @events import (NF6)", () => {
    assertClean(
      "no-semi-local-export.ts",
      [
        `export { publishEnvelope }`,
        `import { makeEmitter } from "@0xhoneyjar/events"`,
        `export const e = makeEmitter`,
      ].join("\n") + "\n",
    );
  });
});
