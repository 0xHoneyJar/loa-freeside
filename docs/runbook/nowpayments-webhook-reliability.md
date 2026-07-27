# NOWPayments Webhook Reliability Runbook

Operational contract for `POST /webhooks/nowpayments`
(`packages/routes/webhooks.routes.ts`). Covers the response-code contract,
dedupe semantics, freshness quarantine, and reconciliation behavior demanded
by issues #324, #325, #326, and #327.

> ## Deployment status — read this first
>
> There are **two** NOWPayments implementations and only one of them runs.
>
> | | live today | not yet deployed |
> |---|---|---|
> | endpoint | `POST /api/crypto/webhook` (`themes/sietch/src/api/crypto-billing.routes.ts` → `CryptoWebhookService`) | `POST /webhooks/nowpayments` (`packages/routes/webhooks.routes.ts`) |
> | store | sietch SQLite (`themes/sietch/src/db/`) | platform Postgres (`themes/sietch/drizzle/migrations/`, RLS + monotonicity trigger) |
> | reconciliation sweep | none | `packages/services/reconciliation-sweep.ts` — **no scheduler invokes it yet** |
>
> Everything in this runbook below the response-code table describes the
> platform (Postgres) implementation unless a row says otherwise. That
> implementation is exercised only by its test suite: `createWebhookRouter`
> and `runReconciliationSweep` have **no production callers**. Do not read the
> guarantees here as currently-enforced production behavior.
>
> **Before cutting over**, all of these must be true, and none of them is a
> code change in this package:
>
> 1. A platform app owns a `pg.Pool` against the Postgres schema and mounts
>    `createWebhookRouter`, with `systemPool` bound to a connection that has
>    cross-tenant authority (see `WebhookDeps.systemPool`).
> 2. `runReconciliationSweep` is scheduled (the module is written for a
>    5-minute cadence) with `maintenancePool` bound to the same authority.
>    Several guarantees below — durable outbox drain, missed-mint recovery,
>    stale-event recovery — are **inert** until this exists.
> 3. The NOWPayments IPN URL is repointed, and the sietch endpoint retired or
>    kept as a documented dual-write.
>
> Until then, route hardening must land in BOTH paths.

## Response-code contract

NOWPayments retries IPN delivery on any **non-2xx** response (bounded retry
schedule with backoff). The handler uses that deliberately:

| HTTP | Body `status` / `reason` | Meaning | Provider retry wanted? |
|------|--------------------------|---------|------------------------|
| 200 `processed` | fully handled; credits minted on `finished` | — | no |
| 200 `processed` / `credited_without_status_write` | `finished` credited while the status column stayed at a terminal failure it cannot be moved back from | — | no |
| 200 `duplicate` | this exact `(payment_id, payment_status)` was already recorded | — | no |
| 200 `skipped` / `backward_transition` or `terminal_state` | monotonicity gate; event recorded, no state change | — | no |
| 200 `skipped` / `refunded` | `finished` arrived for a refunded payment; deliberately not credited | — | no |
| 200 `quarantined` / `stale_timestamp` | event older than the freshness window; durably recorded, not processed | — | no (a retry would still be stale) |
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
- **`updated_at` is mandatory.** Both a **missing** and a **present-but-
  unparseable** `updated_at` are rejected explicitly: 200 `ignored` /
  `invalid_timestamp` with a warn log, before any payment lookup, DB write, or
  mint. Rationale: `updated_at` lives inside the HMAC-signed payload, so a
  legitimate NOWPayments IPN always carries it; allowing a missing value to
  *skip* freshness enforcement was a user-controlled bypass of a security
  check (CodeQL `js/user-controlled-bypass-of-sensitive-action`). Requiring it
  does not risk stranding a payment: a rejected event leaves the
  `crypto_payments` row non-terminal, and the reconciliation sweep polls it
  against the NOWPayments API for the authoritative status.

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
   selects payments with no `credit_lots` row and mints idempotently (no API
   poll — the status is already known). Two sources qualify:
   - `status = 'finished'` (migration 0020 index), and
   - `status IN ('failed','expired')` **with a signed `<payment_id>:finished`
     row in `webhook_events`** (migration 0021 index). See "A `finished` event
     never loses its credit" below for why that row class exists. Quarantined
     stale events use a distinct `:stale` key and deliberately do **not**
     qualify — they are recovered by the provider poll, not auto-minted.
   `refunded` is excluded from both: money that was returned is not owed.
5. **Sietch (monolith) stale `finished` events** — the live
   `/api/crypto/webhook` path has no sweep, so a stale signature-valid
   `finished` event is PROCESSED rather than quarantined (delayed terminal
   delivery must not strand a payment); replay safety is preserved by the
   LVVER idempotency layers (Redis `(payment_id, status)` dedupe + DB
   status-transition validation). Non-terminal stale events are **dropped**,
   with a `crypto_webhook_quarantined_stale` audit row for the operator trail
   — nothing in sietch consumes that row, and nothing needs to: only
   non-terminal transitions can be dropped, so no credit or settlement outcome
   is at stake, and the payment's own terminal event still arrives.

## A `finished` event never loses its credit

`finished` is the provider's statement that the customer paid, so it is the
only credit-bearing event. Three things could previously suppress it:

- **A concurrent terminal failure.** `failed`/`expired` may transition from any
  non-terminal state, so a delivery that commits first takes the status column.
- **A late payment on a settled invoice.** The invoice expires, the customer
  pays anyway, and `finished` arrives after the row already says `expired`.
- **Monotonicity.** The trigger ranks `finished` (5) *below* `expired` (6) and
  `failed` (7), so the status can never be corrected afterwards.

The route therefore does **not** gate the mint on winning the status write.
`credit_lots` is unique on `payment_id`, so crediting without owning the status
column is idempotent; the response is `200 processed / credited_without_status_write`
and the `billing_audit_log` payload carries `credited_without_status_write: true`.
`refunded` is the one terminal state that still suppresses the mint. Crash
safety for the same window is sweep arm 4b above.

## Batch fairness

`batchSize` is the total work items per sweep across **all three** arms
(non-terminal poll, missed-mint recovery, Redis-adjustment drain) and is
honored exactly — `batchSize: 1` processes one item, never one per arm.

Slots go to the least-recently-serviced items globally. Every arm exposes the
same cursor (`crypto_payment_checks.last_checked_at` for the two payment arms,
`pending_redis_credit_adjustments.last_attempt_at` for the outbox), and the
cursor is stamped **before** the work runs. Two consequences worth knowing
during an incident:

- A standing backlog in one arm cannot hold the batch. At `batchSize: 1` the
  single slot visibly alternates between arms.
- A permanently-failing item rotates to the back instead of re-winning the head
  slot, so one poison row cannot block everything behind it. It is still
  retried every cycle through the rotation — a row with a high `attempts` count
  and a recent `last_attempt_at` is stuck, not starved.

## Alerting hooks

- `Failed to insert webhook_events` (error log) → durable-capture failures;
  alert if sustained (provider retries are bounded).
- `Raw webhook body unavailable` (error log) → deploy/middleware regression;
  every webhook is being 500'd. Page immediately.
- `Stale webhook quarantined` (warn log) → clock skew or delayed provider
  delivery; investigate if frequent.
- `finished webhook lost the status race` (warn log) → a payment was credited
  while its status stayed `failed`/`expired`. Not a bug and not actionable per
  event, but a sustained rate means the provider is delivering conflicting
  terminal statuses; reconcile those payments against the provider.
- `Approved proposal closed without applying` (warn log, governance) → an older
  proposal was superseded by a newer one for the same scope. Expected when
  proposals overlap; frequent occurrences suggest a stuck activation sweep.
