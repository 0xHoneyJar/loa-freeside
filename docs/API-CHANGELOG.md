# API Changelog

<!-- cite: loa-freeside:docs/api/stable-endpoints.json -->

This file tracks breaking changes, deprecations, and additions to **Tier 1 Stable** endpoints.
For the full route index, see [API-REFERENCE.md](API-REFERENCE.md).

## Format

Each entry follows:

```
## [7.50.0] — 2026-07-01 — Run Mode: Community onboarding kitchen (K0-K2)


Implements kitchen fulfillment sprints K0–K2 for `community-onboarding` orders in ordering-service.

| Sprint | Deliverable |
|--------|-------------|

### Added

- **kitchen K0-K2**: Postgres store, GitHub issue enqueue, reprobe worker
- **ordering-service**: fire-and-forget ORDER_OPS_WEBHOOK_URL on community-onboarding place
- **ordering-service**: Railway deploy slice for internal community-onboarding demo
- **platform/ordering**: community-onboarding preset + triage orchestrator
- **shared/eligibility**: S1-403 — sealed EligibilityRule + EligibilityVerdict noun
- **platform/ordering**: S4 — signed order (H-5) + intake auth (H-6) + private ops channel (M-8)
- **platform/ordering**: S3 — loa-where resolver + trust-rooted resolution (H-7)
- **platform/ordering**: S2 — order-tracking frontend (form + live tracking demo)
- **platform/ordering**: S1-T2..T6 — thin order spine (intake + orchestrator + outbox)
- **shared/ordering-protocol**: S1-T1 — order envelope + lifecycle + preset schemas
- **shadow-audit**: shareable migration-delta export (CSV+JSON) — the viral artifact (wedge T3)
- **shadow-audit**: consume diffShadow — the migration-delta Comparison View into the audit output (wedge keystone)
- **shadow-audit**: ownership projection runtime — the live wire (DRAFT, shadow-then-cutover)
- **shadow-audit**: ownership.changed subscriber handler — events FLOW into the spine
- **shadow-audit**: event-fed ownership projection + ProjectionOwnershipSource — the L3→L2 rung
- **shadow-audit**: AccessDecisionPort — the L2-composition lens (pilot, reforged on the WHO×WHAT ladder)
- **shadow-audit**: S2-T1/T2/T3/T5 — the real chain ownership adapter + deployable server entry
- **shadow-audit**: S2-T1/T4 — deployment composition root + the missing real local adapters

### Fixed

- **ordering-service**: install pnpm via npm in Docker (corepack sig flake)
- **ordering-service**: root railway.toml for Dockerfile deploy from monorepo
- **shadow-audit**: commit dangling diffShadow keystone — discrepancy.ts was untracked
- **shadow-audit**: confirmation-FAGAN round 2 — close NEW-2 type hole + HIGH-2 residual + NEW-1 honesty
- **shadow-audit**: address FAGAN review of the wedge (HIGH-1/2, MEDIUM-1/2, LOW-1)
- **shadow-audit**: methodology travels with the AUTHED delta only — keep the anon response byte-stable
- **shadow-audit**: cutover gate fails CLOSED on erc1155 — the projection cannot model per-token erc1155
- **shadow-audit**: address FAGAN review of the keystone beads — the model-independent fixes
- **shadow-audit**: address FAGAN review of a17c0b44 — correct the unification overclaim
- **shadow-audit**: address the bridgebuilder review + ground the deploy config against live truth
- **shadow-audit**: GET /v1/audit serves the protocol AuditOutput — unbreak the dashboard seam
- **shadow-audit**: address the FAGAN review — money-path + privacy + config-coherence
- **operator-dash**: validate beacon SHAPE not just status (close the masked-200 false positive)

_Source: PR #396_


## [YYYY-MM-DD] — Summary

### Added / Changed / Deprecated / Removed
- Endpoint: description of change
- Migration: what consumers should do
- Deprecation window: N cycles (if applicable)
```

---

## [2026-02-19] — Initial Stable Surface

### Added
- `GET /api/agents/health` — Agent gateway health check
- `GET /.well-known/jwks.json` — JWKS for JWT verification
- `POST /api/agents/invoke` — Synchronous agent invocation
- `POST /api/agents/stream` — SSE streaming agent invocation
- `GET /api/agents/models` — List available model aliases
- `GET /api/agents/budget` — Budget status (admin only)
- `POST /api/verify/:sessionId` — Wallet signature verification

These 7 endpoints constitute the initial Tier 1 stable surface.
