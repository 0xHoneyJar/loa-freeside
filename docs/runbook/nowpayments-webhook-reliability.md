# NOWPayments Webhook Reliability Runbook

Operational contract for `POST /webhooks/nowpayments`
(`packages/routes/webhooks.routes.ts`). Covers the response-code contract,
dedupe semantics, freshness quarantine, and reconciliation behavior demanded
by issues #324, #325, #326, and #327.

> **Production mounting (honest state).** The monolith's live NOWPayments
> endpoint is `POST /api/crypto/webhook` — `themes/sietch/src/api/
> crypto-billing.routes.ts` → `CryptoWebhookService` (raw-body HMAC, LVVER
> lock, Redis+DB `(payment_id, status)` dedupe, freshness gate with durable
> quarantine, and 503 `quarantine_failed` when the quarantine record cannot
> be written). `packages/routes/webhooks.routes.ts` is the extracted-platform
> (Postgres) implementation of the same contract; it is not yet mounted by
> the sietch app and is kept contract-equivalent by its test suite. Route
> hardening changes must land in BOTH paths until the extraction completes.

## Response-code contract

NOWPayments retries IPN delivery on any **non-2xx** response (bounded retry
schedule with backoff). The handler uses that deliberately:

| HTTP | Body `status` / `reason` | Meaning | Provider retry wanted? |
|------|--------------------------|---------|------------------------|
| 200 `processed` | fully handled; credits minted on `finished` | — | no |
| 200 `duplicate` | this exact `(payment_id, payment_status)` was already recorded | — | no |
| 200 `skipped` / `backward_transition` or `terminal_state` | monotonicity gate; event recorded, no state change | — | no |
| 200 `quarantined` / `stale_timestamp` | event older than the freshness window; recorded for reconciliation, not processed | — | no (a retry would still be stale) |
| 200 `ignored` / `invalid_payload` or `invalid_timestamp` | signed but malformed event; dropped explicitly with audit log | — | no |
| 401 `rejected` | missing/invalid/duplicated signature header | — | n/a (hostile or misconfigured) |
| 404 `error` / `unknown_payment` | signature valid but no `crypto_payments` row yet (webhook raced payment creation) | **yes** — retriable, event is NOT recorded/deduped | yes |
| 500 `error` / `raw_body_unavailable` | server misconfiguration: raw-body capture middleware missing | yes (and page the operator — this is a deploy bug) | yes |
| 503 `error` / `internal` | `webhook_events` INSERT (first durable capture) failed transiently | **yes** — this is the #326 fix; a 200 here would silently drop payments | yes |
| 503 `error` / `quarantine_record_failed` | stale event's durable quarantine record could not be written | **yes** — acking an unrecorded stale event would drop it from the reconciliation trail | yes |
| 503 `disabled` | `FEATURE_BILLING_ENABLED` is false | yes | yes |

## Dedupe identity (#324)

- Dedupe key is `(provider='nowpayments', event_id='<payment_id>:<payment_status>')`
  against `webhook_events` `UNIQUE(provider, event_id)`.
- An early `waiting`/`confirming` event therefore **cannot** consume the dedupe
  slot of the later `finished` event — status progression always reaches the
  minting path exactly once.
- Duplicate `finished` events collide on `<payment_id>:finished` → 200
  `duplicate`, no second mint. `credit_lots` additionally enforces
  `ON CONFLICT (payment_id) DO NOTHING` as a second idempotency layer.
- Rows written before this change used bare `payment_id` as `event_id`; they do
  not collide with the new composite keys, so historical events cannot block
  new status progressions either.
- Unknown-payment events are **not** inserted into `webhook_events` (they get a
  retriable 404 before the dedupe step), so they can never be terminally
  deduped before the `crypto_payments` row exists.

## Raw-body signature verification (#325)

- The route fails closed (500 `raw_body_unavailable`) unless the exact raw
  request bytes are available, from one of:
  - `req.rawBody` — set by the exported `captureRawBody` verify hook:
    `app.use(express.json({ verify: captureRawBody }))`
  - a string/Buffer `req.body` (`express.raw()` / `express.text()`)
- The HMAC-SHA512 is verified against (1) the exact raw bytes, then (2) the
  NOWPayments documented signing rule — `JSON.stringify` of the sorted-key
  payload **parsed from those same raw bytes**. The middleware-parsed
  `req.body` object is never re-serialized for signature input.
- Duplicated `x-nowpayments-sig` headers are rejected 401.

## Freshness window & quarantine (#327)

- `webhookMaxAgeMs` (router dep, default 15 minutes, `0` disables) bounds the
  accepted age of the signed `updated_at` timestamp.
- **Stale** events (age > window) are quarantined: recorded durably in
  `webhook_events` under `event_id='<payment_id>:<status>:stale'` (a distinct
  dedupe slot that never blocks fresh processing), logged with
  `providerTimestamp`, `receivedAt`, `ageMs`, and `freshness: 'stale'`, then
  acked 200 `quarantined`. If the durable record itself fails, the event is
  **not** acked: 503 `quarantine_record_failed` (retriable) so the provider
  redelivers.
- **Missing** `updated_at` is accepted and logged with
  `freshness: 'missing_timestamp'`. Policy rationale: the timestamp lives
  inside the signed payload, so an attacker cannot strip it without
  invalidating the signature; rejecting would drop legitimate provider
  payloads that omit the field.
- **Invalid** (present but unparseable) `updated_at` is rejected explicitly:
  200 `ignored` / `invalid_timestamp` with a warn log.

## Reconciliation behavior

The webhook path is best-effort real-time; the reconciliation sweep
(`packages/services/reconciliation-sweep.ts`) is the safety net:

1. **Missed mints** — `finished` payments whose `credit_lots` row is missing
   (e.g. mint threw after the 200 was committed) are picked up by the sweep;
   mint failure inside the handler is logged
   (`Credit lot minting failed — will retry via reconciliation`) and does not
   fail the webhook response.
2. **Quarantined stale events** — operators can query
   `SELECT * FROM webhook_events WHERE provider='nowpayments' AND event_id LIKE '%:stale'`
   and reconcile the affected payments against the NOWPayments API
   (payment-status poll) before manually advancing them.
3. **Dropped durable capture** — a 503 storm (persistent `webhook_events`
   INSERT failure) means DB trouble; NOWPayments retries cover the transient
   case, and the sweep's stuck-payment query
   (`idx_crypto_payments_reconciliation`, statuses `waiting`/`confirming`/
   `confirmed`/`sending`/`partially_paid` — migration 0019) covers exhaustion
   of the provider retry schedule. `partially_paid` is included because it can
   still receive a delayed `finished` webhook that the freshness gate
   quarantines; the sweep is that payment's only recovery path.
4. **Missed mints on terminal rows** — when the webhook marked the payment
   `finished` but the mint threw after the 200 was committed, the row is
   terminal and invisible to the stuck-payment query. A second sweep arm
   selects `finished` payments with no `credit_lots` row and mints
   idempotently (no API poll — the status is already known).
5. **Sietch (monolith) stale `finished` events** — the live
   `/api/crypto/webhook` path has no sweep, so a stale signature-valid
   `finished` event is PROCESSED rather than quarantined (delayed terminal
   delivery must not strand a payment); replay safety is preserved by the
   LVVER idempotency layers (Redis `(payment_id, status)` dedupe + DB
   status-transition validation). Non-terminal stale events remain
   quarantined with a durable `crypto_webhook_quarantined_stale` record.
6. **Concurrent status deliveries** — because the dedupe key includes
   `payment_status`, two different-status deliveries can race past the
   advisory read-then-check. The Postgres route's UPDATE enforces
   monotonicity atomically (terminal rows never change; ordinals must
   strictly increase), so a slower `confirmed` can never overwrite a faster
   `finished` (`200 skipped/concurrent_transition`).

## Alerting hooks

- `Failed to insert webhook_events` (error log) → durable-capture failures;
  alert if sustained (provider retries are bounded).
- `Raw webhook body unavailable` (error log) → deploy/middleware regression;
  every webhook is being 500'd. Page immediately.
- `Stale webhook quarantined` (warn log) → clock skew or delayed provider
  delivery; investigate if frequent.
