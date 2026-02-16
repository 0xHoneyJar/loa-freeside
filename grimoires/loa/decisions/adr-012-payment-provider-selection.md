# ADR-012: Payment Provider Selection — NOWPayments

**Status:** Accepted
**Date:** 2026-02-16
**Decision Makers:** Engineering Team

## Context

The platform needs a payment provider for creator payouts. The platform operates in the crypto/web3 space and needs to pay creators in cryptocurrency without requiring traditional banking infrastructure.

## Decision

**NOWPayments** as the primary payout provider, accessed through the `IPayoutProvider` port abstraction.

Code: `NOWPaymentsAdapter.ts`, `packages/core/ports/ICryptoPaymentProvider.ts`

## Alternatives Considered

| Provider | Status | Pros | Cons | Verdict |
|----------|--------|------|------|---------|
| **NOWPayments** | Active | Crypto-native, payout API, no fiat banking, multi-chain support | Smaller company, limited track record vs Stripe | **Chosen** |
| Stripe | Dead | Industry standard, excellent docs | Account closed. Does not support crypto-native payouts | Rejected |
| Paddle | Dead | Good for SaaS billing | Rejected crypto business model | Rejected |
| x402 (HTTP 402) | Promising | Native web protocol, decentralized | No payout API yet. Protocol-level, not a service | Deferred (monitor) |
| lobster.cash | Investigating | Potentially good rates | No established track record, limited API docs | Deferred (investigate) |
| MaximumSats | Niche | Lightning Network native, fast | Lightning-only (no EVM chains), small user base | Deferred (promising for BTC) |

## Architecture

The `IPayoutProvider` port pattern enables future provider migration:

```typescript
interface IPayoutProvider {
  createPayout(input: PayoutInput): Promise<PayoutResult>;
  getPayoutStatus(payoutId: string): Promise<PayoutStatus>;
  verifyWebhook(payload: string, signature: string): boolean;
}
```

Switching providers requires only implementing a new adapter — no changes to `CreatorPayoutService`, `PayoutStateMachine`, or any consuming code.

## Consequences

- Dependent on NOWPayments API availability and uptime
- IPN (Instant Payment Notification) webhook pattern for async status updates
- `NOWPAYMENTS_API_KEY` and `NOWPAYMENTS_IPN_SECRET` required at startup
- Port abstraction enables migration without application code changes
