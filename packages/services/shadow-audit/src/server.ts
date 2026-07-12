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
import type { CollectionRegistry } from './ownership-source.js';
import { makeFileRoleSource } from './role-source.js';
import { makeDurableRoleStore } from './role-store.js';
import { makeBalanceWhaleSource } from './whale-source.js';
import { InMemoryEventStore } from './event-store.js';
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
  /** S2-T3: per-IP limit for the PUBLIC /v1/access-risk teaser (default 6 req / 60s — tighter, because it
   *  is unauthenticated and each call does real chain work). */
  teaserRateLimit?: { limit: number; windowMs: number };
  /** S1-T4: service token the exporter presents to POST /v1/role-snapshot. When set, ingestion is enabled
   *  and the durable role store becomes the audit's role source; when absent, ingestion is NOT mounted and
   *  the role source falls back to the file at `roleSnapshotPath` (existing behavior). */
  ingestToken?: string;
  /** S1-T4: directory the durable role store writes ingested snapshots to (default `./data/role-snapshots`). */
  roleSnapshotDir?: string;
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

/** Build the audit Hono app from an injected `OwnershipSource` + the local adapters. */
export function buildAuditApp(ownership: OwnershipSource, config: AuditServerConfig, collectionRegistry?: CollectionRegistry): Hono {
  const now = () => Date.now();
  const rl = config.rateLimit ?? { limit: 30, windowMs: 60_000 };
  // Tighter default for the unauthenticated teaser (S2-T3): 6/min per IP.
  const teaserRl = config.teaserRateLimit ?? { limit: 6, windowMs: 60_000 };

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
    const store = makeDurableRoleStore({
      dir: config.roleSnapshotDir ?? './data/role-snapshots',
      community,
    });
    roles = store;
    ingest = { token: config.ingestToken, sink: store };
  } else {
    roles = makeFileRoleSource(config.roleSnapshotPath);
  }

  const deps: AuditRouterDeps = {
    ownership,
    collectionRegistry,
    whale: makeBalanceWhaleSource(),
    roles,
    ingest,
    // F4: the event store + rate limiter are IN-MEMORY (per-replica, non-durable). That is correct for the
    // single-replica MVP — the audit is stateless read-modelling + best-effort anti-abuse, not a ledger.
    // loa:shortcut: in-memory event/rate state; if this scales past one replica, back both with Redis (the
    //   rate window + the nonce/event store), else limits + replay-dedup are per-replica.
    eventStore: new InMemoryEventStore(),
    rateLimiter: new FixedWindowRateLimiter({ limit: rl.limit, windowMs: rl.windowMs, now }),
    // S2-T3 (IMP-006): the PUBLIC teaser gets its OWN, tighter budget — it is unauthenticated and each call
    // costs a block-at-date resolve + two balance reconstructions. Default 6/min vs the authed 30/min.
    teaserRateLimiter: new FixedWindowRateLimiter({
      limit: teaserRl.limit,
      windowMs: teaserRl.windowMs,
      now,
    }),
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
  return {
    apiKey: env.SHADOW_AUDIT_API_KEY || undefined,
    operatedCommunities: operated,
    cta: { product, conversation },
    roleSnapshotPath: env.ROLE_SNAPSHOT_PATH || undefined,
    ingestToken: env.ROLE_SNAPSHOT_INGEST_TOKEN || undefined,
    roleSnapshotDir: env.ROLE_SNAPSHOT_DIR || undefined,
    k,
  };
}
