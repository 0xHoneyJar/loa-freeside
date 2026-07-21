import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildSigningKeyRegistryDocument,
  decodeSigningKeyRegistryDocument,
  defaultFixtureCustodyKeys,
  KeyCustodyRejectedError,
  PinnedKeyRegistry,
  registryObservability,
} from "../index.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/scenarios");

describe("pinned key registry (CR-013)", () => {
  const bundle = JSON.parse(
    readFileSync(join(fixturesDir, "registry-rotation.shared.json"), "utf8"),
  ) as {
    accepted_at_ms: number;
    registry: ReturnType<typeof decodeSigningKeyRegistryDocument>;
    scenarios: Array<{
      id: string;
      expect: "accept" | "reject";
      signing_key_id: string;
      reject_reason?: string;
      registry_published_at?: string;
      accepted_at_ms?: number;
    }>;
  };

  const freshRegistry = (): PinnedKeyRegistry => {
    const document = buildSigningKeyRegistryDocument({
      registryId: bundle.registry.registry_id,
      registryGeneration: bundle.registry.registry_generation,
      publishedAt: bundle.registry.published_at,
      keyClassScope: "fixture",
      keys: defaultFixtureCustodyKeys(),
      maxStalenessMs: bundle.registry.max_staleness_ms,
    });
    return new PinnedKeyRegistry(document);
  };

  it("exposes registry freshness observability", () => {
    const registry = freshRegistry();
    const observed = registryObservability(registry.document, bundle.accepted_at_ms);
    expect(observed.is_stale).toBe(false);
    expect(observed.key_class_scope).toBe("fixture");
  });

  it("resolves or rejects intake scenarios fail-closed", () => {
    for (const scenario of bundle.scenarios) {
      let registry = freshRegistry();
      if (scenario.registry_published_at !== undefined) {
        registry = new PinnedKeyRegistry(
          buildSigningKeyRegistryDocument({
            registryId: bundle.registry.registry_id,
            registryGeneration: bundle.registry.registry_generation,
            publishedAt: scenario.registry_published_at,
            keyClassScope: "fixture",
            keys: defaultFixtureCustodyKeys(),
            maxStalenessMs: bundle.registry.max_staleness_ms,
          }),
        );
      }

      const acceptedAtMs = scenario.accepted_at_ms ?? bundle.accepted_at_ms;
      const resolve = () =>
        registry.resolveForIntake({
          signingKeyId: scenario.signing_key_id,
          acceptedAtMs,
          context: "fixture",
        });

      if (scenario.expect === "accept") {
        expect(resolve, scenario.id).not.toThrow();
      } else {
        try {
          resolve();
          expect.fail(`expected rejection for ${scenario.id}`);
        } catch (error) {
          expect(error).toBeInstanceOf(KeyCustodyRejectedError);
          if (scenario.reject_reason !== undefined) {
            expect((error as KeyCustodyRejectedError).reason).toBe(scenario.reject_reason);
          }
        }
      }
    }
  });

  it("rejects unknown registry at intake boundary", () => {
    expect(() =>
      PinnedKeyRegistry.assertFresh({
        document: freshRegistry().document,
        observedAtMs: Date.parse("2026-07-17T22:00:00.000Z"),
      }),
    ).toThrow(KeyCustodyRejectedError);
  });
});
