import {
  buildFixtureCustodyKey,
  buildSigningKeyRegistryDocument,
  type SigningKeyRegistryDocument,
} from "@freeside/signing-key-custody-protocol";
import {
  FIXTURE_SIGNING_KEY_IDS,
  FIXTURE_CAPABILITY,
} from "@freeside/trust-envelope-protocol";
import { DEPENDENCY_EDGE_CAPABILITY } from "./version.js";

const ledgerFixtureCapabilities = [
  FIXTURE_CAPABILITY,
  DEPENDENCY_EDGE_CAPABILITY,
] as const;

export const buildDependencyLedgerFixtureRegistryDocument = (
  publishedAt = "2026-07-17T21:00:00.000Z",
): SigningKeyRegistryDocument =>
  buildSigningKeyRegistryDocument({
    registryId: "collection-report.dependency-ledger-fixture.v1",
    registryGeneration: 1,
    publishedAt,
    keyClassScope: "fixture",
    keys: [
      buildFixtureCustodyKey(FIXTURE_SIGNING_KEY_IDS.sonarPrimary, {
        activatedAt: "2026-07-01T00:00:00.000Z",
      }),
      buildFixtureCustodyKey(FIXTURE_SIGNING_KEY_IDS.sonarRotated, {
        activatedAt: "2026-07-10T00:00:00.000Z",
      }),
      buildFixtureCustodyKey(FIXTURE_SIGNING_KEY_IDS.sonarRevoked, {
        activatedAt: "2026-07-01T00:00:00.000Z",
        revokedAt: "2026-07-15T00:00:00.000Z",
      }),
    ].map((key) => ({
      ...key,
      capabilities: [...ledgerFixtureCapabilities],
    })),
  });
