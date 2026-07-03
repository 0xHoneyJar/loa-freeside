import { StubTriagePorts, type TriagePorts } from './triage-ports.js';
import { HttpBuildingProbes, httpBuildingProbesFromEnv } from './http-building-probes.js';

/**
 * What shadow_preview reports while NO shadow-audit producer exists (cycle consumption-truth
 * S1-T1 finding: no deployed audit surface, in-process adapter unwired, probe contract needs
 * owner_wallet the preset lacks — see grimoires/loa/cycles/consumption-truth/e2e-runbook.md).
 *
 * - `blocked` (default): today's exact behavior — stub `blocked`, operator advances by hand.
 * - `optional`: fulfillment honestly proceeds WITHOUT a preview ("capability not deployed");
 *   `canFulfillCommunityOnboarding` already accepts complete|optional. Deliberate operator flip.
 */
// loa:shortcut: real probeShadow deferred to producer-decision bead arrakis-r3kr; wire it when a
// shadow-audit producer (deployed surface + probe-satisfiable read) exists, then retire this knob.
export type ShadowUnavailablePolicy = 'blocked' | 'optional';

export function shadowUnavailablePolicyFromEnv(): ShadowUnavailablePolicy {
  return process.env.SHADOW_PREVIEW_UNAVAILABLE_POLICY?.trim() === 'optional' ? 'optional' : 'blocked';
}

/** Delegates to HTTP building probes when KITCHEN_PROBE_HTTP_ENABLED; else stub fallback (SDD §3.4). */
export class KitchenTriagePorts implements TriagePorts {
  private readonly fallback: TriagePorts;
  private readonly http: HttpBuildingProbes | null;
  private readonly shadowPolicy: ShadowUnavailablePolicy;

  constructor(
    http: HttpBuildingProbes | null,
    fallback: TriagePorts = new StubTriagePorts(),
    shadowPolicy: ShadowUnavailablePolicy = 'blocked',
  ) {
    this.http = http;
    this.fallback = fallback;
    this.shadowPolicy = shadowPolicy;
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
    // Policy applies ONLY when no real shadow producer exists (the default stub). A custom
    // fallback or future http probeShadow leg always wins — policy can never mask a real probe.
    probe: (chainId: string, contract: string) =>
      this.shadowPolicy === 'optional' && this.fallback instanceof StubTriagePorts
        ? Promise.resolve('optional' as const)
        : this.fallback.shadow.probe(chainId, contract),
  };

  get httpProbes(): HttpBuildingProbes | null {
    return this.http;
  }
}

export function createKitchenTriagePorts(): TriagePorts {
  const http = httpBuildingProbesFromEnv();
  const shadowPolicy = shadowUnavailablePolicyFromEnv();
  if (shadowPolicy === 'optional') {
    console.warn(
      '[ordering-service] shadow_preview: no producer configured — policy=optional, fulfillment proceeds without preview',
    );
  } else if (http) {
    console.warn(
      '[ordering-service] shadow probe: DARK (stub blocked — no shadow-audit producer; see grimoires/loa/cycles/consumption-truth/e2e-runbook.md)',
    );
  }
  return new KitchenTriagePorts(http, undefined, shadowPolicy);
}
