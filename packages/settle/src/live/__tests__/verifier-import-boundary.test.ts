/**
 * Verifier import boundary (SKP-006): `verifier.live.ts` must import ONLY from the
 * domain and ports surfaces — never a producer / writer / quality module. The
 * independent recompute is only "independent" if it shares no code path with the
 * thing it is judging.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const verifierSrc = readFileSync(
  fileURLToPath(new URL("../verifier.live.ts", import.meta.url)),
  "utf8",
);

function importSources(src: string): string[] {
  const out: string[] = [];
  const re = /(?:import|export)[^"']*from\s+["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

const ALLOWED = [/^\.\.\/domain\//, /^\.\.\/ports\//, /^\.\//];
const FORBIDDEN_TOKEN = /producer|writer|quality|self.?report/i;

describe("verifier import boundary", () => {
  const sources = importSources(verifierSrc);

  it("imports something (sanity)", () => {
    expect(sources.length).toBeGreaterThan(0);
  });

  it("every import is within the allowed domain/ports surface", () => {
    for (const s of sources) {
      const ok = ALLOWED.some((re) => re.test(s));
      expect(ok, `disallowed import: ${s}`).toBe(true);
    }
  });

  it("imports nothing that names a producer/writer/quality path", () => {
    for (const s of sources) {
      expect(FORBIDDEN_TOKEN.test(s), `producer-ish import: ${s}`).toBe(false);
    }
  });
});
