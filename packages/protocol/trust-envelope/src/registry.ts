import type { ServiceSigningKey } from "./contracts.js";

const parseIso = (value: string): number => Date.parse(value);

export class ServiceKeyRegistry {
  readonly #keys: ReadonlyMap<string, ServiceSigningKey>;

  constructor(keys: readonly ServiceSigningKey[]) {
    this.#keys = new Map(keys.map((key) => [key.signing_key_id, key]));
  }

  resolve(signingKeyId: string): ServiceSigningKey | undefined {
    return this.#keys.get(signingKeyId);
  }

  isActive(key: ServiceSigningKey, acceptedAtMs: number): boolean {
    if (key.compromise === true) return false;
    if (Date.parse(key.activated_at) > acceptedAtMs) return false;
    if (key.revoked_at !== undefined && Date.parse(key.revoked_at) <= acceptedAtMs) {
      return false;
    }
    return true;
  }

  bindsProducer(key: ServiceSigningKey, producer: string): boolean {
    return key.producer === producer;
  }

  bindsCapability(key: ServiceSigningKey, capability: string): boolean {
    return key.capabilities.includes(capability);
  }

  bindsTenantScope(key: ServiceSigningKey, tenantScopeDigest: string): boolean {
    if (key.tenant_scope_digests === undefined) return true;
    return key.tenant_scope_digests.includes(tenantScopeDigest);
  }

  overlappingRotationWindow(
    previous: ServiceSigningKey,
    next: ServiceSigningKey,
    atMs: number,
  ): boolean {
    return (
      previous.producer === next.producer &&
      this.isActive(previous, atMs) &&
      this.isActive(next, atMs) &&
      previous.signing_key_id !== next.signing_key_id
    );
  }
}

export const issuedAtMs = parseIso;
export const expiresAtMs = parseIso;
