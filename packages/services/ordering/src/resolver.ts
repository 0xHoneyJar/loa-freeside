import type { CapabilityNeed } from '@freeside/ordering-protocol';
import type { ResolutionSource } from '@freeside/ordering-protocol';

/**
 * Capability resolver PORT (SDD §6, §13 B-1) — the agent-navigation seam.
 *
 * Maps a declarative `CapabilityNeed` to the building + endpoint that satisfies it. The MVP
 * backend resolves from explicit config (`ConfigCapabilityResolver`, `source: 'config'`),
 * because the discovery plane is empty (`loa doctor` → `discovered:0, granted:0`). The
 * declared target is a `loa where` backend behind THIS SAME interface (Sprint 3, S3-T2):
 * swap the implementation, routing events truthfully relabel `source: 'loa-where'`. The
 * routing event NEVER claims agent-navigation it didn't perform (the B-2 honesty rule).
 */
export interface ResolvedEndpoint {
  capability: CapabilityNeed;
  building: string;
  endpoint: string;
  source: ResolutionSource;
}

export interface CapabilityResolver {
  /** Resolve one capability. Fail-closed: throws `CapabilityUnresolvedError` if unsatisfiable (SDD §9, G-6). */
  resolve(capability: CapabilityNeed): Promise<ResolvedEndpoint>;
}

export class CapabilityUnresolvedError extends Error {
  constructor(readonly capability: CapabilityNeed) {
    super(`capability could not be resolved: ${capability}`);
    this.name = 'CapabilityUnresolvedError';
  }
}

export type CapabilityConfig = Partial<Record<CapabilityNeed, { building: string; endpoint: string }>>;

/**
 * Config-backed resolver — the honest MVP (B-1). Reads a static capability→building map; an
 * unmapped capability fails closed rather than guessing. `source` is always `'config'`, so
 * a routing event built from these never overstates how the endpoint was found.
 */
export class ConfigCapabilityResolver implements CapabilityResolver {
  constructor(private readonly config: CapabilityConfig) {}

  async resolve(capability: CapabilityNeed): Promise<ResolvedEndpoint> {
    const entry = this.config[capability];
    if (!entry) throw new CapabilityUnresolvedError(capability);
    return { capability, building: entry.building, endpoint: entry.endpoint, source: 'config' };
  }
}
