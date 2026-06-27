# Payment Webhook Lifecycle Runbook

This runbook scopes the NOWPayments webhook changes in PR #365.

## Raw body policy

The webhook signature check must use the exact raw request body bytes supplied by upstream Express middleware.

Accepted raw body shapes:

- `string`
- `Buffer`

Rejected raw body shapes:

- parsed object bodies;
- arrays;
- missing body values;
- reconstructed JSON.

## Timestamp policy

If `updated_at` is present, it must parse as a finite timestamp and must not be older than 24 hours.

If `updated_at` is absent, the handler accepts the signed payload as a legacy provider shape and logs that the timestamp is absent. This preserves compatibility while making timestamp absence visible.

## Receipt and processing policy

`webhook_events` records receipt. It is not the processing terminal.

A duplicate receipt continues through idempotent status and credit-lot processing so provider retries can recover partial failures.

## Retryable failures

The handler intentionally returns `500` for:

- receipt insert failure;
- credit-lot mint failure.

These responses are retryable. Operators should treat repeated retryable failures as payment lifecycle incidents and inspect database/Redis availability plus the credit-lot ledger.

## Non-claims

This runbook does not claim full production billing readiness. It does not replace reconciliation jobs, provider-side retry guarantees, feature-flag rollout evidence, or full integration tests.

## Local policy check

Run:

```bash
node scripts/check-nowpayments-webhook-policy.mjs
```

The checker verifies that the handler keeps the raw-body, duplicate-receipt, retryable-failure, and timestamp-policy contracts visible in source.
