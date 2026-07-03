import { StubTriagePorts, type ShadowProbeDetail, type TriagePorts } from './triage-ports.js';
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
  /** True iff NO fallback was injected — the only state the policy may act on. Any injected
   *  fallback (even a stub subclass) counts as a producer and always wins over the policy. */
  private readonly shadowProducerless: boolean;

  constructor(
    http: HttpBuildingProbes | null,
    fallback?: TriagePorts,
    shadowPolicy: ShadowUnavailablePolicy = 'blocked',
  ) {
    this.http = http;
    this.shadowProducerless = fallback === undefined;
    this.fallback = fallback ?? new StubTriagePorts();
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
    // Precedence: a REAL producer (http.probeShadow, when SHADOW_AUDIT_API_URL is set) wins over
    // the policy knob, which wins over the stub. The policy applies ONLY when no producer exists.
    probe: (chainId: string, contract: string) => {
      if (this.http?.hasShadowProbe) return this.http.probeShadow(chainId, contract);
      return this.shadowPolicy === 'optional' && this.shadowProducerless
        ? Promise.resolve('optional' as const)
        : this.fallback.shadow.probe(chainId, contract);
    },
    // Detail variant carries WHY into the durable trail (probe_meta.reason) when the status
    // came from the policy rule rather than a real probe. A real probe reports no reason.
    probeDetail: async (chainId: string, contract: string): Promise<ShadowProbeDetail> => {
      if (this.http?.hasShadowProbe) return { status: await this.http.probeShadow(chainId, contract) };
      return this.shadowPolicy === 'optional' && this.shadowProducerless
        ? { status: 'optional', reason: 'policy_optional_no_producer' }
        : { status: await this.fallback.shadow.probe(chainId, contract) };
    },
  };

  get httpProbes(): HttpBuildingProbes | null {
    return this.http;
  }
}

let warnedShadowProducerless = false;

export function createKitchenTriagePorts(): TriagePorts {
  const http = httpBuildingProbesFromEnv();
  const shadowPolicy = shadowUnavailablePolicyFromEnv();
  if (!warnedShadowProducerless && (http || shadowPolicy === 'optional')) {
    warnedShadowProducerless = true;
    console.warn(
      `[ordering-service] shadow_preview producer-less — policy=${shadowPolicy} (${
        shadowPolicy === 'optional'
          ? 'fulfillment proceeds without preview'
          : 'DARK: stub blocked; operator advance required'
      }; see grimoires/loa/cycles/consumption-truth/e2e-runbook.md)`,
    );
  }
  return new KitchenTriagePorts(http, undefined, shadowPolicy);
}

/** Test seam: reset the once-per-process producer-less warning. */
export function resetShadowProducerlessWarning(): void {
  warnedShadowProducerless = false;
}
