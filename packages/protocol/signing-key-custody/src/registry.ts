import { ServiceKeyRegistry } from "@freeside/trust-envelope-protocol";
import type { CustodySigningKey, KeyCustodyClass, SigningKeyRegistryDocument } from "./contracts.js";
import { ContractIntegrityError, KeyCustodyRejectedError } from "./errors.js";
import {
  assertFixtureKeyOnly,
  assertProductionAuthorizedKey,
  toTrustEnvelopeServiceKey,
  validateKeyClassMechanics,
} from "./key-class.js";

export interface RegistryFreshnessInput {
  readonly document: SigningKeyRegistryDocument;
  readonly observedAtMs: number;
}

export interface ResolveKeyForIntakeInput {
  readonly signingKeyId: string;
  readonly acceptedAtMs: number;
  readonly context: KeyCustodyClass;
}

export class PinnedKeyRegistry {
  readonly #document: SigningKeyRegistryDocument;
  readonly #trustRegistry: ServiceKeyRegistry;
  readonly #keys: ReadonlyMap<string, CustodySigningKey>;

  constructor(document: SigningKeyRegistryDocument) {
    for (const key of document.keys) {
      validateKeyClassMechanics(key);
      if (key.key_class !== document.key_class_scope) {
        throw new ContractIntegrityError({
          detail: `key ${key.signing_key_id} class ${key.key_class} does not match registry scope ${document.key_class_scope}`,
        });
      }
    }

    this.#document = document;
    this.#keys = new Map(document.keys.map((key) => [key.signing_key_id, key]));
    this.#trustRegistry = new ServiceKeyRegistry(document.keys.map(toTrustEnvelopeServiceKey));
  }

  get document(): SigningKeyRegistryDocument {
    return this.#document;
  }

  get trustRegistry(): ServiceKeyRegistry {
    return this.#trustRegistry;
  }

  static assertFresh({ document, observedAtMs }: RegistryFreshnessInput): void {
    const publishedAtMs = Date.parse(document.published_at);
    const ageMs = observedAtMs - publishedAtMs;
    if (ageMs > document.max_staleness_ms) {
      throw new KeyCustodyRejectedError({
        reason: "registry_stale",
        remediation: "refresh_registry",
      });
    }
  }

  resolveForIntake({ signingKeyId, acceptedAtMs, context }: ResolveKeyForIntakeInput): CustodySigningKey {
    PinnedKeyRegistry.assertFresh({
      document: this.#document,
      observedAtMs: acceptedAtMs,
    });

    const key = this.#keys.get(signingKeyId);
    if (key === undefined) {
      throw new KeyCustodyRejectedError({
        reason: "unknown_signing_key",
        remediation: "refresh_registry",
      });
    }

    if (context === "production") {
      assertProductionAuthorizedKey(key);
    } else {
      assertFixtureKeyOnly(key);
    }

    if (key.compromise === true) {
      throw new KeyCustodyRejectedError({
        reason: "compromised_signing_key",
        remediation: "emergency_revoke",
      });
    }

    if (!this.#trustRegistry.isActive(toTrustEnvelopeServiceKey(key), acceptedAtMs)) {
      throw new KeyCustodyRejectedError({
        reason: "revoked_signing_key",
        remediation: "rotate_signing_key",
      });
    }

    return key;
  }

  overlappingRotationWindow(
    previousKeyId: string,
    nextKeyId: string,
    atMs: number,
  ): boolean {
    const previous = this.#keys.get(previousKeyId);
    const next = this.#keys.get(nextKeyId);
    if (previous === undefined || next === undefined) return false;
    return this.#trustRegistry.overlappingRotationWindow(
      toTrustEnvelopeServiceKey(previous),
      toTrustEnvelopeServiceKey(next),
      atMs,
    );
  }
}

export const registryObservability = (
  document: SigningKeyRegistryDocument,
  observedAtMs: number,
): {
  readonly registry_id: string;
  readonly registry_generation: number;
  readonly published_at: string;
  readonly age_ms: number;
  readonly max_staleness_ms: number;
  readonly is_stale: boolean;
  readonly key_class_scope: KeyCustodyClass;
  readonly active_key_count: number;
} => {
  const ageMs = observedAtMs - Date.parse(document.published_at);
  return {
    registry_id: document.registry_id,
    registry_generation: document.registry_generation,
    published_at: document.published_at,
    age_ms: ageMs,
    max_staleness_ms: document.max_staleness_ms,
    is_stale: ageMs > document.max_staleness_ms,
    key_class_scope: document.key_class_scope,
    active_key_count: document.keys.length,
  };
};
