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

const FETCH_TIMEOUT_MS = 6000;
const IDENTITY_API = "https://identity-api-production-317b.up.railway.app";
const HONEY_ROAD = "https://mibera.honeyjar.xyz";

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
      `${IDENTITY_API}/v1/profile?wallet=${wallet}`,
      (b) => fieldOf(b, "displayName") ?? fieldOf(b, "name"),
      "Phase 2 compose:",
    ).then<SojuLensRow>((r) => ({
      surface: "identity-api compose",
      field: "displayName",
      observed: r.observed,
      source: "/v1/profile (G-5)",
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

    safeFetchJSON(
      `${HONEY_ROAD}/api/profile?wallet=${wallet}`,
      (b) => fieldOf(b, "name") ?? fieldOf(b, "displayName") ?? fieldOf(b, "username"),
      "honey-road (Alchemy):",
    ).then<SojuLensRow>((r) => ({
      surface: "honey-road (reads Alchemy)",
      field: "displayName",
      observed: r.observed,
      source: "honey-road /api/profile",
      error: r.error,
    })),
  ];

  const rows = await Promise.all(promises);

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
