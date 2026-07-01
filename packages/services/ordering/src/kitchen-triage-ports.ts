import { StubTriagePorts, type TriagePorts } from './triage-ports.js';
import { HttpBuildingProbes, httpBuildingProbesFromEnv } from './http-building-probes.js';

/** Delegates to HTTP building probes when KITCHEN_PROBE_HTTP_ENABLED; else stub fallback (SDD §3.4). */
export class KitchenTriagePorts implements TriagePorts {
  private readonly fallback: TriagePorts;
  private readonly http: HttpBuildingProbes | null;

  constructor(http: HttpBuildingProbes | null, fallback: TriagePorts = new StubTriagePorts()) {
    this.http = http;
    this.fallback = fallback;
  }

  sonar = {
    probe: (chainId: string, contract: string) =>
      this.http ? this.http.probeSonar(chainId, contract) : this.fallback.sonar.probe(chainId, contract),
  };
  score = {
    probe: (chainId: string, contract: string) =>
      this.http ? this.http.probeScore(chainId, contract) : this.fallback.score.probe(chainId, contract),
  };
  worlds = {
    probe: (chainId: string, contract: string) =>
      this.http
        ? this.http.probeWorlds(chainId, contract).then((r) => r.status)
        : this.fallback.worlds.probe(chainId, contract),
    probeDetail: (chainId: string, contract: string) =>
      this.http
        ? this.http.probeWorlds(chainId, contract)
        : this.fallback.worlds.probeDetail?.(chainId, contract) ??
          this.fallback.worlds.probe(chainId, contract).then((status) => ({ status })),
  };
  discord = {
    probe: (chainId: string, contract: string) =>
      this.fallback.discord?.probe(chainId, contract) ?? Promise.resolve('optional' as const),
  };
  shadow = {
    probe: (chainId: string, contract: string) => this.fallback.shadow.probe(chainId, contract),
  };

  get httpProbes(): HttpBuildingProbes | null {
    return this.http;
  }
}

export function createKitchenTriagePorts(): TriagePorts {
  const http = httpBuildingProbesFromEnv();
  return new KitchenTriagePorts(http);
}
