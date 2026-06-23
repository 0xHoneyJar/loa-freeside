/** Bar Registration Authority: producer-pinned rejected; sha-bind; TTL. (T2.2 AC) */
import { describe, it, expect } from "vitest";
import { BarRegistry } from "../bar-registry.live.js";
import type { Bar } from "../../domain/claim.js";
import { sha256Hex } from "../../lib/jcs.js";

const producers = new Set(["quality.py", "producer-x"]);
function bar(criterion = "the criterion", id = "b1"): Bar {
  return { id, criterion, sha: sha256Hex(criterion) };
}

describe("BarRegistry", () => {
  it("rejects a producer-pinned bar (SKP-002a self-grading)", () => {
    const reg = new BarRegistry(producers);
    expect(() => reg.register(bar(), "producer-x", 1000, 500)).toThrow(/producer-pinned/);
  });

  it("accepts a bar pinned by a non-producer authority", () => {
    const reg = new BarRegistry(producers);
    expect(() => reg.register(bar(), "independent-auditor", 1000, 500)).not.toThrow();
  });

  it("rejects a bar whose sha does not content-bind the criterion (no post-hoc edits)", () => {
    const reg = new BarRegistry(producers);
    const tampered: Bar = { id: "b1", criterion: "edited after the fact", sha: "stale-sha" };
    expect(() => reg.register(tampered, "auditor", 1000, 500)).toThrow(/sha mismatch/);
  });

  it("honors the TTL validity window (SKP-005a): valid through TTL, invalid after", () => {
    const reg = new BarRegistry(producers);
    reg.register(bar(), "auditor", 1000, 500); // valid 1000..1500
    expect(reg.isValid("b1", 1400)).toBe(true);
    expect(reg.isValid("b1", 1500)).toBe(true); // inclusive boundary
    expect(reg.isValid("b1", 1501)).toBe(false);
  });

  it("treats unknown bars as invalid (fail-closed)", () => {
    const reg = new BarRegistry(producers);
    expect(reg.isValid("nope", 1000)).toBe(false);
    expect(reg.get("nope")).toBeNull();
  });
});
