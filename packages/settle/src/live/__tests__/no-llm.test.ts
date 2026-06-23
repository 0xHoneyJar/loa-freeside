/**
 * No-LLM invariant (SDD §9): instruments and live code must be deterministic —
 * no LLM / cheval / model-provider imports, no `Date.now`, no `Math.random`.
 * Determinism is what lets the independent verifier re-execute and agree.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const srcDir = fileURLToPath(new URL("../../", import.meta.url));

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".ts"))
    .map((e) => join(e.parentPath ?? dir, e.name));
}

const FORBIDDEN_IMPORT = /from\s+["'][^"']*(cheval|openai|anthropic|@google\/gen|gemini|llm)[^"']*["']/i;
const FORBIDDEN_NONDET = /\b(Date\.now|Math\.random)\b/;

describe("no-LLM / determinism invariant over src/live", () => {
  const files = tsFiles(join(srcDir, "live")).filter((f) => !f.includes("__tests__"));

  it("scans live files", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file.split("/live/")[1]} imports no LLM/model provider`, () => {
      expect(FORBIDDEN_IMPORT.test(readFileSync(file, "utf8"))).toBe(false);
    });
    it(`${file.split("/live/")[1]} uses no Date.now/Math.random`, () => {
      expect(FORBIDDEN_NONDET.test(readFileSync(file, "utf8"))).toBe(false);
    });
  }
});
