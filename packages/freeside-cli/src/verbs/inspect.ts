/**
 * `loa freeside inspect <slug>` — fetch a cell's beacon and render the keyed orientation
 * packet (beacon-consumer S1-T4, SDD D2). Was a stub; now the first live beacon consumer.
 *
 * Composes the SSRF-safe `hardenedBeaconFetcher` (the security core, S1-T3) + `validateBeaconV3`
 * + `buildOrientationPacket`. (doctor's `probeBeacon` is NOT reused directly: it discards the
 * response body, which inspect needs to render the beacon fields — the load-bearing pieces
 * reused are the hardened fetcher and the V3 validator.)
 */
import { loadRegistry, type Registry } from "@freeside/freeside-registry";
import {
  validateBeaconV3,
  buildOrientationPacket,
  BEACON_EXIT,
  type OrientationPacket,
  type OrientationProbeInput,
  type OrientationBeaconInput,
  type BeaconClassification,
  type VerdictDetail,
} from "@freeside/beacon-schema";
import { hardenedBeaconFetcher, normalizeHost, type RemoteFetchResult } from "../lib/harden-beacon-fetch.js";

export interface InspectResult {
  readonly packet?: OrientationPacket;
  readonly error?: { error: string; slug?: string; available_slugs?: string[]; detail?: VerdictDetail };
  readonly exit: number;
  /** `--raw`: the raw fetched beacon JSON (null when not beacon_valid). */
  readonly raw?: unknown;
}

const ERROR_DETAIL: Record<string, VerdictDetail> = {
  scheme_rejected: "scheme_rejected",
  host_not_allowlisted: "host_not_allowlisted",
  resolved_private: "resolved_private",
  timeout: "timeout",
  transport_error: "transport_error",
};

/** Map a fetch outcome → the 5-class classification + detail + parsed beacon (SDD D5). */
function classify(
  fetched: RemoteFetchResult,
  declaredUrl: string,
  expectedSlug: string,
): { classification: BeaconClassification; detail: VerdictDetail; beacon?: OrientationBeaconInput } {
  if (fetched.error) {
    if (fetched.error === "oversize") return { classification: "beacon_invalid", detail: "oversize" };
    const detail = ERROR_DETAIL[fetched.error] ?? "transport_error";
    return { classification: "beacon_unreachable", detail };
  }
  // off-host redirect (the fetcher surfaces it as a changed finalUrl host) → void.
  const declaredHost = normalizeHost(safeHostname(declaredUrl));
  const finalHost = normalizeHost(safeHostname(fetched.finalUrl));
  if (declaredHost && finalHost && finalHost !== declaredHost) {
    return { classification: "beacon_void", detail: "off_host_redirect" };
  }
  if (fetched.status >= 200 && fetched.status < 300) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(fetched.body);
    } catch {
      return { classification: "beacon_invalid", detail: "invalid_beacon" };
    }
    const v = validateBeaconV3(parsed);
    if (!v.ok) return { classification: "beacon_invalid", detail: "invalid_beacon" };
    if (v.beacon.slug !== expectedSlug) return { classification: "beacon_dark", detail: "slug_mismatch" };
    return { classification: "beacon_valid", detail: "ok", beacon: toBeaconInput(v.beacon) };
  }
  // reachable host, non-2xx (404 / non-beacon) → dark.
  return { classification: "beacon_dark", detail: "not_found" };
}

function toBeaconInput(b: {
  publisher: string;
  is: { one_liner: string; scope: readonly string[] };
  is_not: readonly string[];
  capabilities?: readonly string[];
  composes_with?: Readonly<Record<string, { role: string; tag: string; required: boolean }>>;
  cycle_state: { status: string; since: string; next_review: string };
  mcp?: unknown;
  cli?: unknown;
}): OrientationBeaconInput {
  return {
    publisher: b.publisher,
    is: b.is.one_liner, // BeaconV3 `is` is {one_liner, scope}; the orientation packet renders the one-liner.
    is_not: b.is_not,
    capabilities: b.capabilities,
    // Distill each composition edge to its fully-qualified interface tag (the type-checkable
    // reference an orienting agent needs) — drop role/required prose to keep the packet lean.
    composes_with: b.composes_with
      ? Object.fromEntries(Object.entries(b.composes_with).map(([slug, edge]) => [slug, edge.tag]))
      : undefined,
    cycle_state: b.cycle_state.status, // BeaconV3 cycle_state is {status, since, next_review}; render the lifecycle status.
    mcp: b.mcp,
    cli: b.cli,
  };
}

/**
 * Inspect a cell (pure; fetcher injectable for network-free tests). Returns the packet +
 * exit code, or an error envelope (unknown slug → exit 1 + available_slugs).
 */
export async function inspectModule(
  slug: string,
  opts: { fetcher?: (url: string) => Promise<RemoteFetchResult>; registry?: Registry } = {},
): Promise<InspectResult> {
  const registry = opts.registry ?? loadRegistry();
  const fetcher = opts.fetcher ?? hardenedBeaconFetcher;

  const entry = registry.modules[slug];
  if (!entry) {
    return {
      exit: BEACON_EXIT.unknown_slug,
      error: { error: `unknown module: ${slug}`, slug, available_slugs: Object.keys(registry.modules).sort() },
    };
  }

  const reg = {
    slug,
    beacon_url: entry.beacon_url ?? null,
    deployment_url: entry.deployment_url ?? null,
    runtime_state: entry.runtime_state ?? null,
  };

  // No declared beacon_url → cannot fetch; honest dark (registry fields still render).
  if (!reg.beacon_url) {
    const probe: OrientationProbeInput = { classification: "beacon_dark", detail: "not_found", target: "" };
    const packet = buildOrientationPacket(reg, probe);
    return { packet, exit: BEACON_EXIT.beacon_dark, raw: null };
  }

  const fetched = await fetcher(reg.beacon_url);
  const { classification, detail, beacon } = classify(fetched, reg.beacon_url, slug);
  const probe: OrientationProbeInput = { classification, detail, target: reg.beacon_url };
  const packet = buildOrientationPacket(reg, probe, beacon);
  const raw = classification === "beacon_valid" ? safeParse(fetched.body) : null;
  return { packet, exit: BEACON_EXIT[classification], raw };
}

function safeParse(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function safeHostname(u: string): string {
  try {
    return new URL(u).hostname;
  } catch {
    return "";
  }
}
