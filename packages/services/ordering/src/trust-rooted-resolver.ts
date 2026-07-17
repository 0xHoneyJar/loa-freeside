import type { CapabilityNeed } from '@freeside/ordering-protocol';
import type { CapabilityResolver, ResolvedEndpoint } from './resolver.js';

/**
 * S3-T3 / H-7 — trust-rooted resolution. Wraps ANY inner `CapabilityResolver`; after it resolves a
 * building+endpoint, that endpoint MUST match an allowlisted, env-matching, allowlisted-trust-root
 * SIGNED declaration before it is used — else REFUSE. A wrong-but-valid-looking endpoint would yield
 * a wrong audit → a wrong access decision (R-1; this generalizes EULER's secret-parity hazard).
 * Fail-closed: anything unverified is refused, never used.
 *
 * Signature verification itself lives at the registry/beacon (the network plane, H-7); this platform
 * layer consumes the VERIFIED declarations (the `declarations` allowlist) and enforces binding +
 * env + trust-root at resolution time.
 */
export interface SignedDeclaration {
  building: string;
  endpoint: string;
  /** Deploy environment the endpoint is declared for (e.g. 'production', 'staging'). */
  env: string;
  /** Capability/contract version the endpoint serves. */
  capabilityVersion: string;
  /** Identity of the trust root that signed this declaration. */
  trustRoot: string;
}

export interface TrustPolicy {
  /** Verified signed declarations (signature already checked upstream at the registry/beacon). */
  declarations: readonly SignedDeclaration[];
  /** The env this resolver runs in; an endpoint declared for another env is refused. */
  env: string;
  /** Allowlisted trust roots; a declaration signed by a non-allowlisted root is refused. */
  trustRoots: readonly string[];
}

export class TrustViolationError extends Error {
  constructor(
    readonly capability: CapabilityNeed,
    readonly reason: string,
  ) {
    super(`trust-rooted resolution refused ${capability}: ${reason}`);
    this.name = 'TrustViolationError';
  }
}

export class TrustRootedResolver implements CapabilityResolver {
  constructor(
    private readonly inner: CapabilityResolver,
    private readonly policy: TrustPolicy,
  ) {}

  async resolve(capability: CapabilityNeed): Promise<ResolvedEndpoint> {
    const resolved = await this.inner.resolve(capability);
    const decl = this.policy.declarations.find(
      (d) => d.building === resolved.building && d.endpoint === resolved.endpoint,
    );
    if (!decl) {
      throw new TrustViolationError(capability, `no signed declaration for ${resolved.building}@${resolved.endpoint}`);
    }
    if (decl.env !== this.policy.env) {
      throw new TrustViolationError(capability, `env mismatch: declared '${decl.env}', running '${this.policy.env}'`);
    }
    if (!this.policy.trustRoots.includes(decl.trustRoot)) {
      throw new TrustViolationError(capability, `trust root not allowlisted: '${decl.trustRoot}'`);
    }
    return resolved;
  }
}
