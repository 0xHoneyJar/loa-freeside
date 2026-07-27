/**
 * Webhook Routes — NOWPayments IPN Handler
 *
 * POST /webhooks/nowpayments — HMAC-SHA512 verified webhook
 *
 * Security:
 *   - HMAC-SHA512 signature verification via x-nowpayments-sig header
 *   - Signature is verified against the EXACT raw request bytes first; if that
 *     does not match, against the NOWPayments documented signing rule
 *     (JSON.stringify of the sorted-key payload parsed from those same raw
 *     bytes). The middleware-parsed `req.body` object is NEVER re-serialized
 *     for signature input (issue #325).
 *   - Fail closed: if no raw body is available the route returns 500
 *     (server misconfiguration) instead of guessing (issue #325).
 *   - 401 on invalid/missing signature (NOT 200 — per acceptance criteria)
 *   - Duplicated/array x-nowpayments-sig headers are rejected (CodeQL
 *     type-confusion finding from PR #365 review)
 *   - Webhook freshness window enforced: events older than
 *     `webhookMaxAgeMs` (default 15 min) are quarantined, not processed
 *     (issue #327)
 *   - Feature flag: FEATURE_BILLING_ENABLED must be true
 *   - Webhook rate limiting: 100 req/min per IP, 1KB max payload
 *
 * Idempotency (issue #324):
 *   - Dedupe key is (provider, payment_id:payment_status) — an earlier
 *     non-final status (waiting/confirming/…) can no longer consume the only
 *     dedupe slot and block a later `finished` webhook from minting credits.
 *   - Unknown-payment webhooks are NOT recorded in webhook_events; they get a
 *     retriable 404 so the provider redelivers after the crypto_payments row
 *     exists (they are never terminally deduped).
 *   - INSERT INTO credit_lots ON CONFLICT (payment_id) DO NOTHING
 *   - Redis INCRBY only if credit_lots INSERT returned id
 *
 * Durability (issue #326):
 *   - webhook_events INSERT failure returns a retriable 503 so the provider
 *     re-delivers (never a silent 200).
 *
 * @see nowpayments-handler.ts for credit lot minting
 * @see docs/runbook/nowpayments-webhook-reliability.md for the response-code
 *      contract and reconciliation behavior
 * @see Sprint 2, Task 2.1 (F-16, F-17, F-18)
 * @module packages/routes/webhooks.routes
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { Router, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import { processPaymentForLedger, verifyPaymentExists } from '../services/nowpayments-handler.js';
import { withCommunityScope } from '../services/community-scope.js';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** Minimal logger interface (avoids hard dependency on project logger) */
interface Logger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

/** NOWPayments IPN webhook payload */
interface NowpaymentsWebhookPayload {
  payment_id: number | string;
  payment_status: string;
  pay_address: string;
  pay_amount: number;
  pay_currency: string;
  price_amount: number;
  price_currency: string;
  order_id: string;
  order_description?: string;
  actually_paid: number;
  created_at?: string;
  updated_at?: string;
}

/** Status ordinal for monotonicity enforcement */
// Ranks MUST match the deployed crypto_payments_status_monotonicity trigger
// (migration 0010 rank_map). A mismatch lets the in-app guard permit a
// transition the DB trigger then rejects with P0005 (e.g. partially_paid →
// confirmed): the UPDATE throws instead of cleanly skipping, and the payment
// is left stale. partially_paid is rank 4 there, NOT confirming's level.
const STATUS_ORDINAL: Record<string, number> = {
  waiting: 0,
  confirming: 1,
  confirmed: 2,
  sending: 3,
  partially_paid: 4,
  finished: 5,
  expired: 6,
  failed: 7,
  refunded: 8,
};

/** Default webhook freshness window: 15 minutes (issue #327) */
export const DEFAULT_WEBHOOK_MAX_AGE_MS = 15 * 60 * 1000;

/** Dependencies injected at server init */
interface WebhookDeps {
  /**
   * Tenant connection. Every read and write that has a known community runs
   * through `withCommunityScope` on this pool, so it is safe (and correct) for
   * this to be the ordinary `arrakis_app` role.
   */
  pool: Pool;
  /**
   * Connection for the two operations that CANNOT carry a tenant scope, and
   * therefore need cross-tenant authority. Its role MUST hold **BYPASSRLS**
   * (or be a superuser) — table ownership is NOT sufficient, because
   * `crypto_payments` declares FORCE ROW LEVEL SECURITY, which subjects the
   * owner to the tenant policies too. `arrakis_admin` in the deployed schema.
   *
   *   1. The `crypto_payments` lookup that resolves the payment's community.
   *      An IPN arrives with no tenant context; this read is what establishes
   *      it, so it cannot itself be scoped. `crypto_payments` carries forced
   *      RLS with tenant policies (migration 0010), so under the app role this
   *      lookup returns no rows and every webhook 404s.
   *   2. `webhook_events` dedupe INSERTs. That table is system-level by
   *      design — forced RLS with NO policy and only `arrakis_admin` granted
   *      write (migration 0010: "webhooks are processed before tenant context
   *      is established"). Under the app role the INSERT is default-denied,
   *      which this route reports as a retriable 503 forever.
   *
   * Nothing else uses it. Defaults to `pool`, which is correct only where that
   * pool already holds such authority; a deployment running the route under
   * the ordinary tenant role MUST inject a privileged connection here.
   */
  systemPool?: Pool;
  redis: Redis;
  ipnSecret: string;
  logger: Logger;
  featureBillingEnabled: boolean;
  /**
   * Max accepted age of the provider `updated_at` timestamp before the event
   * is quarantined instead of processed (issue #327). Set 0 to disable the
   * freshness gate. Default: DEFAULT_WEBHOOK_MAX_AGE_MS (15 minutes).
   */
  webhookMaxAgeMs?: number;
}

// --------------------------------------------------------------------------
// Raw body capture middleware helper (issue #325)
// --------------------------------------------------------------------------

/**
 * `verify` hook for express.json()/express.urlencoded() that captures the
 * exact raw request bytes on `req.rawBody` BEFORE any parsing:
 *
 *   app.use(express.json({ verify: captureRawBody }));
 *
 * The webhook route fails closed (500) when neither `req.rawBody` nor a
 * string/Buffer `req.body` (express.raw / express.text) is present.
 */
export function captureRawBody(
  req: Request,
  _res: Response,
  buf: Buffer,
): void {
  (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
}

/**
 * Resolve the exact raw request bytes. Only trusted sources are accepted:
 *   1. `req.rawBody` set by the captureRawBody verify hook
 *   2. `req.body` when it is still a string or Buffer (express.raw/text)
 * A middleware-parsed object body is NOT acceptable — re-serializing it
 * changes signature semantics (issue #325). Returns undefined when raw
 * bytes are unavailable.
 */
function getRawBody(req: Request): Buffer | undefined {
  const rawProp = (req as Request & { rawBody?: unknown }).rawBody;
  if (Buffer.isBuffer(rawProp)) return rawProp;
  if (typeof rawProp === 'string') return Buffer.from(rawProp, 'utf8');
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body, 'utf8');
  return undefined;
}

// --------------------------------------------------------------------------
// Per-IP rate limiting (CodeQL: route performs DB access + authorization)
// --------------------------------------------------------------------------

/** Webhook rate limit: 100 requests per minute per source IP. */
export const WEBHOOK_RATE_LIMIT_MAX = 100;
export const WEBHOOK_RATE_LIMIT_WINDOW_MS = 60_000;

// --------------------------------------------------------------------------
// Router
// --------------------------------------------------------------------------

export function createWebhookRouter(deps: WebhookDeps): Router {
  const router = Router();
  const { pool, redis, ipnSecret, logger, featureBillingEnabled } = deps;
  // See WebhookDeps.systemPool: the only two operations that cannot be
  // tenant-scoped. Everything else goes through withCommunityScope(pool).
  const systemPool = deps.systemPool ?? pool;
  const webhookMaxAgeMs = deps.webhookMaxAgeMs ?? DEFAULT_WEBHOOK_MAX_AGE_MS;

  // Per-IP fixed-window limiter, mounted BEFORE signature verification and
  // any Postgres/Redis work. Per-process state is acceptable: NOWPayments IPN
  // traffic is low-rate and this is a DoS bound, not a billing control
  // (idempotency is enforced downstream by the dedupe key). Behind a proxy,
  // the app must set `trust proxy` for req.ip to be the real client.
  router.use('/nowpayments', rateLimit({
    windowMs: WEBHOOK_RATE_LIMIT_WINDOW_MS,
    limit: WEBHOOK_RATE_LIMIT_MAX,
    standardHeaders: false,
    legacyHeaders: false,
    handler: (req: Request, res: Response) => {
      logger.warn({ ip: req.ip }, 'webhook rate limit exceeded');
      res.status(429).json({ status: 'rate_limited' });
    },
  }));

  /**
   * POST /webhooks/nowpayments — NOWPayments IPN callback
   *
   * Expects raw JSON body and x-nowpayments-sig HMAC-SHA512 header.
   * Raw body middleware must be configured upstream — either
   * express.json({ verify: captureRawBody }) or express.raw(). The route
   * asserts this at request time and returns 500 when it is missing.
   */
  router.post('/nowpayments', async (req: Request, res: Response) => {
    // Feature flag gate
    if (!featureBillingEnabled) {
      res.status(503).json({ status: 'disabled', reason: 'billing_not_enabled' });
      return;
    }

    // -------------------------------------------------------------------
    // Step 1: HMAC-SHA512 signature verification (raw bytes, fail closed)
    // -------------------------------------------------------------------
    const rawSignatureHeader = req.headers['x-nowpayments-sig'];
    const signature = normalizeSingleHeader(rawSignatureHeader);

    if (Array.isArray(rawSignatureHeader) && rawSignatureHeader.length > 1) {
      // Duplicated signature headers are ambiguous — reject instead of
      // guessing which value to verify (PR #365 CodeQL finding).
      logger.warn(
        { headerCount: rawSignatureHeader.length },
        'Duplicated x-nowpayments-sig header rejected',
      );
      res.status(401).json({ status: 'rejected', reason: 'invalid_signature_header' });
      return;
    }

    if (!signature || !ipnSecret) {
      logger.warn(
        { hasSignature: !!signature, hasSecret: !!ipnSecret },
        'Missing webhook signature or IPN secret',
      );
      res.status(401).json({ status: 'rejected', reason: 'missing_signature' });
      return;
    }

    // Fail closed when the exact raw request bytes are unavailable — never
    // re-serialize the middleware-parsed body for HMAC input (issue #325).
    const rawBody = getRawBody(req);
    if (!rawBody) {
      logger.error(
        {},
        'Raw webhook body unavailable — raw-body capture middleware is not installed. ' +
        'Mount express.json({ verify: captureRawBody }) or express.raw() upstream.',
      );
      res.status(500).json({ status: 'error', reason: 'raw_body_unavailable' });
      return;
    }

    // Parse the payload from the raw bytes (NOT from req.body — the parsed
    // object may differ from what the provider actually signed).
    let parsedPayload: unknown;
    let parseFailed = false;
    try {
      parsedPayload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      parseFailed = true;
    }

    // Verification path 1: HMAC over the exact raw bytes received.
    const rawBytesSig = createHmac('sha512', ipnSecret).update(rawBody).digest('hex');
    let verified = timingSafeCompare(rawBytesSig, signature);

    // Verification path 2: NOWPayments' documented signing rule — HMAC over
    // JSON.stringify of the sorted-key payload. The canonical form is derived
    // from the raw bytes we received, never from middleware output.
    if (!verified && !parseFailed) {
      const canonicalSig = createHmac('sha512', ipnSecret)
        .update(JSON.stringify(sortKeys(parsedPayload)))
        .digest('hex');
      verified = timingSafeCompare(canonicalSig, signature);
    }

    if (!verified) {
      logger.warn({}, 'Invalid NOWPayments webhook signature');
      res.status(401).json({ status: 'rejected', reason: 'invalid_signature' });
      return;
    }

    // -------------------------------------------------------------------
    // Step 2: Validate payload
    // -------------------------------------------------------------------
    if (parseFailed || typeof parsedPayload !== 'object' || parsedPayload === null) {
      res.status(200).json({ status: 'ignored', reason: 'invalid_payload' });
      return;
    }

    const payload = parsedPayload as NowpaymentsWebhookPayload;
    const paymentId = String(payload.payment_id ?? '');

    if (!paymentId || !payload.payment_status) {
      res.status(200).json({ status: 'ignored', reason: 'invalid_payload' });
      return;
    }

    // -------------------------------------------------------------------
    // Step 3: Webhook freshness enforcement (issue #327)
    // -------------------------------------------------------------------
    const receivedAt = Date.now();

    // updated_at is MANDATORY. It lives inside the HMAC-signed payload, so a
    // legitimate NOWPayments IPN always carries it; requiring it removes the
    // optional branch where a missing timestamp skipped freshness enforcement
    // entirely (CodeQL js/user-controlled-bypass-of-sensitive-action). A
    // missing/invalid value is rejected here — before any payment lookup, DB
    // write, or mint — and the reconciliation sweep still recovers the payment
    // (its crypto_payments row stays non-terminal and is polled against the
    // NOWPayments API), so no payment is stranded.
    {
      const providerTs =
        typeof payload.updated_at === 'string' ? new Date(payload.updated_at).getTime() : Number.NaN;

      if (typeof payload.updated_at !== 'string' || Number.isNaN(providerTs)) {
        // Missing or present-but-unparseable timestamp is rejected explicitly
        // (freshness is mandatory) rather than skipping enforcement.
        //
        // A receipt-time fallback is NOT an option: it makes ageMs ≈ 0 for
        // every event that omits the field, which is exactly the
        // user-controlled freshness bypass CodeQL flagged
        // (js/user-controlled-bypass-of-sensitive-action) — an attacker
        // replaying an old signed event with `updated_at` stripped would be
        // processed as fresh.
        //
        // But dropping it with no trace is also wrong: the event IS
        // signature-valid, so something real happened. Record a durable
        // marker under its own dedupe slot — never processed, never
        // auto-minted (the missed-mint recovery arm keys on the exact
        // `<id>:finished` event id, not this one), but visible to operators
        // and to any provider-poll recovery. Failing to record it is treated
        // like any other lost durable capture: retriable 503, not a silent ack.
        try {
          await systemPool.query(
            `INSERT INTO webhook_events (provider, event_id, payload, processed_at)
             VALUES ('nowpayments', $1, $2, NOW())
             ON CONFLICT (provider, event_id) DO NOTHING`,
            [`${paymentId}:${payload.payment_status}:no_timestamp`, JSON.stringify(payload)],
          );
        } catch (err) {
          logger.error(
            { paymentId, err },
            'Failed to record timestamp-less webhook — returning retriable 503',
          );
          res.status(503).json({ status: 'error', reason: 'capture_failed' });
          return;
        }
        logger.warn(
          { paymentId, updatedAt: payload.updated_at ?? null, receivedAt, freshness: 'invalid' },
          'Webhook timestamp missing or invalid — recorded, not processed (freshness mandatory)',
        );
        res.status(200).json({ status: 'ignored', reason: 'invalid_timestamp' });
        return;
      }

      const ageMs = receivedAt - providerTs;

      // TERMINAL statuses are never quarantined, however late they arrive.
      //
      // Quarantine acknowledges the event with 200 and defers recovery to the
      // reconciliation sweep — which has NO production caller. Deferring a
      // credit-bearing event to machinery that never runs is a silent loss, so
      // safety must not depend on it: a delayed terminal truth is processed
      // here instead. Freshness is not what protects a terminal event from
      // replay; the layers below it are, and they still all apply —
      // `(payment_id, payment_status)` dedupe in webhook_events, the atomic
      // monotonicity guard on the UPDATE, `credit_lots` unique on payment_id,
      // and the exactly-once Redis marker. A replayed stale `finished` is
      // absorbed by the dedupe slot; a FIRST delivery of a stale `finished` is
      // a purchase we owe.
      //
      // This mirrors the decision already shipped on the live sietch path
      // (CryptoWebhookService staleProcessableStatuses), keeping the two
      // implementations behaviourally identical as the runbook requires.
      //
      // Non-terminal stale events stay quarantined: no money rides on them, so
      // dropping one costs at most a little status lag until the next event.
      const isTerminalStatus = ['finished', 'failed', 'refunded', 'expired']
        .includes(payload.payment_status);

      if (webhookMaxAgeMs > 0 && ageMs > webhookMaxAgeMs && isTerminalStatus) {
        logger.warn(
          {
            paymentId,
            status: payload.payment_status,
            providerTimestamp: payload.updated_at,
            ageMs,
            maxAgeMs: webhookMaxAgeMs,
            freshness: 'stale_terminal_processed',
          },
          'Stale TERMINAL webhook processed, not quarantined — recovery machinery is not scheduled; idempotency layers protect against replay',
        );
        // fall through to normal processing
      } else if (webhookMaxAgeMs > 0 && ageMs > webhookMaxAgeMs) {
        // A stale event whose crypto_payments row does not exist yet must NOT
        // be quarantine-acked: the reconciliation sweep polls crypto_payments
        // and never consumes webhook_events, so quarantining + 200 here would
        // strand the payment once its row is created. Verify existence first
        // and return the same retriable 404 the fresh path uses; the provider
        // redelivers after the row appears, and the freshness gate re-runs.
        const stalePaymentExists = await verifyPaymentExists(systemPool, paymentId);
        if (!stalePaymentExists) {
          logger.warn(
            { paymentId, status: payload.payment_status, ageMs },
            'Stale webhook for unknown payment — retriable 404, not quarantined',
          );
          res.status(404).json({ status: 'error', reason: 'unknown_payment' });
          return;
        }
        // Stale event: quarantine. Record it durably (distinct dedupe slot so
        // it never blocks fresh processing) for the reconciliation sweep,
        // then ack — provider retries of a stale event stay stale, so a
        // non-2xx would only generate retry noise. But if the durable record
        // itself fails, we must NOT ack: a 200 would silently drop the event
        // from the reconciliation trail. Return retriable 503 instead.
        try {
          await systemPool.query(
            `INSERT INTO webhook_events (provider, event_id, payload, processed_at)
             VALUES ('nowpayments', $1, $2, NOW())
             ON CONFLICT (provider, event_id) DO NOTHING`,
            [`${paymentId}:${payload.payment_status}:stale`, JSON.stringify(payload)],
          );
        } catch (err) {
          logger.error(
            { paymentId, err },
            'Failed to record quarantined stale webhook — returning retriable 503',
          );
          res.status(503).json({ status: 'error', reason: 'quarantine_record_failed' });
          return;
        }
        logger.warn(
          {
            paymentId,
            status: payload.payment_status,
            providerTimestamp: payload.updated_at,
            receivedAt: new Date(receivedAt).toISOString(),
            ageMs,
            maxAgeMs: webhookMaxAgeMs,
            freshness: 'stale',
          },
          'Stale webhook quarantined (freshness window exceeded)',
        );
        res.status(200).json({ status: 'quarantined', reason: 'stale_timestamp' });
        return;
      }

      logger.info(
        {
          paymentId,
          status: payload.payment_status,
          providerTimestamp: payload.updated_at,
          receivedAt: new Date(receivedAt).toISOString(),
          ageMs,
          // A stale terminal event reaches here too — do not mislabel it fresh.
          freshness:
            webhookMaxAgeMs > 0 && ageMs > webhookMaxAgeMs ? 'stale_terminal' : 'fresh',
        },
        'Webhook timestamp age',
      );
    }

    // -------------------------------------------------------------------
    // Step 4: Verify payment exists (Flatline IMP-009) BEFORE dedupe.
    // Unknown payments are NOT recorded in webhook_events (issue #324):
    // recording first would terminally dedupe the event, so a provider retry
    // after the crypto_payments row appears would be suppressed. The 404 is
    // retriable — NOWPayments redelivers on non-2xx.
    // -------------------------------------------------------------------
    const existingPayment = await verifyPaymentExists(systemPool, paymentId);

    if (!existingPayment) {
      logger.warn(
        { paymentId, status: payload.payment_status },
        'Webhook for unknown payment (no crypto_payments row) — retriable 404, not deduped',
      );
      res.status(404).json({ status: 'error', reason: 'unknown_payment' });
      return;
    }

    // -------------------------------------------------------------------
    // Step 5: Idempotent webhook_events INSERT (dedup)
    // Dedupe identity is (payment_id, payment_status) — NOT payment_id alone
    // (issue #324): an early `waiting` event must never consume the dedupe
    // slot of the later `finished` event that mints credits.
    // -------------------------------------------------------------------
    try {
      const dedupResult = await systemPool.query<{ id: string }>(
        `INSERT INTO webhook_events (provider, event_id, payload, processed_at)
         VALUES ('nowpayments', $1, $2, NOW())
         ON CONFLICT (provider, event_id) DO NOTHING
         RETURNING id`,
        [`${paymentId}:${payload.payment_status}`, JSON.stringify(payload)],
      );

      if (dedupResult.rows.length === 0) {
        // Duplicate webhook — this exact (payment_id, status) already processed
        logger.info(
          { paymentId, status: payload.payment_status },
          'Duplicate webhook (already in webhook_events)',
        );
        res.status(200).json({ status: 'duplicate' });
        return;
      }
    } catch (err) {
      logger.error({ paymentId, err }, 'Failed to insert webhook_events');
      // The webhook_events INSERT is the FIRST durable capture of this event.
      // A transient failure here means we have NO record — returning 200 would
      // ack the event and NOWPayments would never retry, permanently dropping
      // the payment (a `finished` event would strand credits). Return a
      // retriable 503 so the provider re-delivers the event (issue #326).
      res.status(503).json({ status: 'error', reason: 'internal' });
      return;
    }

    // -------------------------------------------------------------------
    // Step 6: Status monotonicity check
    // -------------------------------------------------------------------
    const currentOrdinal = STATUS_ORDINAL[payload.payment_status] ?? -1;

    // Query current status from crypto_payments. The community is known now,
    // so this and every write below run inside that community's RLS scope.
    const scoped = <T extends import('pg').QueryResultRow>(
      sql: string,
      params: unknown[],
    ): Promise<import('pg').QueryResult<T>> =>
      withCommunityScope(existingPayment.community_id, pool, (client) => client.query<T>(sql, params));

    const statusResult = await scoped<{ status: string }>(
      `SELECT status FROM crypto_payments WHERE payment_id = $1`,
      [paymentId],
    );

    if (statusResult.rows.length > 0) {
      const existingOrdinal = STATUS_ORDINAL[statusResult.rows[0].status] ?? -1;

      // Allow failed/refunded/expired from any non-terminal state
      const isTerminalTransition = ['failed', 'refunded', 'expired'].includes(payload.payment_status);
      const isTerminalCurrent = ['finished', 'failed', 'refunded', 'expired'].includes(statusResult.rows[0].status);

      // A `finished` event arriving after the row already settled as
      // failed/expired still owes credit — the provider says the customer
      // paid (a late payment on an expired invoice is the common case). The
      // status itself is not correctable (monotonicity ranks finished 5 below
      // expired 6 / failed 7) and neither reconciliation arm revisits those
      // rows, so short-circuiting here would lose the purchase permanently.
      // Fall through to the idempotent mint instead; the UPDATE below still
      // (correctly) refuses to move the status backwards.
      const isRecoverableFinished =
        payload.payment_status === 'finished' &&
        ['failed', 'expired'].includes(statusResult.rows[0].status);

      if (isTerminalCurrent && !isRecoverableFinished) {
        logger.info({ paymentId, current: statusResult.rows[0].status, incoming: payload.payment_status },
          'Payment already in terminal state');
        res.status(200).json({ status: 'skipped', reason: 'terminal_state' });
        return;
      }

      if (!isTerminalTransition && !isRecoverableFinished && currentOrdinal <= existingOrdinal) {
        logger.info(
          { paymentId, current: statusResult.rows[0].status, incoming: payload.payment_status },
          'Backward status transition rejected (monotonicity)',
        );
        res.status(200).json({ status: 'skipped', reason: 'backward_transition' });
        return;
      }
    }

    // -------------------------------------------------------------------
    // Step 7: Update crypto_payments status (atomic monotonicity guard)
    //
    // The Step 6 read-then-check is advisory (friendly response codes) but
    // NOT a lock: because the dedupe key includes payment_status, two valid
    // deliveries with different statuses (e.g. confirmed + finished) can
    // both reach this point concurrently and both observe the same
    // pre-update row. The UPDATE itself therefore re-enforces monotonicity
    // in one atomic statement — a slower 'confirmed' can never overwrite a
    // faster 'finished'. rowCount 0 means we lost the race (or the row went
    // terminal between read and write): skip side effects.
    // -------------------------------------------------------------------
    const isFinished = payload.payment_status === 'finished';
    const isTerminalFailure = ['failed', 'refunded', 'expired'].includes(payload.payment_status);

    const updateResult = await scoped(
      `UPDATE crypto_payments
       SET status = $2,
           actually_paid = COALESCE($3, actually_paid),
           finished_at = CASE WHEN $4 THEN NOW() ELSE finished_at END,
           updated_at = NOW()
       WHERE payment_id = $1
         AND status NOT IN ('finished', 'failed', 'refunded', 'expired')
         AND ($5 OR CASE status
                WHEN 'waiting' THEN 0
                WHEN 'confirming' THEN 1
                WHEN 'confirmed' THEN 2
                WHEN 'sending' THEN 3
                WHEN 'partially_paid' THEN 4
                ELSE -1 END < $6)`,
      [
        paymentId,
        payload.payment_status,
        payload.actually_paid,
        isFinished,
        isTerminalFailure,
        currentOrdinal,
      ],
    );

    // Losing the status write does NOT decide whether credits are owed.
    //
    // `finished` is the credit-bearing fact: the provider states the payment
    // completed. A concurrent `failed`/`expired` delivery can commit first —
    // both bypass the rank check from any non-terminal state — and then the
    // monotonicity trigger makes the status permanently uncorrectable
    // (finished is rank 5, BELOW expired 6 and failed 7), while both
    // reconciliation arms exclude failed/expired rows. Suppressing the mint
    // here would lose the purchased credit forever. credit_lots is unique on
    // payment_id, so minting without owning the status column is idempotent.
    //
    // `refunded` is the one terminal state that must still suppress the mint:
    // it means the money was returned.
    let mintWithoutStatusWrite = false;

    if (updateResult.rowCount === 0) {
      if (!isFinished) {
        logger.info(
          { paymentId, incoming: payload.payment_status },
          'Status update lost a concurrent transition race — no overwrite',
        );
        res.status(200).json({ status: 'skipped', reason: 'concurrent_transition' });
        return;
      }

      const raceWinner = await scoped<{ status: string }>(
        `SELECT status FROM crypto_payments WHERE payment_id = $1`,
        [paymentId],
      );
      const winningStatus = raceWinner.rows[0]?.status ?? null;

      if (winningStatus === 'refunded') {
        logger.warn(
          { paymentId, winningStatus },
          'finished webhook lost to a refund — not minting',
        );
        res.status(200).json({ status: 'skipped', reason: 'refunded' });
        return;
      }

      mintWithoutStatusWrite = true;
      logger.warn(
        { paymentId, winningStatus },
        'finished webhook lost the status race — crediting anyway (status is not correctable)',
      );
    }

    // -------------------------------------------------------------------
    // Step 8: Mint credit lot if finished (idempotent)
    // -------------------------------------------------------------------
    if (isFinished) {
      try {
        const lotResult = await processPaymentForLedger(pool, redis, {
          paymentId,
          communityId: existingPayment.community_id,
          priceUsd: existingPayment.price_amount,
          orderId: payload.order_id,
        });

        logger.info({
          paymentId,
          lotId: lotResult.lotId,
          minted: lotResult.minted,
          redisAdjusted: lotResult.redisAdjusted,
          amountMicro: lotResult.amountUsdMicro.toString(),
        }, 'NOWPayments webhook: credit lot processing complete');
      } catch (err) {
        // Lot minting failure should not fail the webhook response.
        // Intended recovery is the reconciliation sweep — which is NOT
        // currently scheduled (no production caller; see
        // packages/services/reconciliation-sweep.ts header). Until it is
        // activated, a mint failure here is not automatically recovered.
        logger.error({ paymentId, err }, 'Credit lot minting failed — will retry via reconciliation');
      }
    }

    // -------------------------------------------------------------------
    // Step 9: Audit log
    // -------------------------------------------------------------------
    try {
      await scoped(
        `INSERT INTO billing_audit_log (event_type, payload, community_id, created_at)
         VALUES ($1, $2, $3, NOW())`,
        [
          isFinished ? 'nowpayments_payment_completed' : `nowpayments_status_${payload.payment_status}`,
          JSON.stringify({
            payment_id: paymentId,
            status: payload.payment_status,
            actually_paid: payload.actually_paid,
            pay_currency: payload.pay_currency,
            price_amount: payload.price_amount,
            // Durable operator signal: the credit was applied while the
            // payment row stayed at a non-correctable terminal failure.
            ...(mintWithoutStatusWrite ? { credited_without_status_write: true } : {}),
          }),
          existingPayment.community_id,
        ],
      );
    } catch {
      // Audit log failure is non-blocking
    }

    res.status(200).json(
      mintWithoutStatusWrite
        ? { status: 'processed', reason: 'credited_without_status_write' }
        : { status: 'processed' },
    );
  });

  return router;
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/**
 * Normalize a possibly-array header value to a single string.
 * Returns undefined for missing headers and for multi-value arrays
 * (the caller rejects duplicated signature headers explicitly).
 */
function normalizeSingleHeader(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.length === 1 && typeof value[0] === 'string') {
    return value[0];
  }
  return undefined;
}

/**
 * Sort object keys recursively for canonical HMAC computation.
 * NOWPayments signs over JSON with sorted keys. The input MUST be parsed
 * from the raw request bytes — never from middleware-parsed req.body.
 */
function sortKeys(obj: unknown): unknown {
  if (obj === null || obj === undefined || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sortKeys);

  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
    sorted[key] = sortKeys((obj as Record<string, unknown>)[key]);
  }
  return sorted;
}

/**
 * Constant-time string comparison using timingSafeEqual.
 * Returns false for different-length strings without timing leak.
 */
function timingSafeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
