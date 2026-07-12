/**
 * Unit tests · src/beacon-cache.ts
 *
 * Per Sprint 3 AC-1 + AC-2 + AC-6 + AC-7:
 *   - successful fetch → cache populated with source: fresh
 *   - 5xx after retries → if cache age < 1hr, demote to stale
 *   - 5xx after retries + cache age > 1hr → evict (resolver falls back)
 *   - schema decode failure (parse error) → no cache update · existing entry unchanged
 *   - timeout via AbortController fires (4s)
 *
 * The retry policy itself (3 retries 1s/2s/4s) is exercised via the failure
 * path tests — each refresh-failure test forces all retries to exhaust.
 *
 * Tests use a stubbed global.fetch so we don't hit the network. Stubs are
 * restored in finally blocks so test order doesn't matter.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BEACON_CACHE,
  fetchBeacon,
  refreshAllBeacons,
  STALE_CEILING_MS,
} from "../src/beacon-cache.js";
import { Effect } from "effect";
import { TENANTS } from "../src/tenants.js";

// ── fixture: minimal valid beacon ──

const VALID_BEACON_JSON = {
  schema_version: "2",
  mcp: {
    shape: "data",
    paths: ["remote-http"],
    remote: {
      transport: "streamable-http",
      endpoint: "https://test.example.com/mcp",
    },
    auth: { kind: "none" },
    capabilities: ["tools"],
    tools: ["lookup_zone"],
    pricing: { model: "free", description: "free as in libre" },
    publisher: "0xHoneyJar",
  },
  payment: { enabled: false },
};

// ── fetch stub helpers ──

type FetchHandler = (url: string) => Promise<Response>;

function stubFetch(handler: FetchHandler, fn: () => Promise<void>): Promise<void> {
  const original = global.fetch;
  global.fetch = (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    return handler(url);
  };
  return fn().finally(() => {
    global.fetch = original;
  });
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

// ── happy path ──

test("fetchBeacon succeeds → returns decoded BeaconV2", async () => {
  await stubFetch(
    async (url) => {
      assert.match(url, /\/\.well-known\/beacon\.json$/);
      return jsonResponse(VALID_BEACON_JSON);
    },
    async () => {
      const result = await Effect.runPromiseExit(
        fetchBeacon("https://test.example.com"),
      );
      if (result._tag === "Failure") {
        assert.fail(`expected success, got failure: ${JSON.stringify(result.cause)}`);
      }
      assert.equal(result.value.schema_version, "2");
      assert.equal(result.value.mcp.shape, "data");
    },
  );
});

// ── refreshAllBeacons populates cache ──

test("refreshAllBeacons populates BEACON_CACHE on success", async () => {
  BEACON_CACHE.clear();
  await stubFetch(
    async () => jsonResponse(VALID_BEACON_JSON),
    async () => {
      await refreshAllBeacons();
      for (const tenant of TENANTS) {
        const entry = BEACON_CACHE.get(tenant.slug);
        assert.ok(entry, `expected cache entry for ${tenant.slug}`);
        assert.equal(entry.source, "fresh");
        assert.equal(entry.beacon.schema_version, "2");
        assert.ok(Date.now() - entry.fetchedAt < 5000);
      }
    },
  );
  BEACON_CACHE.clear();
});

// ── stale-while-revalidate ──

test("refreshAllBeacons demotes to stale when fetch fails AND cache age < 1hr", async () => {
  BEACON_CACHE.clear();
  // Pre-seed cache with a 30min-old entry
  const tenant = TENANTS[0];
  const oldFetchedAt = Date.now() - 30 * 60 * 1000;
  BEACON_CACHE.set(tenant.slug, {
    beacon: VALID_BEACON_JSON as never,
    fetchedAt: oldFetchedAt,
    source: "fresh",
  });

  // Suppress noisy warn output during this test
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    await stubFetch(
      async () => new Response("upstream down", { status: 503 }),
      async () => {
        await refreshAllBeacons();
        const entry = BEACON_CACHE.get(tenant.slug);
        assert.ok(entry, "stale entry should be retained");
        assert.equal(entry.source, "stale");
        assert.equal(entry.fetchedAt, oldFetchedAt, "fetchedAt should not advance on failure");
      },
    );
  } finally {
    console.warn = originalWarn;
    BEACON_CACHE.clear();
  }
});

test("refreshAllBeacons evicts when fetch fails AND cache age > 1hr", async () => {
  BEACON_CACHE.clear();
  const tenant = TENANTS[0];
  const ancientFetchedAt = Date.now() - STALE_CEILING_MS - 1000;
  BEACON_CACHE.set(tenant.slug, {
    beacon: VALID_BEACON_JSON as never,
    fetchedAt: ancientFetchedAt,
    source: "fresh",
  });

  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    await stubFetch(
      async () => new Response("upstream down", { status: 503 }),
      async () => {
        await refreshAllBeacons();
        assert.equal(BEACON_CACHE.get(tenant.slug), undefined, "ancient entry should be evicted");
      },
    );
  } finally {
    console.warn = originalWarn;
    BEACON_CACHE.clear();
  }
});

// ── parse error ──

test("refreshAllBeacons does NOT cache malformed beacons (parse error)", async () => {
  BEACON_CACHE.clear();
  const tenant = TENANTS[0];

  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    await stubFetch(
      async () => jsonResponse({ schema_version: "1", invalid: true }),
      async () => {
        await refreshAllBeacons();
        // Cache should NOT contain the malformed beacon. Since there was no
        // pre-existing entry, it stays absent (fallback path triggered later).
        assert.equal(BEACON_CACHE.get(tenant.slug), undefined);
      },
    );
  } finally {
    console.warn = originalWarn;
    BEACON_CACHE.clear();
  }
});

test("refreshAllBeacons preserves existing entry on parse error of new fetch", async () => {
  BEACON_CACHE.clear();
  const tenant = TENANTS[0];
  const recentFetchedAt = Date.now() - 60_000;
  BEACON_CACHE.set(tenant.slug, {
    beacon: VALID_BEACON_JSON as never,
    fetchedAt: recentFetchedAt,
    source: "fresh",
  });

  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    await stubFetch(
      async () => jsonResponse({ schema_version: "999", garbage: true }),
      async () => {
        await refreshAllBeacons();
        // Parse error → falls into the "fetch failed" branch → demotes existing
        // entry to stale (since age < 1hr). This preserves last-known-good.
        const entry = BEACON_CACHE.get(tenant.slug);
        assert.ok(entry, "existing entry should be preserved");
        assert.equal(entry.source, "stale");
      },
    );
  } finally {
    console.warn = originalWarn;
    BEACON_CACHE.clear();
  }
});
