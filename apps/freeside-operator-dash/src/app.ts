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
import {
  getEventsTraceSnapshot,
  getPerClassRing,
  startEventsTraceSubscriber,
} from "./events-trace.js";

// Boot the events-trace subscriber as a module-load side-effect.
// Best-effort: returns even when NATS_URL is absent (lifecycle state object
// inside events-trace.ts reflects the outcome; the dash panel surfaces
// "subscriber disabled" or "NATS connect failed" messages explicitly).
startEventsTraceSubscriber().catch((err) => {
  console.error("[events-trace] startEventsTraceSubscriber threw:", err);
});

const app = new Hono();

const CACHE_TTL_MS = 30_000;

let cached: { state: DashState; html: string; at: number } | null = null;

function getOperatorWallet(): string | null {
  const w = process.env.OPERATOR_WALLET;
  if (!w || w.length === 0) return null;
  return w;
}

function buildIdentityPhases(probes: ReturnType<typeof probeAll> extends Promise<infer R> ? R : never): IdentityApiPhase[] {
  // Phase status reflects ground truth as of 2026-05-25:
  //   Phases 1-4 substrate work is BUILT + deployed (T1.*-T4.4 closed in
  //   ~/bonfire/identity-api-coordinator beads); T4.E2E (P0 end-to-end goal
  //   validation, bead arrakis-hito) is the only OPEN task. Phase 2/3
  //   endpoints respond correctly when called with proper params:
  //     /v1/profile requires (world + wallet|userId)
  //     /v1/mibera/dimensions requires (wallet|userId), world implicit
  //   The Soju-lens panel below proves this by probing each surface live.
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
      beadsRefs: ["arrakis-zhq2 (Sprint 396) — all 12 P1 tasks closed in coord"],
    },
    {
      phase: 2,
      name: "Serve (compose endpoint)",
      goalIds: ["G-5"],
      goalNotes: ["G-5: /v1/profile composes spine+inventory+score+codex, degrades 200 with degraded[] not 5xx"],
      status: "deployed",
      evidence: [
        "/v1/profile mounted with composeProfile orchestrator + circuit breakers (freeside-auth/src/api/routes/profile.ts)",
        "tests cover happy-path + downstream-blackout + 4xx subject-validation",
      ],
      beadsRefs: ["arrakis-pgoo (Sprint 397) — all 4 P1 tasks closed (T2.1/T2.2/T2.3/T2.TEST)"],
    },
    {
      phase: 3,
      name: "Mibera Dimensions on Honey Road (Soju headline)",
      goalIds: ["G-6"],
      goalNotes: ["G-6: honey-road renders 7-dim Mibera from @0xhoneyjar/identity not Alchemy"],
      status: "deployed",
      evidence: [
        "/v1/mibera/dimensions mounted with Codex 7-dim resolver + tests (freeside-auth/src/api/__tests__/mibera-dimensions-route.test.ts)",
        "honey-road swap landed: lib/identity/mibera-dimensions.ts reads identity-api by default (HONEYROAD_PROFILE_SOURCE env, alchemy is kill-switch fallback)",
        "if BERA name still appears on Honey Road UI: check HONEYROAD_PROFILE_SOURCE env in prod + Vercel deploy SHA + whether identity-api is degrading to alchemy fallback for the operator's wallet (Soju-lens above shows which)",
      ],
      beadsRefs: ["arrakis-eul7 (Sprint 398) — all 3 P1 tasks closed (T3.1/T3.2/T3.3)"],
    },
    {
      phase: 4,
      name: "cycle-c redirect + midi_profiles backfill",
      goalIds: ["G-4"],
      goalNotes: ["G-4: /verify completion writes spine row"],
      status: "deployed",
      evidence: [
        "Phase 4 tasks T4.1/T4.3/T4.4/T4.TEST all closed in coord beads",
        "T4.E2E (arrakis-hito, P0) is the LAST open task — end-to-end goal validation against G-1..G-6",
      ],
      beadsRefs: [
        "arrakis-oujo (Sprint 399) — 4/5 P1 tasks closed",
        "arrakis-hito T4.E2E (P0) — STILL OPEN — drive: cd ~/Documents/GitHub/freeside-auth && claude /implement T4.E2E",
      ],
    },
  ];
}

async function buildDashState(walletOverride?: string | null): Promise<DashState> {
  // Wallet precedence: explicit per-request query/form param > OPERATOR_WALLET env.
  // walletOverride === null means "explicitly cleared via UI"; undefined means
  // "no override, use env default."
  const wallet =
    walletOverride === undefined ? getOperatorWallet() : (walletOverride && walletOverride.length > 0 ? walletOverride : null);
  const cells = loadRegistry();
  const [probes, sojuLens] = await Promise.all([probeAll(cells), collectSojuLens(wallet)]);
  const identityPhases = buildIdentityPhases(probes);
  const eventsTrace = getEventsTraceSnapshot();

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
  const lastOpenTask = identityPhases.find((p) => p.status === "deployed" && p.beadsRefs.some((r) => r.includes("STILL OPEN")));
  if (lastOpenTask) {
    warnings.push(
      `identity-api: only T4.E2E (arrakis-hito, P0) remains — substrate Phases 1-4 deployed. If Honey Road still shows BERA fallback, the issue is config/deploy-side (HONEYROAD_PROFILE_SOURCE env, Vercel deploy SHA, or degraded-fallback to alchemy for operator's wallet). Soju-lens above proves which.`,
    );
  }
  if (!eventsTrace.subscriberEnabled) {
    warnings.push(
      "events-trace: subscriber disabled (NATS_URL env not set). Cluster events panel will show no envelopes.",
    );
  } else if (!eventsTrace.natsConnected && eventsTrace.lastLifecycleError) {
    warnings.push(`events-trace: ${eventsTrace.lastLifecycleError}`);
  } else if (eventsTrace.totalObserved > 0 && eventsTrace.totalFailures / eventsTrace.totalObserved > 0.1) {
    warnings.push(
      `events-trace: ${eventsTrace.totalFailures}/${eventsTrace.totalObserved} envelopes failed verification (>10%). Check publisher key material + JWKS endpoint.`,
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    generatorVersion: "0.1.0",
    cells,
    probes,
    identityPhases,
    sojuLens,
    eventsTrace,
    warnings,
  };
}

async function getCached(walletOverride?: string | null): Promise<{ state: DashState; html: string }> {
  // Only cache the default (env-wallet) view. Per-request wallet overrides
  // are computed fresh to avoid cross-wallet contamination + cache poisoning.
  if (walletOverride !== undefined) {
    const state = await buildDashState(walletOverride);
    const html = renderHTML(state);
    return { state, html };
  }
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) return cached;
  const state = await buildDashState();
  const html = renderHTML(state);
  cached = { state, html, at: now };
  return cached;
}

function parseWalletParam(raw: string | undefined): string | null | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === "") return null; // explicit clear
  // Loose hex address shape — reject obvious garbage but don't hard-validate
  // (identity-api will reject + the Soju-lens row will show the error).
  if (!/^0x[a-fA-F0-9]{4,}$/.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

app.get("/", async (c) => {
  const walletOverride = parseWalletParam(c.req.query("wallet"));
  const { html } = await getCached(walletOverride);
  return c.html(html);
});

app.get("/healthz", (c) => {
  return c.json({ ok: true, generatedAt: cached?.state.generatedAt ?? null });
});

app.get("/api/state", async (c) => {
  const walletOverride = parseWalletParam(c.req.query("wallet"));
  const { state } = await getCached(walletOverride);
  return c.json(state);
});

/**
 * GET /api/events?class=<event-class>&limit=<n>
 *
 * Returns the events-trace ring buffer for a given event class (or the
 * cross-class recent feed when class is omitted). Per build doc §6, this
 * is the raw forensics surface the operator drills into after spotting
 * something in the HTML panel.
 *
 *   class — optional. e.g. "nft.mint.detected.mibera-shadow". Returns
 *           that class's per-class ring (cap 200). Omitted = recent
 *           cross-class feed (cap 100).
 *   limit — optional. Caps the response size; defaults to ring size.
 */
app.get("/api/events", (c) => {
  const eventClass = c.req.query("class");
  const limitRaw = c.req.query("limit");
  const limit = limitRaw && /^\d+$/.test(limitRaw) ? parseInt(limitRaw, 10) : undefined;

  const snapshot = getEventsTraceSnapshot();
  if (!eventClass) {
    const envelopes = limit ? snapshot.recentEnvelopes.slice(0, limit) : snapshot.recentEnvelopes;
    return c.json({
      scope: "recent",
      subscriberEnabled: snapshot.subscriberEnabled,
      natsConnected: snapshot.natsConnected,
      subscribedSubjects: snapshot.subscribedSubjects,
      totalObserved: snapshot.totalObserved,
      totalFailures: snapshot.totalFailures,
      lastLifecycleError: snapshot.lastLifecycleError,
      envelopes,
    });
  }
  const ring = getPerClassRing(eventClass);
  const envelopes = limit ? ring.slice(-limit) : ring;
  return c.json({
    scope: "per-class",
    eventClass,
    subscriberEnabled: snapshot.subscriberEnabled,
    natsConnected: snapshot.natsConnected,
    count: envelopes.length,
    envelopes,
  });
});

export default app;
