/**
 * beacon-cache.ts — gateway broadcast layer cache (Cycle C v0.3 P3)
 *
 * Per-tenant cache of upstream `/.well-known/beacon.json` documents. Effect
 * Schedule handles retry semantics declaratively; setInterval drives the
 * 5min refresh cadence; stale-while-revalidate keeps the gateway serving
 * last-known-good beacons for up to 1hr when an upstream is briefly down.
 *
 * Design (per SDD §1.3 + §3.1 + §3.2):
 *   - 5min TTL refresh (matches upstream evolution cadence; not request-blocking)
 *   - Exponential retry: 1s · 2s · 4s (Schedule.exponential(1s) compose recurs(3))
 *   - 1hr stale-while-revalidate ceiling: serve stale on transient failure
 *   - After 1hr: cache evicted, beacon-resolver.ts falls back to tenants.ts curator fields
 *   - Boot-time: void refreshAllBeacons() fires non-blocking · gateway accepts
 *     requests immediately using curator fallback during cold start (~10s window)
 *   - 4s fetch timeout matches health probe cadence (app.ts:45 PROBE_TIMEOUT_MS)
 *
 * The cache is a plain Map (not Effect Cache) because:
 *   1. Cycle D federation index v2 consumes BEACON_CACHE directly (per
 *      coordination contract in docs-dx-sdd §11) — exposing a Map is the
 *      simplest readable shape.
 *   2. We need explicit `source: "fresh"|"stale"|"fallback"` semantics that
 *      Effect Cache's TTL primitives don't naturally express. Stale serving
 *      is a first-class state, not a degradation of fresh.
 *
 * Trust boundary: this module FETCHES from upstream constructs (trusted
 * 0xHoneyJar publishers). Schema decode runs BEFORE cache insert — malformed
 * beacons NEVER reach the cache. Defense-in-depth: beacon-resolver.ts
 * additionally falls back to tenants.ts when cache is empty.
 */

import { Data, Duration, Effect, Schedule, Schema } from "effect";
import { BeaconV2Schema, type BeaconV2 } from "@0xhoneyjar/beacon-schema";
import { TENANTS } from "./tenants.js";

// ────── constants ──────

/** Refresh cadence — every 5 minutes. Heavier than health probe (30s) since
 * beacons rarely change but represent more work to fetch + decode. */
export const BEACON_TTL_MS = 5 * 60 * 1000;

/** Maximum age of a stale entry the gateway will continue serving when
 * upstream is failing. After this, beacon-resolver falls back to tenants.ts. */
export const STALE_CEILING_MS = 60 * 60 * 1000;

/** Per-fetch timeout. Matches PROBE_TIMEOUT_MS in app.ts for consistency. */
export const FETCH_TIMEOUT_MS = 4_000;

// ────── types ──────

/**
 * One cache entry. The `source` discriminator drives /status.json reporting
 * and beacon-resolver fallback decisions.
 *
 *   - fresh : last fetch succeeded; beacon is the canonical truth
 *   - stale : last fetch failed but cache age < 1hr; serve last-known-good
 *   - fallback (NEVER stored here) : signaled by absence-from-Map; resolver
 *                                     uses tenants.ts curator fields
 */
export type CacheEntry = {
  beacon: BeaconV2;
  fetchedAt: number;
  source: "fresh" | "stale";
};

/** Per-tenant cache keyed by slug. Exposed to beacon-resolver.ts and (per
 * Cycle D coordination contract) to the federation index v2 cutover. */
export const BEACON_CACHE: Map<string, CacheEntry> = new Map();

// ────── errors ──────

/** Tagged error for fetch failures. Effect Schedule retries trigger on
 * any failure; we don't differentiate retry semantics by error kind here
 * (a 5xx and a network error both warrant retry-then-stale). */
export class BeaconFetchError extends Data.TaggedError("BeaconFetchError")<{
  readonly upstreamUrl: string;
  readonly status?: number;
  readonly cause?: unknown;
}> {}

// ────── fetch effect ──────

/**
 * Fetch + decode a single upstream's beacon. Returns a typed `BeaconV2` on
 * success or fails the Effect on any error (network, non-2xx, schema decode).
 *
 * Retry policy: exponential backoff 1s · 2s · 4s, then surface the failure
 * to the caller (refreshAllBeacons handles stale-while-revalidate from there).
 *
 * The AbortController binds the fetch to FETCH_TIMEOUT_MS; the timer is
 * always cleared (success or failure path) via Effect.ensuring.
 */
export const fetchBeacon = (
  upstreamUrl: string,
): Effect.Effect<BeaconV2, BeaconFetchError> =>
  Effect.gen(function* () {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

    const res = yield* Effect.tryPromise({
      try: () =>
        fetch(`${upstreamUrl}/.well-known/beacon.json`, {
          signal: ctrl.signal,
        }),
      catch: (cause) => new BeaconFetchError({ upstreamUrl, cause }),
    }).pipe(Effect.ensuring(Effect.sync(() => clearTimeout(timer))));

    if (!res.ok) {
      return yield* Effect.fail(
        new BeaconFetchError({ upstreamUrl, status: res.status }),
      );
    }

    const json = yield* Effect.tryPromise({
      try: () => res.json() as Promise<unknown>,
      catch: (cause) => new BeaconFetchError({ upstreamUrl, cause }),
    });

    return yield* Schema.decodeUnknown(BeaconV2Schema)(json).pipe(
      Effect.mapError(
        (cause) => new BeaconFetchError({ upstreamUrl, cause }),
      ),
    );
  }).pipe(
    Effect.retry(
      Schedule.exponential(Duration.seconds(1)).pipe(
        Schedule.compose(Schedule.recurs(3)),
      ),
    ),
  );

// ────── refresh loop ──────

/**
 * Refresh every tenant's beacon. Fires on boot (non-blocking via void) and
 * every BEACON_TTL_MS thereafter.
 *
 * Failure handling:
 *   - Success → cache entry { source: "fresh", fetchedAt: now }
 *   - Failure + cache age < STALE_CEILING_MS → demote to { source: "stale" }, log warn
 *   - Failure + cache age ≥ STALE_CEILING_MS → evict from cache, log warn
 *     (resolver falls back to tenants.ts curator fields)
 *
 * Errors are logged to stderr (console.warn) — never to a Hono response
 * (gateway never blocks on beacon fetch · always has fallback per PRD §7.2).
 *
 * Returns Promise<void> so the caller can `void refreshAllBeacons()` for
 * fire-and-forget semantics on boot, or `await` for tests.
 */
export async function refreshAllBeacons(): Promise<void> {
  const now = Date.now();

  await Promise.all(
    TENANTS.map(async (tenant) => {
      const result = await Effect.runPromiseExit(fetchBeacon(tenant.upstream));

      if (result._tag === "Success") {
        BEACON_CACHE.set(tenant.slug, {
          beacon: result.value,
          fetchedAt: now,
          source: "fresh",
        });
        return;
      }

      // Failure path · retain stale within ceiling, otherwise evict
      const existing = BEACON_CACHE.get(tenant.slug);
      if (existing && now - existing.fetchedAt < STALE_CEILING_MS) {
        BEACON_CACHE.set(tenant.slug, { ...existing, source: "stale" });
        const ageSec = Math.round((now - existing.fetchedAt) / 1000);
        console.warn(
          `[beacon-cache] ${tenant.slug}: fetch failed; serving stale (age ${ageSec}s)`,
        );
      } else {
        BEACON_CACHE.delete(tenant.slug);
        console.warn(
          `[beacon-cache] ${tenant.slug}: fetch failed AND no usable cache; falling back to curator fields`,
        );
      }
    }),
  );
}

// ────── refresh scheduling ──────

let REFRESH_INTERVAL: ReturnType<typeof setInterval> | undefined;

/**
 * Start the 5min recurring refresh. Idempotent — calling twice does NOT
 * stack intervals. Returns a stop handle for tests.
 */
export function startBeaconRefresh(): () => void {
  if (REFRESH_INTERVAL !== undefined) {
    return stopBeaconRefresh;
  }
  REFRESH_INTERVAL = setInterval(() => {
    // Hotfix 2026-05-04: explicit .catch() · `void` doesn't catch unhandled
    // rejections · Node default crashes the process. Same fix shape as
    // app.ts boot wiring.
    refreshAllBeacons().catch((err: unknown) => {
      console.warn(
        "[beacon-cache] scheduled refreshAllBeacons failed:",
        err,
      );
    });
  }, BEACON_TTL_MS);
  // Don't keep the event loop alive solely for this timer — Node tests
  // and short-lived smokes shouldn't hang waiting for the interval.
  REFRESH_INTERVAL.unref?.();
  return stopBeaconRefresh;
}

/** Stop the recurring refresh. Used by tests; not normally called in prod. */
export function stopBeaconRefresh(): void {
  if (REFRESH_INTERVAL !== undefined) {
    clearInterval(REFRESH_INTERVAL);
    REFRESH_INTERVAL = undefined;
  }
}
