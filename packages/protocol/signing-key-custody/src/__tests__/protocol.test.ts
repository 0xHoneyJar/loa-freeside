import { describe, expect, it } from "vitest";
import {
  buildDefaultFixtureRegistryDocument,
  decodeSigningKeyRegistryDocument,
  exampleProductionRegistryTemplate,
  satisfiesProductionReleaseGate,
  assertFixtureKeyOnly,
  assertProductionAuthorizedKey,
  isFixtureKeyId,
  KeyCustodyRejectedError,
} from "../index.js";

describe("signing key custody contracts (CR-013)", () => {
  it("decodes registry documents strictly", () => {
    const document = buildDefaultFixtureRegistryDocument();
    const decoded = decodeSigningKeyRegistryDocument(document);
    expect(decoded.key_class_scope).toBe("fixture");
    expect(() =>
      decodeSigningKeyRegistryDocument({
        ...document,
        unexpected: true,
      }),
    ).toThrow();
  });

  it("mechanically separates fixture and production key classes", () => {
    const fixtureDoc = buildDefaultFixtureRegistryDocument();
    const productionDoc = exampleProductionRegistryTemplate();

    expect(isFixtureKeyId("sonar-fixture-primary")).toBe(true);
    expect(isFixtureKeyId("sonar-production-primary")).toBe(false);

    for (const key of fixtureDoc.keys) {
      expect(() => assertFixtureKeyOnly(key)).not.toThrow();
      expect(() => assertProductionAuthorizedKey(key)).toThrow(KeyCustodyRejectedError);
    }

    for (const key of productionDoc.keys) {
      expect(() => assertProductionAuthorizedKey(key)).not.toThrow();
      expect(() => assertFixtureKeyOnly(key)).toThrow(KeyCustodyRejectedError);
    }

    expect(satisfiesProductionReleaseGate(fixtureDoc.keys)).toBe(false);
    expect(satisfiesProductionReleaseGate(productionDoc.keys)).toBe(true);
  });
});
