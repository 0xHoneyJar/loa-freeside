# Implementation Report — Public Gate-Leak Sprint 4: public interaction transport + lifecycle-wide capability contract

**Traces:** PRD G-7 / FR-11 · SDD §2.7 · sprint.md Sprint 4 (S4-T1..T3) · bead `arrakis-up74v`
**Branch:** `feat/public-gate-leak-lifecycle` (stacked draft PR #470 → `feat/shadow-audit-mvp`)
**Review path:** Loa code review (Claude) → Loa security audit (Claude Opus) → live Codex adversarial pass (fagan)

---

## Executive Summary

Closed the missing public interaction seam AND the lifecycle-wide capability contract gap surfaced by the
Codex adversarial pass.

**Interaction seam:** `AttentionKindSchema` admitted `enhance_intent` + `feedback` and the
`gate_leak_attention.kind` CHECK already listed both, but **no route ever emitted them** — the router's
local `attention()` helper accepted only the four automatic lifecycle kinds, and the sole public reaction
transport (`POST /v1/audit/reaction`) hard-codes `mode: 'dogfood-full'` and binds via `getRun`. The fix is
`POST /v1/access-risk/:runId/interaction`.

**Lifecycle-wide capability contract (FAGAN HIGH-1 + HIGH-2, both closed here):** the original HIGH-1 fix
stripped `journey_token` from the unauthenticated poll response. The Codex adversarial review correctly
rejected this as incomplete — stripping from the poll while the resume path could still re-disclose the
token, and while the poll remained unauthenticated, left the "(run_id + journey_token) = two-factor" claim
structurally hollow. The binding correction requires ALL three public sub-routes (poll, resume, interaction)
to gate on the journey_token credential.

---

## Capability contract (canonical statement)

`run_id` is the **public address** — embeddable in a URL, QR code, or client log without privilege
escalation. `journey_token` is the **authentication credential** — server-issued at submit, required by
every public sub-route.

| Sub-route | Authentication required | Missing/mismatch response |
|---|---|---|
| `GET /v1/access-risk/:runId` (poll) | `?journey_token=` query param | 404 (no oracle) |
| `POST /v1/access-risk/:runId/resume` | `journey_token` in strict body | 404 (no oracle) |
| `POST /v1/access-risk/:runId/interaction` | `journey_token` in strict body | 404 (no oracle) |

On a successful poll, the full `PublicJourneyProjection` (including `journey_token`) is returned so the
caller can re-confirm their held credential. On a successful resume or interaction, the durable run's
`journey_token` is the single source of truth — it is never replaced by a caller-supplied value.

The Ordering orchestrator holds the full `PublicJourneyProjection` (output: `{ journey }`) in the order
store and passes `priorJourney.data.journey_token` to `GateLeakPort.resume`. The `HttpGateLeakPort`
forwards it as `journey_token` in the body. The dashboard BFF never exposes the token to the end-user.

---

## AC Verification

### S4-T1 — route + contract + attention widening
> "Add `POST /v1/access-risk/:runId/interaction` with a `.strict()` discriminated-union body
> (`feedback`→`ReactionSchema`, `enhance_intent`→`CtaInteractionSchema`) + `journey_token`. Widen the
> router's local `attention()` helper to the full `AttentionKind`. Test: valid `feedback` → 200, a durable
> `gate_leak_attention` row `kind=feedback` bound to the run's subject + a `public-gate-leak` `RunEvent`
> carrying `reaction`; valid `enhance_intent` → `kind=enhance_intent` + `cta_interaction`."

**✓ Met.**
- `InteractionBodySchema` (strict discriminated union): `audit-router.ts:308`; route: `audit-router.ts:1079–1130`.
- `attention()` helper widened to `AttentionKind`, returns `{ created }`: `audit-router.ts:469`.
- Test (feedback → durable attention row bound to subject + `public-gate-leak` RunEvent):
  `audit-router.test.ts` (describe block "POST /v1/access-risk/:runId/interaction — public demand signal").
- Test (enhance_intent → `kind=enhance_intent` + `cta_interaction`): same describe block.

### S4-T2 — capability + fail-closed
> "Capability + fail-closed: reject missing/malformed body (400), unknown/non-public `run_id` (404),
> mismatched `journey_token` (404, no oracle), expired run outside the window (404)."

**✓ Met.** All three public sub-routes (poll, resume, interaction) gate on `journey_token` with 404 on
mismatch. The lifecycle-wide capability tests (describe block "lifecycle-wide capability contract") prove:
- Bare `run_id` poll (no token) → 404
- Mismatched token poll → 404
- Matching token poll → 200 with full projection including `journey_token`
- Resume without `journey_token` → 400 (schema)
- Resume with mismatched token → 404

### S4-T3 — privacy + retry + Postgres round-trip + dogfood untouched

**✓ Met.** `.strict()` rejects `wallet`/`placed_by`/`subject`; reflection guard (bad enum not echoed in 400);
idempotent retry (`deduplicated:true`, no second row, first value wins); Postgres round-trip
(`event-store-postgres.test.ts`); dogfood reaction mode untouched.

---

## FAGAN Adversarial Review Findings (live Codex pass)

### HIGH-1 — Capability collapse: lifecycle-wide authentication gap (CLOSED)

**Finding:** The originally proposed fix stripped `journey_token` from the unauthenticated GET poll response.
Codex rejected this as incomplete: the resume route still accepted only `access_started_at` (no
authentication at all), so a caller with a `run_id` could resume a journey without the token and observe
its new state. The "(run_id + journey_token) = two-factor capability" claim was structurally hollow while
any sub-route remained unauthenticated.

**Fix applied (lifecycle-wide):**
1. `GET /v1/access-risk/:runId` now requires `?journey_token=` as a query parameter; missing/mismatch → 404.
   On success it returns the full `PublicJourneyProjection` including `journey_token`.
2. `POST /v1/access-risk/:runId/resume` `ResumeGateLeakBodySchema` now requires `journey_token`; token
   validated against the durable run before any state read, compute, or mutation.
3. `POST /v1/access-risk/:runId/interaction` was already correct (token required); unchanged.
4. `GateLeakPort.resume(runId, accessStartedAt, journeyToken)` interface updated; `HttpGateLeakPort.resume`
   forwards the token in the body; orchestrator passes `priorJourney.data.journey_token`.

**Regression tests (audit-router.test.ts):**
- "lifecycle-wide capability contract — all sub-routes gate on journey_token" describe block:
  bare run_id poll → 404; mismatched poll → 404; matching poll → 200 with token; resume without token → 400; resume with mismatched token → 404.
- Existing interaction capability tests unchanged (already correct).
- Resume happy-path test updated to include `journey_token`.
- Poll after resume test updated to include `?journey_token=`.

**Regression tests (ordering):**
- `gate-leak-ports.test.ts`: resume body assertion — `journey_token` forwarded.
- `gate-leak-orchestrator.test.ts`: resume call asserts non-empty `journeyToken` passed.

### HIGH-2 — Route dead-on-arrival in apiKey posture (CLOSED)

**Finding:** `server.ts` exemption regex omitted `/interaction`; with `apiKey` configured, the middleware
401'd the route before the handler ran.

**Fix (kept and extended):** Regex covers all three sub-routes: `/^\/v1\/access-risk\/[^/]+(?:\/resume|\/interaction)?$/`.

**Regression test updated:** `server.test.ts` — "exempts all public gate-leak sub-routes from the X-API-Key
gate" — now covers all three sub-routes (poll, resume, interaction), each proved to reach the handler
(returning 404, not 401).

### MEDIUM-3 — Issues echo on public 400 (CLOSED)

`zod` `.issues` stripped from the public 400 response; reflection guard test retained.

### MEDIUM-4 — Non-transactional interaction write (deferred — bead `arrakis-ispp6`)

Best-effort two-step (attention first, RunEvent second). Demand signal (the durable half) survives a crash;
only the bounded value row is lost. Cannot be recovered by retry (attention row already exists).
Bead `arrakis-ispp6` now tracks only this item — the lifecycle-wide token secrecy follow-up is CLOSED.

---

## Testing Summary

| Suite | Result |
|---|---|
| shadow-audit service (`pnpm test`) | **343 passed**, 1 skipped |
| shadow-audit protocol | 90 passed |
| ordering service | **202 passed** |
| ordering protocol | 26 passed |
| **Total** | **661 passed, 1 skipped** |
| Typecheck (shadow-audit + ordering) | pass |

---

## Files Changed

| File | Change |
|---|---|
| `packages/services/shadow-audit/src/http/audit-router.ts` | New `/interaction` route; `attention()` widened; `ResumeGateLeakBodySchema` + `journey_token`; resume token gate; GET poll now requires `?journey_token` |
| `packages/services/shadow-audit/src/server.ts` | Exemption regex extended to include `/interaction` (HIGH-2) |
| `packages/services/ordering/src/gate-leak-ports.ts` | `GateLeakPort.resume` + `HttpGateLeakPort.resume` signature: add `journeyToken: string` |
| `packages/services/ordering/src/gate-leak-orchestrator.ts` | Pass `priorJourney.data.journey_token` to `gateLeak.resume` |
| `packages/services/shadow-audit/src/__tests__/audit-router.test.ts` | Lifecycle-wide capability tests; resume + poll tests updated; HIGH-1 regressions |
| `packages/services/shadow-audit/src/__tests__/server.test.ts` | HIGH-2 regression expanded to all three sub-routes |
| `packages/services/ordering/src/__tests__/gate-leak-ports.test.ts` | Resume body assertion added |
| `packages/services/ordering/src/__tests__/gate-leak-orchestrator.test.ts` | Resume signature + journey_token forwarding asserted |
| `grimoires/loa/sdd.md` | §2.7 updated with lifecycle-wide capability contract |
| `grimoires/loa/a2a/sprint-4/reviewer.md` | Restored: original Order System Sprint 4 report |
| `grimoires/loa/a2a/public-gate-leak-sprint-4/reviewer.md` | This file — Public Interaction Transport + FAGAN fixes |

---

## Known Limitations / Scope Held

- Not deployed. Stacked draft PR #470 → `feat/shadow-audit-mvp` → `main`. No auto-merge.
- Deferred: MEDIUM-4 non-transactional interaction write (bead `arrakis-ispp6`).
- Deferred: downstream consumers (dashboard BFF, orders projection) not built this sprint (Non-Goals §5).
