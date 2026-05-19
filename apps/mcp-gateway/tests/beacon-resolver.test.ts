/**
 * Unit tests · src/beacon-resolver.ts
 *
 * Per Sprint 3 AC-3 + AC-9:
 *   - cache present (fresh)  → mergeFromBeacon · beacon B-axis wins · age < 1hr
 *   - cache present (stale)  → mergeFromBeacon · beaconSource: stale
 *   - cache absent           → mergeFromTenant · beaconSource: fallback · log once
 *   - registry policy (A-axis) ALWAYS from tenants.ts (beacon cannot self-promote)
 *   - name/description from tenants.ts even when beacon present
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveTenant,
  _resetFallbackLog,
} from "../src/beacon-resolver.js";
import { BEACON_CACHE } from "../src/beacon-cache.js";
import type { Tenant } from "../src/tenants.js";
import type { BeaconV2 } from "@0xhoneyjar/beacon-schema";

// ── fixtures ──

const CURATOR_TENANT: Tenant = {
  slug: "score",
  name: "Score Mibera",
  description: "Curator description",
  publisher: "Curator-Publisher",
  upstream: "https://score-api.example.com",
  auth: "api-key",
  authHeader: "X-Curator-Header",
  documentation: "https://curator-docs.example.com",
  status: "live",
  visibility: "internal",
  access: "api-key",
  capabilities: ["tools"],
  pricing: { model: "free", description: "curator pricing" },
  owner: { handle: "0xHoneyJar", contact: "https://github.com/0xHoneyJar" },
};

function makeBeacon(): BeaconV2 {
  return {
    schema_version: "2",
    mcp: {
      shape: "data",
      paths: ["remote-http"],
      auth: {
        kind: "api-key",
        header: "X-MCP-Key",
        credentials_ref: { type: "railway-secret", key: "MCP_SCORE_UPSTREAM_KEY" },
      },
      capabilities: ["tools", "logging"],
      tools: ["get_zone_digest", "list_factors"],
      pricing: { model: "free", description: "broadcast pricing" },
      publisher: "Beacon-Publisher",
      documentation: "https://beacon-docs.example.com",
    },
    payment: { enabled: false },
  } as BeaconV2;
}

function withClearedCache(fn: () => void): void {
  BEACON_CACHE.clear();
  _resetFallbackLog();
  try {
    fn();
  } finally {
    BEACON_CACHE.clear();
    _resetFallbackLog();
  }
}

// ── cache present (fresh) ──

test("cache present (fresh) → beacon B-axis wins · A-axis from tenants.ts", () => {
  withClearedCache(() => {
    const beacon = makeBeacon();
    const fetchedAt = Date.now() - 30_000; // 30s ago
    BEACON_CACHE.set("score", { beacon, fetchedAt, source: "fresh" });

    const resolved = resolveTenant(CURATOR_TENANT);

    // A-axis · always from tenants.ts (registry policy)
    assert.equal(resolved.slug, "score");
    assert.equal(resolved.upstream, "https://score-api.example.com");
    assert.equal(resolved.visibility, "internal");
    assert.equal(resolved.access, "api-key");
    assert.equal(resolved.status, "live");
    assert.equal(resolved.name, "Score Mibera"); // beacon doesn't carry name
    assert.equal(resolved.description, "Curator description"); // beacon doesn't carry description

    // B-axis · from beacon
    assert.equal(resolved.publisher, "Beacon-Publisher");
    assert.equal(resolved.authKind, "api-key");
    assert.equal(resolved.authHeader, "X-MCP-Key");
    assert.deepEqual(resolved.credentialsRef, {
      type: "railway-secret",
      key: "MCP_SCORE_UPSTREAM_KEY",
    });
    assert.deepEqual([...resolved.capabilities], ["tools", "logging"]);
    assert.deepEqual(resolved.pricing, { model: "free", description: "broadcast pricing" });
    assert.equal(resolved.documentation, "https://beacon-docs.example.com");

    // metadata
    assert.equal(resolved.beaconSource, "fresh");
    assert.ok(resolved.beaconAgeSec !== null && resolved.beaconAgeSec >= 29 && resolved.beaconAgeSec <= 32);
  });
});

// ── cache present (stale) ──

test("cache present (stale) → beaconSource: stale · still uses beacon B-axis", () => {
  withClearedCache(() => {
    const beacon = makeBeacon();
    const fetchedAt = Date.now() - 45 * 60 * 1000; // 45min ago (within 1hr ceiling)
    BEACON_CACHE.set("score", { beacon, fetchedAt, source: "stale" });

    const resolved = resolveTenant(CURATOR_TENANT);
    assert.equal(resolved.beaconSource, "stale");
    assert.equal(resolved.publisher, "Beacon-Publisher"); // still beacon
    assert.ok(resolved.beaconAgeSec !== null && resolved.beaconAgeSec > 2600);
  });
});

// ── cache absent (fallback) ──

test("cache absent → mergeFromTenant · beaconSource: fallback · null age", () => {
  withClearedCache(() => {
    const resolved = resolveTenant(CURATOR_TENANT);
    assert.equal(resolved.beaconSource, "fallback");
    assert.equal(resolved.beaconAgeSec, null);

    // B-axis comes from tenants.ts
    assert.equal(resolved.publisher, "Curator-Publisher");
    assert.equal(resolved.authKind, "api-key");
    assert.equal(resolved.authHeader, "X-Curator-Header");
    assert.equal(resolved.credentialsRef, undefined); // tenants.ts has none
    assert.equal(resolved.documentation, "https://curator-docs.example.com");
  });
});

// ── once-per-slug-per-boot logging ──

test("fallback path logs once per slug per boot", () => {
  withClearedCache(() => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
    try {
      resolveTenant(CURATOR_TENANT);
      resolveTenant(CURATOR_TENANT);
      resolveTenant(CURATOR_TENANT);
    } finally {
      console.warn = originalWarn;
    }
    const fallbackWarns = warnings.filter((w) =>
      w.includes("[beacon-resolver] score"),
    );
    assert.equal(fallbackWarns.length, 1, `expected exactly 1 fallback warning, got ${fallbackWarns.length}: ${warnings.join("\n")}`);
  });
});

// ── beacon documentation override ──

test("beacon.documentation overrides tenants.ts when present", () => {
  withClearedCache(() => {
    const beacon = makeBeacon();
    BEACON_CACHE.set("score", { beacon, fetchedAt: Date.now(), source: "fresh" });
    const resolved = resolveTenant(CURATOR_TENANT);
    assert.equal(resolved.documentation, "https://beacon-docs.example.com");
  });
});

test("beacon.documentation falls back to tenants.ts when beacon omits it", () => {
  withClearedCache(() => {
    const beacon = makeBeacon();
    delete (beacon.mcp as { documentation?: string }).documentation;
    BEACON_CACHE.set("score", { beacon, fetchedAt: Date.now(), source: "fresh" });
    const resolved = resolveTenant(CURATOR_TENANT);
    assert.equal(resolved.documentation, "https://curator-docs.example.com");
  });
});
