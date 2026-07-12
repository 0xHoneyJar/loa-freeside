/**
 * Soju-lens — parallel-fetch the operator's identity across every surface
 * that exposes one. Group by field, surface DISCREPANCIES.
 *
 * The actually-novel observability primitive per bridgebuilder F6. Status
 * display is solved 100 ways; cross-surface identity reconciliation isn't.
 *
 * Probes (when wallet supplied):
 *   identity-api /v1/resolve/wallet/:address   → userId (Phase 1, deployed)
 *   identity-api /v1/profile?wallet=…           → displayName (Phase 2, currently 400)
 *   identity-api /v1/mibera/dimensions?wallet=… → miberaDimensions (Phase 3, currently 400)
 *   honey-road  /api/profile?wallet=…           → displayName (Alchemy fallback today)
 *
 * BERA→Soju gap: until identity-api Phases 2-3 land, honey-road's Alchemy
 * fallback will be the ONLY non-null displayName. That discrepancy is the
 * Soju headline G-6 blocker, immediately legible in the table.
 */

import type { SojuLens, SojuLensRow } from "./types.js";

const FETCH_TIMEOUT_MS = 8000;
const IDENTITY_API = "https://identity-api-production-317b.up.railway.app";
// Canonical mibera.0xhoneyjar.xyz — the raw Next.js app. Server-side probe-safe.
// (NOTE: an unrelated honeyjar.xyz domain that previously appeared in cached
// data is NOT a 0xHoneyJar property — do NOT probe or reference.)
const HONEY_ROAD = "https://mibera.0xhoneyjar.xyz";
const WORLD_SLUG = "mibera"; // THJ world slug per identity-api PRD; tested in routes.test.ts:166

type FetchResult = { observed: string | null; error: string | null };

async function safeFetchJSON<T>(
  url: string,
  extractor: (body: unknown) => string | null,
  errorPrefix: string,
): Promise<FetchResult> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) {
      let body = "";
      try { body = (await res.text()).slice(0, 100); } catch { /* noop */ }
      return { observed: null, error: `${errorPrefix} HTTP ${res.status}${body ? ` — ${body}` : ""}` };
    }
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("application/json")) {
      return { observed: null, error: `${errorPrefix} non-JSON content-type (${ct})` };
    }
    const body = (await res.json().catch(() => null)) as unknown;
    if (body === null) return { observed: null, error: `${errorPrefix} body unparseable` };
    return { observed: extractor(body), error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { observed: null, error: `${errorPrefix} ${msg}` };
  }
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function fieldOf<K extends string>(body: unknown, key: K): string | null {
  if (typeof body !== "object" || body === null) return null;
  const v = (body as Record<string, unknown>)[key];
  return asString(v);
}

export async function collectSojuLens(wallet: string | null): Promise<SojuLens> {
  if (!wallet) {
    return {
      wallet: null,
      rows: [
        {
          surface: "(not configured)",
          field: "displayName",
          observed: null,
          source: "set OPERATOR_WALLET env to enable Soju-lens",
          error: "no wallet supplied",
        },
      ],
      discrepancies: [],
    };
  }

  const promises = [
    safeFetchJSON(
      `${IDENTITY_API}/v1/resolve/wallet/${wallet}`,
      (b) => fieldOf(b, "userId") ?? fieldOf(b, "id"),
      "Phase 1 resolve:",
    ).then<SojuLensRow>((r) => ({
      surface: "identity-api spine",
      field: "userId",
      observed: r.observed,
      source: `/v1/resolve/wallet/${wallet.slice(0, 6)}…${wallet.slice(-4)}`,
      error: r.error,
    })),

    safeFetchJSON(
      // /v1/profile requires world + (wallet XOR userId) — schema is
      // ProfileQuery in freeside-auth/src/api/routes/profile.ts:77.
      `${IDENTITY_API}/v1/profile?world=${WORLD_SLUG}&wallet=${wallet}`,
      (b) => fieldOf(b, "displayName") ?? fieldOf(b, "name"),
      "Phase 2 compose:",
    ).then<SojuLensRow>((r) => ({
      surface: "identity-api compose",
      field: "displayName",
      observed: r.observed,
      source: `/v1/profile?world=${WORLD_SLUG} (G-5)`,
      error: r.error,
    })),

    safeFetchJSON(
      `${IDENTITY_API}/v1/mibera/dimensions?wallet=${wallet}`,
      (b) => {
        if (typeof b !== "object" || b === null) return null;
        const s = JSON.stringify(b);
        return s.length > 80 ? `${s.slice(0, 77)}…` : s;
      },
      "Phase 3 mibera-dims:",
    ).then<SojuLensRow>((r) => ({
      surface: "identity-api mibera-dims",
      field: "miberaDimensions",
      observed: r.observed,
      source: "/v1/mibera/dimensions (G-6)",
      error: r.error,
    })),

    // honey-road's actual API route (verified via mibera-honeyroad/app/api/mibera/
    // dimensions/route.ts). Returns shape:
    //   { source: "identity-api" | "alchemy", degraded: boolean,
    //     degradedReasons: string[], tokens: [...], userId?: string,
    //     primaryWallet: string }
    // We emit 3 rows: source (the discrepancy signal — which backend honey-road
    // actually used), userId (cross-check with identity-api spine row),
    // degraded (boolean flag indicating why fallback may have kicked in).
    fetch(`${HONEY_ROAD}/api/mibera/dimensions?wallet=${wallet}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
      .then(async (res) => {
        if (!res.ok) {
          let body = "";
          try { body = (await res.text()).slice(0, 100); } catch { /* noop */ }
          return { source: null as string | null, userId: null as string | null, degraded: null as string | null, error: `HTTP ${res.status}${body ? ` — ${body}` : ""}` };
        }
        const ct = res.headers.get("content-type") ?? "";
        if (!ct.includes("application/json")) {
          return { source: null, userId: null, degraded: null, error: `non-JSON (${ct}) — bot protection? try canonical URL` };
        }
        const body = (await res.json().catch(() => null)) as unknown;
        if (body === null) return { source: null, userId: null, degraded: null, error: "body unparseable" };
        return {
          source: fieldOf(body, "source"),
          userId: fieldOf(body, "userId"),
          degraded: typeof (body as { degraded?: unknown }).degraded === "boolean"
            ? String((body as { degraded: boolean }).degraded)
            : null,
          error: null,
        };
      })
      .catch((e) => ({
        source: null as string | null, userId: null as string | null, degraded: null as string | null,
        error: e instanceof Error ? e.message : String(e),
      }))
      .then((r) => [
        {
          surface: "honey-road (consumer)",
          field: "honeyRoadSource" as const,
          observed: r.source,
          source: "honey-road /api/mibera/dimensions — `source` field",
          error: r.error,
        },
        {
          surface: "honey-road (consumer)",
          field: "userId" as const,
          observed: r.userId,
          source: "honey-road /api/mibera/dimensions — `userId` field",
          error: r.userId === null && !r.error ? "(undefined when source=alchemy or wallet unresolved)" : r.error,
        },
        {
          surface: "honey-road (consumer)",
          field: "degraded" as const,
          observed: r.degraded,
          source: "honey-road /api/mibera/dimensions — `degraded` field",
          error: r.error,
        },
      ] as SojuLensRow[]),
  ];

  const resolved = await Promise.all(promises);
  // Flatten — the honey-road probe returns an array of 3 rows; everything else
  // returns a single row.
  const rows: SojuLensRow[] = [];
  for (const r of resolved) {
    if (Array.isArray(r)) rows.push(...r);
    else rows.push(r);
  }

  // discrepancy detection: per field, surface conflicting values
  const discrepancies: string[] = [];
  const byField = new Map<string, SojuLensRow[]>();
  for (const r of rows) {
    if (!byField.has(r.field)) byField.set(r.field, []);
    byField.get(r.field)!.push(r);
  }
  for (const [field, group] of byField.entries()) {
    const observedSet = new Set(group.filter((r) => r.observed !== null).map((r) => r.observed!));
    if (observedSet.size > 1) {
      discrepancies.push(
        `DISCREPANCY on \`${field}\`: ${[...observedSet].map((v) => `"${v}"`).join(" vs ")}`,
      );
    }
    const errored = group.filter((r) => r.observed === null && r.error !== null);
    if (errored.length === group.length && group.length > 0) {
      discrepancies.push(
        `MISSING on \`${field}\`: no surface returned a value (all ${group.length} sources errored — likely Phase 2/3 not built)`,
      );
    }
  }

  return { wallet, rows, discrepancies };
}
