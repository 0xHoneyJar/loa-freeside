/**
 * SDD §5/§6 — inbound HTTP adapter (AC-4, AC-6) + the thin dashboard view (T9).
 *
 * A framework-light Hono router built from injected ports, so the full request
 * path is testable in-process (app.request) with fakes — no live chain/DB.
 *
 * MOUNTED BY: the `shadow-audit-api` server entry — `../server.ts` (buildAuditApp)
 * wires the real adapters; `bin/http.ts` constructs the chain OwnershipSource from
 * env + serves it (Sprint 2). It is its own deployable building, NOT the inward
 * operator-dash (an earlier docstring named operator-dash; that was aspirational +
 * the wrong host — operator-dash is inward operator-health, this is an outward
 * product surface).
 *
 * CONSUMED BY: freeside-dashboard's already-built dormant client
 * (`src/lib/freeside-worlds/access-audit/client.ts`): `GET ${SHADOW_AUDIT_API_URL}/v1/audit`
 * with an `X-API-Key`. The dashboard needs ZERO code change — point `SHADOW_AUDIT_API_URL`
 * (+ `SHADOW_AUDIT_API_KEY`) at the deployed audit-api and the seam goes live.
 *
 * Routes:
 *   GET  /v1/audit          → anonymous aggregate (k-anon), rate-limited
 *   POST /v1/audit          → named output, gated by AssociationVerifier (auth)
 *   POST /v1/audit/reaction → "does this match?" capture (run lifecycle checked)
 *   POST /v1/audit/contact  → consented contact capture
 *   GET  /v1/audit/view     → thin server-rendered HTML (aggregate + reaction + dual CTA)
 */

import { Hono, type Context } from 'hono';
import { z } from 'zod';
import {
  OrderSchema,
  REFUSAL_HTTP_STATUS,
  type CohortCount,
  type Cta,
  type Order,
  type Refusal,
} from '@freeside/shadow-audit-protocol';
import {
  runAudit,
  type AuditServiceResult,
  type OwnershipSource,
  type RoleSource,
  type WhaleSource,
} from '../audit-service.js';
import {
  verifyAssociation,
  SignedAuthMessageSchema,
  type AuthExpectations,
  type CommunityOwnerCheck,
  type NonceStore,
  type RecoverSigner,
} from '../association-verifier.js';
import type { RateLimiter } from '../rate-limiter.js';
import {
  isRunWithinWindow,
  ReactionSchema,
  type EventStore,
  type RunEvent,
} from '../event-store.js';

export interface AuditRouterDeps {
  ownership: OwnershipSource;
  whale: WhaleSource;
  roles: RoleSource;
  eventStore: EventStore;
  rateLimiter: RateLimiter;
  auth: {
    recover: RecoverSigner;
    nonces: NonceStore;
    isCommunityOwner: CommunityOwnerCheck;
    domain: string;
    chainId: number;
    scope: string;
    maxValiditySeconds: number;
  };
  isOperatedCommunity: (communityId: string) => boolean;
  cta: Cta;
  /** unix ms. */
  now: () => number;
  /** rate-limit key from the x-forwarded-for header (the gateway sets it). */
  clientKey: (xff: string | undefined) => string;
  k?: number;
  runWindowMs?: number;
}

const DEFAULT_RUN_WINDOW_MS = 86_400_000; // 24h

type RefusalStatus = 404 | 422 | 429 | 503;

function refusalStatus(refusal: Refusal): RefusalStatus {
  return (REFUSAL_HTTP_STATUS[refusal.code] ?? 422) as RefusalStatus;
}

const OrderQuerySchema = z.object({
  chain: z.string(),
  contract: z.string(),
  snapshot_date: z.string(),
  community: z.string(),
  owner_wallet: z.string(),
  threshold: z.string().optional(),
  gating: z.string().optional(),
});
type OrderQuery = z.infer<typeof OrderQuerySchema>;

function buildOrder(q: Omit<OrderQuery, 'gating'>): { ok: true; order: Order } | { ok: false } {
  const parsed = OrderSchema.safeParse({
    community: { name: q.community, owner_wallet: q.owner_wallet },
    source: { chain: q.chain, contract_address: q.contract },
    gating_rule: { kind: 'nft-balance', threshold: Number(q.threshold ?? '1') },
    products: ['audit'],
    mode: 'lead-magnet',
  });
  return parsed.success ? { ok: true, order: parsed.data } : { ok: false };
}

function cohortText(c: CohortCount): string {
  return c.kind === 'exact' ? String(c.value) : c.bucket;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function recordRun(
  deps: AuditRouterDeps,
  output: { run_id: string; inputs_hash: string; aggregate: { stale_access: CohortCount } },
  extra: Partial<RunEvent> = {},
): Promise<void> {
  const stale = output.aggregate.stale_access;
  await deps.eventStore.appendRunEvent({
    run_id: output.run_id,
    mode: 'dogfood-full',
    inputs_hash: output.inputs_hash,
    stale_set_size: stale.kind === 'exact' ? stale.value : 0,
    reruns: 0,
    ts: new Date(deps.now()).toISOString(),
    ...extra,
  });
}

async function audit(
  deps: AuditRouterDeps,
  order: Order,
  snapshotDate: string,
  includeRecords: boolean,
): Promise<AuditServiceResult> {
  return runAudit(
    {
      order,
      snapshotDate,
      isOperatedCommunity: deps.isOperatedCommunity(order.community.name),
      nowUnixSeconds: Math.floor(deps.now() / 1000),
      includeRecords,
      cta: deps.cta,
    },
    { ownership: deps.ownership, whale: deps.whale, roles: deps.roles, k: deps.k },
  );
}

/** Read a request body as JSON or form-encoded (BLOCK-1: the no-JS HTML form
 *  posts application/x-www-form-urlencoded). */
async function readBody(c: Context): Promise<{ body: unknown; isForm: boolean }> {
  const ct = c.req.header('content-type') ?? '';
  if (ct.includes('form-urlencoded') || ct.includes('multipart/form-data')) {
    const form = (await c.req.parseBody()) as Record<string, unknown>;
    // consent arrives as a string from a form — coerce to a real boolean.
    if ('consent' in form) {
      form.consent = form.consent === 'true' || form.consent === 'on' || form.consent === true;
    }
    return { body: form, isForm: true };
  }
  return { body: await c.req.json().catch(() => null), isForm: false };
}

export function createAuditRouter(deps: AuditRouterDeps): Hono {
  const app = new Hono();
  const runWindow = deps.runWindowMs ?? DEFAULT_RUN_WINDOW_MS;

  const isRateLimited = (c: Context): boolean =>
    !deps.rateLimiter.check(deps.clientKey(c.req.header('x-forwarded-for'))).allowed;

  const rateLimitRefusal: Refusal = {
    code: 'rate-limited',
    reason: 'too many requests',
    retryable: true,
  };

  // ---- GET /v1/audit — anonymous aggregate -------------------------------
  app.get('/v1/audit', async (c) => {
    if (isRateLimited(c)) return c.json({ error: rateLimitRefusal }, refusalStatus(rateLimitRefusal));
    const q = OrderQuerySchema.safeParse(c.req.query());
    if (!q.success) return c.json({ error: 'missing/invalid query params' }, 400);
    if ((q.data.gating ?? 'nft-balance') !== 'nft-balance') {
      const r: Refusal = { code: 'unsupported-gating', reason: `gating "${q.data.gating}" not supported`, retryable: false };
      return c.json({ error: r }, refusalStatus(r));
    }
    const built = buildOrder(q.data);
    if (!built.ok) return c.json({ error: 'invalid order params' }, 400);

    const result = await audit(deps, built.order, q.data.snapshot_date, false);
    if (!result.ok) return c.json({ error: result.refusal }, refusalStatus(result.refusal));
    await recordRun(deps, result.output);
    // Return the PROTOCOL `AuditOutput` verbatim (anonymous ⇒ no `records`). freeside-dashboard's client
    // strict-decodes this against the protocol's AuditOutputSchema (`onExcessProperty: error`), so the
    // earlier hand-picked subset (missing mode/inputs_hash) + the excess top-level `uncertain` made the
    // dashboard reject every 200 and show empty — a silently-broken integration. `uncertain` (the stale-
    // snapshot signal) stays on the HTML /view route; re-adding it to this JSON needs a protocol change
    // on both sides (verified end-to-end by the contract-parity test).
    return c.json(result.output);
  });

  // ---- POST /v1/audit — named output (authed) ----------------------------
  const NamedBodySchema = z.object({
    chain: z.string(),
    contract: z.string(),
    snapshot_date: z.string(),
    community: z.string(),
    owner_wallet: z.string(),
    threshold: z.string().optional(),
    auth: z.object({
      message: SignedAuthMessageSchema,
      signature: z.string(),
      ownerWallet: z.string(),
    }),
  });

  app.post('/v1/audit', async (c) => {
    if (isRateLimited(c)) return c.json({ error: rateLimitRefusal }, refusalStatus(rateLimitRefusal));
    const body = await c.req.json().catch(() => null);
    const parsed = NamedBodySchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'invalid body' }, 400);

    const built = buildOrder(parsed.data);
    if (!built.ok) return c.json({ error: 'invalid order params' }, 400);

    // BB-1: bind the signature to THIS request's order (not a static expectation),
    // and require the signer to be the order's owner_wallet.
    const expectations: AuthExpectations = {
      domain: deps.auth.domain,
      chainId: deps.auth.chainId,
      contract: built.order.source.contract_address,
      communityId: built.order.community.name,
      scope: deps.auth.scope,
      maxValiditySeconds: deps.auth.maxValiditySeconds,
      nowUnixSeconds: Math.floor(deps.now() / 1000),
    };
    const authResult = await verifyAssociation(
      {
        message: parsed.data.auth.message,
        signature: parsed.data.auth.signature,
        ownerWallet: parsed.data.auth.ownerWallet,
      },
      expectations,
      { recover: deps.auth.recover, nonces: deps.auth.nonces, isCommunityOwner: deps.auth.isCommunityOwner },
    );
    if (!authResult.ok) return c.json({ error: 'unauthorized', reason: authResult.reason }, 401);
    if (authResult.wallet.toLowerCase() !== built.order.community.owner_wallet.toLowerCase()) {
      return c.json({ error: 'unauthorized', reason: 'signer is not the community owner_wallet' }, 401);
    }

    const result = await audit(deps, built.order, parsed.data.snapshot_date, true);
    if (!result.ok) return c.json({ error: result.refusal }, refusalStatus(result.refusal));
    await recordRun(deps, result.output);
    return c.json(result.output);
  });

  // ---- POST /v1/audit/reaction ------------------------------------------
  app.post('/v1/audit/reaction', async (c) => {
    if (isRateLimited(c)) return c.json({ error: rateLimitRefusal }, refusalStatus(rateLimitRefusal));
    const { body, isForm } = await readBody(c);
    const parsed = z.object({ run_id: z.string().min(1), reaction: ReactionSchema }).safeParse(body);
    if (!parsed.success) return c.json({ error: 'invalid body' }, 400);
    const run = await deps.eventStore.getRun(parsed.data.run_id);
    if (!run || !isRunWithinWindow(run, deps.now(), runWindow)) {
      return c.json({ error: 'unknown or expired run_id' }, 404);
    }
    await deps.eventStore.appendRunEvent({
      run_id: parsed.data.run_id,
      mode: 'dogfood-full',
      inputs_hash: run.inputs_hash,
      stale_set_size: 0,
      reruns: 0,
      reaction: parsed.data.reaction,
      ts: new Date(deps.now()).toISOString(),
    });
    // BLOCK-1: a no-JS form submit completes via redirect; JSON callers get JSON.
    if (isForm) return c.redirect('/v1/audit/view', 303);
    return c.json({ ok: true });
  });

  // ---- POST /v1/audit/contact (consent required) ------------------------
  app.post('/v1/audit/contact', async (c) => {
    if (isRateLimited(c)) return c.json({ error: rateLimitRefusal }, refusalStatus(rateLimitRefusal));
    const { body } = await readBody(c);
    const parsed = z
      .object({ run_id: z.string().min(1), contact: z.string().min(1).max(320), consent: z.literal(true) })
      .safeParse(body);
    if (!parsed.success) return c.json({ error: 'invalid body or missing consent' }, 400);
    const run = await deps.eventStore.getRun(parsed.data.run_id);
    if (!run || !isRunWithinWindow(run, deps.now(), runWindow)) {
      return c.json({ error: 'unknown or expired run_id' }, 404);
    }
    await deps.eventStore.appendContact({
      run_id: parsed.data.run_id,
      contact: parsed.data.contact,
      consent: true,
      ts: new Date(deps.now()).toISOString(),
    });
    return c.json({ ok: true });
  });

  // ---- GET /v1/audit/view — thin dashboard HTML (T9) ---------------------
  app.get('/v1/audit/view', async (c) => {
    if (isRateLimited(c)) return c.html('<p>rate limited — try again shortly</p>', 429);
    const q = OrderQuerySchema.safeParse(c.req.query());
    if (!q.success) return c.html('<p>missing/invalid query params</p>', 400);
    if ((q.data.gating ?? 'nft-balance') !== 'nft-balance') {
      return c.html(
        renderRefusalHtml({ code: 'unsupported-gating', reason: `gating "${q.data.gating}" not supported`, retryable: false }),
        422,
      );
    }
    const built = buildOrder(q.data);
    if (!built.ok) return c.html('<p>invalid order params</p>', 400);
    const result = await audit(deps, built.order, q.data.snapshot_date, false);
    if (!result.ok) {
      return c.html(renderRefusalHtml(result.refusal), refusalStatus(result.refusal));
    }
    await recordRun(deps, result.output);
    return c.html(renderAuditHtml(result.output, result.uncertain));
  });

  return app;
}

function renderRefusalHtml(refusal: Refusal): string {
  return `<!doctype html><html><body>
  <h1>We can't run this audit</h1>
  <p>${escapeHtml(refusal.reason)}</p>
  </body></html>`;
}

function renderAuditHtml(
  output: { run_id: string; aggregate: AuditAggregateLike; cta: Cta },
  uncertain: boolean,
): string {
  const a = output.aggregate;
  const turnoverPct = (a.holder_turnover * 100).toFixed(0);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Shadow Access Audit</title></head><body>
  <h1>Shadow Access Audit</h1>
  ${uncertain ? '<p><em>Heads up: the role snapshot is stale — treat these numbers as directional.</em></p>' : ''}
  <ul>
    <li>Stale access (role, no longer qualifies): <strong>${escapeHtml(cohortText(a.stale_access))}</strong></li>
    <li>Sold / lapsed: <strong>${escapeHtml(cohortText(a.sold_lapsed))}</strong></li>
    <li>Newly eligible: <strong>${escapeHtml(cohortText(a.newly_eligible))}</strong></li>
    <li>Holder turnover: <strong>${turnoverPct}%</strong></li>
    <li>Stale-access risk: <strong>${escapeHtml(a.stale_access_risk_band)}</strong></li>
  </ul>
  <form method="post" action="/v1/audit/reaction">
    <input type="hidden" name="run_id" value="${escapeHtml(output.run_id)}">
    <p>Does this match what you expected?</p>
    <button name="reaction" value="worse">Worse than I thought</button>
    <button name="reaction" value="expected">About what I expected</button>
    <button name="reaction" value="surprised">Surprised me</button>
  </form>
  <p>
    <a href="${escapeHtml(output.cta.product)}">See the access control-plane</a> &middot;
    <a href="${escapeHtml(output.cta.conversation)}">Talk to us</a>
  </p>
  </body></html>`;
}

interface AuditAggregateLike {
  holder_turnover: number;
  stale_access: CohortCount;
  sold_lapsed: CohortCount;
  newly_eligible: CohortCount;
  stale_access_risk_band: string;
}
