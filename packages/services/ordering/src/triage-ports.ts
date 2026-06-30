import type { IngredientStatus } from '@freeside/ordering-protocol';

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
  };
  discord?: {
    probe(chainId: string, contract: string): Promise<IngredientStatus>;
  };
  shadow: {
    probe(chainId: string, contract: string): Promise<IngredientStatus>;
  };
}

/** MVP default: all probes return pending until operator advance. */
export class StubTriagePorts implements TriagePorts {
  sonar = { probe: async () => 'pending' as const };
  score = { probe: async () => 'pending' as const };
  worlds = { probe: async () => 'pending' as const };
  discord = { probe: async () => 'optional' as const };
  shadow = { probe: async () => 'blocked' as const };
}
