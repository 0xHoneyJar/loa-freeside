/**
 * hardenBeaconFetch — SSRF-safe beacon fetcher (beacon-consumer S1-T3, SDD D3).
 *
 * Fetching a registry-supplied `beacon_url` is a network read path that must be safe even if
 * the registry is compromised. Guards, in order:
 *   (a) https-only
 *   (b) canonical host allowlist (IDNA-normalized, dot-boundary) — the PRIMARY control
 *   (c) DNS resolve + reject if ANY resolved address is private/loopback/link-local/metadata
 *   (d) IP-PINNED fetch — connect ONLY to the validated resolved IP (closes the DNS-rebinding
 *       TOCTOU: no re-resolution at connect time), TLS SNI/cert preserved against the host
 *   (e) size cap + timeout; off-host redirects → void; errors carry no body/headers.
 *
 * Zero-dep: stdlib only (node:https, node:dns, node:net, node:url). Returns doctor's
 * `RemoteFetchResult` shape so it drops into `probeBeacon` as the injected fetcher.
 */
import { request as httpsRequest } from "node:https";
import { lookup as dnsLookupCb } from "node:dns";
import { isIP } from "node:net";
import { domainToASCII } from "node:url";
import type { RemoteFetchResult } from "../verbs/doctor.js";

// Re-export so the fetcher's consumers (inspect) import the result shape from one place.
export type { RemoteFetchResult } from "../verbs/doctor.js";

/** Cluster-controlled domain suffixes the beacon_url host MUST match (SDD D3b). */
export const ALLOWED_BEACON_HOST_SUFFIXES: readonly string[] = [
  "0xhoneyjar.xyz",
  "up.railway.app",
  "vercel.app",
];

const REQUEST_TIMEOUT_MS = 12_000; // matches doctor's REMOTE_TIMEOUT_MS
const MAX_BODY_BYTES = 256 * 1024;
const MAX_REDIRECTS = 3;

/** Canonicalize a URL host: lowercase, strip exactly one trailing dot, IDNA→ASCII.
 *  Returns null for a syntactically invalid host (SDD D3b, flatline SKP-002/003). */
export function normalizeHost(rawHost: string): string | null {
  if (!rawHost) return null;
  // reject embedded userinfo/port at this layer (URL already split them, but be defensive)
  if (rawHost.includes("@") || rawHost.includes(":") || rawHost.includes("/")) return null;
  let host = rawHost.toLowerCase();
  if (host.endsWith(".")) host = host.slice(0, -1); // strip exactly one trailing dot
  if (!host) return null;
  const ascii = domainToASCII(host); // IDNA/punycode; returns "" on invalid
  if (!ascii) return null;
  return ascii;
}

/** Allowlist match: exact host OR dot-boundary suffix (never a substring match). */
export function isHostAllowlisted(normalizedHost: string): boolean {
  return ALLOWED_BEACON_HOST_SUFFIXES.some(
    (suffix) => normalizedHost === suffix || normalizedHost.endsWith("." + suffix),
  );
}

/** Complete private/loopback/link-local/metadata/reserved block set, v4 + v6 + IPv4-mapped. */
export function isBlockedAddress(ip: string): boolean {
  const fam = isIP(ip);
  if (fam === 4) return isBlockedV4(ip);
  if (fam === 6) return isBlockedV6(ip);
  return true; // not a valid IP literal → block (fail-closed)
}

function isBlockedV4(ip: string): boolean {
  const parts = ip.split(".").map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  const u = ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
  const inRange = (netStr: string, bits: number): boolean => {
    const np = netStr.split(".").map(Number);
    const net = ((np[0] << 24) >>> 0) + (np[1] << 16) + (np[2] << 8) + np[3];
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (u & mask) === (net & mask);
  };
  return (
    inRange("0.0.0.0", 8) || // "this network" / unspecified
    inRange("10.0.0.0", 8) ||
    inRange("100.64.0.0", 10) || // CGNAT
    inRange("127.0.0.0", 8) || // loopback
    inRange("169.254.0.0", 16) || // link-local incl. 169.254.169.254 cloud metadata
    inRange("172.16.0.0", 12) ||
    inRange("192.0.0.0", 24) || // IETF protocol assignments
    inRange("192.168.0.0", 16) ||
    inRange("198.18.0.0", 15) || // benchmarking
    a === 224 || (a >= 224 && a <= 239) || // 224/4 multicast
    a >= 240 // 240/4 reserved incl. 255.255.255.255 broadcast
  );
}

function isBlockedV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  // IPv4-mapped ::ffff:a.b.c.d — unwrap and re-check as v4.
  const mapped = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isBlockedV4(mapped[1]);
  if (lower === "::1" || lower === "::") return true; // loopback / unspecified
  if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true; // fe80::/10 link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7 ULA
  if (lower.startsWith("ff")) return true; // ff00::/8 multicast
  return false;
}

/** A resolved GET result from the low-level transport (redirect bodies are drained). */
export interface PinnedGetResult {
  readonly status: number;
  readonly location: string | null;
  readonly body: string;
  readonly error?: string;
}

/**
 * The injectable transport seam. Splitting resolve + connect out of the guard logic is what
 * makes the security-critical fetcher testable WITHOUT a live socket (DNS-rebinding + redirect
 * behavior): a test supplies a fake `resolveAll` (public/private/mixed records) and a fake `get`
 * (canned status/redirects), and asserts the guard + pin decisions. Production uses `realTransport`.
 */
export interface HardenTransport {
  /** Resolve a host to ALL its A/AAAA records (default: node:dns lookup, {all:true}). */
  readonly resolveAll: (host: string) => Promise<Array<{ address: string; family: number }>>;
  /** One GET, PINNED to the pre-validated `ip` (no connect-time re-resolution). */
  readonly get: (args: { url: string; host: string; ip: string; family: 4 | 6 }) => Promise<PinnedGetResult>;
}

/** Resolve + validate a host via the transport; a pinnable {ip, family} or a guard-reject detail. */
async function resolveValidated(
  resolveAll: HardenTransport["resolveAll"],
  host: string,
): Promise<{ ok: true; ip: string; family: 4 | 6 } | { ok: false; detail: "resolved_private" | "transport_error" }> {
  const all = await resolveAll(host).catch(() => null);
  if (!all || all.length === 0) return { ok: false, detail: "transport_error" };
  // Reject if ANY resolved record is blocked (defense against split-horizon / mixed records).
  if (all.some((a) => isBlockedAddress(a.address))) return { ok: false, detail: "resolved_private" };
  const first = all[0];
  return { ok: true, ip: first.address, family: first.family === 6 ? 6 : 4 };
}

/** One IP-pinned https GET (no re-resolution at connect — pins to `ip`, SNI = original host). */
function pinnedGet(urlStr: string, host: string, ip: string, family: 4 | 6): Promise<PinnedGetResult> {
  return new Promise((resolve) => {
    const u = new URL(urlStr);
    const req = httpsRequest(
      {
        protocol: "https:",
        host,
        servername: host, // TLS SNI + cert hostname verified against the declared host
        path: u.pathname + u.search,
        method: "GET",
        timeout: REQUEST_TIMEOUT_MS,
        // PIN: connect only to the pre-validated IP; no connect-time re-resolution (rebinding TOCTOU closed).
        lookup: (_hostname, _opts, cb) => cb(null, ip as never, family),
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = res.headers.location ?? null;
        if (status >= 300 && status < 400) {
          res.resume(); // drain, do not read a redirect body
          resolve({ status, location, body: "" });
          return;
        }
        let body = "";
        let bytes = 0;
        let aborted = false;
        res.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > MAX_BODY_BYTES) {
            aborted = true;
            req.destroy();
            resolve({ status, location: null, body: "", error: "oversize" });
            return;
          }
          body += chunk.toString("utf8");
        });
        res.on("end", () => {
          if (!aborted) resolve({ status, location: null, body });
        });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({ status: 0, location: null, body: "", error: "timeout" });
    });
    req.on("error", (err) => resolve({ status: 0, location: null, body: "", error: err.message }));
    req.end();
  });
}

/** Production transport: node:dns resolve-all + the IP-pinned node:https GET above. */
const realTransport: HardenTransport = {
  resolveAll: (host) =>
    new Promise((resolve, reject) => {
      dnsLookupCb(host, { all: true }, (err, addrs) =>
        err ? reject(err) : resolve(addrs as Array<{ address: string; family: number }>),
      );
    }),
  get: ({ url, host, ip, family }) => pinnedGet(url, host, ip, family),
};

/**
 * Build the SSRF-safe fetcher (a `BeaconFetcher`) over a transport. Applies all D3 guards in
 * order, follows only same-host redirects (each re-validated + re-pinned), surfaces off-host as
 * `finalUrl` (→ void) and every reject as a status-0 result whose `error` is an enumerated detail
 * (never a body). `transport` is injectable so the guard/pin/redirect logic is testable offline.
 */
export function makeHardenedBeaconFetcher(transport: HardenTransport = realTransport) {
  return async (rawUrl: string): Promise<RemoteFetchResult> => {
    let current = rawUrl;
    const declaredHost = safeHost(rawUrl);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      let u: URL;
      try {
        u = new URL(current);
      } catch {
        return { status: 0, finalUrl: current, body: "", error: "transport_error" };
      }
      if (u.protocol !== "https:") return { status: 0, finalUrl: current, body: "", error: "scheme_rejected" };
      const host = normalizeHost(u.hostname);
      if (!host) return { status: 0, finalUrl: current, body: "", error: "transport_error" };
      if (!isHostAllowlisted(host)) return { status: 0, finalUrl: current, body: "", error: "host_not_allowlisted" };

      const resolved = await resolveValidated(transport.resolveAll, host);
      if (!resolved.ok) return { status: 0, finalUrl: current, body: "", error: resolved.detail };

      // PIN: connect to the validated IP only (no re-resolution at connect — rebinding TOCTOU closed).
      const res = await transport.get({ url: current, host, ip: resolved.ip, family: resolved.family });
      if (res.error) return { status: res.status, finalUrl: current, body: "", error: res.error };

      if (res.status >= 300 && res.status < 400) {
        if (!res.location) return { status: res.status, finalUrl: current, body: "" };
        const next = new URL(res.location, current).toString();
        // off-host redirect → surface finalUrl so the host-integrity guard classifies VOID.
        if (safeHost(next) !== declaredHost) return { status: res.status, finalUrl: next, body: "" };
        current = next; // same-host → re-loop (re-validated + re-pinned)
        continue;
      }
      return { status: res.status, finalUrl: current, body: res.body };
    }
    return { status: 0, finalUrl: current, body: "", error: "transport_error" }; // too many redirects
  };
}

/** The production SSRF-safe fetcher (real DNS + IP-pinned node:https). */
export const hardenedBeaconFetcher = makeHardenedBeaconFetcher();

function safeHost(u: string): string {
  try {
    return normalizeHost(new URL(u).hostname) ?? "";
  } catch {
    return "";
  }
}
