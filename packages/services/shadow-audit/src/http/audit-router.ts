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
  type DriftReport,
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
import type { CollectionRegistry } from '../ownership-source.js';
import { canonicalCollectionKey, type SourceResolver } from '../collection-union.js';
import {
  verifyAssociation,
  SignedAuthMessageSchema,
  type AuthExpectations,
  type CommunityOwnerCheck,
  type NonceStore,
  type RecoverSigner,
} from '../association-verifier.js';
import type { RateLimiter, ReconstructionBudget } from '../rate-limiter.js';
import {
  isRunWithinWindow,
  ReactionSchema,
  type EventStore,
  type RunEvent,
} from '../event-store.js';
import { createHash } from 'node:crypto';
import {
  ROLE_SNAPSHOT_MAX_FUTURE_SKEW_MS,
  RoleSnapshotSchema,
} from '../role-snapshot.js';
import {
  RoleSnapshotConflictError,
  UndeclaredCollectionSourceError,
  type RoleSink,
} from '../role-store.js';
import { timingSafeEqualStr } from '../crypto-util.js';
import {
  computeAccessRisk,
  type AccessRiskOutput,
  type AccessRiskResult,
} from '../access-risk.js';

export interface AuditRouterDeps {
  ownership: OwnershipSource;
  /** Membership lookup for the OPEN capability read (GET /v1/collections/:chain/:contract). */
  collectionRegistry?: CollectionRegistry;
  /** S5-T3 — the addressed deployment → the collection's FULL source set. REQUIRED: without it no audit
   *  can know whether the collection it was handed is one chain of several, and a single-chain audit of a
   *  bridged collection brands the other chain's holders as stale access. */
  sources: SourceResolver;
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
  /** S1-T4 (IMP-009): role-snapshot ingestion. Absent → the POST /v1/role-snapshot route is NOT mounted
   *  (fail-closed: no ingest token configured ⇒ no ingestion surface, never an open one). */
  ingest?: {
    /** Current and previous tokens may overlap during a rotation. */
    tokens?: readonly string[];
    /** Backward-compatible single-token injection for tests/local callers. */
    token?: string;
    sink: RoleSink;
  };
  /** S2-T3 (IMP-006): dedicated, TIGHTER limiter for the PUBLIC teaser. That route is unauthenticated and
   *  does real chain work (RPC + reconstruction), so it must not share the authed routes' budget. Falls
   *  back to `rateLimiter` when absent.
   *
   *  BEST-EFFORT ONLY — do NOT rely on this as the abuse bound. It is keyed on the client identifier
   *  derived from X-Forwarded-For, which is CALLER-SUPPLIED. A live probe (2026-07-12) sent 9 requests with
   *  rotating XFF against the 6/min teaser and NONE were limited. Treat per-IP as a speed bump; the real
   *  collection-scoped bound is `teaserBudget` + the cache below. */
  teaserRateLimiter?: RateLimiter;
  /**
   * S2-T3 COLLECTION HARD BOUND: an identity-independent, shared budget on the expensive path, keyed on
   * the finite registry's canonical collection — not on the client. Production supplies a Postgres-backed
   * implementation so every replica consumes from the same per-collection counter. One collection's flood
   * cannot starve every other collection. Tests may inject the synchronous in-memory limiter.
   */
  teaserBudget?: ReconstructionBudget;
  /** S2-T3: TTL for memoizing the (deterministic) teaser result, so repeat queries cost ZERO chain work. */
  teaserCacheTtlMs?: number;
}

const DEFAULT_RUN_WINDOW_MS = 86_400_000; // 24h

/** Hard cap on an ingested role snapshot (S1-T4). ~10 MB comfortably holds a very large guild export;
 *  beyond that a caller is abusing the endpoint, not exporting a Discord guild. */
const MAX_SNAPSHOT_BYTES = 10 * 1024 * 1024;
/** At most ~40 MiB of aggregate request buffering (2 × roughly 2× MAX_SNAPSHOT_BYTES). */
const MAX_CONCURRENT_INGESTS = 2;

type BoundedBodyResult =
  | { ok: true; text: string; bytes: Uint8Array }
  | { ok: false; reason: 'too-large' };

/**
 * Read and decode at most `maxBytes`, cancelling the stream as soon as it exceeds the bound.
 *
 * Chunk accumulation plus the final contiguous buffer peaks near 2× `maxBytes`
 * for a maximum-size request. The authenticated ingest lane enforces a small
 * process-wide bulkhead below, bounding aggregate buffering as well as
 * per-request size without serializing every sibling collection export.
 */
async function readBoundedText(request: Request, maxBytes: number): Promise<BoundedBodyResult> {
  const body = request.body;
  if (!body) return { ok: true, text: '', bytes: new Uint8Array() };

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;

  try {
    while (true) {
      // oxlint-disable-next-line no-await-in-loop -- stream chunks must be consumed sequentially
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        // oxlint-disable-next-line no-await-in-loop -- cancel the same reader before returning
        await reader.cancel('snapshot too large');
        return { ok: false, reason: 'too-large' };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(bytesRead);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { ok: true, text: new TextDecoder().decode(bytes), bytes };
  } finally {
    reader.releaseLock();
  }
}

type RefusalStatus = 404 | 422 | 429 | 503;

function refusalStatus(refusal: Refusal): RefusalStatus {
  return (REFUSAL_HTTP_STATUS[refusal.code] ?? 422) as RefusalStatus;
}

const MIN_SNAPSHOT_DATE = '2015-07-30';
const SnapshotDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'snapshot_date must be YYYY-MM-DD')
  .refine((value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year!, month! - 1, day!));
    if (Number.isNaN(date.getTime())) return false;
    return date.toISOString().slice(0, 10) === value;
  }, 'snapshot_date must be a real UTC calendar date')
  .refine(
    (value) => value >= MIN_SNAPSHOT_DATE,
    `snapshot_date must be on or after ${MIN_SNAPSHOT_DATE}`,
  );

const isNonFutureSnapshotDate = (value: string, nowMs: number): boolean =>
  value <= new Date(nowMs).toISOString().slice(0, 10);

const OrderQuerySchema = z.object({
  chain: z.string(),
  contract: z.string(),
  snapshot_date: SnapshotDateSchema,
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
    { ownership: deps.ownership, whale: deps.whale, roles: deps.roles, sources: deps.sources, k: deps.k },
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

  // ---- GET /v1/collections/:chain/:contract — capability read (OPEN) ------
  // "Can the audit cover this collection?" — membership + static config only,
  // NO member data. This is what the ordering service's shadow_preview probe
  // needs (SDD sandwich-line FR-2). Returns 200 {collection, standard} / 404.
  app.get('/v1/collections/:chain/:contract', (c) => {
    // Rate-limited like the sibling routes — an OPEN endpoint must not be an
    // unauthenticated enumeration oracle (FAGAN S3).
    if (isRateLimited(c)) return c.json({ error: rateLimitRefusal }, refusalStatus(rateLimitRefusal));
    if (!deps.collectionRegistry) return c.json({ error: 'registry unavailable' }, 503);
    const chain = c.req.param('chain');
    const contract = c.req.param('contract');
    const ref = deps.collectionRegistry({ chain, contract });
    if (!ref) return c.json({ error: 'not_found', chain, contract }, 404);
    return c.json({ chain, contract, collection: ref.collection, standard: ref.standard });
  });

  // ---- GET /v1/access-risk — the PUBLIC teaser (S2-T3, G-5, IMP-006) ------
  // UNAUTHENTICATED by design (exempted from the X-API-Key gate in server.ts): this is the lead magnet —
  // it must work for a community whose Discord we have NO access to. On-chain only, aggregate only, k-anon.
  // It never returns member data and never claims to know the real stale-access set (see access-risk.ts).
  const AccessRiskQuerySchema = z.object({
    chain: z.string().regex(/^[1-9]\d*$/, 'chain must be a canonical positive numeric id'),
    contract: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'contract must be an EVM address'),
    snapshot_date: SnapshotDateSchema,
    threshold: z.string().optional(),
  });

  // Memoize the teaser. The result is DETERMINISTIC for (canonical collection source set,
  // snapshot_date, threshold) within a TTL, so a repeat through ANY sibling deployment must cost ZERO
  // chain work. This — not the per-IP limiter — is what makes a flood cheap. Bounded so the map cannot
  // grow without limit.
  const teaserTtlMs = deps.teaserCacheTtlMs ?? 300_000; // 5 min
  const TEASER_CACHE_MAX = 500;
  const teaserCache = new Map<string, { at: number; body: AccessRiskOutput }>();
  // A cache entry exists only after reconstruction finishes. Coalesce an
  // identical concurrent miss so a same-key burst consumes one budget unit
  // and performs one reconstruction, not one per waiter.
  const teaserInFlight = new Map<string, Promise<AccessRiskResult>>();
  const presentTeaserForAddress = (
    body: AccessRiskOutput,
    addressedChain: string,
  ): AccessRiskOutput => {
    const addressed = body.collection_sources.find(
      (source) => source.chain === addressedChain,
    );
    return addressed ? { ...body, snapshot_block: addressed.snapshot_block } : body;
  };

  app.get('/v1/access-risk', async (c) => {
    // Anti-abuse #1 — per-IP speed bump. BEST-EFFORT ONLY: the key derives from X-Forwarded-For, which the
    // CALLER supplies. A live probe (2026-07-12) rotated XFF across 9 requests against the 6/min teaser and
    // NONE were limited. Keep it (it stops naive hammering) but never treat it as the bound. The real
    // bounds are the cache (#4) and the identity-independent global budget (#5).
    const limiter = deps.teaserRateLimiter ?? deps.rateLimiter;
    if (!limiter.check(deps.clientKey(c.req.header('x-forwarded-for'))).allowed) {
      return c.json({ error: rateLimitRefusal }, refusalStatus(rateLimitRefusal));
    }

    const q = AccessRiskQuerySchema.safeParse(c.req.query());
    if (!q.success || !isNonFutureSnapshotDate(q.data.snapshot_date, deps.now())) {
      return c.json({ error: 'missing/invalid query params' }, 400);
    }
    const canonicalChain = q.data.chain;
    const canonicalContract = q.data.contract.toLowerCase();

    // Anti-abuse #2 — ANTI-ENUMERATION: only collections in the registry are auditable, so an open caller
    // cannot walk the chain/contract space using this endpoint as a probe oracle.
    if (!deps.collectionRegistry) return c.json({ error: 'registry unavailable' }, 503);
    if (!deps.collectionRegistry({ chain: canonicalChain, contract: canonicalContract })) {
      const r: Refusal = {
        code: 'unindexed-contract',
        reason: 'contract is not in the audited collection registry',
        retryable: false,
      };
      return c.json({ error: r }, refusalStatus(r));
    }
    const collectionSources = deps.sources({
      chain: canonicalChain,
      contract: canonicalContract,
    });
    if (!collectionSources || collectionSources.length === 0) {
      const r: Refusal = {
        code: 'unindexed-contract',
        reason: 'contract is not in the audited collection registry',
        retryable: false,
      };
      return c.json({ error: r }, refusalStatus(r));
    }

    const threshold = Number(q.data.threshold ?? '1');
    if (!Number.isInteger(threshold) || threshold < 1) {
      return c.json({ error: 'threshold must be a positive integer' }, 400);
    }

    // Anti-abuse #4 — CACHE. The teaser is deterministic for these inputs, so a repeat is free. A flood of
    // identical queries (the cheapest attack) does exactly ONE reconstruction per TTL.
    const cacheKey =
      `${canonicalCollectionKey(collectionSources)}/${q.data.snapshot_date}/${threshold}`;
    const now = deps.now();
    const hit = teaserCache.get(cacheKey);
    if (hit && now - hit.at < teaserTtlMs) {
      // Map preserves insertion order: promote on hit so a cold-key scan cannot evict the hot working set.
      teaserCache.delete(cacheKey);
      teaserCache.set(cacheKey, hit);
      return c.json(presentTeaserForAddress(hit.body, canonicalChain));
    }
    if (hit) teaserCache.delete(cacheKey); // expired entries do not consume capacity

    let result: AccessRiskResult;
    const existing = teaserInFlight.get(cacheKey);
    if (existing) {
      result = await existing;
    } else {
      // Anti-abuse #5 — the collection-scoped HARD BOUND on cache MISSES (the only expensive path), keyed
      // on the finite registry identity, NOT on the caller. Production's atomic Postgres decision is shared
      // by every replica, while one flooded collection cannot starve unrelated collections. Install the
      // promise BEFORE awaiting that remote decision, so identical local misses cannot race through the
      // budget and consume multiple units.
      const computation: Promise<AccessRiskResult> = (async () => {
        if (deps.teaserBudget) {
          try {
            const collectionBudgetKey = createHash('sha256')
              .update(canonicalCollectionKey(collectionSources))
              .digest('hex');
            if (!(await deps.teaserBudget.check(collectionBudgetKey)).allowed) {
              return { ok: false, refusal: rateLimitRefusal };
            }
          } catch {
            console.error(JSON.stringify({ event: 'teaser_budget_unavailable' }));
            return {
              ok: false,
              refusal: {
                code: 'upstream-exhausted',
                reason: 'reconstruction budget unavailable',
                retryable: true,
              },
            };
          }
        }
        // Anti-abuse #3 (k-anon + meaningful-or-refuse) lives in computeAccessRisk: a sub-k denominator is
        // REFUSED (cohort-too-small) rather than served as a vacuous "no risk" or a back-computable ratio.
        return computeAccessRisk(
          {
            chain: canonicalChain,
            contract: canonicalContract,
            snapshotDate: q.data.snapshot_date,
            threshold,
            nowUnixSeconds: Math.floor(now / 1000),
            cta: deps.cta,
          },
          { ownership: deps.ownership, whale: deps.whale, sources: deps.sources, k: deps.k },
        );
      })();
      teaserInFlight.set(cacheKey, computation);
      try {
        result = await computation;
      } finally {
        // Delete only our promise so a future implementation can safely replace
        // an entry without an older waiter erasing it.
        if (teaserInFlight.get(cacheKey) === computation) teaserInFlight.delete(cacheKey);
      }
    }
    if (!result.ok) {
      return c.json({ error: result.refusal }, refusalStatus(result.refusal));
    }

    // Sweep expired entries first; only live entries compete for the bounded LRU.
    for (const [key, entry] of teaserCache) {
      if (now - entry.at >= teaserTtlMs) teaserCache.delete(key);
    }
    if (teaserCache.size >= TEASER_CACHE_MAX) {
      // Hits are promoted above, so the first entry is least recently used.
      const oldest = teaserCache.keys().next().value;
      if (oldest !== undefined) teaserCache.delete(oldest);
    }
    teaserCache.set(cacheKey, { at: now, body: result.output });
    return c.json(presentTeaserForAddress(result.output, canonicalChain));
  });

  // ---- GET /v1/audit — anonymous aggregate -------------------------------
  app.get('/v1/audit', async (c) => {
    if (isRateLimited(c)) return c.json({ error: rateLimitRefusal }, refusalStatus(rateLimitRefusal));
    const q = OrderQuerySchema.safeParse(c.req.query());
    if (!q.success || !isNonFutureSnapshotDate(q.data.snapshot_date, deps.now())) {
      return c.json({ error: 'missing/invalid query params' }, 400);
    }
    if ((q.data.gating ?? 'nft-balance') !== 'nft-balance') {
      const r: Refusal = { code: 'unsupported-gating', reason: `gating "${q.data.gating}" not supported`, retryable: false };
      return c.json({ error: r }, refusalStatus(r));
    }
    const built = buildOrder(q.data);
    if (!built.ok) return c.json({ error: 'invalid order params' }, 400);

    const result = await audit(deps, built.order, q.data.snapshot_date, false);
    if (!result.ok) {
      // A COVERAGE refusal carries the DRIFT BOARD. The wallet-derived aggregate is refused, but the
      // counts-only board needs no wallet map — and it is the only honest answer for a community at ~0%
      // identity coverage (thj). Omitting it here would mean every JSON consumer (the dashboard) shows an
      // empty state for exactly the community this was built for. The HTML view already renders it; the
      // JSON must too, or the drift is visible only to whoever curls the server.
      // Contract proof: freeside-dashboard's strict `AuditRefusalSchema` explicitly admits optional
      // `drift`, and its client test decodes this exact 422 shape. Success and refusal are separate schemas.
      return c.json(
        'drift' in result && result.drift
          ? { error: result.refusal, drift: result.drift }
          : { error: result.refusal },
        refusalStatus(result.refusal),
      );
    }
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
    snapshot_date: SnapshotDateSchema,
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
    if (!parsed.success || !isNonFutureSnapshotDate(parsed.data.snapshot_date, deps.now())) {
      return c.json({ error: 'invalid body' }, 400);
    }

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
    if (!result.ok) {
      // A COVERAGE refusal carries the DRIFT BOARD. The wallet-derived aggregate is refused, but the
      // counts-only board needs no wallet map — and it is the only honest answer for a community at ~0%
      // identity coverage (thj). Omitting it here would mean every JSON consumer (the dashboard) shows an
      // empty state for exactly the community this was built for. The HTML view already renders it; the
      // JSON must too, or the drift is visible only to whoever curls the server.
      return c.json(
        'drift' in result && result.drift
          ? { error: result.refusal, drift: result.drift }
          : { error: result.refusal },
        refusalStatus(result.refusal),
      );
    }
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
    if (!q.success || !isNonFutureSnapshotDate(q.data.snapshot_date, deps.now())) {
      return c.html('<p>missing/invalid query params</p>', 400);
    }
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
      // A COVERAGE refusal still carries the drift board (the counts-only report needs no wallet map).
      // Rendering the refusal alone would deny the report to the exact community it was built for: thj is
      // at ~0% wallet coverage, and the side-by-side is the ONLY honest thing we can show it. So the page
      // says both — "we cannot see your members" AND "here is your drift anyway".
      return c.html(
        renderRefusalHtml(result.refusal, result.drift),
        refusalStatus(result.refusal),
      );
    }
    await recordRun(deps, result.output);
    // The drift report comes from the SERVICE RESULT, not `result.output` — it is emitted on the wire only
    // with the authed delta (the anon JSON must stay byte-stable for freeside-dashboard's strict decode).
    // HTML has no strict decoder, so the anon HUMAN surface can show it: this IS "the community sees its
    // real drift, next to its incumbent roles" (DoD #4).
    return c.html(
      renderAuditHtml(result.output, result.uncertain, result.uncertainReasons, result.drift),
    );
  });

  // ---- POST /v1/role-snapshot — exporter ingestion (S1-T4, IMP-009) -------
  // The freeside-characters exporter feeds the audit's role snapshot here (the S1↔S3 seam). Service-token
  // auth — a DISTINCT principal from the dashboard X-API-Key (this path is exempted from that gate in
  // server.ts). Byte-exact sha256 integrity over the raw body. Mounted ONLY when ingestion is configured,
  // so an unconfigured deploy has NO ingestion surface (fail-closed), never an open one.
  if (deps.ingest) {
    const ingest = deps.ingest;
    const ingestTokens = ingest.tokens ?? (ingest.token === undefined ? [] : [ingest.token]);
    if (ingestTokens.length === 0 || ingestTokens.some((token) => token.length === 0)) {
      throw new Error('role-snapshot ingestion requires at least one non-empty token');
    }
    // The body reader can hold close to twice the byte cap while joining stream chunks. A two-slot bulkhead
    // enforces the heap bound while allowing sibling collection exports to overlap. Cross-replica writes
    // remain serialized by the durable repository's version constraint.
    let ingestsInFlight = 0;
    app.post('/v1/role-snapshot', async (c) => {
      // Authenticate before framing validation so unauthenticated callers get one uniform response and
      // cannot probe the configured byte cap through status codes.
      const presentedToken = c.req.header('x-ingest-token') ?? '';
      let ingestAuthorized = false;
      // Compare every configured token so the match position does not become an observable rotation hint.
      for (const token of ingestTokens) {
        ingestAuthorized = timingSafeEqualStr(presentedToken, token) || ingestAuthorized;
      }
      if (!ingestAuthorized) {
        return new Response(null, { status: 401 });
      }
      // Reject malformed or honestly-declared oversized framing before secret-dependent work. The streamed
      // cap below remains authoritative because Content-Length is optional and caller-controlled.
      const declaredLength = c.req.header('content-length');
      if (declaredLength !== undefined) {
        if (!/^(0|[1-9]\d*)$/.test(declaredLength)) {
          return c.json({ error: 'invalid content-length' }, 400);
        }
        if (BigInt(declaredLength) > BigInt(MAX_SNAPSHOT_BYTES)) {
          return c.json({ error: 'snapshot too large' }, 413);
        }
      }
      if (ingestsInFlight >= MAX_CONCURRENT_INGESTS) {
        c.header('Retry-After', '1');
        return c.json({ error: { code: 'ingest-busy', retryable: true } }, 429);
      }
      ingestsInFlight += 1;
      try {
      // Byte-exact integrity: sha256 of the EXACT bytes received must equal the declared header — guards a
      // truncated/tampered body in transit. Validate BEFORE JSON.parse so a corrupt body is rejected as an
      // integrity failure, not a parse error.
      const boundedBody = await readBoundedText(c.req.raw, MAX_SNAPSHOT_BYTES);
      if (!boundedBody.ok) return c.json({ error: 'snapshot too large' }, 413);
      const raw = boundedBody.text;
      const declared = (c.req.header('x-snapshot-sha256') ?? '').toLowerCase();
      const actual = createHash('sha256').update(boundedBody.bytes).digest('hex');
      if (!declared || !timingSafeEqualStr(declared, actual)) {
        return c.json({ error: 'integrity check failed' }, 422);
      }
      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        return c.json({ error: 'invalid json' }, 400);
      }
      const parsed = RoleSnapshotSchema.safeParse(json);
      if (!parsed.success) return c.json({ error: 'invalid role snapshot' }, 422);
      if (
        Date.parse(parsed.data.captured_at) >
        deps.now() + ROLE_SNAPSHOT_MAX_FUTURE_SKEW_MS
      ) {
        return c.json({ error: 'captured_at exceeds allowed clock skew' }, 422);
      }

      // The community is caller-supplied and becomes a STORAGE KEY (one file per community+collection).
      // Without this gate, a token-holder could mint unbounded distinct communities and grow the store
      // without limit. Only communities this deploy actually operates may be ingested.
      if (!deps.isOperatedCommunity(parsed.data.community)) {
        return c.json({ error: 'community is not operated by this deploy' }, 403);
      }

      // S5-T1: the COLLECTION is the other half of the storage key, and is equally caller-supplied. Gate it
      // on the same registry the audit reads from, for two reasons: (1) it bounds the key space exactly as
      // the community gate does; (2) a typo'd contract would otherwise file the snapshot under a key NO
      // audit ever reads — every audit for the real collection would then refuse "no snapshot" with no clue
      // why. Reject at ingest, loudly, instead. No registry ⇒ this deploy cannot know which collections it
      // audits ⇒ it must not accept snapshots for them (same fail-closed posture as /v1/access-risk).
      if (!deps.collectionRegistry) return c.json({ error: 'registry unavailable' }, 503);
      const { chain, contract } = parsed.data.collection;
      if (!deps.collectionRegistry({ chain, contract })) {
        return c.json({ error: 'collection is not in the audited collection registry', chain, contract }, 422);
      }

      let stored: boolean;
      try {
        stored = await ingest.sink.store(parsed.data);
      } catch (error) {
        if (error instanceof UndeclaredCollectionSourceError) {
          return c.json(
            { error: { code: 'collection-source-undeclared', retryable: false } },
            422,
          );
        }
        if (error instanceof RoleSnapshotConflictError) {
          console.error(
            JSON.stringify({
              event: 'role_snapshot_version_conflict',
              community: parsed.data.community,
              collection: parsed.data.collection,
              captured_at: parsed.data.captured_at,
              error_type: error.name,
            }),
          );
          return c.json(
            { error: { code: 'snapshot-version-conflict', retryable: false } },
            409,
          );
        }
        console.error(
          JSON.stringify({
            event: 'role_snapshot_store_failed',
            community: parsed.data.community,
            collection: parsed.data.collection,
            captured_at: parsed.data.captured_at,
            error_type: error instanceof Error ? error.name : 'UnknownError',
          }),
        );
        return c.json({ error: { code: 'snapshot-store-failed', retryable: true } }, 503);
      }
      // Minimal receipt — the exporter reconciles on (community, collection, captured_at, entries), no member
      // data echoed. `stored:false` means an equal-or-newer snapshot is already held FOR THIS COLLECTION
      // (replay / out-of-order delivery); it is a successful no-op, NOT an error — the exporter is
      // at-least-once and must be able to retry.
      return c.json({
        ok: true,
        stored,
        community: parsed.data.community,
        collection: parsed.data.collection,
        captured_at: parsed.data.captured_at,
        entries: parsed.data.entries.length,
      });
      } finally {
        ingestsInFlight -= 1;
      }
    });
  }

  return app;
}

/**
 * A refusal page — which, for a COVERAGE refusal, still shows the drift.
 *
 * The wallet-derived cohorts are refused (at 1 resolvable wallet in 515 they would be computed over a
 * matched set the unmatched set dwarfs). But the drift board is COUNTS-ONLY — role members vs on-chain
 * holders, zero identity data — and it is exactly what S5 built so a community with no wallet map could
 * still see its drift. Showing only the refusal would deny the report to the community it exists for.
 *
 * So the page is honest on both counts: here is what we cannot see, and here is your drift anyway.
 */
function renderRefusalHtml(refusal: Refusal, drift?: DriftReport): string {
  return `<!doctype html><html><body>
  <h1>We can't run the full audit</h1>
  <p>${escapeHtml(refusal.reason)}</p>
  ${drift ? `<hr><h2>But here is your drift — measured, with no identity data at all</h2>${renderDriftHtml(drift)}` : ''}
  </body></html>`;
}

/**
 * The DRIFT BOARD (S5-T4). The assumption-free SIDE-BY-SIDE leads — role members next to per-chain holder
 * counts, two measured facts with no derivation. The floors follow as clearly-labelled DERIVED claims, each
 * printing its assumption and the direction it errs when that assumption breaks. A floor is a bound over
 * WALLETS; rendering it as a count of PEOPLE is the confidently-wrong shape this whole service exists to
 * prevent, so the wording says "wallets" every time it says a number.
 */
function renderDriftHtml(d: DriftReport): string {
  const board = d.per_source_holders
    .map((s) => `${escapeHtml(cohortText(s.holders))} on ${escapeHtml(s.chain)}`)
    .join(' &middot; ');
  const floor = (
    label: string,
    f: { value: number; assumption: string; breaks_when: string; direction_if_violated: string },
  ): string =>
    `<li>${escapeHtml(label)}: <strong>&ge;${f.value} wallets</strong>
       <br><small>Holds only if ${escapeHtml(f.assumption)}. If not — ${escapeHtml(f.breaks_when)} — this
       number <strong>${escapeHtml(f.direction_if_violated)}</strong>. It bounds WALLETS, not people: one
       person with ten wallets is ten holders.</small></li>`;
  const boundNote = d.floors_from_public_bound
    ? '<p><small>One or more chains hold fewer than ' +
      `${d.k_anonymity} qualifying wallets; its count is withheld, so the floors below are derived from the ` +
      'widest total consistent with what is shown (they understate rather than reveal it).</small></p>'
    : '';
  // The floors are SUPPRESSED (null) when the role set is sub-k — both are functions of the role count, so
  // either one would hand back the very cohort the bucket hides. The side-by-side above survives; say plainly
  // why the derived half is missing rather than rendering a silent blank.
  const derived =
    d.stale_floor && d.undergrant_floor
      ? `<h3>What that bounds</h3>
  <ul>
    ${floor('Members whose access may be stale (at least)', d.stale_floor)}
    ${floor('Qualifying wallets with no role (at least)', d.undergrant_floor)}
  </ul>
  ${boundNote}
  <p><small>${escapeHtml(d.disclosure)}</small></p>`
      : `<p><small>Your role has fewer than ${d.k_anonymity} members, so we withhold the derived floors:
     each one is computed from the member count, and publishing either would hand that count straight back.
     The two measured numbers above are unaffected.</small></p>`;
  return `
  <h2>Your role, next to the chain</h2>
  <p><strong>${escapeHtml(cohortText(d.role_members))} members</strong> hold the role &mdash; the collection is
     held by <strong>${board}</strong>.</p>
  <p><small>Both numbers are measured. No identity data, no assumptions. The gap between them is the drift.</small></p>
  ${derived}`;
}

function renderAuditHtml(
  output: { run_id: string; aggregate: AuditAggregateLike; cta: Cta },
  uncertain: boolean,
  uncertainReasons: readonly string[] = [],
  drift?: DriftReport,
): string {
  const a = output.aggregate;
  const turnoverDisplay =
    a.holder_turnover === null ? 'Unknown (cohort suppressed)' : `${(a.holder_turnover * 100).toFixed(0)}%`;
  // Name the uncertainty rather than lumping it under one banner: a fresh-but-unseeable snapshot is
  // NOT "stale", and telling the reader it is would be its own small lie (486383).
  const stale = uncertainReasons.includes('stale-snapshot');
  const staleBanner = stale
    ? '<p><em>Heads up: the role snapshot is stale — treat these numbers as directional.</em></p>'
    : '';
  const coverageBanner = a.coverage_uncertain
    ? `<p><em>Heads up: we could only resolve ${
        a.role_coverage === null ? 'some' : `${(a.role_coverage * 100).toFixed(0)}% of`
      } your role-holders to a wallet — the ${escapeHtml(
        cohortText(a.unmatched_role_holders),
      )} we could not see are counted as role-holders, but their on-chain holdings are invisible to this audit. Treat these numbers as directional.</em></p>`
    : '';
  // Legacy fallback: uncertain for a reason we were not told about (defensive; keeps the old banner).
  const genericBanner = uncertain && !stale && !a.coverage_uncertain
    ? '<p><em>Heads up: treat these numbers as directional.</em></p>'
    : '';
  // The drift board LEADS: it is the one part of this page that needs no wallet map, so it is the only part
  // that is true for a community at 0% identity coverage — and it is the DoD's "sees its real drift".
  return `<!doctype html><html><head><meta charset="utf-8"><title>Shadow Access Audit</title></head><body>
  <h1>Shadow Access Audit</h1>
  ${staleBanner}${coverageBanner}${genericBanner}
  ${drift ? renderDriftHtml(drift) : ''}
  <h2>Members we could match to a wallet</h2>
  <ul>
    <li>Stale access (role, no longer qualifies): <strong>${escapeHtml(cohortText(a.stale_access))}</strong></li>
    <li>Sold / lapsed: <strong>${escapeHtml(cohortText(a.sold_lapsed))}</strong></li>
    <li>Newly eligible: <strong>${escapeHtml(cohortText(a.newly_eligible))}</strong></li>
    <li>Holder turnover: <strong>${turnoverDisplay}</strong></li>
    <li>Stale-access risk: <strong>${escapeHtml(a.stale_access_risk_band)}</strong></li>
    <li>Role-holders we could not resolve: <strong>${escapeHtml(cohortText(a.unmatched_role_holders))}</strong></li>
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
  holder_turnover: number | null;
  stale_access: CohortCount;
  sold_lapsed: CohortCount;
  newly_eligible: CohortCount;
  stale_access_risk_band: string;
  /** Role-holders we could not resolve to a wallet — flagged, never dropped (486383). */
  unmatched_role_holders: CohortCount;
  /** matched/total, or NULL when the unmatched cohort is k-anon-suppressed. */
  role_coverage: number | null;
  coverage_uncertain: boolean;
}
