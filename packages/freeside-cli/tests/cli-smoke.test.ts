/**
 * Real-binary smoke · freeside-cli (bug #449)
 *
 * Guards the shipped binary against module-load crashes caused by a stale/unbuilt
 * workspace dependency `dist/` (e.g. `@freeside/beacon-schema` missing a newer
 * export like `BEACON_EXIT`). `bin/freeside-cli.ts` imports every verb at the top
 * of the file, so a missing export aborts module load before any verb runs — the
 * whole CLI is unrunnable as shipped.
 *
 * This asserts `--help` exits 0 AND prints usage on stdout. It is immune to the
 * false-green in the existing `doctor --registry <bad> → exit 1` smoke: a
 * module-load crash also exits non-zero, so an exit-1 assertion cannot tell
 * "correctly rejected" from "crashed before running". Exit-0-with-usage can.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "dist", "bin", "freeside-cli.js");

for (const flag of ["--help", "-h"]) {
  test(`CLI · ${flag} → exit 0 with usage on stdout (module-load smoke, #449)`, () => {
    if (!existsSync(CLI)) throw new Error(`CLI not built at ${CLI} — run \`npm run build\` first`);
    // execFileSync throws on non-zero exit → a module-load crash fails this test.
    const stdout = execFileSync("node", [CLI, flag], { encoding: "utf-8" });
    assert.match(stdout, /freeside-cli/, "usage banner must be printed on stdout");
  });
}
