/**
 * Folder invariant (T1.2 AC): every `live/*.live.ts` has a matching
 * `mock/*.mock.ts` and depends on a port (imports from `../ports/`). This is the
 * structural translation-layer discipline made mechanical.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const srcDir = fileURLToPath(new URL("../../", import.meta.url)); // -> src/
const liveDir = join(srcDir, "live");
const mockDir = join(srcDir, "mock");

const liveFiles = readdirSync(liveDir).filter((f) => f.endsWith(".live.ts"));

describe("folder invariant", () => {
  it("finds live implementations to check", () => {
    expect(liveFiles.length).toBeGreaterThan(0);
  });

  for (const file of liveFiles) {
    const stem = file.replace(/\.live\.ts$/, "");

    it(`${file} has a sibling mock/${stem}.mock.ts`, () => {
      expect(existsSync(join(mockDir, `${stem}.mock.ts`))).toBe(true);
    });

    it(`${file} depends on a port (imports from ../ports/)`, () => {
      const content = readFileSync(join(liveDir, file), "utf8");
      expect(content).toMatch(/from\s+["']\.\.\/ports\//);
    });
  }
});
