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
  AccessStartedAtDateSchema,
  OrderSchema,
  PUBLIC_JOURNEY_HTTP_STATUS,
  PublicGateLeakChainIdSchema,
  PublicGateLeakContractAddressSchema,
  REFUSAL_HTTP_STATUS,
  projectPublicJourney,
  type CohortCount,
  type Cta,
  type DriftReport,
  type Order,
  type PublicJourneyProjection,
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
import type { SourceResolver } from '../collection-union.js';
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
import { createHash, randomUUID } from 'node:crypto';
import { RoleSnapshotSchema } from '../role-snapshot.js';
import { timingSafeEqualStr, type RoleSink } from '../role-store.js';
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
  ingest?: { token: string; sink: RoleSink };
  /** S2-T3 (IMP-006): dedicated, TIGHTER limiter for the PUBLIC teaser. That route is unauthenticated and
   *  does real chain work (RPC + reconstruction), so it must not share the authed routes' budget. Falls
   *  back to `rateLimiter` when absent.
   *
   *  BEST-EFFORT ONLY — do NOT rely on this as the abuse bound. It is keyed on the client identifier
   *  derived from X-Forwarded-For, which is CALLER-SUPPLIED. A live probe (2026-07-12) sent 9 requests with
   *  rotating XFF against the 6/min teaser and NONE were limited. Treat per-IP as a speed bump; the real
   *  bound is `teaserBudget` + the cache below. */
  teaserRateLimiter?: RateLimiter;
  /**
   * S2-T3 HARD BOUND (FAGAN 2026-07-12): a GLOBAL budget on the expensive path, keyed on a CONSTANT — not
   * on the client. Because the caller identity on a public endpoint is unforgeable-by-nobody, the only
   * bound that actually holds is one that does not depend on identity at all. This caps total chain
   * reconstructions per window no matter who calls, how many IPs they rotate, or what headers they forge.
   */
  teaserBudget?: RateLimiter;
  /** Required deployment-wide durable-write budget, consumed atomically by EventStore registration. */
  publicJourneyBudget: { limit: number; windowMs: number };
  /** S2-T3: TTL for memoizing the (deterministic) teaser result, so repeat queries cost ZERO chain work. */
  teaserCacheTtlMs?: number;
  /** Distributed compute-claim lease. A crashed worker becomes retryable after this interval. */
  publicComputeLeaseMs?: number;
}

const DEFAULT_RUN_WINDOW_MS = 86_400_000; // 24h

/** Hard cap on an ingested role snapshot (S1-T4). ~10 MB comfortably holds a very large guild export;
 *  beyond that a caller is abusing the endpoint, not exporting a Discord guild. */
const MAX_SNAPSHOT_BYTES = 10 * 1024 * 1024;

type RefusalStatus = 404 | 422 | 429 | 503;

class PublicJourneyBudgetExceededError extends Error {}

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
  if (!Number.isInteger(deps.publicJourneyBudget.limit) || deps.publicJourneyBudget.limit < 1) {
    throw new Error('publicJourneyBudget.limit must be a positive integer');
  }
  if (!Number.isInteger(deps.publicJourneyBudget.windowMs) || deps.publicJourneyBudget.windowMs < 1) {
    throw new Error('publicJourneyBudget.windowMs must be a positive integer');
  }

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
    chain: z.string().min(1),
    contract: z.string().min(1),
    snapshot_date: z.string().min(1),
    threshold: z.string().optional(),
  });

  // Memoize the teaser. The result is DETERMINISTIC for (chain, contract, snapshot_date, threshold) within
  // a TTL, so a repeat query must cost ZERO chain work. This — not the per-IP limiter — is what makes a
  // flood cheap. Bounded so the map cannot grow without limit.
  const teaserTtlMs = deps.teaserCacheTtlMs ?? 300_000; // 5 min
  const TEASER_CACHE_MAX = 500;
  const teaserCache = new Map<string, { at: number; body: unknown }>();
  const teaserInFlight = new Map<string, Promise<PublicCompute>>();

  const GateLeakBodySchema = z
    .object({
      chain: PublicGateLeakChainIdSchema,
      contract: PublicGateLeakContractAddressSchema,
      access_started_at: AccessStartedAtDateSchema.optional(),
      threshold: z.number().int().positive().optional(),
      /** Server-issued retry capability. A supplied token must already exist. */
      journey_token: z.string().min(1).max(128).optional(),
    })
    .strict();
  const ResumeGateLeakBodySchema = z
    .object({
      access_started_at: AccessStartedAtDateSchema,
    })
    .strict();

  const publicSubject = (chain: string, contract: string) => ({
    chain_id: chain,
    contract_address: contract.toLowerCase(),
  });
  const originalSubmissionHash = (chain: string, contract: string, threshold: number): string =>
    createHash('sha256')
      .update(
        JSON.stringify({
          chain_id: chain,
          contract_address: contract.toLowerCase(),
          threshold,
          source: 'public_gate_leak',
        }),
      )
      .digest('hex');
  // The run id is the anonymous mutation capability. It MUST be server-random; the
  // caller-controlled journey token is only an idempotency/correlation key.
  const publicRunId = (): string => `gate_${randomUUID().replaceAll('-', '')}`;
  const isFutureAccessDate = (value: string, now: number): boolean =>
    value > new Date(now).toISOString().slice(0, 10);

  const cacheSuccessfulTeaser = (key: string, now: number, output: AccessRiskOutput): void => {
    if (teaserCache.size >= TEASER_CACHE_MAX) {
      const oldest = teaserCache.keys().next().value;
      if (oldest !== undefined) teaserCache.delete(oldest);
    }
    teaserCache.set(key, { at: now, body: output });
  };
  const publicComputeCacheKey = (args: {
    chain: string;
    contract: string;
    accessStartedAt: string;
    threshold: number;
  }): string => `${args.chain}/${args.contract}/${args.accessStartedAt}/${args.threshold}`;
  const publicComputeKey = (args: {
    chain: string;
    contract: string;
    accessStartedAt: string;
    threshold: number;
  }): string => createHash('sha256').update(publicComputeCacheKey(args)).digest('hex');

  type PublicCompute =
    | { kind: 'result'; result: AccessRiskResult }
    | { kind: 'budget' }
    | { kind: 'in_progress' };
  const computePublic = async (args: {
    chain: string;
    contract: string;
    accessStartedAt: string;
    threshold: number;
    now: number;
  }): Promise<PublicCompute> => {
    const cacheKey = publicComputeCacheKey(args);
    const computeKey = publicComputeKey(args);
    const hit = teaserCache.get(cacheKey);
    if (hit && args.now - hit.at < teaserTtlMs) {
      return { kind: 'result', result: { ok: true, output: hit.body as AccessRiskOutput } };
    }
    const durable = await deps.eventStore.getPublicComputeResult(computeKey);
    if (durable !== undefined) {
      const output = durable as AccessRiskOutput;
      cacheSuccessfulTeaser(cacheKey, args.now, output);
      return { kind: 'result', result: { ok: true, output } };
    }
    const active = teaserInFlight.get(cacheKey);
    if (active) return active;
    const ownerToken = randomUUID();
    const claimedAt = new Date(args.now).toISOString();
    const claim = await deps.eventStore.claimPublicCompute({
      compute_key: computeKey,
      owner_token: ownerToken,
      claimed_at: claimedAt,
      lease_expires_at: new Date(args.now + (deps.publicComputeLeaseMs ?? 600_000)).toISOString(),
    });
    if (claim === 'complete') {
      const completed = await deps.eventStore.getPublicComputeResult(computeKey);
      if (completed !== undefined) {
        const output = completed as AccessRiskOutput;
        cacheSuccessfulTeaser(cacheKey, args.now, output);
        return { kind: 'result', result: { ok: true, output } };
      }
      return { kind: 'in_progress' };
    }
    if (claim === 'busy') return { kind: 'in_progress' };
    if (deps.teaserBudget && !deps.teaserBudget.check('global').allowed) {
      await deps.eventStore.releasePublicCompute(computeKey, ownerToken);
      return { kind: 'budget' };
    }
    const computation = (async (): Promise<PublicCompute> => {
      try {
        const result = await computeAccessRisk(
          {
            chain: args.chain,
            contract: args.contract,
            snapshotDate: args.accessStartedAt,
            threshold: args.threshold,
            nowUnixSeconds: Math.floor(args.now / 1000),
            cta: deps.cta,
          },
          { ownership: deps.ownership, whale: deps.whale, sources: deps.sources, k: deps.k },
        );
        if (result.ok) {
          // Re-read the clock after the expensive work. Passing the claim timestamp here
          // would let a computation that actually outlived its lease commit stale work.
          const completed = await deps.eventStore.completePublicCompute(
            computeKey,
            ownerToken,
            result.output,
            new Date(deps.now()).toISOString(),
          );
          if (!completed) {
            // Another replica may have renewed the lease while this one was working.
            // Never publish or locally cache the stale owner's result.
            const replacement = await deps.eventStore.getPublicComputeResult(computeKey);
            if (replacement !== undefined) {
              const output = replacement as AccessRiskOutput;
              cacheSuccessfulTeaser(cacheKey, deps.now(), output);
              return { kind: 'result', result: { ok: true, output } };
            }
            await deps.eventStore.releasePublicCompute(computeKey, ownerToken);
            return { kind: 'in_progress' };
          }
          cacheSuccessfulTeaser(cacheKey, deps.now(), result.output);
        } else {
          await deps.eventStore.releasePublicCompute(computeKey, ownerToken);
        }
        return { kind: 'result', result };
      } catch (error) {
        await deps.eventStore.releasePublicCompute(computeKey, ownerToken);
        throw error;
      }
    })();
    teaserInFlight.set(cacheKey, computation);
    try {
      return await computation;
    } finally {
      if (teaserInFlight.get(cacheKey) === computation) teaserInFlight.delete(cacheKey);
    }
  };

  const attention = async (
    subject: ReturnType<typeof publicSubject>,
    journeyToken: string,
    kind: 'submitted' | 'delivered_e1' | 'needs_input' | 'refused',
    now: number,
  ): Promise<void> => {
    await deps.eventStore.appendAttention({
      subject_chain_id: subject.chain_id,
      subject_contract_address: subject.contract_address,
      journey_token: journeyToken,
      kind,
      ts: new Date(now).toISOString(),
    });
  };

  const registerPublicJourney = async (args: {
    runId: string;
    journeyToken: string;
    chain: string;
    contract: string;
    threshold: number;
    inputsHash: string;
    outcome: 'submitted' | 'computing' | 'needs_input' | 'delivered_e1' | 'refused' | 'unavailable';
    refusalCode?: Refusal['code'];
    accessStartedAt?: string;
    staleSetSize?: number;
    now: number;
  }) => {
    const subject = publicSubject(args.chain, args.contract);
    const appended = await deps.eventStore.appendPublicGateLeakRun(
      {
        run_id: args.runId,
        journey_token: args.journeyToken,
        subject,
        inputs_hash: args.inputsHash,
        threshold: args.threshold,
        outcome: args.outcome,
        refusal_code: args.refusalCode,
        access_started_at: args.accessStartedAt,
        ts: new Date(args.now).toISOString(),
      },
      {
        bucket: 'public-gate-leak',
        window_started_at: new Date(
          Math.floor(args.now / deps.publicJourneyBudget.windowMs) * deps.publicJourneyBudget.windowMs,
        ).toISOString(),
        limit: deps.publicJourneyBudget.limit,
      },
    );
    if (appended.rate_limited) throw new PublicJourneyBudgetExceededError();
    let durable = await deps.eventStore.getPublicGateLeakJourneyByToken(args.journeyToken);
    if (!durable) throw new Error(`public journey disappeared after append: ${args.journeyToken}`);
    if (!appended.created && args.accessStartedAt) {
      await deps.eventStore.appendPublicJourneyInput({
        run_id: durable.run_id,
        input: 'access_started_at',
        value: args.accessStartedAt,
        ts: new Date(args.now).toISOString(),
      });
    }
    if (!appended.created && args.outcome !== 'submitted' && durable.current_outcome !== args.outcome) {
      try {
        await deps.eventStore.appendPublicJourneyTransition({
          run_id: durable.run_id,
          outcome: args.outcome,
          refusal_code: args.refusalCode,
          ts: new Date(args.now).toISOString(),
        });
      } catch (error) {
        // A concurrent terminal writer wins. Durable state, never the attempted state,
        // remains the response truth. Other conflicts (notably semantic input) surface.
        if (!(error instanceof Error && error.message.includes('terminal public journey'))) throw error;
      }
      durable = (await deps.eventStore.getPublicGateLeakJourney(durable.run_id)) ?? durable;
    }
    const runId = durable.run_id;
    // Self-healing binding: if a prior attempt persisted the public journey but died before
    // registering the feedback run, the retry fills the missing append-only event.
    if (
      durable.current_outcome !== 'submitted' &&
      durable.current_outcome !== 'computing' &&
      !(await deps.eventStore.getRun(runId))
    ) {
      await deps.eventStore.appendRunEvent({
        run_id: runId,
        mode: 'public-gate-leak',
        inputs_hash: args.inputsHash,
        stale_set_size: args.staleSetSize ?? 0,
        reruns: 0,
        ts: new Date(args.now).toISOString(),
      });
    }
    await attention(durable.subject, durable.journey_token, 'submitted', args.now);
    if (
      durable.current_outcome === 'needs_input' ||
      durable.current_outcome === 'delivered_e1' ||
      durable.current_outcome === 'refused'
    ) {
      await attention(durable.subject, durable.journey_token, durable.current_outcome, args.now);
    }
    return projectPublicJourney({
      run_id: durable.run_id,
      journey_token: durable.journey_token,
      subject: durable.subject,
      outcome: durable.current_outcome,
      refusal_code: durable.current_refusal_code,
    });
  };

  const publicJourneyStatus = (journey: PublicJourneyProjection): 200 | 202 | 404 | 422 | 428 | 429 | 503 =>
    journey.status.state === 'refused'
      ? (REFUSAL_HTTP_STATUS[journey.status.refusal_code] as 404 | 422 | 429 | 503)
      : (PUBLIC_JOURNEY_HTTP_STATUS[journey.status.state] as 200 | 202 | 428 | 503);

  const respondFromDurableJourney = async (
    c: Context,
    args: {
      journey: PublicJourneyProjection;
      attemptedRefusal?: Refusal;
      output?: AccessRiskOutput;
      compute?: { chain: string; contract: string; accessStartedAt: string; threshold: number };
    },
  ): Promise<Response> => {
    if (args.journey.status.state === 'delivered_e1') {
      let output = args.output;
      if (!output && args.compute) {
        output = (await deps.eventStore.getPublicComputeResult(publicComputeKey(args.compute))) as
          | AccessRiskOutput
          | undefined;
      }
      if (!output) {
        // A delivered transition without its immutable aggregate artifact is a
        // storage inconsistency. Never attach the losing attempted refusal or
        // fabricate a success body.
        return c.json({ journey: args.journey, error: 'delivered report is temporarily unavailable' }, 503);
      }
      return c.json({ journey: args.journey, report: { ...output, run_id: args.journey.run_id } }, 200);
    }
    if (
      args.journey.status.state === 'refused' &&
      args.attemptedRefusal?.code === args.journey.status.refusal_code
    ) {
      return c.json(
        { journey: args.journey, error: args.attemptedRefusal },
        publicJourneyStatus(args.journey),
      );
    }
    return c.json({ journey: args.journey }, publicJourneyStatus(args.journey));
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
    if (!q.success) return c.json({ error: 'missing/invalid query params' }, 400);

    // Anti-abuse #2 — ANTI-ENUMERATION: only collections in the registry are auditable, so an open caller
    // cannot walk the chain/contract space using this endpoint as a probe oracle.
    if (!deps.collectionRegistry) return c.json({ error: 'registry unavailable' }, 503);
    if (!deps.collectionRegistry({ chain: q.data.chain, contract: q.data.contract })) {
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
    const cacheKey = `${q.data.chain}/${q.data.contract}/${q.data.snapshot_date}/${threshold}`;
    const now = deps.now();
    const hit = teaserCache.get(cacheKey);
    if (hit && now - hit.at < teaserTtlMs) {
      return c.json(hit.body as Record<string, unknown>);
    }

    // Anti-abuse #5 — the HARD BOUND: a GLOBAL budget on cache MISSES (the only expensive path), keyed on a
    // constant, NOT on the caller. This is the bound that actually holds, because it does not depend on
    // identifying a client we fundamentally cannot identify on a public endpoint.
    if (deps.teaserBudget && !deps.teaserBudget.check('global').allowed) {
      return c.json({ error: rateLimitRefusal }, refusalStatus(rateLimitRefusal));
    }

    // Anti-abuse #3 (k-anon + meaningful-or-refuse) lives in computeAccessRisk: a sub-k denominator is
    // REFUSED (cohort-too-small) rather than served as a vacuous "no risk" or a back-computable ratio.
    const result = await computeAccessRisk(
      {
        chain: q.data.chain,
        contract: q.data.contract,
        snapshotDate: q.data.snapshot_date,
        threshold,
        nowUnixSeconds: Math.floor(now / 1000),
        cta: deps.cta,
      },
      { ownership: deps.ownership, whale: deps.whale, sources: deps.sources, k: deps.k },
    );
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

    // G-2: register the PUBLIC teaser run so its run_id resolves via getRun and reaction/contact can BIND to
    // it (previously the teaser returned a run_id backed by NO event, so every follow-up 404'd). Aggregate
    // only: stale_set_size mirrors recordRun — the exact cohort, or 0 when k-anon-suppressed (never a
    // back-computable sub-k count). Runs on the cache-MISS path only (a cache hit returned above), so a
    // flood does not multiply registrations. Fail-closed by design: if the durable store is unavailable the
    // teaser errors rather than promise a feedback binding it cannot honor.
    const staleUpper = result.output.stale_access_upper_bound;
    await deps.eventStore.appendRunEvent({
      run_id: result.output.run_id,
      mode: 'public-gate-leak',
      inputs_hash: result.output.inputs_hash,
      stale_set_size: staleUpper.kind === 'exact' ? staleUpper.value : 0,
      reruns: 0,
      ts: new Date(now).toISOString(),
    });

    if (teaserCache.size >= TEASER_CACHE_MAX) {
      // Evict the oldest insertion (Map preserves insertion order) — bounded memory, no LRU needed.
      const oldest = teaserCache.keys().next().value;
      if (oldest !== undefined) teaserCache.delete(oldest);
    }
    teaserCache.set(cacheKey, { at: now, body: result.output });
    return c.json(result.output);
  });

  // ---- POST /v1/access-risk — address-first, typed + resumable ------------
  app.post('/v1/access-risk', async (c) => {
    const limiter = deps.teaserRateLimiter ?? deps.rateLimiter;
    if (!limiter.check(deps.clientKey(c.req.header('x-forwarded-for'))).allowed) {
      return c.json({ error: rateLimitRefusal }, refusalStatus(rateLimitRefusal));
    }
    const parsed = GateLeakBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid gate-leak input', issues: parsed.error.issues }, 400);

    const threshold = parsed.data.threshold ?? 1;
    const inputsHash = originalSubmissionHash(parsed.data.chain, parsed.data.contract, threshold);
    const now = deps.now();
    if (parsed.data.access_started_at && isFutureAccessDate(parsed.data.access_started_at, now)) {
      return c.json({ error: 'access_started_at cannot be in the future' }, 400);
    }
    const existing = parsed.data.journey_token
      ? await deps.eventStore.getPublicGateLeakJourneyByToken(parsed.data.journey_token)
      : undefined;
    if (parsed.data.journey_token && !existing) {
      // Tokens are capabilities issued by this server, not caller-chosen aliases.
      // Rejecting unknown tokens prevents low-entropy preclaims from becoming a
      // lookup path to the server-random run/resume capability.
      return c.json({ error: 'journey_token is unknown' }, 404);
    }
    const journeyToken = existing?.journey_token ?? randomUUID();
    if (
      existing &&
      (existing.inputs_hash !== inputsHash ||
        existing.subject.chain_id !== parsed.data.chain ||
        existing.subject.contract_address !== parsed.data.contract.toLowerCase() ||
        existing.threshold !== threshold ||
        (parsed.data.access_started_at !== undefined &&
          existing.supplied_access_started_at !== undefined &&
          parsed.data.access_started_at !== existing.supplied_access_started_at))
    ) {
      return c.json({ error: 'journey_token conflicts with its original submission' }, 409);
    }
    const runId = existing?.run_id ?? publicRunId();
    try {
      await registerPublicJourney({
        runId,
        journeyToken,
        chain: parsed.data.chain,
        contract: parsed.data.contract,
        threshold,
        inputsHash,
        outcome: 'submitted',
        now,
      });
    } catch (error) {
      if (error instanceof PublicJourneyBudgetExceededError) {
        return c.json({ error: rateLimitRefusal }, refusalStatus(rateLimitRefusal));
      }
      throw error;
    }

    if (!deps.collectionRegistry) {
      const journey = await registerPublicJourney({
        runId,
        journeyToken,
        chain: parsed.data.chain,
        contract: parsed.data.contract,
        threshold,
        inputsHash,
        outcome: 'unavailable',
        now,
      });
      return respondFromDurableJourney(c, {
        journey,
        compute: existing?.supplied_access_started_at
          ? {
              chain: parsed.data.chain,
              contract: parsed.data.contract,
              accessStartedAt: existing.supplied_access_started_at,
              threshold,
            }
          : undefined,
      });
    }

    const ref = deps.collectionRegistry({ chain: parsed.data.chain, contract: parsed.data.contract });
    if (!ref) {
      const refusal: Refusal = {
        code: 'unindexed-contract',
        reason: 'contract is not in the audited collection registry',
        retryable: false,
      };
      const journey = await registerPublicJourney({
        runId,
        journeyToken,
        chain: parsed.data.chain,
        contract: parsed.data.contract,
        threshold,
        inputsHash,
        outcome: 'refused',
        refusalCode: refusal.code,
        now,
      });
      return respondFromDurableJourney(c, {
        journey,
        attemptedRefusal: refusal,
        compute: existing?.supplied_access_started_at
          ? {
              chain: parsed.data.chain,
              contract: parsed.data.contract,
              accessStartedAt: existing.supplied_access_started_at,
              threshold,
            }
          : undefined,
      });
    }

    const accessStartedAt = parsed.data.access_started_at ?? ref.access_started_at;
    if (!accessStartedAt) {
      const journey = await registerPublicJourney({
        runId,
        journeyToken,
        chain: parsed.data.chain,
        contract: parsed.data.contract,
        threshold,
        inputsHash,
        outcome: 'needs_input',
        now,
      });
      return respondFromDurableJourney(c, {
        journey,
        compute: existing?.supplied_access_started_at
          ? {
              chain: parsed.data.chain,
              contract: parsed.data.contract,
              accessStartedAt: existing.supplied_access_started_at,
              threshold,
            }
          : undefined,
      });
    }
    if (!AccessStartedAtDateSchema.safeParse(accessStartedAt).success || isFutureAccessDate(accessStartedAt, now)) {
      const journey = await registerPublicJourney({
        runId,
        journeyToken,
        chain: parsed.data.chain,
        contract: parsed.data.contract,
        threshold,
        inputsHash,
        outcome: 'unavailable',
        now,
      });
      if (journey.status.state === 'unavailable') {
        return c.json({ journey, error: 'registry access_started_at is invalid or in the future' }, 503);
      }
      return respondFromDurableJourney(c, { journey });
    }

    const computingJourney = await registerPublicJourney({
      runId,
      journeyToken,
      chain: parsed.data.chain,
      contract: parsed.data.contract,
      threshold,
      inputsHash,
      outcome: 'computing',
      accessStartedAt,
      now,
    });
    if (computingJourney.status.state === 'delivered_e1' || computingJourney.status.state === 'refused') {
      // A concurrent terminal state wins. A delivered retry continues to the durable
      // compute cache below so the report can be returned; a refusal is already complete.
      if (computingJourney.status.state === 'refused') {
        return c.json({ journey: computingJourney }, publicJourneyStatus(computingJourney));
      }
    }

    const computed = await computePublic({
      chain: parsed.data.chain,
      contract: parsed.data.contract,
      accessStartedAt,
      threshold,
      now,
    });
    if (computed.kind === 'budget') {
      const journey = await registerPublicJourney({
        runId,
        journeyToken,
        chain: parsed.data.chain,
        contract: parsed.data.contract,
        threshold,
        inputsHash,
        outcome: 'refused',
        refusalCode: rateLimitRefusal.code,
        accessStartedAt,
        now,
      });
      return respondFromDurableJourney(c, {
        journey,
        attemptedRefusal: rateLimitRefusal,
        compute: { chain: parsed.data.chain, contract: parsed.data.contract, accessStartedAt, threshold },
      });
    }
    if (computed.kind === 'in_progress') {
      const journey = await registerPublicJourney({
        runId,
        journeyToken,
        chain: parsed.data.chain,
        contract: parsed.data.contract,
        threshold,
        inputsHash,
        outcome: 'computing',
        accessStartedAt,
        now,
      });
      return respondFromDurableJourney(c, {
        journey,
        compute: { chain: parsed.data.chain, contract: parsed.data.contract, accessStartedAt, threshold },
      });
    }
    if (!computed.result.ok) {
      const journey = await registerPublicJourney({
        runId,
        journeyToken,
        chain: parsed.data.chain,
        contract: parsed.data.contract,
        threshold,
        inputsHash,
        outcome: 'refused',
        refusalCode: computed.result.refusal.code,
        accessStartedAt,
        now,
      });
      return respondFromDurableJourney(c, {
        journey,
        attemptedRefusal: computed.result.refusal,
        compute: { chain: parsed.data.chain, contract: parsed.data.contract, accessStartedAt, threshold },
      });
    }

    const staleUpper = computed.result.output.stale_access_upper_bound;
    const journey = await registerPublicJourney({
      runId,
      journeyToken,
      chain: parsed.data.chain,
      contract: parsed.data.contract,
      threshold,
      inputsHash,
      outcome: 'delivered_e1',
      accessStartedAt,
      staleSetSize: staleUpper.kind === 'exact' ? staleUpper.value : 0,
      now,
    });
    return respondFromDurableJourney(c, {
      journey,
      output: computed.result.output,
      compute: { chain: parsed.data.chain, contract: parsed.data.contract, accessStartedAt, threshold },
    });
  });

  // Appends the missing semantic input; never rewrites the original submission/digest.
  app.post('/v1/access-risk/:runId/resume', async (c) => {
    const limiter = deps.teaserRateLimiter ?? deps.rateLimiter;
    if (!limiter.check(deps.clientKey(c.req.header('x-forwarded-for'))).allowed) {
      return c.json({ error: rateLimitRefusal }, refusalStatus(rateLimitRefusal));
    }
    const parsed = ResumeGateLeakBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid resume input', issues: parsed.error.issues }, 400);
    const now = deps.now();
    if (isFutureAccessDate(parsed.data.access_started_at, now)) {
      return c.json({ error: 'access_started_at cannot be in the future' }, 400);
    }

    const run = await deps.eventStore.getPublicGateLeakJourney(c.req.param('runId'));
    if (!run) return c.json({ error: 'journey not found' }, 404);
    if (run.current_outcome !== 'needs_input' && run.current_outcome !== 'computing') {
      const journey = projectPublicJourney({
        run_id: run.run_id,
        journey_token: run.journey_token,
        subject: run.subject,
        outcome: run.current_outcome,
        refusal_code: run.current_refusal_code,
      });
      return c.json({ journey }, publicJourneyStatus(journey));
    }

    try {
      await deps.eventStore.appendPublicJourneyInput({
        run_id: run.run_id,
        input: 'access_started_at',
        value: parsed.data.access_started_at,
        ts: new Date(now).toISOString(),
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('conflicting journey input')) {
        return c.json({ error: 'access_started_at conflicts with the previously supplied value' }, 409);
      }
      throw error;
    }

    const computed = await computePublic({
      chain: run.subject.chain_id,
      contract: run.subject.contract_address,
      accessStartedAt: parsed.data.access_started_at,
      threshold: run.threshold,
      now,
    });
    const refusal =
      computed.kind === 'budget'
        ? rateLimitRefusal
        : computed.kind === 'result' && !computed.result.ok
          ? computed.result.refusal
          : undefined;
    const output = computed.kind === 'result' && computed.result.ok ? computed.result.output : undefined;
    const staleUpper = output?.stale_access_upper_bound;
    const outcome = computed.kind === 'in_progress' ? 'computing' : refusal ? 'refused' : 'delivered_e1';
    const journey = await registerPublicJourney({
      runId: run.run_id,
      journeyToken: run.journey_token,
      chain: run.subject.chain_id,
      contract: run.subject.contract_address,
      threshold: run.threshold,
      inputsHash: run.inputs_hash,
      outcome,
      refusalCode: refusal?.code,
      accessStartedAt: parsed.data.access_started_at,
      staleSetSize: staleUpper?.kind === 'exact' ? staleUpper.value : 0,
      now,
    });
    return respondFromDurableJourney(c, {
      journey,
      attemptedRefusal: refusal,
      output,
      compute: {
        chain: run.subject.chain_id,
        contract: run.subject.contract_address,
        accessStartedAt: parsed.data.access_started_at,
        threshold: run.threshold,
      },
    });
  });

  // Minimal internal/public poll. The dashboard BFF remains a later medium-specific projection.
  app.get('/v1/access-risk/:runId', async (c) => {
    try {
      const run = await deps.eventStore.getPublicGateLeakJourney(c.req.param('runId'));
      if (!run) return c.json({ error: 'journey not found' }, 404);
      const journey = projectPublicJourney({
        run_id: run.run_id,
        journey_token: run.journey_token,
        subject: run.subject,
        outcome: run.current_outcome,
        refusal_code: run.current_refusal_code,
      });
      return c.json({ journey }, 200);
    } catch {
      return c.json({ run_id: c.req.param('runId'), status: { state: 'unavailable' } }, 503);
    }
  });

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
    app.post('/v1/role-snapshot', async (c) => {
      // Service-token, constant-time. Missing/wrong X-Ingest-Token → 401, no body detail.
      if (!timingSafeEqualStr(c.req.header('x-ingest-token') ?? '', ingest.token)) {
        return new Response(null, { status: 401 });
      }
      // Bound the body BEFORE reading it. A valid token is not a licence to stream multi-GB into sha256 +
      // JSON.parse; a leaked/compromised token would otherwise be a trivial memory-exhaustion vector.
      const declaredLen = Number(c.req.header('content-length') ?? '0');
      if (Number.isFinite(declaredLen) && declaredLen > MAX_SNAPSHOT_BYTES) {
        return c.json({ error: 'snapshot too large' }, 413);
      }
      // Byte-exact integrity: sha256 of the EXACT bytes received must equal the declared header — guards a
      // truncated/tampered body in transit. Validate BEFORE JSON.parse so a corrupt body is rejected as an
      // integrity failure, not a parse error.
      const raw = await c.req.text();
      if (Buffer.byteLength(raw, 'utf8') > MAX_SNAPSHOT_BYTES) {
        return c.json({ error: 'snapshot too large' }, 413); // Content-Length absent or lied
      }
      const declared = (c.req.header('x-snapshot-sha256') ?? '').toLowerCase();
      const actual = createHash('sha256').update(raw, 'utf8').digest('hex');
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

      const stored = await ingest.sink.store(parsed.data);
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
  const turnoverPct = (a.holder_turnover * 100).toFixed(0);
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
    <li>Holder turnover: <strong>${turnoverPct}%</strong></li>
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
  holder_turnover: number;
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
