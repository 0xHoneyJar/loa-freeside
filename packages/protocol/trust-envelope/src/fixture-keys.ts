import { LocalEd25519TrustSigner } from "./signing.js";

/** Deterministic non-production fixture seeds — CR-013 owns production custody. */
export const FIXTURE_SIGNING_SEEDS = Object.freeze({
  sonarPrimary: "0000000000000000000000000000000000000000000000000000000000000000",
  sonarRotated: "1111111111111111111111111111111111111111111111111111111111111111",
  sonarRevoked: "2222222222222222222222222222222222222222222222222222222222222222",
  orderingReplay: "3333333333333333333333333333333333333333333333333333333333333333",
});

export const FIXTURE_SIGNING_KEY_IDS = Object.freeze({
  sonarPrimary: "sonar-fixture-primary",
  sonarRotated: "sonar-fixture-rotated",
  sonarRevoked: "sonar-fixture-revoked",
  orderingReplay: "ordering-fixture-replay",
});

export const FIXTURE_STREAM_ID = "sonar.public-capability.v1";
export const FIXTURE_TENANT_SCOPE_DIGEST =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const FIXTURE_CAPABILITY = "collection-report.capability-evidence.v1";

export const fixtureSigners = () => ({
  sonarPrimary: LocalEd25519TrustSigner.fromSeedHex(
    FIXTURE_SIGNING_SEEDS.sonarPrimary,
    FIXTURE_SIGNING_KEY_IDS.sonarPrimary,
  ),
  sonarRotated: LocalEd25519TrustSigner.fromSeedHex(
    FIXTURE_SIGNING_SEEDS.sonarRotated,
    FIXTURE_SIGNING_KEY_IDS.sonarRotated,
  ),
  sonarRevoked: LocalEd25519TrustSigner.fromSeedHex(
    FIXTURE_SIGNING_SEEDS.sonarRevoked,
    FIXTURE_SIGNING_KEY_IDS.sonarRevoked,
  ),
  orderingReplay: LocalEd25519TrustSigner.fromSeedHex(
    FIXTURE_SIGNING_SEEDS.orderingReplay,
    FIXTURE_SIGNING_KEY_IDS.orderingReplay,
  ),
});

export const fixturePublicKeys = (): Record<string, string> => {
  const signers = fixtureSigners();
  return {
    [FIXTURE_SIGNING_KEY_IDS.sonarPrimary]: signers.sonarPrimary.publicKeyHex(),
    [FIXTURE_SIGNING_KEY_IDS.sonarRotated]: signers.sonarRotated.publicKeyHex(),
    [FIXTURE_SIGNING_KEY_IDS.sonarRevoked]: signers.sonarRevoked.publicKeyHex(),
    [FIXTURE_SIGNING_KEY_IDS.orderingReplay]: signers.orderingReplay.publicKeyHex(),
  };
};
