/** Post-hoc detector: planted slip → MISMATCH; clean → ok; windowed cursor. (T2.3 AC) */
import { describe, it, expect } from "vitest";
import { TrailDetector } from "../detector.live.js";
import type { TrailEntry } from "../../ports/trail.port.js";

function entry(over: Partial<TrailEntry>): TrailEntry {
  return {
    at: 1, domain: "money/transfer", claim_id: "a",
    posture: "FAIL_CLOSED", required: "settled", earned: "settled",
    proceed: true, reason: "ok", level: "INFO",
    ...over,
  };
}

describe("TrailDetector", () => {
  it("flags a claimed-as-settled slip in a must-settle record → MISMATCH tile", () => {
    const entries = [entry({ proceed: true, required: "settled", earned: "claimed", claim_id: "slip" })];
    const tile = new TrailDetector().scan(entries, 0);
    expect(tile.status).toBe("MISMATCH");
    expect(tile.tile).toBe("STATUS=MISMATCH|SIGNAL=settle-drift|MISMATCH=1");
    expect(tile.mismatches[0]!.claim_id).toBe("slip");
  });

  it("returns ok for a clean trail (proceeds only when earned >= required)", () => {
    const entries = [
      entry({ proceed: true, required: "settled", earned: "settled" }),
      entry({ proceed: false, required: "settled", earned: "abstained" }), // abstained, did not proceed
    ];
    const tile = new TrailDetector().scan(entries, 0);
    expect(tile.status).toBe("ok");
    expect(tile.tile).toMatch(/MISMATCH=0$/);
  });

  it("is windowed: advances the cursor and does not rescan prior entries", () => {
    const entries = [
      entry({ proceed: true, required: "settled", earned: "claimed", claim_id: "old-slip" }),
      entry({ proceed: true, required: "settled", earned: "settled" }),
    ];
    const first = new TrailDetector().scan(entries, 0);
    expect(first.cursor).toBe(2);
    expect(first.mismatches).toHaveLength(1);
    // Re-scan from the advanced cursor — the prior slip is NOT re-flagged.
    const second = new TrailDetector().scan(entries, first.cursor);
    expect(second.status).toBe("ok");
    expect(second.mismatches).toHaveLength(0);
    expect(second.cursor).toBe(2);
  });
});
