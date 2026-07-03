import type { IngredientStatus } from '@freeside/ordering-protocol';

export interface WorldsProbeDetail {
  status: IngredientStatus;
  world_slug?: string;
}

export interface ShadowProbeDetail {
  status: IngredientStatus;
  /** Present when the status came from a rule rather than a real probe
   *  (e.g. `policy_optional_no_producer`) — flows into probe_meta.reason. */
  reason?: string;
}

/**
 * Ingredient fulfillment ports for preset #2 (SDD §3.2.4).
 * MVP stubs return `pending` on probe; operator advance-ingredient unblocks fulfillment.
 */
export interface TriagePorts {
  sonar: {
    probe(chainId: string, contract: string): Promise<IngredientStatus>;
  };
  score: {
    probe(chainId: string, contract: string): Promise<IngredientStatus>;
  };
  worlds: {
    probe(chainId: string, contract: string): Promise<IngredientStatus>;
    probeDetail?(chainId: string, contract: string): Promise<WorldsProbeDetail>;
  };
  discord?: {
    probe(chainId: string, contract: string): Promise<IngredientStatus>;
  };
  shadow: {
    probe(chainId: string, contract: string): Promise<IngredientStatus>;
    probeDetail?(chainId: string, contract: string): Promise<ShadowProbeDetail>;
  };
}

/** MVP default: all probes return pending until operator advance. */
export class StubTriagePorts implements TriagePorts {
  sonar = { probe: async (_chainId: string, _contract: string) => 'pending' as const };
  score = { probe: async (_chainId: string, _contract: string) => 'pending' as const };
  worlds = {
    probe: async (_chainId: string, _contract: string) => 'pending' as const,
    probeDetail: async (_chainId: string, _contract: string) => ({ status: 'pending' as const }),
  };
  discord = { probe: async (_chainId: string, _contract: string) => 'optional' as const };
  shadow = { probe: async (_chainId: string, _contract: string) => 'blocked' as const };
}
