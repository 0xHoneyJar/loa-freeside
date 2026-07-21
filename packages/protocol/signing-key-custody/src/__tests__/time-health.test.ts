import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertSignedIntakeTimeHealthy,
  buildTimeHealthSnapshot,
  evaluateDatabaseClockSkew,
  KeyCustodyRejectedError,
  ORDERING_DATABASE_MAX_SKEW_MS,
  timeHealthObservability,
  type TimeSourceReading,
} from "../index.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/scenarios");

describe("database time-health (CR-013)", () => {
  const bundle = JSON.parse(
    readFileSync(join(fixturesDir, "time-health.shared.json"), "utf8"),
  ) as {
    evaluated_at_ms: number;
    database_unix_ms: number;
    healthy_sources: TimeSourceReading[];
    scenarios: Array<{
      id: string;
      expect: "accept" | "reject";
      database_unix_ms?: number;
      sources?: TimeSourceReading[];
      max_skew_ms?: number;
      last_good_at?: string;
      reject_reason?: string;
    }>;
  };

  it("blocks signed intake when skew exceeds 2 seconds", () => {
    for (const scenario of bundle.scenarios) {
      const verdict = evaluateDatabaseClockSkew({
        databaseUnixMs: scenario.database_unix_ms ?? bundle.database_unix_ms,
        evaluatedAtMs: bundle.evaluated_at_ms,
        authoritativeSources: scenario.sources ?? bundle.healthy_sources,
        maxSkewMs: scenario.max_skew_ms ?? ORDERING_DATABASE_MAX_SKEW_MS,
        lastGoodAt: scenario.last_good_at,
      });

      if (scenario.expect === "accept") {
        expect(verdict.intakeBlocked, scenario.id).toBe(false);
      } else {
        expect(verdict.intakeBlocked, scenario.id).toBe(true);
        if (scenario.reject_reason !== undefined) {
          expect(verdict.blockReason).toBe(scenario.reject_reason);
        }
      }
    }
  });

  it("builds observable time-health snapshots", () => {
    const snapshot = buildTimeHealthSnapshot({
      databaseUnixMs: bundle.database_unix_ms,
      evaluatedAtMs: bundle.evaluated_at_ms,
      authoritativeSources: bundle.healthy_sources,
    });
    const obs = timeHealthObservability(snapshot);
    expect(obs.intake_blocked).toBe(false);
    expect(obs.source_count).toBeGreaterThanOrEqual(2);
    expect(() => assertSignedIntakeTimeHealthy(snapshot)).not.toThrow();
  });

  it("fails closed on unhealthy snapshots", () => {
    const snapshot = buildTimeHealthSnapshot({
      databaseUnixMs: bundle.database_unix_ms + 10_000,
      evaluatedAtMs: bundle.evaluated_at_ms,
      authoritativeSources: bundle.healthy_sources,
    });
    expect(() => assertSignedIntakeTimeHealthy(snapshot)).toThrow(KeyCustodyRejectedError);
  });
});
