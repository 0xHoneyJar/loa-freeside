import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { CapabilityNeed } from '@freeside/ordering-protocol';
import { type CapabilityResolver, type ResolvedEndpoint, CapabilityUnresolvedError } from './resolver.js';

const execFileAsync = promisify(execFile);

/**
 * S3-T2 — capability resolution via `loa where`, the graduation from `ConfigCapabilityResolver`
 * behind the SAME `CapabilityResolver` PORT (SDD §6, §13 B-1→agent-nav). Maps each capability to
 * the building that publishes it (the declaration), asks `loa where <building>` for the LIVE
 * endpoint, and labels `source: 'loa-where'` so routing events truthfully report agent-navigation.
 *
 * Fail-closed: an unmapped capability, or `found:false` / no endpoint from `loa where`, →
 * `CapabilityUnresolvedError`. Until the network discovery plane is populated (S3-T1 registry
 * declarations + grants, OPERATOR-GATED), `loa where` returns `found:false` for the audit's
 * buildings (SDD §12.0) and this resolver fails closed — which is honest, not broken.
 */

/** Normalized `loa where` result — the resolver depends on THIS, not the raw CLI JSON shape. */
export interface LoaWhereResult {
  found: boolean;
  endpoint?: string;
}

export type LoaWhereInvoker = (destination: string) => Promise<LoaWhereResult>;

export class LoaWhereCapabilityResolver implements CapabilityResolver {
  constructor(
    private readonly capabilityToBuilding: Partial<Record<CapabilityNeed, string>>,
    private readonly invoke: LoaWhereInvoker,
  ) {}

  async resolve(capability: CapabilityNeed): Promise<ResolvedEndpoint> {
    const building = this.capabilityToBuilding[capability];
    if (!building) throw new CapabilityUnresolvedError(capability);
    const result = await this.invoke(building);
    if (!result.found || !result.endpoint) throw new CapabilityUnresolvedError(capability);
    return { capability, building, endpoint: result.endpoint, source: 'loa-where' };
  }
}

/**
 * Default invoker: shells `loa where <destination> --json` (execFile, no shell → no injection) and
 * normalizes. `found:false` is the verified empty-plane response. For `found:true` the endpoint is
 * taken from the first hint that looks like a URL; if found-but-no-endpoint, it returns
 * `{found:false}` so the resolver fails closed rather than FABRICATING an endpoint (never silently
 * wrong). The exact `found:true` hint shape should be confirmed against a live grant before relying on it.
 */
export function makeLoaWhereInvoker(loaBin = 'loa'): LoaWhereInvoker {
  return async (destination: string): Promise<LoaWhereResult> => {
    let stdout: string;
    try {
      ({ stdout } = await execFileAsync(loaBin, ['where', destination, '--json'], { timeout: 10_000 }));
    } catch {
      return { found: false }; // loa unavailable / non-zero exit → fail closed
    }
    let parsed: { found?: boolean; hints?: unknown[] };
    try {
      parsed = JSON.parse(stdout);
    } catch {
      return { found: false };
    }
    if (!parsed.found) return { found: false };
    const endpoint = firstUrlHint(parsed.hints);
    return endpoint ? { found: true, endpoint } : { found: false };
  };
}

function firstUrlHint(hints: unknown[] | undefined): string | undefined {
  if (!Array.isArray(hints)) return undefined;
  for (const h of hints) {
    if (typeof h === 'string' && /^https?:\/\//.test(h)) return h;
    if (h && typeof h === 'object') {
      const e = (h as Record<string, unknown>).endpoint ?? (h as Record<string, unknown>).url;
      if (typeof e === 'string' && /^https?:\/\//.test(e)) return e;
    }
  }
  return undefined;
}
