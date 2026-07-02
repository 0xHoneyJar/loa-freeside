/**
 * OrientationPacket — the keyed building→orientation READ shape (beacon-consumer cycle, SDD D0/D1).
 *
 * SINGLE OWNER of the packet contract. `freeside-cli inspect` imports this directly; the
 * external `loa-cli` mirrors the shape and pins parity via the shared conformance vectors
 * (`test-vectors/orientation-conformance.json`).
 *
 * Deliberately a PLAIN interface (not an Effect Schema): it is a derived RENDER shape, not a
 * wire contract that needs decode-validation, and loa-cli (zero-dep pure-.mjs) cannot import
 * Effect. Both surfaces build the same value; the conformance suite is the drift alarm.
 */

/** Classification of a beacon fetch+validate attempt (SDD D5). Maps to a stable exit code. */
export type BeaconClassification =
  | "beacon_valid" // 200 + host-pinned + valid BeaconV3 whose slug matches
  | "beacon_dark" // correct host, 404 / non-BeaconV3 body / sibling's beacon (slug mismatch)
  | "beacon_void" // redirected off the declared host (SSRF host-pin guard)
  | "beacon_invalid" // fetched a body but it fails BeaconV3 decode/validate, or oversize
  | "beacon_unreachable"; // transport failure / timeout / pre-fetch guard reject

/** Enumerated, agent-parseable detail (SDD IMP-005). NEVER contains a response body substring. */
export type VerdictDetail =
  | "ok"
  | "scheme_rejected"
  | "host_not_allowlisted"
  | "resolved_private"
  | "off_host_redirect"
  | "not_found"
  | "not_a_beacon"
  | "slug_mismatch"
  | "invalid_beacon"
  | "oversize"
  | "timeout"
  | "transport_error"
  | "unknown_slug";

export interface OrientationVerdict {
  readonly reachable: boolean;
  readonly beacon_valid: boolean;
  readonly classification: BeaconClassification;
  readonly detail: VerdictDetail;
  readonly target: string; // the declared beacon_url probed
}

export interface OrientationPacket {
  readonly slug: string;
  // ── beacon-derived (null unless classification === "beacon_valid") ──
  readonly publisher: string | null;
  readonly is: string | null;
  readonly is_not: readonly string[] | null;
  readonly capabilities: readonly string[] | null;
  readonly composes_with: Readonly<Record<string, string>> | null;
  readonly cycle_state: string | null;
  readonly transport: { readonly mcp: boolean; readonly cli: boolean } | null;
  // ── registry-derived (ALWAYS present) ──
  readonly deployment_url: string | null;
  readonly runtime_state: string;
  // ── verdict (ALWAYS present) ──
  readonly verdict: OrientationVerdict;
}

/** Registry-side inputs the builder needs (a subset of ModuleEntry — kept minimal + repo-portable). */
export interface OrientationRegistryInput {
  readonly slug: string;
  readonly beacon_url: string | null;
  readonly deployment_url?: string | null;
  readonly runtime_state?: string | null;
}

/** The beacon fields the builder reads when the beacon is valid (a subset of BeaconV3). */
export interface OrientationBeaconInput {
  readonly publisher: string;
  readonly is: string;
  readonly is_not: readonly string[];
  readonly capabilities?: readonly string[];
  readonly composes_with?: Readonly<Record<string, string>>;
  readonly cycle_state: string;
  readonly mcp?: unknown;
  readonly cli?: unknown;
}

/** The probe outcome the builder reads (a subset of doctor's BeaconProbe + the mapped classification). */
export interface OrientationProbeInput {
  readonly classification: BeaconClassification;
  readonly detail: VerdictDetail;
  readonly target: string;
}

/**
 * Build the orientation packet (SDD D0). TOTAL — never throws.
 *
 * Missing-field policy (SDD IMP-006): beacon fields are populated ONLY when
 * `probe.classification === "beacon_valid"` AND `beacon` is present; otherwise they are `null`.
 * Beacon data is NEVER partial-filled from an invalid/partial beacon (an invalid beacon →
 * `beacon_invalid`, all beacon fields null, packet still returned). A packet never presents
 * unvalidated beacon data as authoritative.
 */
export function buildOrientationPacket(
  registry: OrientationRegistryInput,
  probe: OrientationProbeInput,
  beacon?: OrientationBeaconInput,
): OrientationPacket {
  const valid = probe.classification === "beacon_valid" && beacon !== undefined;
  return {
    slug: registry.slug,
    publisher: valid ? beacon!.publisher : null,
    is: valid ? beacon!.is : null,
    is_not: valid ? beacon!.is_not : null,
    capabilities: valid ? beacon!.capabilities ?? [] : null,
    composes_with: valid ? beacon!.composes_with ?? {} : null,
    cycle_state: valid ? beacon!.cycle_state : null,
    transport: valid ? { mcp: beacon!.mcp !== undefined, cli: beacon!.cli !== undefined } : null,
    deployment_url: registry.deployment_url ?? null,
    runtime_state: registry.runtime_state ?? "unknown",
    verdict: {
      reachable: probe.classification === "beacon_valid" || probe.classification === "beacon_dark" || probe.classification === "beacon_invalid",
      beacon_valid: probe.classification === "beacon_valid",
      classification: probe.classification,
      detail: probe.detail,
      target: probe.target,
    },
  };
}

/** SDD D5 / FR-5a — the ONE exit-code table, shared by inspect + loa model. */
export const BEACON_EXIT: Record<BeaconClassification | "unknown_slug" | "ok", number> = {
  ok: 0,
  beacon_valid: 0,
  unknown_slug: 1,
  beacon_unreachable: 2,
  beacon_invalid: 3,
  beacon_dark: 4,
  beacon_void: 5,
};
