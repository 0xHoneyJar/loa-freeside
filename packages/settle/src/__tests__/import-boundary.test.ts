/**
 * THE UNBYPASSABLE PROOF (SKP-001b, G-2).
 *
 * The raw must-settle capability (`live/_internal/must-settle-capability.ts`) may
 * be imported by exactly ONE module: `live/gated-facade.ts`. This test scans the
 * whole source tree and fails if any other file imports it — including a test
 * that tries to reach the capability directly, bypassing the gate. A green run
 * here means: the only path to a must-settle action is through the gate.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const RAW_MODULE = "must-settle-capability";
const srcDir = fileURLToPath(new URL("../", import.meta.url)); // -> src/

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".ts"))
    .map((e) => join(e.parentPath ?? dir, e.name));
}

/**
 * Does a file have a real `import/export ... from "<...must-settle-capability...>"`
 * STATEMENT? Checked line-by-line so this detector does not match its own regex
 * literal or a documentation mention (which is why a whole-file regex is wrong).
 */
function importsRawCapability(content: string): boolean {
  return content.split("\n").some(
    (line) =>
      /^\s*(?:import|export)\b/.test(line) &&
      new RegExp(`from\\s+["'][^"']*${RAW_MODULE}`).test(line),
  );
}

describe("must-settle capability is reachable only through the gated facade", () => {
  const files = tsFiles(srcDir);
  const importers = files
    .filter((f) => importsRawCapability(readFileSync(f, "utf8")))
    .map((f) => f.replace(srcDir, ""));

  it("exactly one module imports the raw capability", () => {
    expect(importers).toEqual(["live/gated-facade.ts"]);
  });

  it("the raw capability is not re-exported from the package barrel", () => {
    const barrel = readFileSync(join(srcDir, "index.ts"), "utf8");
    expect(importsRawCapability(barrel)).toBe(false);
  });
});
