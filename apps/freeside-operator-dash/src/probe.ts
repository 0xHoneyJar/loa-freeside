/**
 * Probe each cell's deployment_url for liveness.
 *
 * gateway-probe-mismatch-aware: per-cell HEALTH_PATH_OVERRIDES table corrects
 * the path the gateway's probeTenant() gets wrong (score-api serves health
 * at `/`, not `/healthz`). Until tenants.ts grows a `health_path` field, this
 * override map is the source of truth.
 */

import type { RegistryCell, CellProbe, ProbeStateKind } from "./types.js";

const PROBE_TIMEOUT_MS = 6000;

/**
 * Per-cell path override. Default probe path is `/health`; override for cells
 * whose runtime serves health at a different path.
 */
const HEALTH_PATH_OVERRIDES: Record<string, string> = {
  "score-api": "/", // returns full status JSON: {status:"ok", db:"connected", ...}
  "sonar-api": "/", // returns {message:"Sonar API"}
  "storage-api": "/", // GraphQL playground HTML; non-404 means alive
  "inventory-api": "/", // MCP server; 401 expected (auth-gated → still "up")
};

function probePathFor(slug: string): string {
  return HEALTH_PATH_OVERRIDES[slug] ?? "/health";
}

function interpret(
  slug: string,
  statusCode: number | null,
  latencyMs: number | null,
): { state: ProbeStateKind; note: string | null } {
  if (statusCode === null) return { state: "unreachable", note: "DNS/network/timeout" };

  // inventory-api specifically: 401 is the auth-gated MCP server's expected response
  if (slug === "inventory-api" && (statusCode === 401 || statusCode === 403)) {
    return { state: "auth-gated", note: "MCP server alive (auth required)" };
  }

  if (statusCode >= 200 && statusCode < 400) {
    const slow = latencyMs !== null && latencyMs > 1500;
    return { state: slow ? "degraded" : "up", note: slow ? `slow ${latencyMs}ms` : null };
  }
  if (statusCode === 401 || statusCode === 403) {
    return { state: "auth-gated", note: `auth-gated (HTTP ${statusCode})` };
  }
  if (statusCode === 404) return { state: "scaffold", note: "endpoint 404 — not deployed at this URL" };
  if (statusCode >= 500) return { state: "down", note: `5xx ${statusCode}` };
  return { state: "degraded", note: `unexpected ${statusCode}` };
}

async function probeOne(cell: RegistryCell): Promise<CellProbe> {
  if (!cell.deployment_url) {
    return {
      slug: cell.slug,
      url: null,
      state: cell.runtime_state === "not-built" ? "down" : "unreachable",
      statusCode: null,
      latencyMs: null,
      bodyExcerpt: null,
      error: cell.runtime_state === "not-built" ? "no runtime — not built" : "no deployment_url in registry",
      note: cell.runtime_state === "not-built" ? "registry marks this cell not-built" : null,
      probedPath: "(none)",
    };
  }
  const path = probePathFor(cell.slug);
  const url = `${cell.deployment_url}${path}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  const start = Date.now();
  try {
    const res = await fetch(url, { method: "GET", signal: ctrl.signal });
    clearTimeout(timer);
    const latencyMs = Date.now() - start;
    let body = "";
    try {
      body = (await res.text()).slice(0, 200).replace(/\s+/g, " ").trim();
    } catch {
      body = "";
    }
    const { state, note } = interpret(cell.slug, res.status, latencyMs);
    return {
      slug: cell.slug,
      url,
      state,
      statusCode: res.status,
      latencyMs,
      bodyExcerpt: body || null,
      error: null,
      note,
      probedPath: path,
    };
  } catch (err) {
    clearTimeout(timer);
    return {
      slug: cell.slug,
      url,
      state: "unreachable",
      statusCode: null,
      latencyMs: null,
      bodyExcerpt: null,
      error: err instanceof Error ? err.message : String(err),
      note: "DNS/network/timeout",
      probedPath: path,
    };
  }
}

export async function probeAll(cells: RegistryCell[]): Promise<CellProbe[]> {
  return Promise.all(cells.map((c) => probeOne(c)));
}
