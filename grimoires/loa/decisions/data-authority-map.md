# Data Authority Map

**Version:** 1.0
**Date:** 2026-02-16
**Sprint:** 17 (Global: 273), Task 17.5

## Overview

Defines the system-of-record, mutability, and derivation rules for every monetary entity in the billing subsystem.

## Authority Matrix

| Domain | Table | Authority | Mutability | System of Record |
|--------|-------|-----------|------------|------------------|
| **Account Identity** | `credit_accounts` | Primary | Mutable (version) | SQLite |
| **Credit Balances** | `credit_ledger` | Primary | **Append-only** | SQLite |
| **Reservations** | `credit_ledger` (entry_type) | Primary | Append-only (finalize/release adds entries) | SQLite |
| **Referral Attribution** | `referral_registrations` | Primary | Mutable (bonus_status) | SQLite |
| **Referral Events** | `referral_events` | Primary | Append-only | SQLite |
| **Referrer Earnings** | `referrer_earnings` | Primary | Mutable (`settled_at`, `clawback_reason`) | SQLite |
| **Revenue Rules** | `revenue_rules` | Primary | Mutable (status lifecycle) | SQLite |
| **Fraud Rules** | `fraud_rules` | Primary | Mutable (status lifecycle) | SQLite |
| **Payout Requests** | `payout_requests` | Primary | Mutable (status lifecycle) | SQLite |
| **Treasury State** | `treasury_state` | Primary | Mutable (OCC versioned) | SQLite |
| **Webhook Events** | `webhook_events` | Primary | Append-only | SQLite |
| **Score Snapshots** | `score_snapshots` | Derived | **Append-only** | SQLite (from external scores) |
| **Score Distributions** | `score_distributions` | Derived | Mutable (status lifecycle) | SQLite |
| **Billing Events** | `billing_events` (Sprint 18) | Derived | **Append-only** | SQLite |
| **Cached Balances** | Redis (future) | Derived | Ephemeral | Redis (derived from credit_ledger) |

## Append-Only Tables (Immutable After Insert)

| Table | Enforcement | Purpose |
|-------|-------------|---------|
| `credit_ledger` | Application logic (no UPDATE/DELETE in code) | Double-entry ledger integrity |
| `referral_events` | Application logic | Fraud detection audit trail |
| `revenue_rule_audit_log` | SQLite trigger (blocks UPDATE/DELETE) | Governance audit immutability |
| `fraud_rule_audit_log` | Application logic | Fraud rule governance trail |
| `webhook_events` | Application logic | Payment provider webhook log |
| `billing_events` (Sprint 18) | SQLite trigger | Event stream immutability |
| `admin_audit_log` | Application logic | Admin action trail |

## Derivation Rules

| Derived Value | Source | Computation |
|---------------|--------|-------------|
| Account balance | `credit_ledger` | `SUM(amount_micro) WHERE account_id AND pool_id` |
| Settled balance | `referrer_earnings` | `SUM(amount_micro) WHERE settled_at IS NOT NULL AND clawback_reason IS NULL` |
| Pending balance | `referrer_earnings` | `SUM(amount_micro) WHERE settled_at IS NULL` |
| Withdrawable balance | Settlement + Escrow | `settled_balance - SUM(payout_requests WHERE status IN ('pending', 'approved', 'processing'))` |
| Active revenue split | `revenue_rules` | `WHERE status = 'active' LIMIT 1` |
| Active fraud weights | `fraud_rules` | `WHERE status = 'active' LIMIT 1` |
| KYC level | `credit_accounts.kyc_level` | Direct read |
| Cumulative payouts | `payout_requests` | `SUM(amount_micro) WHERE status = 'completed'` |

## Event Stream Relationship (Sprint 18)

During the dual-write phase:
- Existing tables remain the **primary** authority
- `billing_events` is a **derived** append-only log
- Events are emitted within the same transaction as the primary write
- Temporal queries can reconstruct state from events (proof of concept)
- Future: events become primary, tables become projections (CQRS)

## Cross-System Boundaries

| Boundary | Protocol | Authority |
|----------|----------|-----------|
| Billing API responses | REST/JSON | Serialized from SQLite (convert timestamps to ISO 8601) |
| Webhook ingestion | IPN/HTTP POST | Verified via HMAC, stored in `webhook_events` |
| Admin API | REST/JSON + JWT | Audit logged in `admin_audit_log` |
| Creator Dashboard | REST/JSON + Auth | Read-only derivations from SQLite |
