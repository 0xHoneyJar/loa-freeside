/**
 * THE UNBYPASSABLE PROOF (SKP-001b, G-2).
 *
 * The raw must-settle capability (`live/_internal/must-settle-capability.ts`) may
 * be reached by exactly ONE module: `live/gated-facade.ts`. Two layers enforce it:
 *
 *  1. EXTERNAL (the real teeth): `package.json` `exports` lists only the barrel,
 *     so Node refuses any subpath import of the raw module from outside the
 *     package (`ERR_PACKAGE_PATH_NOT_EXPORTED`). The barrel does not re-export it.
 *  2. IN-TREE drift detector (this test): scans the source tree and fails if any
 *     OTHER file reaches the raw module — via static `import … from`, dynamic
 *     `import()`, or `require()` (incl. multi-line). A failure here means a
 *     drifting agent added an in-package bypass. The detector self-tests its own
 *     evasion-resistance below so the proof cannot rot into theater.
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
 * Does a file REACH the raw module — by static `from "…"`, dynamic `import("…")`,
 * or `require("…")`? Checked per physical line (so a newline-spanning `[^"']*`
 * cannot match this test's own regex literals), but covering all three reach
 * forms — a regex that only knew static `from` would be defeated by `import()`.
 */
function reachesRawModule(content: string): boolean {
  const fromStatic = new RegExp(`\\bfrom\\s+["'][^"'\\n]*${RAW_MODULE}`);
  const dynamicOrRequire = new RegExp(
    `\\b(?:import|require)\\s*\\(\\s*["'][^"'\\n]*${RAW_MODULE}`,
  );
  return content
    .split("\n")
    .some((line) => fromStatic.test(line) || dynamicOrRequire.test(line));
}

describe("must-settle capability is reachable only through the gated facade", () => {
  const files = tsFiles(srcDir);
  const importers = files
    .filter((f) => reachesRawModule(readFileSync(f, "utf8")))
    .map((f) => f.replace(srcDir, ""));

  it("exactly one module reaches the raw capability", () => {
    expect(importers).toEqual(["live/gated-facade.ts"]);
  });

  it("the raw capability is not re-exported from the package barrel", () => {
    expect(reachesRawModule(readFileSync(join(srcDir, "index.ts"), "utf8"))).toBe(false);
  });

  // The detector must resist the evasion forms a real bypass would use, or the
  // proof above is false confidence (the external exports map still blocks
  // outside consumers, but in-tree drift would slip).
  it("detector catches every reach form (evasion-resistance)", () => {
    const evasions = [
      `import { x } from "./_internal/${RAW_MODULE}.js";`,
      `import {\n x\n} from "./_internal/${RAW_MODULE}.js";`, // multi-line: `from` line still caught
      `const m = await import("./_internal/${RAW_MODULE}.js");`,
      `const m = require("./_internal/${RAW_MODULE}.js");`,
      `export { x } from "./_internal/${RAW_MODULE}.js";`,
    ];
    for (const e of evasions) {
      expect(reachesRawModule(e), e).toBe(true);
    }
    // ...and does NOT flag a mere mention / string constant (no reach).
    expect(reachesRawModule(`const NAME = "${RAW_MODULE}";`)).toBe(false);
    expect(reachesRawModule(`// see ${RAW_MODULE} for details`)).toBe(false);
  });
});
