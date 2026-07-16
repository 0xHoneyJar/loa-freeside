/**
 * Sprint 2 / S2-T1 — the audit's deployment composition root.
 *
 * Sprint 1 (#296/#300/#306) built the whole audit (schemas · AuditService · resolvers · createAuditRouter)
 * but mounted it NOWHERE and wired only test fakes for its I/O ports. This module is the missing seam: it
 * assembles the real adapters into the Hono app `createAuditRouter` needs, so the audit becomes a
 * deployable HTTP building (`shadow-audit-api`) that freeside-dashboard's already-built dormant client
 * (`GET ${SHADOW_AUDIT_API_URL}/v1/audit`) can consume.
 *
 * The `OwnershipSource` (the chain-reconstruction adapter) is INJECTED, NOT constructed here — it is the
 * one correctness-critical, live-verified part (a wrong ownership reconstruction is a wrong audit), built
 * + gated in `bin/http.ts`. That injection seam keeps this composition root fully unit-testable with a
 * fake OwnershipSource (the #306 discipline: no live network in the unit suite). The other adapters are
 * local + dependency-free (whale = balance concentration; roles = a validated file; rate-limit + event-
 * store = in-memory), so they are constructed here.
 *
 * MVP scope = the anonymous `GET /v1/audit` k-anon aggregate. The authed `POST /v1/audit` named-output
 * (V2, SIWE) is intentionally NOT wired — its auth is constructed fail-closed (always 401), so POST can
 * never half-serve named records.
 */

import { timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import type { Cta } from '@freeside/shadow-audit-protocol';
import { createAuditRouter, type AuditRouterDeps } from './http/audit-router.js';
import type { CollectionIndex } from './ownership-source.js';
import { makeFileRoleSource } from './role-source.js';
import { makeDurableRoleStore, type DurableRoleStore } from './role-store.js';
import { makeBalanceWhaleSource } from './whale-source.js';
import { InMemoryEventStore, type EventStore } from './event-store.js';
import { InMemoryNonceStore } from './association-verifier.js';
import { FixedWindowRateLimiter } from './rate-limiter.js';
import type { OwnershipSource, RoleSource } from './audit-service.js';

export interface AuditServerConfig {
  /** X-API-Key shared secret the dashboard sends; when set, all routes (except /healthz) require it. */
  apiKey?: string;
  /** community names this deploy operates (dogfood-full eligible). */
  operatedCommunities: readonly string[];
  cta: Cta;
  /** path to the Discord role-export JSON; absent → audits refuse external-mode. */
  roleSnapshotPath?: string;
  /** k-anonymity threshold (AuditService default 5). */
  k?: number;
  /** per-IP rate limit for the authed routes (default 30 req / 60s). */
  rateLimit?: { limit: number; windowMs: number };
  /** S2-T3: per-IP limit for the PUBLIC /v1/access-risk teaser (default 6 req / 60s). BEST-EFFORT — keyed
   *  on caller-supplied X-Forwarded-For; a live probe evaded it by rotating the header. */
  teaserRateLimit?: { limit: number; windowMs: number };
  /** S2-T3 HARD BOUND: global cap on teaser chain-reconstructions (cache misses), keyed on a constant so
   *  no header/IP rotation can raise it. Default 30 / 60s. */
  teaserBudget?: { limit: number; windowMs: number };
  /** Global cap on NEW durable anonymous journeys. Default 120 / 60s per replica. */
  publicJourneyBudget?: { limit: number; windowMs: number };
  /** S1-T4: service token the exporter presents to POST /v1/role-snapshot. When set, ingestion is enabled
   *  and the durable role store becomes the audit's role source; when absent, ingestion is NOT mounted and
   *  the role source falls back to the file at `roleSnapshotPath` (existing behavior). */
  ingestToken?: string;
  /** S1-T4: directory the durable role store writes ingested snapshots to (default `./data/role-snapshots`). */
  roleSnapshotDir?: string;
  /** arrakis-7mtwa: explicit persistence backend. Production Railway uses postgres; file is local fallback. */
  roleSnapshotStore?: 'file' | 'postgres';
  /** Required when roleSnapshotStore=postgres. Kept out of logs and response surfaces. */
  databaseUrl?: string;
  /** G-1: event-store backend. `memory` (default) is per-replica/non-durable — dev/test ONLY.
   *  `postgres` is durable; production sets it so a registered run (and its feedback binding)
   *  survives a restart/deploy. When `postgres`, the runtime MUST supply an initialized
   *  eventStore or the app fails closed (never a silent in-memory masquerade). */
  eventStoreBackend?: 'memory' | 'postgres';
}

export interface AuditAppRuntime {
  /** Pre-initialized shared store. Required when roleSnapshotStore=postgres. */
  roleStore?: DurableRoleStore;
  /** G-1: pre-initialized durable event store. REQUIRED when eventStoreBackend=postgres. */
  eventStore?: EventStore;
}

/** Fail-closed auth for the un-wired V2 POST path: `recover` returns a wallet that can never match a real
 *  `owner_wallet`, and `isCommunityOwner` is false, so the named-output route always 401s. */
function failClosedAuth(): AuditRouterDeps['auth'] {
  return {
    recover: async () => '0x' + '0'.repeat(40),
    nonces: new InMemoryNonceStore(),
    isCommunityOwner: async () => false,
    domain: 'shadow-audit',
    chainId: 1,
    scope: 'shadow-audit-v1',
    maxValiditySeconds: 300,
  };
}

/**
 * §12.3 — startup API-key guard. Call once before serving. Throws when SHADOW_AUDIT_API_KEY is
 * absent/empty so the caller can process.exit(1) with a clear message. The ONLY accepted local-dev
 * bypass is SHADOW_AUDIT_ALLOW_ANON=dev-only — never valid in production.
 */
export function validateApiKeyEnv(env: NodeJS.ProcessEnv = process.env): void {
  if (env.SHADOW_AUDIT_API_KEY) return;
  if (env.SHADOW_AUDIT_ALLOW_ANON === 'dev-only') {
    console.warn(
      '[shadow-audit-api] WARNING: SHADOW_AUDIT_ALLOW_ANON=dev-only — running open/unauthenticated. ' +
        'This escape is for local dev only; NEVER set it in production.',
    );
    return;
  }
  throw new Error(
    'SHADOW_AUDIT_API_KEY is required in production (§12.3 — service is fail-closed). ' +
      'Generate a key: openssl rand -hex 32\n' +
      'For local dev ONLY: SHADOW_AUDIT_ALLOW_ANON=dev-only (NEVER in production).',
  );
}

/**
 * Build the audit Hono app from an injected `OwnershipSource` + the local adapters.
 *
 * `collections` (S5-T3) carries BOTH registry reads: the membership lookup and the collection's full source
 * set. Without it the app is FAIL-CLOSED — every audit refuses `unindexed-contract`, because an app that
 * cannot enumerate a collection's deployments cannot know whether it is auditing one chain of several, and
 * a single-chain audit of a bridged collection brands the other chain's holders as stale access.
 */
export function buildAuditApp(
  ownership: OwnershipSource,
  config: AuditServerConfig,
  collections?: CollectionIndex,
  runtime: AuditAppRuntime = {},
): Hono {
  const now = () => Date.now();
  const rl = config.rateLimit ?? { limit: 30, windowMs: 60_000 };
  // Tighter default for the unauthenticated teaser (S2-T3): 6/min per IP. BEST-EFFORT — the client key
  // comes from caller-supplied X-Forwarded-For (a live probe evaded it by rotating the header).
  const teaserRl = config.teaserRateLimit ?? { limit: 6, windowMs: 60_000 };
  // The HARD bound (FAGAN 2026-07-12): a GLOBAL cap on teaser cache-MISSES — i.e. on actual chain
  // reconstructions — keyed on a constant, so no amount of IP/header rotation raises it. 30/min bounds
  // worst-case RPC spend on the public endpoint regardless of caller identity.
  const teaserBudgetCfg = config.teaserBudget ?? { limit: 30, windowMs: 60_000 };
  const publicJourneyBudgetCfg = config.publicJourneyBudget ?? { limit: 120, windowMs: 60_000 };

  // S1-T4: when a service ingest token is configured, the DURABLE store is BOTH the audit's role source and
  // the ingestion sink (POST /v1/role-snapshot writes it, load() reads it — the SAME instance, so an
  // ingested snapshot is immediately auditable). Without a token, keep the existing file-backed source
  // unchanged (no ingestion surface mounted — fail-closed).
  let roles: RoleSource;
  let ingest: AuditRouterDeps['ingest'];
  if (config.ingestToken) {
    // Fail loud on a half-wired ingest: a token with no operated community has nothing to serve on load().
    const community = config.operatedCommunities[0];
    if (!community) {
      throw new Error(
        'ROLE_SNAPSHOT_INGEST_TOKEN is set but OPERATED_COMMUNITIES is empty — ingestion needs a community to serve.',
      );
    }
    if (config.operatedCommunities.length !== 1) {
      throw new Error(
        'Role-snapshot ingestion currently requires exactly one OPERATED_COMMUNITIES entry per deployment',
      );
    }
    if (config.roleSnapshotStore === 'postgres' && !runtime.roleStore) {
      throw new Error('ROLE_SNAPSHOT_STORE=postgres requires an initialized Postgres role store');
    }
    const store =
      runtime.roleStore ??
      makeDurableRoleStore({
        dir: config.roleSnapshotDir ?? './data/role-snapshots',
        community,
        // The SAME resolver the audit reads by — so a snapshot is FILED under the canonical collection key,
        // not under the deployment the exporter happened to name. Without this the ingest returns
        // {stored:true} and no audit can ever find the snapshot.
        sources: collections?.sources ?? (() => undefined),
      });
    roles = store;
    ingest = { token: config.ingestToken, sink: store };
  } else {
    roles = makeFileRoleSource(config.roleSnapshotPath);
  }

  // G-1: fail closed — a durable-required deployment must supply an initialized durable store; it may
  // NEVER silently fall back to the in-memory store (which would make a "registered" run vanish on restart
  // and drop feedback binding across a deploy). The rate limiter stays in-memory (best-effort anti-abuse).
  if (config.eventStoreBackend === 'postgres' && !runtime.eventStore) {
    throw new Error('EVENT_STORE=postgres requires an initialized Postgres event store');
  }
  const eventStore = runtime.eventStore ?? new InMemoryEventStore();

  const deps: AuditRouterDeps = {
    ownership,
    collectionRegistry: collections?.registry,
    sources: collections?.sources ?? (() => undefined),
    whale: makeBalanceWhaleSource(),
    roles,
    ingest,
    // The event store is durable (Postgres) when eventStoreBackend=postgres, else in-memory (dev/test).
    // The rate limiter remains IN-MEMORY per-replica by design (best-effort anti-abuse, not a ledger).
    eventStore,
    rateLimiter: new FixedWindowRateLimiter({ limit: rl.limit, windowMs: rl.windowMs, now }),
    // S2-T3 (IMP-006): the PUBLIC teaser gets its OWN, tighter per-IP budget — best-effort only.
    teaserRateLimiter: new FixedWindowRateLimiter({
      limit: teaserRl.limit,
      windowMs: teaserRl.windowMs,
      now,
    }),
    // The bound that actually holds: identity-INDEPENDENT global cap on chain reconstructions.
    teaserBudget: new FixedWindowRateLimiter({
      limit: teaserBudgetCfg.limit,
      windowMs: teaserBudgetCfg.windowMs,
      now,
    }),
    publicJourneyBudget: publicJourneyBudgetCfg,
    auth: failClosedAuth(),
    isOperatedCommunity: (id) => config.operatedCommunities.includes(id),
    cta: config.cta,
    now,
    // F5: key the rate limit on the RIGHTMOST X-Forwarded-For hop — the one the trusted edge proxy (Railway)
    // appends, which a client cannot forge. The leftmost hop is client-claimed and spoofable, so keying on it
    // lets an attacker evade the limit by rotating a fake first hop. (Assumes ONE trusted proxy in front; add
    // more from the right if the deploy fronts the service with additional trusted proxies.)
    clientKey: (xff) => (xff?.split(',').pop()?.trim() || 'unknown'),
    k: config.k,
  };

  const app = new Hono();
  // X-API-Key gate (the dashboard's access-audit client sends `X-API-Key`). /healthz stays open for
  // deploy health checks. Defense-in-depth on top of the deploy's own network boundary.
  if (config.apiKey) {
    const keyBuf = Buffer.from(config.apiKey);
    app.use('*', async (c, next) => {
      // /healthz + the OPEN capability read (membership only, no member data) skip the key gate.
      // /v1/role-snapshot is exempt too — it is a DIFFERENT principal (the service exporter) authenticated
      // by its OWN service token (X-Ingest-Token) inside the route, not the dashboard's X-API-Key.
      // /v1/access-risk (S2-T3, G-5) is exempt BY DESIGN — it is the public lead-magnet teaser and must
      // work for a community we have no relationship with. Its abuse budget is its own tighter per-IP
      // limiter + registry gating + k-anon, NOT an API key (see audit-router.ts).
      // Match the EXACT route only (/v1/collections/:chain/:contract) — a broad prefix could
      // accidentally expose a future /v1/collections/... route (FAGAN S3).
      if (
        c.req.path === '/healthz' ||
        c.req.path === '/v1/role-snapshot' ||
        c.req.path === '/v1/access-risk' ||
        // The public gate-leak sub-routes (:runId poll, /resume, /interaction) are all part of the same
        // login-less lead-magnet lifecycle and MUST stay exempt — omitting /interaction 401s the public
        // demand signal (FR-11) before it reaches the handler, making the route dead-on-arrival in the
        // apiKey posture (FAGAN HIGH-2).
        /^\/v1\/access-risk\/[^/]+(?:\/resume|\/interaction)?$/.test(c.req.path) ||
        /^\/v1\/collections\/[^/]+\/[^/]+$/.test(c.req.path)
      )
        return next();
      const got = Buffer.from(c.req.header('x-api-key') ?? '');
      // §12.3 constant-time verify: always run timingSafeEqual — never short-circuit on length mismatch.
      // A `got.length === keyBuf.length &&` guard placed BEFORE timingSafeEqual turns the key length
      // into a timing oracle (attacker learns correct length in O(1)). Fix: pad/truncate the received
      // value to the reference length so timingSafeEqual always executes, then enforce the length
      // constraint on already-computed booleans (no timing leak from `&&` on plain booleans).
      const filled = Buffer.alloc(keyBuf.length, 0);
      got.copy(filled, 0, 0, Math.min(got.length, filled.length));
      const contentMatch = timingSafeEqual(filled, keyBuf);
      const ok = contentMatch && got.length === keyBuf.length;
      if (!ok) return new Response(null, { status: 401 }); // §12.3: no body detail on auth failure
      await next();
    });
  }
  app.get('/healthz', (c) => c.json({ ok: true }));
  app.route('/', createAuditRouter(deps));
  return app;
}

/** Read the server config from the environment, FAILING LOUD on a missing required value — a half-wired
 *  server (no operated communities, no CTA) must never boot + silently refuse every audit. */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): AuditServerConfig {
  const operated = (env.OPERATED_COMMUNITIES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (operated.length === 0) {
    throw new Error('OPERATED_COMMUNITIES is required (comma-separated community names this deploy audits)');
  }
  const product = env.CTA_PRODUCT;
  const conversation = env.CTA_CONVERSATION;
  if (!product || !conversation) {
    throw new Error('CTA_PRODUCT and CTA_CONVERSATION are required (the product + conversation door URLs)');
  }
  // k-anonymity threshold — validate it is a POSITIVE INTEGER. `AUDIT_K=0` (or NaN) would silently disable
  // k-anon and emit EXACT small-cohort counts, deanonymizing the stale/sold set (FAGAN MEDIUM-5).
  let k: number | undefined;
  if (env.AUDIT_K !== undefined && env.AUDIT_K !== '') {
    k = Number(env.AUDIT_K);
    if (!Number.isInteger(k) || k < 1) {
      throw new Error(`AUDIT_K must be a positive integer (got "${env.AUDIT_K}") — k < 1 disables k-anonymity`);
    }
  }
  const roleSnapshotStore = env.ROLE_SNAPSHOT_STORE || 'file';
  if (roleSnapshotStore !== 'file' && roleSnapshotStore !== 'postgres') {
    throw new Error(`ROLE_SNAPSHOT_STORE must be "file" or "postgres" (got "${roleSnapshotStore}")`);
  }
  if (roleSnapshotStore === 'postgres' && !env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required when ROLE_SNAPSHOT_STORE=postgres');
  }
  if (roleSnapshotStore === 'postgres' && !env.ROLE_SNAPSHOT_INGEST_TOKEN) {
    throw new Error('ROLE_SNAPSHOT_INGEST_TOKEN is required when ROLE_SNAPSHOT_STORE=postgres');
  }
  // G-1: event-store backend. Default memory (dev/test). Postgres is durable + fails loud without a URL,
  // so a durable-required deploy can never boot on the non-durable in-memory store.
  const eventStoreBackend = env.SHADOW_AUDIT_EVENT_STORE || 'memory';
  if (eventStoreBackend !== 'memory' && eventStoreBackend !== 'postgres') {
    throw new Error(`SHADOW_AUDIT_EVENT_STORE must be "memory" or "postgres" (got "${eventStoreBackend}")`);
  }
  if (eventStoreBackend === 'postgres' && !env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required when SHADOW_AUDIT_EVENT_STORE=postgres');
  }
  return {
    eventStoreBackend,
    apiKey: env.SHADOW_AUDIT_API_KEY || undefined,
    operatedCommunities: operated,
    cta: { product, conversation },
    roleSnapshotPath: env.ROLE_SNAPSHOT_PATH || undefined,
    ingestToken: env.ROLE_SNAPSHOT_INGEST_TOKEN || undefined,
    roleSnapshotDir: env.ROLE_SNAPSHOT_DIR || undefined,
    roleSnapshotStore,
    databaseUrl: env.DATABASE_URL || undefined,
    k,
  };
}
