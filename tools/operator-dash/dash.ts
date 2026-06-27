#!/usr/bin/env tsx
/**
 * freeside operator-dash — single-pane observability snapshot
 *
 * runs server-side probes, builds a self-contained HTML report at
 *   tools/operator-dash/dash.html
 *
 * usage:
 *   tsx tools/operator-dash/dash.ts                     # snapshot
 *   tsx tools/operator-dash/dash.ts --wallet 0xABC      # soju-lens by wallet
 *   tsx tools/operator-dash/dash.ts --serve             # live serve at :3030
 *   OPERATOR_WALLET=0xABC tsx tools/operator-dash/dash.ts
 *
 * design notes:
 *  - probes run in node, no browser CORS concerns
 *  - HTML is fully baked at generation time; no JS fetches
 *  - to refresh, re-run; live mode polls every 30s on its own server
 *  - this is the v0.1 "lightweight HTML site" — substrate question
 *    (where this eventually lives) is in
 *    grimoires/loa/proposals/freeside-federation-topology.md
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { parse as parseYaml } from "yaml";
import { readFileSync, existsSync } from "node:fs";

// ─────────────────────────── types ──────────────────────────────────────────

import { classifyBeacon, type BeaconState } from "./beacon-classify";

type ProbeState = "up" | "down" | "degraded" | "scaffold" | "unreachable" | "auth-gated";

type EndpointProbe = {
  surface: string;
  endpoint: string;
  url: string;
  method: "GET" | "POST";
  expected: { kind: "ok" } | { kind: "status"; code: number } | { kind: "auth" } | { kind: "any" };
  result: {
    state: ProbeState;
    statusCode: number | null;
    latencyMs: number | null;
    bodyExcerpt: string | null;
    error: string | null;
    note: string | null;
  };
};

type FederationTile = {
  slug: string;
  registryEntry: { beaconUrl: string; visibility: string; owner: string } | null;
  beaconState: BeaconState;
  beaconLatencyMs: number | null;
  // building, not yet declared in registry, but we know about it:
  knownLive: boolean;
  hostUrl: string | null;
  hostStatus: number | null;
};

type PhaseRow = {
  phase: 1 | 2 | 3 | 4;
  name: string;
  goalIds: string[];
  goalNotes: string[];
  status: "deployed" | "scaffolded" | "not-built";
  evidence: string[];
  beadsRefs: string[];
};

type SojuLensRow = {
  surface: string;
  field: "displayName" | "primaryWallet" | "miberaDimensions";
  observed: string | null;
  source: string;
  error: string | null;
};

type DashState = {
  generatedAt: string;
  generatorVersion: string;
  operatorWallet: string | null;
  probes: EndpointProbe[];
  tiles: FederationTile[];
  phases: PhaseRow[];
  sojuLens: SojuLensRow[];
  discrepancies: string[];
  warnings: string[];
};

// ─────────────────────────── probe helpers ──────────────────────────────────

async function probe(
  surface: string,
  endpoint: string,
  url: string,
  method: "GET" | "POST",
  expected: EndpointProbe["expected"],
  timeoutMs = 6000,
): Promise<EndpointProbe> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const start = Date.now();
  try {
    const res = await fetch(url, { method, signal: ctrl.signal });
    clearTimeout(timer);
    const latencyMs = Date.now() - start;
    let body = "";
    try {
      body = (await res.text()).slice(0, 240);
    } catch {
      body = "";
    }
    const statusCode = res.status;
    const { state, note } = interpret(statusCode, expected, latencyMs);
    return {
      surface,
      endpoint,
      url,
      method,
      expected,
      result: { state, statusCode, latencyMs, bodyExcerpt: body || null, error: null, note },
    };
  } catch (err) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    return {
      surface,
      endpoint,
      url,
      method,
      expected,
      result: {
        state: "unreachable",
        statusCode: null,
        latencyMs: null,
        bodyExcerpt: null,
        error: msg,
        note: "DNS/network/timeout",
      },
    };
  }
}

function interpret(
  status: number,
  expected: EndpointProbe["expected"],
  latencyMs: number,
): { state: ProbeState; note: string | null } {
  const slow = latencyMs > 1500;
  if (expected.kind === "ok") {
    if (status >= 200 && status < 300) {
      return { state: slow ? "degraded" : "up", note: slow ? `slow ${latencyMs}ms` : null };
    }
    if (status === 401 || status === 403) return { state: "auth-gated", note: "auth-gated (unexpected for /health)" };
    if (status === 404) return { state: "scaffold", note: "endpoint missing" };
    if (status >= 500) return { state: "down", note: `5xx ${status}` };
    return { state: "scaffold", note: `unexpected ${status}` };
  }
  if (expected.kind === "auth") {
    if (status === 401 || status === 403) {
      return { state: "auth-gated", note: "auth scaffold present (expected)" };
    }
    if (status >= 200 && status < 300) {
      return { state: "up", note: "no-auth response (cookie may be present)" };
    }
    if (status === 404) return { state: "scaffold", note: "endpoint missing" };
    return { state: "degraded", note: `unexpected ${status}` };
  }
  if (expected.kind === "status") {
    if (status === expected.code) return { state: "up", note: null };
    if (status === 404) return { state: "scaffold", note: "endpoint missing" };
    return { state: "degraded", note: `got ${status}, expected ${expected.code}` };
  }
  // any
  if (status >= 200 && status < 500) return { state: "up", note: `responded ${status}` };
  if (status >= 500) return { state: "down", note: `5xx ${status}` };
  return { state: "degraded", note: `status ${status}` };
}

// ─────────────────────────── probe targets ──────────────────────────────────

const IDENTITY_API = "https://identity-api-production-317b.up.railway.app";
const MCP_GATEWAY = "https://mcp.0xhoneyjar.xyz";
const HONEY_ROAD = "https://mibera.0xhoneyjar.xyz";
// (NOTE: mibera.honeyjar.xyz appeared in earlier probe data but honeyjar.xyz
// is NOT a 0xHoneyJar property — do not reference.)

async function collectProbes(): Promise<EndpointProbe[]> {
  const targets: Array<{
    surface: string;
    endpoint: string;
    url: string;
    method: "GET" | "POST";
    expected: EndpointProbe["expected"];
  }> = [
    // identity-api — Phase 1 surface
    { surface: "identity-api", endpoint: "/health", url: `${IDENTITY_API}/health`, method: "GET", expected: { kind: "ok" } },
    { surface: "identity-api", endpoint: "/v1/me", url: `${IDENTITY_API}/v1/me`, method: "GET", expected: { kind: "auth" } },
    { surface: "identity-api", endpoint: "/openapi.json", url: `${IDENTITY_API}/openapi.json`, method: "GET", expected: { kind: "ok" } },
    // identity-api — Phase 2 (compose) — currently 400
    { surface: "identity-api", endpoint: "/v1/profile", url: `${IDENTITY_API}/v1/profile`, method: "GET", expected: { kind: "auth" } },
    // identity-api — Phase 3 (mibera dims) — currently 400
    { surface: "identity-api", endpoint: "/v1/mibera/dimensions", url: `${IDENTITY_API}/v1/mibera/dimensions`, method: "GET", expected: { kind: "auth" } },
    // mcp-gateway — federation manifest
    { surface: "mcp-gateway", endpoint: "/.well-known/federation.json", url: `${MCP_GATEWAY}/.well-known/federation.json`, method: "GET", expected: { kind: "ok" } },
    { surface: "mcp-gateway", endpoint: "/healthz", url: `${MCP_GATEWAY}/healthz`, method: "GET", expected: { kind: "ok" } },
    // honey road — consumer surfaces (the operator's window)
    { surface: "mibera-honeyroad", endpoint: "/ (canonical)", url: `${HONEY_ROAD}/`, method: "GET", expected: { kind: "ok" } },
    { surface: "mibera-honeyroad", endpoint: "/ (fast cname)", url: `${HONEY_ROAD}/`, method: "GET", expected: { kind: "ok" } },
  ];
  return await Promise.all(targets.map((t) => probe(t.surface, t.endpoint, t.url, t.method, t.expected)));
}

// ─────────────────────────── registry / federation tiles ────────────────────

function loadRegistry(): Record<string, { beacon_url: string; visibility: string; owner: string }> {
  const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const path = join(REPO_ROOT, "packages", "freeside-registry", "registry.yaml");
  if (!existsSync(path)) return {};
  try {
    const txt = readFileSync(path, "utf8");
    const yaml = parseYaml(txt) as { modules?: Record<string, { beacon_url: string; visibility: string; owner: string }> };
    return yaml.modules ?? {};
  } catch (err) {
    console.warn(`[registry] failed to parse: ${err instanceof Error ? err.message : err}`);
    return {};
  }
}

async function probeBeacon(beaconUrl: string): Promise<{ state: FederationTile["beaconState"]; latency: number | null }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  const start = Date.now();
  try {
    const res = await fetch(beaconUrl, { signal: ctrl.signal });
    clearTimeout(t);
    // Kuang iter-2: classify by SHAPE, not just status — a catch-all 200 (e.g. a GraphQL
    // playground) is NOT a live beacon. The meter validates the body parses as a BeaconV3.
    let body = "";
    try {
      body = await res.text();
    } catch {
      body = "";
    }
    return { state: classifyBeacon(res.status, body), latency: Date.now() - start };
  } catch {
    clearTimeout(t);
    return { state: "unreachable", latency: null };
  }
}

// Buildings we know about but that may NOT be in registry.yaml yet
const KNOWN_LIVE_BUILDINGS: Record<string, { hostUrl: string; rationale: string }> = {
  "identity-api": { hostUrl: IDENTITY_API, rationale: "deployed 2026-05-25, not yet in registry.yaml" },
};

async function collectTiles(): Promise<FederationTile[]> {
  const registry = loadRegistry();
  const tiles: FederationTile[] = [];

  for (const [slug, entry] of Object.entries(registry)) {
    const beaconState = await probeBeacon(entry.beacon_url);
    tiles.push({
      slug,
      registryEntry: { beaconUrl: entry.beacon_url, visibility: entry.visibility, owner: entry.owner },
      beaconState: beaconState.state,
      beaconLatencyMs: beaconState.latency,
      knownLive: false,
      hostUrl: null,
      hostStatus: null,
    });
  }

  for (const [slug, info] of Object.entries(KNOWN_LIVE_BUILDINGS)) {
    if (registry[slug]) continue; // already counted
    let status: number | null = null;
    try {
      const res = await fetch(`${info.hostUrl}/health`, { signal: AbortSignal.timeout(5000) });
      status = res.status;
    } catch {
      status = null;
    }
    tiles.push({
      slug,
      registryEntry: null,
      beaconState: "not-registered",
      beaconLatencyMs: null,
      knownLive: true,
      hostUrl: info.hostUrl,
      hostStatus: status,
    });
  }

  return tiles;
}

// ─────────────────────────── phase scoreboard ───────────────────────────────

function buildPhases(probes: EndpointProbe[]): PhaseRow[] {
  const find = (endpoint: string) => probes.find((p) => p.endpoint === endpoint);
  const health = find("/health");
  const me = find("/v1/me");
  const profile = find("/v1/profile");
  const mibera = find("/v1/mibera/dimensions");

  return [
    {
      phase: 1,
      name: "Spine + Auth",
      goalIds: ["G-1", "G-2", "G-3"],
      goalNotes: [
        "G-1: beacon valid + registered + SDK + gateway reachable",
        "G-2: 1 human / 2 wallets / 2 nyms → 1 user_id",
        "G-3: zero Dynamic in live auth path",
      ],
      status: health?.result.state === "up" ? "deployed" : "not-built",
      evidence: [
        `/health ${health?.result.statusCode} in ${health?.result.latencyMs}ms`,
        `/v1/me ${me?.result.statusCode} (${me?.result.state})`,
      ],
      beadsRefs: ["arrakis-zhq2 (Sprint 396, P1, 12 tasks ⚠ still OPEN — beads stale vs reality)"],
    },
    {
      phase: 2,
      name: "Serve (compose endpoint)",
      goalIds: ["G-5"],
      goalNotes: ["G-5: /v1/profile degrades (200 with degraded[]) not 5xx"],
      status: profile?.result.statusCode === 400 ? "scaffolded" : profile?.result.state === "auth-gated" ? "deployed" : "not-built",
      evidence: [
        `/v1/profile ${profile?.result.statusCode} (${profile?.result.state})`,
        profile?.result.statusCode === 400 ? "endpoint registered in OpenAPI but compose orchestrator NOT wired" : "endpoint behavior consistent with built state",
      ],
      beadsRefs: ["arrakis-pgoo (Sprint 397, 4 P1 tasks open)", "arrakis-eqxj T2.3", "arrakis-l06n T2.2", "arrakis-ok93 T2.1", "arrakis-wqzd T2.TEST"],
    },
    {
      phase: 3,
      name: "Mibera Dimensions on Honey Road (Soju headline)",
      goalIds: ["G-6"],
      goalNotes: ["G-6: honey-road renders 7-dim Mibera from @0xhoneyjar/identity not Alchemy"],
      status: mibera?.result.statusCode === 400 ? "scaffolded" : mibera?.result.state === "auth-gated" ? "deployed" : "not-built",
      evidence: [
        `/v1/mibera/dimensions ${mibera?.result.statusCode} (${mibera?.result.state})`,
        mibera?.result.statusCode === 400 ? "endpoint scaffolded but Codex 7-dim resolver (T3.1) NOT wired" : "endpoint behavior consistent with built state",
        "honey-road still reads from lib/alchemy.ts (T3.3 swap not landed)",
      ],
      beadsRefs: ["arrakis-eul7 (Sprint 398, 3 P1 tasks open)", "arrakis-8qpm T3.1 codex resolver", "arrakis-g407 T3.2 endpoint", "arrakis-cdwx T3.3 honey-road swap"],
    },
    {
      phase: 4,
      name: "cycle-c redirect + midi_profiles backfill",
      goalIds: ["G-4"],
      goalNotes: ["G-4: /verify completion writes spine row"],
      status: "not-built",
      evidence: ["spine empty until T4.4 backfill migration 0003 runs"],
      beadsRefs: ["arrakis-oujo (Sprint 399, 5 P1 tasks open)", "arrakis-hito T4.E2E P0 end-to-end goal validation"],
    },
  ];
}

// ─────────────────────────── soju-lens ──────────────────────────────────────
//
// the creative move: parallel-fetch the operator's profile through each
// surface that exposes one. surface = name they see. discrepancies highlight
// the BERA→Soju gap that's the real ask.

async function collectSojuLens(wallet: string | null): Promise<{ rows: SojuLensRow[]; discrepancies: string[] }> {
  if (!wallet) {
    return {
      rows: [
        {
          surface: "(not configured)",
          field: "displayName",
          observed: null,
          source: "set OPERATOR_WALLET or --wallet to enable Soju-lens",
          error: "no wallet supplied",
        },
      ],
      discrepancies: [],
    };
  }

  const rows: SojuLensRow[] = [];

  // identity-api resolve-by-wallet (Phase 1 — should work)
  try {
    const url = `${IDENTITY_API}/v1/resolve/wallet/${wallet}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    let observed: string | null = null;
    let err: string | null = null;
    if (res.ok) {
      const body = await res.json().catch(() => null);
      observed = (body as { userId?: string; primaryWallet?: string } | null)?.userId ?? null;
    } else {
      err = `HTTP ${res.status}`;
    }
    rows.push({ surface: "identity-api spine", field: "primaryWallet", observed, source: `/v1/resolve/wallet/${wallet}`, error: err });
  } catch (e) {
    rows.push({
      surface: "identity-api spine",
      field: "primaryWallet",
      observed: null,
      source: `/v1/resolve/wallet/${wallet}`,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // identity-api compose profile (Phase 2 — should return name)
  try {
    const url = `${IDENTITY_API}/v1/profile?wallet=${wallet}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    let observed: string | null = null;
    let err: string | null = null;
    if (res.ok) {
      const body = await res.json().catch(() => null);
      observed = (body as { displayName?: string } | null)?.displayName ?? null;
    } else {
      err = `HTTP ${res.status} — Phase 2 compose not built`;
    }
    rows.push({ surface: "identity-api compose", field: "displayName", observed, source: "/v1/profile (G-5)", error: err });
  } catch (e) {
    rows.push({
      surface: "identity-api compose",
      field: "displayName",
      observed: null,
      source: "/v1/profile (G-5)",
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // identity-api mibera dims (Phase 3 — Soju headline)
  try {
    const url = `${IDENTITY_API}/v1/mibera/dimensions?wallet=${wallet}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    let observed: string | null = null;
    let err: string | null = null;
    if (res.ok) {
      const body = await res.json().catch(() => null);
      observed = body ? JSON.stringify(body).slice(0, 80) : null;
    } else {
      err = `HTTP ${res.status} — Phase 3 codex resolver not built`;
    }
    rows.push({ surface: "identity-api mibera-dims", field: "miberaDimensions", observed, source: "/v1/mibera/dimensions (G-6)", error: err });
  } catch (e) {
    rows.push({
      surface: "identity-api mibera-dims",
      field: "miberaDimensions",
      observed: null,
      source: "/v1/mibera/dimensions (G-6)",
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // honey road API (the consumer — currently reads Alchemy)
  try {
    const url = `${HONEY_ROAD}/api/profile?wallet=${wallet}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    let observed: string | null = null;
    let err: string | null = null;
    if (res.ok) {
      const ct = res.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) {
        const body = await res.json().catch(() => null);
        observed = (body as { name?: string; displayName?: string } | null)?.name ?? null;
      } else {
        err = `non-json response (${ct})`;
      }
    } else {
      err = `HTTP ${res.status}`;
    }
    rows.push({ surface: "honey-road (reads Alchemy)", field: "displayName", observed, source: "honey-road /api/profile", error: err });
  } catch (e) {
    rows.push({
      surface: "honey-road (reads Alchemy)",
      field: "displayName",
      observed: null,
      source: "honey-road /api/profile",
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // discrepancy detection: group by field, flag if values disagree
  const discrepancies: string[] = [];
  const byField = new Map<string, SojuLensRow[]>();
  for (const r of rows) {
    if (!byField.has(r.field)) byField.set(r.field, []);
    byField.get(r.field)!.push(r);
  }
  for (const [field, group] of byField.entries()) {
    const observedSet = new Set(group.filter((r) => r.observed !== null).map((r) => r.observed!));
    if (observedSet.size > 1) {
      discrepancies.push(`DISCREPANCY on ${field}: ${[...observedSet].map((v) => `"${v}"`).join(" vs ")}`);
    }
    const missing = group.filter((r) => r.observed === null && r.error !== null);
    if (missing.length === group.length && group.length > 0) {
      discrepancies.push(`MISSING on ${field}: no surface returned a value (all ${group.length} sources errored)`);
    }
  }
  return { rows, discrepancies };
}

// ─────────────────────────── orchestrator ───────────────────────────────────

async function buildDashState(wallet: string | null): Promise<DashState> {
  const [probes, tiles] = await Promise.all([collectProbes(), collectTiles()]);
  const phases = buildPhases(probes);
  const { rows: sojuLens, discrepancies } = await collectSojuLens(wallet);
  const warnings: string[] = [];
  if (!wallet) warnings.push("OPERATOR_WALLET not set — Soju-lens disabled");
  const idApiHealthy = probes.find((p) => p.endpoint === "/health" && p.surface === "identity-api")?.result.state === "up";
  if (!idApiHealthy) warnings.push("identity-api /health failing — Phase 1 substrate degraded");
  const phase3 = phases.find((p) => p.phase === 3);
  if (phase3?.status === "scaffolded" || phase3?.status === "not-built") {
    warnings.push("Phase 3 (G-6 Soju headline) NOT built — Honey Road will continue showing Alchemy fallback until T3.1 → T3.2 → T3.3 land");
  }
  return {
    generatedAt: new Date().toISOString(),
    generatorVersion: "0.1.0",
    operatorWallet: wallet,
    probes,
    tiles,
    phases,
    sojuLens,
    discrepancies,
    warnings,
  };
}

// ─────────────────────────── renderer (HTML) ────────────────────────────────

function esc(s: string | null | undefined): string {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function stateColor(s: ProbeState): string {
  const map: Record<ProbeState, string> = {
    up: "#1f8a3f",
    "auth-gated": "#7c6cff",
    degraded: "#e3a008",
    scaffold: "#f97316",
    down: "#dc2626",
    unreachable: "#71717a",
  };
  return map[s];
}

function stateLabel(s: ProbeState): string {
  return s.toUpperCase().replace("-", " ");
}

function tileColor(t: FederationTile): string {
  if (t.knownLive && t.hostStatus && t.hostStatus < 400) return "#1f8a3f";
  if (t.beaconState === "live") return "#1f8a3f";
  if (t.beaconState === "masked") return "#dc2626"; // 200 but NOT a beacon — the deceptive one (red)
  if (t.beaconState === "auth-gated") return "#e3a008"; // verify intent (ADR-007 D-8)
  if (t.beaconState === "404") return "#f97316";
  if (t.beaconState === "scaffold") return "#e3a008";
  if (t.beaconState === "not-registered") return "#7c6cff";
  return "#71717a";
}

function renderHTML(state: DashState): string {
  const probesBySurface = new Map<string, EndpointProbe[]>();
  for (const p of state.probes) {
    if (!probesBySurface.has(p.surface)) probesBySurface.set(p.surface, []);
    probesBySurface.get(p.surface)!.push(p);
  }
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>🦎 freeside operator-dash</title>
<style>
  :root {
    --bg: #0a0a0b; --panel: #131316; --panel-hi: #1c1c20; --line: #262629;
    --text: #ededed; --text-dim: #9a9a9e; --accent: #f9c846; --soju: #ff6b9d;
    --mono: "SF Mono","JetBrains Mono","Fira Code",ui-monospace,monospace;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px; background: var(--bg); color: var(--text);
    font-family: -apple-system,BlinkMacSystemFont,"Inter","Segoe UI",sans-serif;
    font-size: 14px; line-height: 1.5;
  }
  header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 24px; }
  header h1 { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.01em; }
  header .meta { color: var(--text-dim); font-family: var(--mono); font-size: 12px; }
  .grid { display: grid; gap: 16px; }
  .grid.two { grid-template-columns: 1fr 1fr; }
  @media (max-width: 900px) { .grid.two { grid-template-columns: 1fr; } }
  .panel {
    background: var(--panel); border: 1px solid var(--line); border-radius: 8px;
    padding: 16px;
  }
  .panel h2 {
    margin: 0 0 12px 0; font-size: 13px; font-weight: 600; letter-spacing: 0.04em;
    text-transform: uppercase; color: var(--text-dim);
  }
  .panel h2 .badge { color: var(--accent); margin-left: 6px; font-weight: 700; }
  .warning {
    background: #2a1b00; border: 1px solid #5a3a00; color: #ffb84d;
    padding: 10px 14px; border-radius: 6px; margin-bottom: 12px; font-size: 13px;
  }
  .discrepancy {
    background: #2a0010; border: 1px solid #5a0020; color: var(--soju);
    padding: 10px 14px; border-radius: 6px; margin-bottom: 12px; font-size: 13px;
    font-family: var(--mono);
  }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid var(--line); }
  th { color: var(--text-dim); font-weight: 500; font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; }
  td.mono { font-family: var(--mono); font-size: 12px; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 99px; font-size: 11px; font-weight: 600; letter-spacing: 0.02em; color: white; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
  .tile {
    background: var(--panel-hi); border: 1px solid var(--line); border-radius: 6px;
    padding: 12px; position: relative; overflow: hidden;
  }
  .tile::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; }
  .tile .slug { font-weight: 600; margin-bottom: 4px; }
  .tile .meta { color: var(--text-dim); font-family: var(--mono); font-size: 11px; line-height: 1.4; }
  .phase {
    background: var(--panel-hi); border: 1px solid var(--line); border-radius: 6px;
    padding: 14px; margin-bottom: 10px;
  }
  .phase .row1 { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 6px; }
  .phase .name { font-weight: 600; }
  .phase .goals { color: var(--accent); font-family: var(--mono); font-size: 12px; }
  .phase ul { margin: 6px 0 0; padding-left: 18px; color: var(--text-dim); font-size: 12px; }
  .phase ul li { margin: 2px 0; }
  .footer { color: var(--text-dim); font-family: var(--mono); font-size: 11px; margin-top: 24px; text-align: right; }
  details summary { cursor: pointer; color: var(--text-dim); font-size: 12px; }
  details summary:hover { color: var(--text); }
  pre.body { background: var(--bg); padding: 8px; border-radius: 4px; font-size: 11px; overflow-x: auto; margin: 4px 0 0; color: var(--text-dim); }
</style>
</head>
<body>
<header>
  <h1>🦎 freeside operator-dash</h1>
  <span class="meta">v${esc(state.generatorVersion)} · generated ${esc(state.generatedAt)}</span>
</header>

${
  state.warnings.length > 0
    ? state.warnings.map((w) => `<div class="warning">⚠ ${esc(w)}</div>`).join("")
    : ""
}

${
  state.discrepancies.length > 0
    ? state.discrepancies.map((d) => `<div class="discrepancy">${esc(d)}</div>`).join("")
    : ""
}

<div class="grid two">

  <!-- left column: phase scoreboard -->
  <div class="panel">
    <h2>identity-api · phase scoreboard <span class="badge">(BERA→Soju path)</span></h2>
    ${state.phases
      .map((p) => {
        const color =
          p.status === "deployed" ? "#1f8a3f" : p.status === "scaffolded" ? "#e3a008" : "#dc2626";
        const label =
          p.status === "deployed"
            ? "DEPLOYED"
            : p.status === "scaffolded"
            ? "SCAFFOLDED"
            : "NOT BUILT";
        return `
        <div class="phase">
          <div class="row1">
            <span class="name">Phase ${p.phase}: ${esc(p.name)}</span>
            <span class="pill" style="background:${color}">${label}</span>
          </div>
          <div class="goals">${esc(p.goalIds.join(" · "))}</div>
          <ul>
            ${p.goalNotes.map((n) => `<li>${esc(n)}</li>`).join("")}
          </ul>
          <details>
            <summary>evidence + beads (${p.evidence.length + p.beadsRefs.length})</summary>
            <ul>
              ${p.evidence.map((e) => `<li>📡 ${esc(e)}</li>`).join("")}
              ${p.beadsRefs.map((b) => `<li>🔗 ${esc(b)}</li>`).join("")}
            </ul>
          </details>
        </div>`;
      })
      .join("")}
  </div>

  <!-- right column: api surface -->
  <div class="panel">
    <h2>api surface · live probe</h2>
    ${[...probesBySurface.entries()]
      .map(
        ([surface, ps]) => `
      <div style="margin-bottom:14px">
        <div style="font-weight:600;margin-bottom:6px">${esc(surface)}</div>
        <table>
          <thead>
            <tr><th>endpoint</th><th>status</th><th>latency</th><th>state</th></tr>
          </thead>
          <tbody>
            ${ps
              .map(
                (p) => `
              <tr>
                <td class="mono">${esc(p.endpoint)}</td>
                <td class="mono">${p.result.statusCode ?? "—"}</td>
                <td class="mono">${p.result.latencyMs != null ? `${p.result.latencyMs}ms` : "—"}</td>
                <td><span class="pill" style="background:${stateColor(p.result.state)}">${stateLabel(p.result.state)}</span>${p.result.note ? `<div style="color:var(--text-dim);font-size:11px;margin-top:3px">${esc(p.result.note)}</div>` : ""}</td>
              </tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </div>`,
      )
      .join("")}
  </div>
</div>

<div class="panel" style="margin-top:16px">
  <h2>federation tiles · freeside-* buildings <span class="badge">(registry.yaml + known-live)</span></h2>
  <div class="tiles">
    ${state.tiles
      .map(
        (t) => `
      <div class="tile" style="border-left:none">
        <div style="position:absolute;left:0;top:0;bottom:0;width:3px;background:${tileColor(t)}"></div>
        <div class="slug">${esc(t.slug)}</div>
        <div class="meta">
          ${t.knownLive ? `host: ${esc(t.hostUrl)}<br>health: HTTP ${t.hostStatus ?? "unreachable"}<br>⚠ NOT in registry.yaml` : `beacon: ${esc(t.beaconState)}${t.beaconLatencyMs != null ? ` (${t.beaconLatencyMs}ms)` : ""}<br>visibility: ${esc(t.registryEntry?.visibility ?? "?")}<br>owner: ${esc(t.registryEntry?.owner ?? "?")}`}
        </div>
      </div>`,
      )
      .join("")}
  </div>
</div>

<div class="panel" style="margin-top:16px">
  <h2>🌸 soju-lens · operator profile across surfaces ${
    state.operatorWallet ? `<span class="badge">wallet ${esc(state.operatorWallet.slice(0, 6))}…${esc(state.operatorWallet.slice(-4))}</span>` : ""
  }</h2>
  <table>
    <thead>
      <tr><th>surface</th><th>field</th><th>observed</th><th>source</th><th>error</th></tr>
    </thead>
    <tbody>
      ${state.sojuLens
        .map(
          (r) => `
        <tr>
          <td>${esc(r.surface)}</td>
          <td class="mono">${esc(r.field)}</td>
          <td class="mono" style="color:${r.observed ? "var(--text)" : "var(--text-dim)"}">${esc(r.observed) || "—"}</td>
          <td class="mono" style="color:var(--text-dim);font-size:11px">${esc(r.source)}</td>
          <td class="mono" style="color:${r.error ? "var(--soju)" : "var(--text-dim)"};font-size:11px">${esc(r.error) || "—"}</td>
        </tr>`,
        )
        .join("")}
    </tbody>
  </table>
  ${
    !state.operatorWallet
      ? `<div style="margin-top:10px;color:var(--text-dim);font-size:12px">enable with <code style="background:var(--bg);padding:1px 6px;border-radius:3px">OPERATOR_WALLET=0xABC tsx tools/operator-dash/dash.ts</code></div>`
      : ""
  }
</div>

<div class="footer">
  freeside operator-dash · ${esc(state.generatedAt)} · re-run: <code>tsx tools/operator-dash/dash.ts</code>
</div>

</body>
</html>`;
}

// ─────────────────────────── cli + serve ────────────────────────────────────

function parseArgs(argv: string[]): { wallet: string | null; serve: boolean; port: number } {
  const opts: { wallet: string | null; serve: boolean; port: number } = {
    wallet: process.env.OPERATOR_WALLET ?? null,
    serve: false,
    port: 3030,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--wallet" && argv[i + 1]) { opts.wallet = argv[i + 1]; i++; }
    else if (argv[i] === "--serve") opts.serve = true;
    else if (argv[i] === "--port" && argv[i + 1]) { opts.port = Number(argv[i + 1]); i++; }
  }
  return opts;
}

async function snapshot(wallet: string | null): Promise<{ state: DashState; html: string }> {
  const state = await buildDashState(wallet);
  const html = renderHTML(state);
  return { state, html };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  console.error(`[dash] probing freeside surfaces${opts.wallet ? ` (soju-lens wallet: ${opts.wallet.slice(0, 6)}…${opts.wallet.slice(-4)})` : ""}…`);

  if (opts.serve) {
    let cached: { html: string; at: number } | null = null;
    const TTL_MS = 30_000;
    const server = createServer(async (req, res) => {
      try {
        const now = Date.now();
        if (!cached || now - cached.at > TTL_MS) {
          const { html } = await snapshot(opts.wallet);
          cached = { html, at: now };
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        res.end(cached.html);
      } catch (e) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end(`probe error: ${e instanceof Error ? e.message : String(e)}`);
      }
    });
    server.listen(opts.port, () => {
      console.error(`[dash] serving at http://localhost:${opts.port}/ (30s TTL cache)`);
    });
    return;
  }

  const { state, html } = await snapshot(opts.wallet);
  const outDir = join(dirname(fileURLToPath(import.meta.url)));
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "dash.html");
  writeFileSync(outPath, html, "utf8");
  const probeSummary = state.probes.reduce((acc, p) => {
    acc[p.result.state] = (acc[p.result.state] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  console.error(`[dash] wrote ${outPath}`);
  console.error(`[dash] probes: ${Object.entries(probeSummary).map(([k, v]) => `${k}=${v}`).join(" · ")}`);
  console.error(`[dash] discrepancies: ${state.discrepancies.length}`);
  console.error(`[dash] warnings: ${state.warnings.length}`);
  console.error(`[dash] open: file://${outPath}`);
}

main().catch((err) => {
  console.error(`[dash] fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
