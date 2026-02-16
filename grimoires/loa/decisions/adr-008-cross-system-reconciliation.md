# ADR-008: Cross-System Reconciliation

**Status:** Accepted
**Date:** 2026-02-16
**PRD refs:** FR-9
**SDD refs:** §SS4.6, §SS8.1

## Context

Cycle-030 introduces two distinct monetary subsystems that must stay in sync:

1. **Credit Ledger** (CreditLedgerAdapter) — conserved funds. Every micro-USD is accounted for across lots, reservations, and consumed balances.
2. **Budget Engine** (AgentBudgetService) — authorized capacity. Daily spending caps that constrain agent spending without holding actual funds.

Additionally, the agent clawback system introduces **off-ledger receivables** (IOUs) that represent platform liabilities not captured in the credit lot balance.

These systems overlap at the `reserve()` → `finalize()` boundary, where credit reservation (conserved) and budget accounting (capacity) must agree.

## Decision

### 1. Semantic Distinction

| System | Type | What It Tracks |
|--------|------|---------------|
| Credit Ledger | Conserved funds | actual micro-USD across lots |
| Budget Engine | Authorized capacity | daily spending authorization |
| Clawback Receivables | Off-ledger liability | platform IOUs from partial clawbacks |

The credit ledger is the **single source of truth** for actual funds. The budget engine is a secondary constraint. Receivables track platform-level liabilities.

### 2. Canonical Bridge Mechanism

The `reserve()` call in the credit ledger locks credits 1:1. The budget engine's `checkBudget()` is an advisory gate that runs before `reserve()`. The `AgentAwareFinalizer` ensures both systems are updated atomically at finalize time.

```
checkBudget(amount) → reserve(amount) → [inference] → AgentAwareFinalizer.finalize()
    ↓ advisory           ↓ conserved                      ↓ atomic: ledger + budget
```

### 3. Authority Model

| Data | Authority | Secondary |
|------|-----------|-----------|
| Account balance | Credit lots (SQLite) | Redis cache |
| Spending limit | agent_spending_limits (SQLite) | Redis advisory |
| Budget spent | agent_budget_finalizations (SQLite) | Computed from window |
| Receivable balance | agent_clawback_receivables (SQLite) | None |

### 4. Reconciliation Protocol: Alert-Only

Reconciliation **NEVER auto-corrects**. Divergence emits `ReconciliationDivergence` event and logs for human review. This prevents cascading corrections from amplifying errors.

Three independent conservation checks:

1. **Lot conservation:** `available + reserved + consumed = original - expired` per account
2. **Receivable tracking:** `sum(balance_micro WHERE balance_micro > 0)` = total outstanding IOUs
3. **Platform-level:** `sum(all_lot_balances) + sum(all_receivable_balances) = sum(all_minted) - sum(all_expired)`

Plus cross-system consistency checks:

4. **Budget vs actuals:** `current_spend_micro` matches `sum(agent_budget_finalizations)` within window
5. **Bridge check:** reserved credits map to allocated budget capacity

### 5. Clawback Propagation

When `EarningClawedBack` fires for an agent:
- If balance covers clawback: full compensating entry, budget unaffected
- If balance insufficient: partial entry + receivable created
- Receivable recovered via drip from future earnings
- Conservation: `clawback_applied + receivable = original_clawback_amount`

### 6. Event-Based Synchronization

All monetary operations emit economic events via the outbox (migration 054).
The budget engine subscribes to finalization events to update spend tracking.
Reconciliation subscribes to divergence events for alerting.

## Consequences

### Positive
- Clear authority model prevents conflicting writes
- Alert-only reconciliation is safe (no cascading auto-corrections)
- Three-tier conservation catches both lot-level and platform-level leaks
- Off-ledger receivables maintain full accounting even when balance is insufficient

### Negative
- Divergence requires manual investigation (no auto-heal)
- Budget engine adds latency to agent finalize path (mitigated by Redis advisory)
- Three separate conservation checks increase reconciliation complexity

### Risks
- Stale Redis cache could allow brief budget overrun (acceptable: advisory only)
- Receivable drip recovery depends on agent continuing to earn (long-lived IOUs possible)
