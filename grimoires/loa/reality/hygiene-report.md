---
source_type: ai-autogen
use_label: usable
read_state: validated
as_of: 2026-07-17
generated_by: /ride Phase 2b — hub thinning hygiene
git_sha: b589f728
scope: hub-thinning
---

# Hygiene Report — Hub Thinning Scope

> CODE IS TRUTH. Items below are **flags for HUMAN DECISION**. Do not treat any row as an authorized delete or cutover.

## Summary

| ID | Cluster | Severity | Status |
|----|---------|----------|--------|
| H-1 | Nested `themes/sietch/src/packages` duplication | HIGH | OPEN — HUMAN DECISION |
| H-2 | Dual NOWPayments + x402 trees | HIGH | OPEN — HUMAN DECISION |
| H-3 | Dual / triple ledgers (SQLite · PG lots · ledger-api) | CRITICAL | OPEN — HUMAN DECISION |
| H-4 | Unmounted BYOK proxy + admin HTTP | MEDIUM | OPEN — HUMAN DECISION |
| H-5 | shadow-audit building under `packages/services` | MEDIUM | OPEN — HUMAN DECISION |
| H-6 | Deadweight `node_modules` inflation | LOW–MED | OPEN — HUMAN DECISION |

---

## H-1 — Nested sietch packages duplication

**Evidence**
- `themes/sietch/src/packages/` ≈ **217** `.ts` files · **~71.4k LOC** (structure.md).
- Nested tree mirrors platform layout: `adapters/{billing,payment,chain,storage,…}`, `core/{ports,billing,protocol}`, `jobs/`, `infrastructure/`.
- Root `packages/adapters/` has `agent|chain|sonar|score|storage|…` — **no** `billing/`.
- Product billing lives nested (`CreditLedgerAdapter`, Paddle, NOWPayments, x402) while platform economic helpers live in `packages/services/*`.

**Risk**
- Agents and humans import the wrong tree; dual implementations diverge; extraction maps double-count.

**HUMAN DECISION (not done)**
- [ ] After billing cutover: delete nested billing tree only, or whole nested `src/packages`?
- [ ] Promote any nested-only ports into root `packages/core` first?
- [ ] Keep coexistence/chain nested copies until worlds/mediums extract?

---

## H-2 — Dual NOWPayments + x402

| Rail | Sietch (product) | `packages/*` (platform) |
|------|------------------|-------------------------|
| NOWPayments | `NOWPaymentsAdapter` + `/api/crypto` + `CryptoWebhookService` — **MOUNTED** | `nowpayments-handler.ts` + `packages/routes/webhooks.routes.ts` — **UNMOUNTED** |
| x402 | `X402PaymentAdapter` + `/api/settlement` — **MOUNTED**; `creditBillingRouter` unmounted | `x402-settlement.ts` + `packages/routes/x402.routes.ts` — **UNMOUNTED** |

**Evidence:** hub-thinning-verdicts A-9; services.md dual-home map.

**HUMAN DECISION (not done)**
- [ ] Single mounted surface: keep sietch mounts and delete/archive unmounted `packages/routes`?
- [ ] Or wire platform routes and retire sietch crypto/settlement?
- [ ] Wire `setCreditLedgerHook` into live `CryptoWebhookService`, or drop the hook as dead?

---

## H-3 — Dual / triple ledgers

| Authority | Location | Role today |
|-----------|----------|------------|
| **SQLite CreditLedger** | `themes/sietch/.../CreditLedgerAdapter.ts` | Live product balance SoT (`better-sqlite3`; header: SQLite sole SoT) |
| **PG credit-lots** | `packages/services/credit-lot-service.ts` | Append-only lots; mint/debit ready; not sole live product authority |
| **ledger-api** | external repo; registry `runtime_state: scaffolded` | Extracted scaffold 2026-06-03; **no deployment_url**; health 404; write path deferred (NG-1) |

**Also:** Redis BudgetManager (Spice Gate) is a fourth spend meter — intentional platform KEEP, not a product ledger.

**HUMAN DECISION (not done)**
- [ ] Which writer is canonical for product credits after cutover?
- [ ] Graduate ledger-api (goal-3) before or after billing-api thin v1?
- [ ] Never auto-delete monolith SQLite/PG copies (goal-3 / beads warn).

---

## H-4 — Unmounted BYOK proxy + admin

**Evidence (A-5)**
- Custody + SSRF proxy code exist: `byok-manager.ts`, `byok-proxy-handler.ts`.
- Admin routes file exists: `themes/sietch/src/api/routes/admin/byok.routes.ts` — **not mounted** in `server.ts` / `admin.routes.ts`.
- `BYOKProxyHandler` — **no** Express/Hono mount under themes/apps (unit tests + adapter only).

**HUMAN DECISION (not done)**
- [ ] Mount proxy + admin for production BYOK completeness?
- [ ] Or document as intentionally deferred and strip “production-complete” claims from docs?

---

## H-5 — shadow-audit under platform paths

**Evidence (A-10)**
- Deployable building: `bin/http.ts`, Dockerfile, `railway.toml`, `DEPLOY.md`.
- Package name `@freeside/shadow-audit-service`.
- Lives under `packages/services/shadow-audit` (platform path per ADR-007 firewall).

**HUMAN DECISION (not done)**
- [ ] Extract to own cell/repo when sequenced?
- [ ] Relabel path / domain so CI firewall matches building semantics?

---

## H-6 — Deadweight node_modules inflation

| Tree | Approx size |
|------|-------------|
| repo-root `node_modules` | ~84M |
| `themes/sietch/node_modules` | ~434M |
| `packages/services/shadow-audit/node_modules` | ~848M |

**Note:** Nested sietch `src/packages` does **not** carry its own `node_modules` (source duplication only). Shadow-audit’s local install dominates disk.

**HUMAN DECISION (not done)**
- [ ] Deduplicate shadow-audit deps via workspace hoist?
- [ ] Add to `.gitignore` / CI cache policy if not already?
- [ ] Purge unused sietch deps after billing/mediums peel?

---

## Explicit non-actions this ride

- No deletes performed.
- No route mounts changed.
- No registry or ADR edits.
- Flags only — operator sequences cleanup in Thin Hub cycle.
