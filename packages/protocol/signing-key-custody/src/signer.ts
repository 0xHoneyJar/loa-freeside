import type { KeyCustodyClass } from "./contracts.js";
import { KeyCustodyRejectedError, SigningBackendError } from "./errors.js";
import { assertFixtureKeyOnly, assertProductionAuthorizedKey } from "./key-class.js";

export interface RemoteSigningBackend {
  readonly backendKind: Exclude<
    import("./contracts.js").CustodyBackendKind,
    "local-fixture"
  >;
  readonly signingKeyId: string;
  readonly keyClass: KeyCustodyClass;
  sign(message: Uint8Array): Promise<Uint8Array>;
  getPublicKeyHex(): Promise<string>;
  healthCheck(): Promise<{ ok: true } | { ok: false; detail: string }>;
}

export interface LocalFixtureSigningBackend {
  readonly backendKind: "local-fixture";
  readonly signingKeyId: string;
  readonly keyClass: "fixture";
  sign(message: Uint8Array): Uint8Array;
  getPublicKeyHex(): string;
}

export type SigningBackend = RemoteSigningBackend | LocalFixtureSigningBackend;

export const assertBackendAuthorizedForContext = (
  backend: SigningBackend,
  context: KeyCustodyClass,
): void => {
  if (context === "production") {
    if (backend.backendKind === "local-fixture" || backend.keyClass !== "production") {
      throw new KeyCustodyRejectedError({
        reason: "fixture_key_in_production_context",
        remediation: "fail_closed_until_recovery",
      });
    }
    assertProductionAuthorizedKey({
      signing_key_id: backend.signingKeyId,
      public_key_hex: "0".repeat(64),
      producer: "placeholder",
      capabilities: ["collection-report.capability-evidence.v1"],
      activated_at: "2026-01-01T00:00:00.000Z",
      key_class: backend.keyClass,
      custody_backend: backend.backendKind,
    });
  } else if (backend.backendKind !== "local-fixture" || backend.keyClass !== "fixture") {
    throw new KeyCustodyRejectedError({
      reason: "production_key_in_fixture_context",
      remediation: "fail_closed_until_recovery",
    });
  }
};

export const signWithBackend = async (
  backend: SigningBackend,
  message: Uint8Array,
): Promise<Uint8Array> => {
  if (backend.backendKind === "local-fixture") {
    return backend.sign(message);
  }

  const health = await backend.healthCheck();
  if (!health.ok) {
    throw new SigningBackendError({
      backend: backend.backendKind,
      operation: "health_check",
      detail: health.detail,
    });
  }

  try {
    return await backend.sign(message);
  } catch (error) {
    throw new SigningBackendError({
      backend: backend.backendKind,
      operation: "sign",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};

export interface KmsHsmKeyReference {
  readonly signing_key_id: string;
  readonly custody_backend: RemoteSigningBackend["backendKind"];
  readonly custody_key_ref: string;
  readonly region?: string;
}
