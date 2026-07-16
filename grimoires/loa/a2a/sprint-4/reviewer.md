# Sprint 4 — Public Interaction Transport (implementation report)

**Traces:** PRD G-7 / FR-11 · SDD §2.7 · sprint.md Sprint 4 (S4-T1..T3) · bead `arrakis-up74v`
**Branch:** `feat/public-gate-leak-lifecycle` (stacked draft PR #470 → `feat/shadow-audit-mvp`)

## Executive Summary

Closed the missing public interaction seam. Before this sprint, `AttentionKindSchema` admitted
`enhance_intent` + `feedback` and the `gate_leak_attention.kind` CHECK already listed both, but **no route
ever emitted them** — the router's local `attention()` helper accepted only the four automatic lifecycle
kinds, and the sole public reaction transport (`POST /v1/audit/reaction`) hard-codes `mode: 'dogfood-full'`
and binds via `getRun` (the internal dogfood store). `CtaInteractionSchema` was defined-but-unused.

The fix is a single new route, `POST /v1/access-risk/:runId/interaction`, that lets a login-less caller
holding the run's `run_id` + `journey_token` capability record a bounded `feedback` (reaction enum) or
`enhance_intent` (CTA-target enum) demand signal. Subject and `public-gate-leak` mode are derived from the
durable run, never the caller. **No EventStore port, schema, or SQL migration change** — every durable
primitive pre-existed.

## AC Verification

### S4-T1 — route + contract + attention widening
> "Add `POST /v1/access-risk/:runId/interaction` with a `.strict()` discriminated-union body
> (`feedback`→`ReactionSchema`, `enhance_intent`→`CtaInteractionSchema`) + `journey_token`. Widen the
> router's local `attention()` helper to the full `AttentionKind`. Test: valid `feedback` → 200, a durable
> `gate_leak_attention` row `kind=feedback` bound to the run's subject + a `public-gate-leak` `RunEvent`
> carrying `reaction`; valid `enhance_intent` → `kind=enhance_intent` + `cta_interaction`."

**✓ Met.**
- `InteractionBodySchema` (strict discriminated union): `packages/services/shadow-audit/src/http/audit-router.ts:308`; route `POST /v1/access-risk/:runId/interaction`: `:1077-1124`.
- `attention()` helper widened to `AttentionKind`, returns `{ created }`: `audit-router.ts:469`.
- Test (feedback → durable attention row bound to subject + `public-gate-leak` RunEvent with `reaction`):
  `packages/services/shadow-audit/src/__tests__/audit-router.test.ts:708`.
- Test (enhance_intent → `kind=enhance_intent` + `cta_interaction`): `audit-router.test.ts:736`.

### S4-T2 — capability + fail-closed
> "Capability + fail-closed: reject missing/malformed body (400), unknown/non-public `run_id` (404),
> mismatched `journey_token` (404, no oracle), expired run outside the window (404). Test: one known-bad
> regression input per rejection; a dogfood-only `run_id` 404s here (non-public fail-closed)."

**✓ Met.**
- 400 on malformed/unknown-discriminant: `audit-router.ts:1082-1083`; 404 on unknown/non-public run
  (via `getPublicGateLeakJourney`): `:1090-1091`; 404 on token mismatch (no oracle): `:1094-1096`; 404 on
  expired window (`isRunWithinWindow`): `:1098-1100`.
- Tests (one known-bad input per rejection incl. a real dogfood run_id → 404): `audit-router.test.ts:786`.
- Test (expired run outside 24h window → 404): `audit-router.test.ts:824`.

### S4-T3 — privacy + retry + Postgres round-trip + dogfood untouched
> "Privacy + retry: body `.strict()` rejects wallet/email/IP/free-text/role/holding/`subject`/`placed_by`
> (known-bad payload); retry of the same `(journey_token, kind)` is idempotent (200 `deduplicated:true`, no
> second attention row, no second `RunEvent`); the value row is written only on first-seen. Postgres
> round-trip test: `appendAttention(kind=feedback)` persists + re-reads through the real adapter (PGlite),
> not the in-memory double. Confirm `/v1/audit/reaction` + `/contact` behavior unchanged."

**✓ Met.**
- `.strict()` arms reject smuggled `wallet` / caller-supplied `subject`: known-bad inputs in
  `audit-router.test.ts:793-799`.
- Idempotent retry (200 `deduplicated:true`, no second attention row, no second value RunEvent, first value
  wins): route logic `audit-router.ts:1106-1122`; test `audit-router.test.ts:758`.
- Value row written only on first-seen (gated on attention `created`): `audit-router.ts:1108-1121`.
- Postgres real-SQL round-trip (feedback + enhance_intent persist through PGlite; kind CHECK admits both;
  row re-read bound to subject): `packages/services/shadow-audit/src/__tests__/event-store-postgres.test.ts:247`.
- Dogfood reaction unchanged (still `mode: 'dogfood-full'`): route untouched at `audit-router.ts:1229`;
  regression test `audit-router.test.ts:839`.

## Weakest-link proof

Per the mandate, a 200 is not the claim. The 200-path test reads the durable store back and asserts the
written event is a `feedback` (or `enhance_intent`) attention event with `subject_chain_id`/
`subject_contract_address` taken from the registered run and `journey_token` equal to the capability, plus a
`public-gate-leak` (never `dogfood-full`) `RunEvent` carrying the bounded value. The Postgres test proves the
same kinds survive real SQL. See `audit-router.test.ts:708` + `event-store-postgres.test.ts:247`.

## Testing Summary

| Suite | Result |
|---|---|
| shadow-audit service (`pnpm test`) | 337 passed, 1 skipped (was 330) — +6 router interaction + +1 Postgres |
| shadow-audit protocol | 90 passed |
| ordering service | 202 passed |
| ordering protocol | 26 passed |
| **Total** | **655 passed, 1 skipped** |
| Typecheck (all four packages) | pass |

Run: `cd packages/services/shadow-audit && pnpm typecheck && pnpm test`.

## Known limitations / scope held

- No frontend/BFF, payment/x402, credits, CRM, member-graph, or Effect-TS (Non-Goals §5 intact).
- The bounded VALUE row (reaction/cta_interaction) is best-effort: written only on first-seen attention, so
  a crash between the attention write and the value write leaves the demand signal (the important half)
  durable and drops only the secondary value — deliberate ordering, documented at `audit-router.ts:1105-1108`.
- Deployment + base-branch gaps are unchanged by this sprint (see PR body).
