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

import { Hono } from 'hono';
import type { Cta } from '@freeside/shadow-audit-protocol';
import { createAuditRouter, type AuditRouterDeps } from './http/audit-router.js';
import { makeFileRoleSource } from './role-source.js';
import { makeBalanceWhaleSource } from './whale-source.js';
import { InMemoryEventStore } from './event-store.js';
import { InMemoryNonceStore } from './association-verifier.js';
import { FixedWindowRateLimiter } from './rate-limiter.js';
import type { OwnershipSource } from './audit-service.js';

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
  /** per-IP rate limit (default 30 req / 60s). */
  rateLimit?: { limit: number; windowMs: number };
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

/** Build the audit Hono app from an injected `OwnershipSource` + the local adapters. */
export function buildAuditApp(ownership: OwnershipSource, config: AuditServerConfig): Hono {
  const now = () => Date.now();
  const rl = config.rateLimit ?? { limit: 30, windowMs: 60_000 };
  const deps: AuditRouterDeps = {
    ownership,
    whale: makeBalanceWhaleSource(),
    roles: makeFileRoleSource(config.roleSnapshotPath),
    eventStore: new InMemoryEventStore(),
    rateLimiter: new FixedWindowRateLimiter({ limit: rl.limit, windowMs: rl.windowMs, now }),
    auth: failClosedAuth(),
    isOperatedCommunity: (id) => config.operatedCommunities.includes(id),
    cta: config.cta,
    now,
    clientKey: (xff) => (xff?.split(',')[0]?.trim() || 'unknown'),
    k: config.k,
  };

  const app = new Hono();
  // X-API-Key gate (the dashboard's access-audit client sends `X-API-Key`). /healthz stays open for
  // deploy health checks. Defense-in-depth on top of the deploy's own network boundary.
  if (config.apiKey) {
    const key = config.apiKey;
    app.use('*', async (c, next) => {
      if (c.req.path === '/healthz') return next();
      if (c.req.header('x-api-key') !== key) return c.json({ error: 'unauthorized' }, 401);
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
  return {
    apiKey: env.SHADOW_AUDIT_API_KEY || undefined,
    operatedCommunities: operated,
    cta: { product, conversation },
    roleSnapshotPath: env.ROLE_SNAPSHOT_PATH || undefined,
    k: env.AUDIT_K ? Number(env.AUDIT_K) : undefined,
  };
}
