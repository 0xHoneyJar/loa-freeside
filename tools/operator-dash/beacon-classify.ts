// beacon-classify.ts — shape-validating beacon classifier.
//
// Kuang R&D metaloop, iteration 2 (2026-06-27). Fixes the false-positive the iter-1
// discovery audit found: probeBeacon() classified ANY 2xx as a "live" beacon without
// reading the body — so storage-api's GraphQL-playground catch-all (200 text/html)
// masked as discoverable. A 200 is the building flattering you; a parseable BeaconV3
// is the behavior. The discovery meter validates the SHAPE, not the HTTP status.
//
// Pure + side-effect-free so the meter (dash.beacon-classify.test.ts) can settle it
// deterministically against fixtures — no network.

export type BeaconState =
  | "live" // 2xx AND a parseable BeaconV3
  | "masked" // 2xx but NOT a beacon (catch-all 200 — the storage case)
  | "auth-gated" // 401/403 — per-building beacons MAY be authenticated (ADR-007 D-8); verify intent
  | "scaffold" // 5xx / unexpected — route exists but broken (the score "beacon_unavailable" case)
  | "404" // no route
  | "unreachable" // DNS/network/timeout
  | "not-registered";

/** Does a 2xx body actually look like a BeaconV3? Required: a recognizable identity field
 *  (slug|name|is) AND a recognizable schema marker (schema_version 2/3 | capabilities | is). */
export function isBeaconShape(body: string): boolean {
  let d: unknown;
  try {
    d = JSON.parse(body);
  } catch {
    return false; // not JSON at all (HTML playground, plain text) → not a beacon
  }
  if (!d || typeof d !== "object") return false;
  const o = d as Record<string, unknown>;
  const hasSchema =
    ["2", "3"].includes(String(o.schema_version)) || "capabilities" in o || "is" in o;
  const hasIdentity = "slug" in o || "name" in o || "is" in o;
  return hasSchema && hasIdentity;
}

/** Classify a beacon probe response by STATUS + SHAPE. The whole point: a 2xx alone is
 *  never "live" — it must carry a valid BeaconV3 body. */
export function classifyBeacon(status: number, body: string): BeaconState {
  if (status === 404) return "404";
  if (status === 401 || status === 403) return "auth-gated";
  if (status >= 200 && status < 300) return isBeaconShape(body) ? "live" : "masked";
  return "scaffold"; // 5xx / other — route present but not serving a beacon
}
