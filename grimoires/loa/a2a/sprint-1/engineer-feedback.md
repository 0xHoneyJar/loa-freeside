# Sprint 1 Review — CHANGES REQUIRED (one small iteration)

Reviewed the full diff (`cycle/fulfillment-surface..feature/fulfillment-s1-platform`, 21 files) against sprint.md Sprint 1 ACs, the SDD, and the implementation report. AC Verification section is present, complete, and evidence-checked — all claims verified in code. Tests 100/100, typecheck clean. Cross-model adversarial review skipped: `flatline_protocol.code_review.enabled: false` (config) — recommend `/fagan` at PR stage per operator doctrine.

Three issues to fix before approval — all cheap, none architectural:

## Critical Issues (must fix)

### 1. DOC: DEPLOY.md is now stale on the API surface it documents
`packages/services/ordering/DEPLOY.md:8-35` documents the route table, auth, and env vars — the dashboard team's contract reference. Sprint 1 added/changed all three and DEPLOY.md was not touched:
- Missing route: `POST /v1/orders/:id/reprobe` (Bearer, 429 cooldown semantics, per-ingredient `ambiguous` results)
- Missing env: `SERVICE_TOKEN_LABEL` (audit actor identity)
- Missing healthz field: `write_routes: open_dev|token|disabled_no_token` + the fail-closed behavior (an operator debugging a "missing" advance route in prod will look here first)
- `advance-ingredient` body: optional `caller_note` (<=120)
**Fix**: extend the route/env tables + one fail-closed paragraph. (Documentation checklist: blocking.)

### 2. BUG(low): prototype-chain `in` weakens the unknown-preset path
`packages/services/ordering/src/intake.ts:91` — `raw.product in PRESETS` returns `true` for `"constructor"`/`"toString"` etc. (verified: `'constructor' in PRESETS === true`), so those magic strings skip the friendly 400+`available_presets` and fall to the generic zod envelope error. Not exploitable (zod still rejects; `resolvePreset` only ever sees enum-validated values) but the FR-1 error contract silently degrades.
**Fix**: `!Object.hasOwn(PRESETS, raw.product)`. Add a one-line test with `product: "constructor"` expecting `available_presets` in the body.

### 3. BUG(medium-low): a timed-out worlds probe can still contribute `world_slug`
`packages/services/ordering/src/community-onboarding-orchestrator.ts` (reprobe, worlds branch) — `worldSlug` is mutated inside the probed closure. If the probe exceeds the 10s race and is reported `ambiguous`, the underlying promise keeps running; if it resolves before the merge block reads `worldSlug` (likely in multi-batch runs), the reprobe both REPORTS the probe as ambiguous AND consumes its `world_slug` — inconsistent evidence semantics (the audit trail says "ambiguous" while fulfillment was built from that probe's data).
**Fix**: return `{status, world_slug}` through `probeWithTimeout`'s success value instead of mutating the closure variable; discard data from timed-out probes entirely.

## Adversarial Analysis

### Concerns Identified
1. DEPLOY.md contract drift (above, #1)
2. Prototype-chain `in` (above, #2)
3. Timed-out probe data leak into fulfillment (above, #3)
4. (non-blocking) `auth !== Bearer-token` string compare is not timing-safe — **pre-existing pattern** on the advance route before this sprint; surgical-changes rule says don't fix here. Log as tech debt: `crypto.timingSafeEqual` for both routes in a follow-up.
5. (non-blocking) `PublicOrderSchema.state` is `z.string()` not the OrderState enum — loose but acceptable for v0.3; CLI mirrors will pin it.

### Assumptions Challenged
- **Assumption**: single-instance deploy makes the in-memory cooldown map correct. **Risk if wrong**: N instances = Nx the intended reprobe rate against buildings. **Verdict**: acknowledged in the report + `loa:shortcut` marker with upgrade trigger — acceptable, keep.

### Alternatives Not Considered
- **Alternative**: conditional-patch CAS port method for the reprobe merge (SDD D1 literal). **Tradeoff**: real CAS vs +1 port method on two stores. **Verdict**: current re-read+monotonic-merge is justified — the race test proves the harm bound, and the report documents the drift honestly. No change requested; SDD gets a conformance note at audit.

## Karpathy / Complexity / Fast-Gate
- Simplicity: no speculative abstractions; `probeWithTimeout` and `probeMetaEntries` each have >=2 call sites. `reprobe()` is ~85 lines — borderline but linear; acceptable.
- Surgical: diff is scoped; kitchen-types move is justified by the D7 contract-home requirement and kept import-compatible.
- Fast-gate parity: `tsc --noEmit` + vitest run and green; package configures no formatter (none skipped).
- `net: -0 lines possible` beyond the three fixes. Lean.

## Next Steps
Fix 1-3, extend the two tests, re-run suite, update the report's Feedback Addressed section. Everything else is approve-ready.
