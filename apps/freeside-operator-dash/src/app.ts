/**
 * freeside-operator-dash — inward-facing operator visibility surface.
 *
 * Sibling to apps/mcp-gateway/ (outward-facing federation discovery for
 * partners + agent clients). This app serves the THJ team's operator
 * persona per ADR-009 §D-9: cluster health, Soju-lens identity
 * reconciliation, identity-api phase scoreboard, federation tile grid.
 *
 * Reads packages/freeside-registry/registry.yaml as the source of truth
 * for which cells exist + their deployment URLs.
 *
 * Routes:
 *   GET /          → HTML dashboard (30s TTL cache)
 *   GET /healthz   → JSON {ok, generatedAt}
 *   GET /api/state → JSON DashState (for future client-side consumers)
 *
 * v0.1 caveats:
 *   - No auth. Run behind Tailscale / local OPERATOR_TOKEN check until T4
 *     (Privy + cm-internal role per ADR-009 §D-9) lands.
 *   - Soju-lens disabled unless OPERATOR_WALLET env var is set.
 *   - Single-instance only; no Redis-backed state, no multi-operator scoping.
 */

import { Hono } from "hono";
import type { DashState, IdentityApiPhase } from "./types.js";
import { loadRegistry } from "./registry.js";
import { probeAll } from "./probe.js";
import { collectSojuLens } from "./soju-lens.js";
import { renderHTML } from "./render.js";

const app = new Hono();

const CACHE_TTL_MS = 30_000;

let cached: { state: DashState; html: string; at: number } | null = null;

function getOperatorWallet(): string | null {
  const w = process.env.OPERATOR_WALLET;
  if (!w || w.length === 0) return null;
  return w;
}

function buildIdentityPhases(probes: ReturnType<typeof probeAll> extends Promise<infer R> ? R : never): IdentityApiPhase[] {
  // Phase scoreboard derives from observed Phase 1-3 endpoint behavior at runtime
  // (live-probed against identity-api each refresh). The endpoint probes happen
  // in soju-lens too; here we do a lightweight category check.
  const identityProbe = probes.find((p) => p.slug === "identity-api");
  const phase1Deployed = identityProbe?.state === "up";

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
      status: phase1Deployed ? "deployed" : "not-built",
      evidence: phase1Deployed
        ? [`identity-api /health → ${identityProbe?.statusCode} in ${identityProbe?.latencyMs}ms`]
        : ["identity-api /health not reachable"],
      beadsRefs: ["arrakis-zhq2 (Sprint 396, P1, 12 tasks ⚠ still OPEN — beads stale vs reality)"],
    },
    {
      phase: 2,
      name: "Serve (compose endpoint)",
      goalIds: ["G-5"],
      goalNotes: ["G-5: /v1/profile degrades (200 with degraded[]) not 5xx"],
      // Phase 2 status comes from Soju-lens probe of /v1/profile (currently 400)
      status: "scaffolded",
      evidence: [
        "/v1/profile registered in OpenAPI but compose orchestrator NOT wired",
        "returns 400 today — Phase 2 sprint 397 not built",
      ],
      beadsRefs: [
        "arrakis-pgoo (Sprint 397, 4 P1 tasks open)",
        "arrakis-eqxj T2.3 / arrakis-l06n T2.2 / arrakis-ok93 T2.1 / arrakis-wqzd T2.TEST",
      ],
    },
    {
      phase: 3,
      name: "Mibera Dimensions on Honey Road (Soju headline)",
      goalIds: ["G-6"],
      goalNotes: ["G-6: honey-road renders 7-dim Mibera from @0xhoneyjar/identity not Alchemy"],
      status: "scaffolded",
      evidence: [
        "/v1/mibera/dimensions scaffolded but Codex 7-dim resolver (T3.1) NOT wired",
        "honey-road still reads from lib/alchemy.ts (T3.3 swap not landed)",
      ],
      beadsRefs: [
        "arrakis-eul7 (Sprint 398, 3 P1 tasks open)",
        "arrakis-8qpm T3.1 codex resolver / arrakis-g407 T3.2 endpoint / arrakis-cdwx T3.3 honey-road swap",
      ],
    },
    {
      phase: 4,
      name: "cycle-c redirect + midi_profiles backfill",
      goalIds: ["G-4"],
      goalNotes: ["G-4: /verify completion writes spine row"],
      status: "not-built",
      evidence: ["spine empty until T4.4 backfill migration 0003 runs"],
      beadsRefs: [
        "arrakis-oujo (Sprint 399, 5 P1 tasks open)",
        "arrakis-hito T4.E2E P0 end-to-end goal validation",
      ],
    },
  ];
}

async function buildDashState(): Promise<DashState> {
  const wallet = getOperatorWallet();
  const cells = loadRegistry();
  const [probes, sojuLens] = await Promise.all([probeAll(cells), collectSojuLens(wallet)]);
  const identityPhases = buildIdentityPhases(probes);

  const warnings: string[] = [];
  if (!wallet) warnings.push("OPERATOR_WALLET not set — Soju-lens disabled");
  const deployedDown = probes.filter(
    (p) => p.state === "down" && cells.find((c) => c.slug === p.slug)?.runtime_state === "deployed",
  );
  if (deployedDown.length > 0) {
    warnings.push(
      `${deployedDown.length} cell(s) registry-marked deployed but probed down: ${deployedDown.map((p) => p.slug).join(", ")}`,
    );
  }
  if (identityPhases.find((p) => p.phase === 3)?.status !== "deployed") {
    warnings.push(
      "Phase 3 (G-6 Soju headline) NOT built — Honey Road will continue showing Alchemy fallback until T3.1 → T3.2 → T3.3 land",
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    generatorVersion: "0.1.0",
    cells,
    probes,
    identityPhases,
    sojuLens,
    warnings,
  };
}

async function getCached(): Promise<{ state: DashState; html: string }> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) return cached;
  const state = await buildDashState();
  const html = renderHTML(state);
  cached = { state, html, at: now };
  return cached;
}

app.get("/", async (c) => {
  const { html } = await getCached();
  return c.html(html);
});

app.get("/healthz", (c) => {
  return c.json({ ok: true, generatedAt: cached?.state.generatedAt ?? null });
});

app.get("/api/state", async (c) => {
  const { state } = await getCached();
  return c.json(state);
});

export default app;
