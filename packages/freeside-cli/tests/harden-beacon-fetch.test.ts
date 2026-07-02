/**
 * Security tests · SSRF beacon fetcher guards (beacon-consumer S1-T3, SDD D3).
 *
 * Driven through the SHARED conformance vectors (S1-T2, beacon-schema/test-vectors) so
 * freeside-cli and loa-cli assert the SAME host-allowlist bypass + CIDR-block set. All
 * network-free: the pure guards (`normalizeHost`/`isHostAllowlisted`/`isBlockedAddress`)
 * are exercised directly, and the fetcher's pre-fetch reject paths (scheme/allowlist)
 * return before any socket is opened.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  normalizeHost,
  isHostAllowlisted,
  isBlockedAddress,
  hardenedBeaconFetcher,
  makeHardenedBeaconFetcher,
  type HardenTransport,
} from "../src/lib/harden-beacon-fetch.js";

const ALLOWED_URL = "https://sonar.0xhoneyjar.xyz/.well-known/beacon.json";

const vectors = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../beacon-schema/test-vectors/orientation-conformance.json", import.meta.url)),
    "utf8",
  ),
) as {
  host_guard: Array<{ name: string; url: string; expect: { reject: boolean; detail?: string } }>;
  private_range: Array<{ name: string; resolves: string[]; expect: { detail: string | null } }>;
};

/** Mirror the fetcher's pre-fetch guard order (scheme → normalize → allowlist) via the real exports. */
function guardUrl(rawUrl: string): { reject: boolean; detail?: string } {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return { reject: true, detail: "transport_error" };
  }
  if (u.protocol !== "https:") return { reject: true, detail: "scheme_rejected" };
  if (u.port && u.port !== "443") return { reject: true, detail: "host_not_allowlisted" }; // BC-006
  const host = normalizeHost(u.hostname);
  if (!host) return { reject: true, detail: "transport_error" };
  if (!isHostAllowlisted(host)) return { reject: true, detail: "host_not_allowlisted" };
  return { reject: false };
}

// ── host-allowlist bypass vectors (shared conformance suite) ──────────────────

test("host_guard conformance vectors — allowlist matches on dot-boundary, not substring", () => {
  assert.ok(vectors.host_guard.length >= 8, "expected the shared host_guard vectors to be present");
  for (const v of vectors.host_guard) {
    const got = guardUrl(v.url);
    assert.equal(got.reject, v.expect.reject, `${v.name}: reject`);
    if (v.expect.detail) assert.equal(got.detail, v.expect.detail, `${v.name}: detail`);
  }
});

// ── private/metadata/reserved CIDR block set (shared conformance suite) ───────

test("private_range conformance vectors — ANY blocked resolved IP rejects the whole set", () => {
  assert.ok(vectors.private_range.length >= 10, "expected the shared private_range vectors to be present");
  for (const v of vectors.private_range) {
    const anyBlocked = v.resolves.some(isBlockedAddress);
    assert.equal(anyBlocked, v.expect.detail === "resolved_private", v.name);
  }
});

// ── direct guard-function edge cases (not all expressible as full URLs) ───────

test("normalizeHost canonicalizes and rejects malformed hosts", () => {
  assert.equal(normalizeHost("SONAR.0xHoneyJar.XYZ"), "sonar.0xhoneyjar.xyz");
  assert.equal(normalizeHost("sonar.0xhoneyjar.xyz."), "sonar.0xhoneyjar.xyz"); // one trailing dot stripped
  assert.equal(normalizeHost(""), null);
  assert.equal(normalizeHost("has space.xyz"), null); // domainToASCII rejects
  assert.equal(normalizeHost("host:8080"), null); // embedded port rejected defensively
});

test("isBlockedAddress: IPv4-mapped IPv6 is unwrapped and blocked in BOTH dotted and hex form (F1)", () => {
  assert.equal(isBlockedAddress("::ffff:169.254.169.254"), true); // dotted metadata
  assert.equal(isBlockedAddress("::ffff:a9fe:a9fe"), true); // HEX form of 169.254.169.254 — no bypass
  assert.equal(isBlockedAddress("::ffff:7f00:1"), true); // HEX form of 127.0.0.1 loopback
  assert.equal(isBlockedAddress("::ffff:0a00:0005"), true); // HEX form of 10.0.0.5 RFC1918
  assert.equal(isBlockedAddress("::ffff:93.184.216.34"), false); // mapped public → allowed
  assert.equal(isBlockedAddress("::ffff:5db8:d822"), false); // hex mapped public (= 93.184.216.34) → allowed
  assert.equal(isBlockedAddress("::"), true); // unspecified
  assert.equal(isBlockedAddress("::1"), true); // loopback
  assert.equal(isBlockedAddress("fe80::1"), true); // link-local
  assert.equal(isBlockedAddress("not-an-ip"), true); // non-IP literal → fail-closed
});

// ── fetcher integration: pre-fetch rejects return before any socket (network-free) ──

test("hardenedBeaconFetcher rejects http scheme before opening a socket", async () => {
  const r = await hardenedBeaconFetcher("http://sonar.0xhoneyjar.xyz/.well-known/beacon.json");
  assert.equal(r.status, 0);
  assert.equal(r.error, "scheme_rejected");
  assert.equal(r.body, "");
});

test("hardenedBeaconFetcher rejects a non-allowlisted host before opening a socket", async () => {
  const r = await hardenedBeaconFetcher("https://evil.example.com/.well-known/beacon.json");
  assert.equal(r.status, 0);
  assert.equal(r.error, "host_not_allowlisted");
  assert.equal(r.body, "");
});

test("hardenedBeaconFetcher rejects the suffix-as-substring bypass (evil0xhoneyjar.xyz)", async () => {
  const r = await hardenedBeaconFetcher("https://evil0xhoneyjar.xyz/.well-known/beacon.json");
  assert.equal(r.error, "host_not_allowlisted");
});

test("BC-001: shared multi-tenant PaaS apexes are NOT allowlisted (vercel.app / up.railway.app)", async () => {
  for (const host of ["attacker.vercel.app", "attacker.up.railway.app"]) {
    const r = await hardenedBeaconFetcher(`https://${host}/.well-known/beacon.json`);
    assert.equal(r.error, "host_not_allowlisted", host);
  }
});

test("BC-006: an explicit non-443 port is rejected before any socket", async () => {
  const r = await hardenedBeaconFetcher("https://sonar.0xhoneyjar.xyz:8443/.well-known/beacon.json");
  assert.equal(r.error, "host_not_allowlisted");
  assert.equal(r.status, 0);
});

test("BC-002: a malformed redirect Location does NOT throw — classified transport_error", async () => {
  const transport: HardenTransport = {
    resolveAll: async () => [{ address: "93.184.216.34", family: 4 }],
    get: async () => ({ status: 302, location: "https://", body: "" }), // unparseable Location
  };
  const r = await makeHardenedBeaconFetcher(transport)("https://sonar.0xhoneyjar.xyz/b.json");
  assert.equal(r.status, 0);
  assert.equal(r.error, "transport_error");
  assert.equal(r.body, "");
});

// ── DNS-rebinding TOCTOU + private-range reject (injected transport, network-free) ──

test("resolved-private: an allowlisted host resolving to a private IP → resolved_private, NO connect", async () => {
  let connected = false;
  const transport: HardenTransport = {
    resolveAll: async () => [{ address: "169.254.169.254", family: 4 }], // cloud metadata
    get: async () => {
      connected = true;
      return { status: 200, location: null, body: "{}" };
    },
  };
  const r = await makeHardenedBeaconFetcher(transport)(ALLOWED_URL);
  assert.equal(r.error, "resolved_private");
  assert.equal(connected, false, "guard must reject before any socket connect");
});

test("mixed records: ANY private record rejects the whole set (split-horizon defense)", async () => {
  const transport: HardenTransport = {
    resolveAll: async () => [
      { address: "93.184.216.34", family: 4 }, // public
      { address: "10.0.0.5", family: 4 }, // private — poisons the set
    ],
    get: async () => ({ status: 200, location: null, body: "{}" }),
  };
  const r = await makeHardenedBeaconFetcher(transport)(ALLOWED_URL);
  assert.equal(r.error, "resolved_private");
});

test("DNS-rebinding: connect pins to the VALIDATED resolved IP, not a re-resolution", async () => {
  // Precheck resolves a public IP; the fetcher must connect to THAT ip (no second lookup at
  // connect time), so a rebinding swap to a private address after the check cannot take effect.
  const validated = "93.184.216.34";
  let connectedIp: string | null = null;
  const transport: HardenTransport = {
    resolveAll: async () => [{ address: validated, family: 4 }],
    get: async ({ ip, host }) => {
      connectedIp = ip;
      assert.equal(host, "sonar.0xhoneyjar.xyz", "SNI/cert host stays the declared host");
      return { status: 200, location: null, body: '{"ok":true}' };
    },
  };
  const r = await makeHardenedBeaconFetcher(transport)(ALLOWED_URL);
  assert.equal(connectedIp, validated, "connect used the pre-validated IP (rebinding TOCTOU closed)");
  assert.equal(r.status, 200);
});
