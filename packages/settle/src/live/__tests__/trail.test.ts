/** AppendOnlyFileTrail: append/read-back + atomic-row boundary. (T1.5) */
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppendOnlyFileTrail, MAX_ROW_BYTES } from "../trail.live.js";
import type { TrailEntry } from "../../ports/trail.port.js";

function entry(over: Partial<TrailEntry> = {}): TrailEntry {
  return {
    at: 1,
    domain: "money/x",
    claim_id: "a",
    posture: "FAIL_CLOSED",
    required: "settled",
    earned: "claimed",
    proceed: false,
    reason: "r",
    level: "WARN",
    ...over,
  };
}

describe("AppendOnlyFileTrail", () => {
  it("appends entries and reads them back in append order", () => {
    const dir = mkdtempSync(join(tmpdir(), "settle-trail-"));
    try {
      const trail = new AppendOnlyFileTrail(join(dir, "trail.jsonl"));
      trail.append(entry({ at: 1, claim_id: "a", proceed: false }));
      trail.append(entry({ at: 2, claim_id: "b", proceed: true, earned: "settled", level: "INFO" }));
      const all = trail.readAll();
      expect(all.map((e) => e.claim_id)).toEqual(["a", "b"]);
      expect(all[1]!.proceed).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns empty for a non-existent trail file", () => {
    const trail = new AppendOnlyFileTrail(join(tmpdir(), "settle-missing-dir-xyz", "t.jsonl"));
    expect(trail.readAll()).toEqual([]);
  });

  it("rejects an over-large row (the atomic-append boundary, SKP-004)", () => {
    const dir = mkdtempSync(join(tmpdir(), "settle-trail-"));
    try {
      const trail = new AppendOnlyFileTrail(join(dir, "t.jsonl"));
      const huge = "x".repeat(MAX_ROW_BYTES);
      expect(() => trail.append(entry({ domain: huge }))).toThrow(/atomic-append limit/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
