import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applyCompromiseToKeys,
  applyRevocationToKeys,
  buildDefaultFixtureRegistryDocument,
  createInMemoryRotationCoordinator,
  decodeCompromiseEvent,
  decodeRevocationEvent,
  decodeRotationEvent,
  defaultFixtureCustodyKeys,
  PinnedKeyRegistry,
  validateRotationOverlap,
} from "../index.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/scenarios");

describe("rotation and revocation (CR-013)", () => {
  const bundle = JSON.parse(
    readFileSync(join(fixturesDir, "registry-rotation.shared.json"), "utf8"),
  ) as {
    accepted_at_ms: number;
    rotation: unknown;
    compromise: unknown;
  };

  const registry = new PinnedKeyRegistry(buildDefaultFixtureRegistryDocument());

  it("validates overlap rotation windows", () => {
    const rotation = decodeRotationEvent(bundle.rotation);
    expect(() =>
      validateRotationOverlap(rotation, registry, Date.parse("2026-07-15T00:00:00.000Z")),
    ).not.toThrow();
  });

  it("applies revocation and compromise events", () => {
    const coordinator = createInMemoryRotationCoordinator("collection-report.fixture-registry.v1");
    const keys = defaultFixtureCustodyKeys();

    const revocation = decodeRevocationEvent({
      event_id: "revoke-test",
      kind: "revocation",
      registry_id: coordinator.registryId,
      signing_key_id: "sonar-fixture-rotated",
      revoked_at: "2026-07-17T21:00:00.000Z",
      reason: "scheduled_rotation_complete",
      issued_at: "2026-07-17T21:00:00.000Z",
    });
    const revokedKeys = coordinator.applyRevocation(revocation, keys);
    const rotated = revokedKeys.find((key) => key.signing_key_id === "sonar-fixture-rotated");
    expect(rotated?.revoked_at).toBe("2026-07-17T21:00:00.000Z");

    const compromise = decodeCompromiseEvent(bundle.compromise);
    const compromisedKeys = applyCompromiseToKeys(compromise, keys);
    const compromised = compromisedKeys.find((key) => key.signing_key_id === compromise.signing_key_id);
    expect(compromised?.compromise).toBe(true);
    expect(compromised?.revoked_at).toBeDefined();

    const manualRevoke = applyRevocationToKeys(revocation, keys);
    expect(manualRevoke.find((key) => key.signing_key_id === revocation.signing_key_id)?.revoked_at).toBe(
      revocation.revoked_at,
    );
  });
});
