import { StubTriagePorts, type TriagePorts } from './triage-ports.js';

/** Delegates to stub probes until KITCHEN_PROBE_HTTP_ENABLED wires building HTTP clients. */
export class KitchenTriagePorts implements TriagePorts {
  private readonly fallback = new StubTriagePorts();

  sonar = {
    probe: (chainId: string, contract: string) => this.fallback.sonar.probe(chainId, contract),
  };
  score = {
    probe: (chainId: string, contract: string) => this.fallback.score.probe(chainId, contract),
  };
  worlds = {
    probe: (chainId: string, contract: string) => this.fallback.worlds.probe(chainId, contract),
  };
  discord = {
    probe: (chainId: string, contract: string) =>
      this.fallback.discord?.probe(chainId, contract) ?? Promise.resolve('optional' as const),
  };
  shadow = {
    probe: (chainId: string, contract: string) => this.fallback.shadow.probe(chainId, contract),
  };
}

export function createKitchenTriagePorts(): TriagePorts {
  if (process.env.KITCHEN_PROBE_HTTP_ENABLED === 'true') {
    // K3: swap HttpBuildingProbes when upstream APIs ship.
    return new KitchenTriagePorts();
  }
  return new KitchenTriagePorts();
}
