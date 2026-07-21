import { describe, expect, it } from "vitest";
import {
  assertSignedIntakeAllowed,
  buildDefaultFixtureRegistryDocument,
  buildTimeHealthSnapshot,
  gateSignedIntake,
  PinnedKeyRegistry,
  type TimeSourceReading,
} from "../index.js";

const healthySources: TimeSourceReading[] = [
  {
    source_id: "ntp.a",
    observed_at: "2026-07-17T21:00:01.000Z",
    unix_ms: Date.parse("2026-07-17T21:00:01.000Z"),
    uncertainty_ms: 20,
  },
  {
    source_id: "ntp.b",
    observed_at: "2026-07-17T21:00:01.000Z",
    unix_ms: Date.parse("2026-07-17T21:00:01.000Z"),
    uncertainty_ms: 25,
  },
];

describe("signed intake gate (CR-013)", () => {
  const acceptedAtMs = Date.parse("2026-07-17T21:00:01.000Z");
  const registry = new PinnedKeyRegistry(buildDefaultFixtureRegistryDocument());

  it("allows intake when registry and time-health are healthy", () => {
    const timeHealth = buildTimeHealthSnapshot({
      databaseUnixMs: acceptedAtMs - 100,
      evaluatedAtMs: acceptedAtMs,
      authoritativeSources: healthySources,
    });

    expect(
      gateSignedIntake({
        registry,
        signingKeyId: "sonar-fixture-primary",
        acceptedAtMs,
        context: "fixture",
        timeHealth,
      }).allowed,
    ).toBe(true);

    expect(() =>
      assertSignedIntakeAllowed({
        registry,
        signingKeyId: "sonar-fixture-primary",
        acceptedAtMs,
        context: "fixture",
        timeHealth,
      }),
    ).not.toThrow();
  });

  it("blocks intake when time-health fails even with a valid key", () => {
    const timeHealth = buildTimeHealthSnapshot({
      databaseUnixMs: acceptedAtMs + 5_000,
      evaluatedAtMs: acceptedAtMs,
      authoritativeSources: healthySources,
    });

    const verdict = gateSignedIntake({
      registry,
      signingKeyId: "sonar-fixture-primary",
      acceptedAtMs,
      context: "fixture",
      timeHealth,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe("database_clock_skew_exceeded");
  });
});
