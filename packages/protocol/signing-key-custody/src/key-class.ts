import type { CustodyBackendKind, CustodySigningKey, KeyCustodyClass } from "./contracts.js";
import { KeyCustodyRejectedError } from "./errors.js";

/** Mechanical marker embedded in every non-production signing_key_id. */
export const FIXTURE_KEY_ID_MARKER = "-fixture-" as const;

const FIXTURE_BACKEND: CustodyBackendKind = "local-fixture";

const PRODUCTION_BACKENDS: ReadonlySet<CustodyBackendKind> = new Set([
  "aws-kms",
  "gcp-kms",
  "azure-keyvault",
  "vault-transit",
  "cloudhsm",
]);

export const isFixtureKeyId = (signingKeyId: string): boolean =>
  signingKeyId.includes(FIXTURE_KEY_ID_MARKER);

export const isProductionKeyId = (signingKeyId: string): boolean =>
  !isFixtureKeyId(signingKeyId);

export const expectedBackendForClass = (keyClass: KeyCustodyClass): CustodyBackendKind =>
  keyClass === "fixture" ? FIXTURE_BACKEND : "aws-kms";

export const backendMatchesClass = (
  keyClass: KeyCustodyClass,
  custodyBackend: CustodyBackendKind,
): boolean => {
  if (keyClass === "fixture") return custodyBackend === FIXTURE_BACKEND;
  return PRODUCTION_BACKENDS.has(custodyBackend);
};

export const validateKeyClassMechanics = (key: CustodySigningKey): void => {
  const idMatchesClass =
    key.key_class === "fixture" ? isFixtureKeyId(key.signing_key_id) : isProductionKeyId(key.signing_key_id);

  if (!idMatchesClass) {
    throw new KeyCustodyRejectedError({
      reason: "invalid_key_id_pattern",
      remediation: key.key_class === "fixture" ? undefined : "emergency_revoke",
    });
  }

  if (!backendMatchesClass(key.key_class, key.custody_backend)) {
    throw new KeyCustodyRejectedError({
      reason: "key_class_backend_mismatch",
      remediation: "emergency_revoke",
    });
  }
};

export const assertProductionAuthorizedKey = (key: CustodySigningKey): void => {
  validateKeyClassMechanics(key);
  if (key.key_class !== "production") {
    throw new KeyCustodyRejectedError({
      reason: "fixture_key_in_production_context",
      remediation: "fail_closed_until_recovery",
    });
  }
};

export const assertFixtureKeyOnly = (key: CustodySigningKey): void => {
  validateKeyClassMechanics(key);
  if (key.key_class !== "fixture") {
    throw new KeyCustodyRejectedError({
      reason: "production_key_in_fixture_context",
      remediation: "fail_closed_until_recovery",
    });
  }
};

/** Release gates must never treat fixture registry proof as production authorization. */
export const satisfiesProductionReleaseGate = (keys: readonly CustodySigningKey[]): boolean =>
  keys.length > 0 && keys.every((key) => {
    try {
      assertProductionAuthorizedKey(key);
      return true;
    } catch {
      return false;
    }
  });

export const toTrustEnvelopeServiceKey = (
  key: CustodySigningKey,
): import("@freeside/trust-envelope-protocol").ServiceSigningKey => ({
  signing_key_id: key.signing_key_id,
  public_key_hex: key.public_key_hex,
  producer: key.producer,
  capabilities: key.capabilities,
  tenant_scope_digests: key.tenant_scope_digests,
  activated_at: key.activated_at,
  revoked_at: key.revoked_at,
  compromise: key.compromise,
});
