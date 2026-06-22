# Sprint Plan — Credit-Ledger Edge · Sprint 1 (CLE-1, thin)

> **Spec (the activated PRD/SDD):** `grimoires/loa/context/2026-06-21-billing-ledger-edge-design-brief.md`.
> The on-disk `prd.md`/`sdd.md` are the PRIOR S1 (extraction-migration / Shadow Access Audit) — IGNORE them
> for this sprint; this `sprint.md` is self-contained. Prior S1 sprint preserved at `sprint-prev-s1-extraction.md`.
> Date: 2026-06-21. Domain: `platform`.

## Goal
Give loa-finn a one-ledger billing finalize path **without** a split-brain second ledger and **without**
touching payment code (NG-1) — by exposing an internal finalize endpoint in the monolith over the SINGLE
credit ledger. `billing-api` (the edge) keeps the internet-facing S2S-JWT + claim-sourcing; the monolith
internal endpoint trusts the VPC-internal caller via the existing `requireInternalApiKey`.

## Boundary constraints (fixed)
- **One ledger** stays in the monolith (`packages/services/credit-lot-service`). C3 = `payment-entangled → defer`
  + NG-1 forbid extracting it. **Additive only — no payment-code change** (`nowpayments-handler`, `x402-settlement`).
- **Do NOT modify `debitLots`** — it is payment-shared (x402 calls it) and throws on overspend + has a
  conservation-no-op structure (finding `arrakis-m45v`). The finalize path uses a NEW additive function instead.

## ⚠ SUPERSEDED by build-phase grounding (2026-06-21) — nothing to build
The monolith ALREADY has the finn S2S finalize endpoint, fully hardened, wired to the
`ICreditLedgerService` port + `ledger.finalize` + `finalizePg`:
`themes/sietch/src/api/routes/billing-routes.ts` → `creditBillingRouter` `POST /internal/finalize`
(= `/api/internal/billing/finalize`), with S2S-JWT auth (iss=loa-finn/aud=arrakis-internal),
confused-deputy account-ownership check, identity-anchor verify, protocol-version compat.
**But `creditBillingRouter` is mounted NOWHERE** (built-but-not-wired; its ledger init is never
called at boot) → the endpoint is unreachable. That is the likely REAL "finn cure."
- CLE-1.1 (`settleActualCost`) — CLOSED redundant (`arrakis-0825`): `finalizePg`/`ledger.finalize` exist.
- CLE-1.2 (build the endpoint) — CLOSED redundant (`arrakis-x71h`): the endpoint exists.
- **Real gap → `arrakis-e20y`:** mount + wire `creditBillingRouter` (small, additive) — NOT rebuild.
  Activating it makes a money path live → OPERATOR-GATED (may be intentionally parked, mirroring billing-api).
Original (now-redundant) task text retained below for the record.

## Tasks (SUPERSEDED — see above)

### CLE-1.1 · `settleActualCost()` — additive ledger finalize (conservation + overspend) `domain:platform`
Add a new exported function to `packages/services/credit-lot-service.ts` that settles an actual cost against a
reservation. **Mirrors billing-api's CORRECTED logic** (reviewed 2026-06-21; avoids its 4 P1 blockers):
- Idempotent on `reservationId` (re-apply = no-op; balance unchanged).
- **Overspend is REPRESENTED, not thrown:** if actual cost exceeds available lots, debit what's available and
  record the shortfall as an `overspend` lot_entry — never throw `BUDGET_EXCEEDED`, never 502.
- **Conservation correct:** the `remaining -=` decrement happens ONLY inside the `if (inserted)` branch (the
  fix `arrakis-m45v` flags `debitLots` for) so an idempotent no-op never silently depletes.
- Does NOT modify `debitLots` (payments untouched).
- **AC:** unit tests prove — (a) settle within balance debits + returns the new balance; (b) re-settle same
  reservationId is a no-op (idempotent); (c) settle exceeding balance records an overspend entry + returns
  `overspent_micro > 0` (NOT a throw); (d) `spent = Σ debit-class entries INCLUDING overspend`. Test-first.

### CLE-1.2 · `POST /internal/billing/finalize` — the S2S edge target `domain:platform`
Add to `themes/sietch/src/api/routes/internal.routes.ts`, gated by the existing `requireInternalApiKey`
(VPC-internal; `billing-api` is the S2S-JWT-terminating edge that forwards verified values here).
- Body: `{ reservationId, communityId, actualCostMicro }` (forwarded by billing-api from finn's verified JWT claims).
- Wraps `settleActualCost` in a community-scoped transaction (`withCommunityScope`).
- Idempotent: `200` finalized / `409` idempotent (a prior settle with the same reservationId) — finn treats both as success.
- Errors collapse to a single sanitized response (no detail leak), per the repo's error-sanitizer.
- **AC:** integration tests prove — `200` on first finalize, `409` on idempotent replay, `401` without the
  internal key, overspend returns `200` (not 502), and conservation holds across replays.

## Out of scope (explicit)
Modifying `debitLots` or any payment code; extracting the ledger; the `billing-api` repo reshape (cross-repo
follow-on via `/coord`); the resource ledger (`ledger-api`); any deploy. One capability, one endpoint, one
additive ledger function.

## Dependencies
CLE-1.2 depends on CLE-1.1.
