/** Tier ladder + TetlockForecast invariants. (T1.1 AC) */
import { describe, it, expect } from "vitest";
import {
  tierGte,
  tierRank,
  isTerminal,
  assertPpm,
  makeTetlockForecast,
} from "../tier.js";

describe("tier ladder", () => {
  it("orders claimed < pinned < settled", () => {
    expect(tierGte("settled", "claimed")).toBe(true); // the named AC
    expect(tierGte("settled", "pinned")).toBe(true);
    expect(tierGte("pinned", "claimed")).toBe(true);
    expect(tierGte("claimed", "settled")).toBe(false);
    expect(tierGte("settled", "settled")).toBe(true);
  });

  it("treats abstained as terminal-insufficient, off the positive ladder", () => {
    expect(isTerminal("abstained")).toBe(true);
    expect(isTerminal("settled")).toBe(false);
    // abstained never satisfies a positive required tier — this is fail-closed.
    expect(tierGte("abstained", "claimed")).toBe(false);
    expect(tierGte("abstained", "settled")).toBe(false);
    expect(tierRank("abstained")).toBeLessThan(tierRank("claimed"));
  });
});

describe("TetlockForecast — integer ppm, no floats", () => {
  it("accepts integers in [0, 1_000_000]", () => {
    const f = makeTetlockForecast(500_000, 100_000, 30_000);
    expect(f.probability_ppm).toBe(500_000);
    expect(f.base_rate_ppm).toBe(100_000);
  });

  it("rejects float ppm (the named AC)", () => {
    expect(() => makeTetlockForecast(0.5)).toThrow(/integer ppm/);
    expect(() => assertPpm(0.123, "p")).toThrow(/integer ppm/);
  });

  it("rejects out-of-range ppm", () => {
    expect(() => makeTetlockForecast(1_000_001)).toThrow(/range/);
    expect(() => makeTetlockForecast(-1)).toThrow(/range/);
  });

  it("allows null base_rate/brier but validates them when present", () => {
    expect(makeTetlockForecast(1, null, null).base_rate_ppm).toBeNull();
    expect(() => makeTetlockForecast(1, 2.5, null)).toThrow(/integer ppm/);
  });
});
