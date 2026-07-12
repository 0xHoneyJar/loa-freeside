# Sprint 1 Implementation Report — ordering-service capabilities (PR-A, platform/ordering)

> Cycle: fulfillment-surface · Branch: `feature/fulfillment-s1-platform` (worktree `.worktrees/fulfillment-surface`) · Beads: `arrakis-fulfillment-surface-7xor.1–.7` (all closed) · Supersedes the stale prior-cycle report (archived under `_archive-prior-cycle-20260622`).

## Executive Summary

Sprint 1 gives the ordering service everything an agent-driven CLI needs: on-demand fresh probes (`POST /v1/orders/:id/reprobe` with load bounds and honest failure semantics), server-derived audit evidence + actor identity on advance, fail-closed write routes in deployed environments, one canonical public projection, and unknown-preset support. **100/100 tests green** (80 pre-existing + 20 new), `tsc --noEmit` clean, protocol package 15/15 green. Zero network-domain paths touched.

## AC Verification

### S1-T0 (closed before implementation)
> "NOTES.md entry with observed healthz/order responses, the pinned fixture ID + expected state, and the URL truth that S2-T5 will consume."

✓ Met — `grimoires/loa/NOTES.md` §"S1-T0 CLOSED": URL `https://ordering-service-production.up.railway.app` (healthz verbatim), fixture `6ddc06f5-0c6f-42b8-8377-768a4c2a302e` pinned at `producing` with full ingredient map. Correction recorded: `kitchen-api-production-1937` was DEPLOY.md's *sonar* example — no DEPLOY.md fix needed.

### S1-T1 — probe_meta shape + single write path
> "unit tests — worker probe run populates probe_meta; legacy record without probe_meta reads clean; monotonic merge preserved (`mergeProbedIngredients` untouched or extended with tests)."

✓ Met —
- Shape typed in protocol: `packages/protocol/ordering/src/kitchen.ts:39-50` (`IngredientProbeMeta`, `OrderProbeMeta`).
- Single write path: `probeMetaEntries()` helper `packages/services/ordering/src/community-onboarding-orchestrator.ts:74-86`, called from `process()` placed branch (`:117-120`) and producing branch (piggybacked on merge patches, `:170-175`) and from `reprobe()` (`:385-388`). `ReProbeWorker` drives `process()` → same path.
- Worker-path populate: `advance-evidence.test.ts:88-93` (process seeds `probe_meta`, source `interval`).
- Legacy read: `store-postgres.ts:41` (`row.probe_meta ?? undefined`); in-memory absent-field is naturally undefined; migration `migrations/002_probe_meta.sql` is additive `ADD COLUMN IF NOT EXISTS`; runner extended `store-postgres.ts:69-74`.
- Monotonic merge: signature widened to `Partial<>` only (`community-onboarding-orchestrator.ts:50-53`), skip-undefined guard added; all 5 pre-existing merge tests still green (e.g. `community-onboarding-orchestrator.test.ts` "does not downgrade in_progress to pending on reprobe").

### S1-T2 — POST /v1/orders/:id/reprobe
> "vitest suite — fresh probe path, timeout→ambiguous, cooldown 429, global-timeout with hung-probe fake, CAS-race retry, 409 on terminal order."

✓ Met — route `intake.ts:209-243`; orchestrator method `community-onboarding-orchestrator.ts:327-412`; bounds at `:39-42` (cooldown 10s, per-probe timeout 10s, fan-out 3). Tests in `reprobe-endpoint.test.ts`:
- fresh path → "fresh probe: returns fresh statuses…" (status merged + probe_meta source `reprobe`)
- probe error → ambiguous, meta NOT updated ("probe error: reports ambiguous…")
- hung probes → timeout-ambiguous + wall-clock bound ("hung probes classify as timeout-ambiguous…")
- cooldown → orchestrator-level ("cooldown: a second reprobe within 10s…") + HTTP 429 with `retry_after_unix` (route test)
- concurrent-advance race → monotonic survival ("concurrent advance survives the reprobe merge") — see Known Limitations (1) for the CAS-retry design note
- terminal → `order already terminal` (orchestrator) + 409 mapping (route `intake.ts:232`); 401/404 also covered.

### S1-T3 — advance server-derived evidence + actor
> "unit tests — audit entry carries token_label regardless of body; evidence == server probe_meta snapshot at advance time; a subsequent reprobe leaves the prior audit entry byte-identical; never-probed → `evidence: null`; legacy body (dashboard shape) still valid; caller_note stored verbatim but never substitutes for token_label."

✓ Met — evidence copy `community-onboarding-orchestrator.ts:288-298` (`evidence: priorMeta ? { ...priorMeta } : null`, `token_label: opts?.tokenLabel`); schema `kitchen.ts:62-72`; route threading `intake.ts:196`; `caller_note` bound ≤120 (`intake.ts:68`). All six assertions in `advance-evidence.test.ts` (5 tests, incl. `structuredClone` byte-identity check after a later reprobe).

### S1-T4 — fail-closed boot + D8 auth matrix
> "integration test matrix — all 4 D8 rows; deployed-tokenless boot leaves POSTs 404 and healthz shows `disabled_no_token` (FR-10b, G-4). Read-route posture explicit [IMP-007]: … one test asserts reads stay open in deployed-tokenless mode."

✓ Met — posture helper `composition.ts:78-116` (matrix documented in-code); boot wiring `bin/http.ts:19-43` (writes unmounted + loud `console.error` + healthz `write_routes`); healthz moved into intake for testability (`intake.ts:162-168`). Tests: `write-route-posture.test.ts` — all 4 matrix rows (+ whitespace-marker edge), POSTs 404 when unmounted, healthz `disabled_no_token`, reads-stay-open (IMP-007).

### S1-T5 — canonical projection
> "projection stability test — all three routes deep-equal on shared fields for the same record; snapshot test pins the public shape; the exported type exists in ordering-protocol."

✓ Met — `PublicOrderSchema` in `packages/protocol/ordering/src/kitchen.ts:78-99` (strict); `toPublicOrder()` `packages/services/ordering/src/projection.ts:12-29`; used by GET (`intake.ts:159`), advance (`intake.ts:204`), reprobe (`intake.ts:242`). `projection.test.ts`: strict-parse pins the shape on all three responses (reprobe = projection + `probes` report), deep-equal on shared fields, redaction assertions (`placed_by`/`inputs`/`inputs_digest`/`created_at_unix`/`output_digest` never appear). Strict zod parse is the shape pin (stronger than a snapshot: unknown keys fail).

### S1-T6 — unknown-preset 400 + rotation runbook
> "400-body test; runbook exists and names both consumers (dashboard, CLI)."

✓ Met — pre-check `intake.ts:87-103` (error + `available_presets`); test `projection.test.ts` §"unknown-preset support". Runbook `packages/services/ordering/docs/token-rotation-runbook.md` names freeside-dashboard (Vercel env) + freeside-cli (shell env), documents issue→update→revoke + `SERVICE_TOKEN_LABEL` audit-era practice + fail-closed degradation.

### Sprint 1 verification
> "full ordering-service vitest suite green; commit scope `platform/ordering`; PR contains zero `packages/freeside-cli` or `packages/freeside-registry` paths — checked mechanically [IMP-005]: run `tools/check-beacon-domain.sh`…"

✓ Met — 100/100 green; commit scoped `platform/ordering`; domain check run pre-commit (see Verification Steps).

## Tasks Completed (files)

| File | Change |
|------|--------|
| `packages/protocol/ordering/src/kitchen.ts` | NEW — canonical kitchen contract: probe meta, audit entry (+`token_label`/`caller_note`/`evidence`), `PublicOrderSchema` |
| `packages/protocol/ordering/src/index.ts` | export kitchen contract |
| `packages/services/ordering/src/kitchen-types.ts` | now re-exports from protocol (imports unchanged everywhere) |
| `packages/services/ordering/src/store.ts` | `probe_meta` on record + patch |
| `packages/services/ordering/src/store-postgres.ts` | probe_meta column mapping in row/transition/patch; migration runner iterates both files |
| `packages/services/ordering/migrations/002_probe_meta.sql` | NEW — additive column |
| `packages/services/ordering/src/community-onboarding-orchestrator.ts` | probeMetaEntries + probe_meta writes; advance evidence/actor; `reprobe()` with bounds; `probeWithTimeout` |
| `packages/services/ordering/src/intake.ts` | reprobe route, caller_note, projection everywhere, healthz-in-app, unknown-preset 400 |
| `packages/services/ordering/src/projection.ts` | NEW — `toPublicOrder` |
| `packages/services/ordering/src/composition.ts` | `resolveWriteRoutePosture` + env helpers |
| `packages/services/ordering/bin/http.ts` | fail-closed mount + posture healthz + loud log |
| `packages/services/ordering/docs/token-rotation-runbook.md` | NEW — NFR-8c |
| 4 new test files | `reprobe-endpoint`, `advance-evidence`, `write-route-posture`, `projection` (20 tests) |

## Technical Highlights

- **Ambiguity never overwrites truth**: a failed/timed-out probe reports `ambiguous` in the response but leaves `probe_meta` and the ingredient merge untouched — recorded truth only moves on fresh success.
- **Evidence chain is unfakeable**: nothing evidence-shaped is client-supplied; audit `evidence` is a value copy of the server's own `probe_meta` (the SDD-gate design revision, operator-approved).
- **Fail-closed degrades to read-only**: a botched token rotation in production disables writes, never opens them; `/healthz` says so.
- **`.strict()` projection parse as the contract test** — leaked internals or accidental shape growth fail CI, not review.

## Testing Summary

`pnpm test` in `packages/services/ordering` → 21 files, 100 tests, green. `pnpm typecheck` clean. Protocol package: 15/15 + typecheck clean. New coverage: reprobe (8 tests), evidence/actor (5), posture/fail-closed (6), projection/preset (2 — with multi-assertion bodies). Timeout test uses `REPROBE_PER_PROBE_TIMEOUT_MS` env + fresh module import; cooldown/clock tests use injected `now()`.

## Known Limitations

1. **Reprobe merge race handling** (SDD IMP-003 drift, deliberate): SDD D1 said "a reprobe whose merge loses CAS retries the merge once." Implemented instead as **re-read-fresh-after-probes + monotonic merge** — the merge is computed against the freshest record after the slow probe I/O completes, and the monotonic merge cannot downgrade a concurrent `complete` (proven by the race test). A literal conditional-patch CAS would need a new store-port method for equal harm-bound; marked in code. `// loa:shortcut` ceiling: if concurrent writers multiply beyond operator+worker, add conditional patch to the port.
2. **Reprobe cooldown is per-instance in-memory** (`community-onboarding-orchestrator.ts:302-304`) — correct for the single-instance Railway deploy; move to the store if the service scales out (marked in code).
3. **Per-probe timeout is race-based, no AbortController propagation** — `TriagePorts` has no signal param; a timed-out probe's fetch may linger until its own network timeout (marked at `probeWithTimeout`). Observable behavior (timeout→ambiguous, wall-clock bound) is tested.
4. **`process()` (interval path) has no probe timeouts** — pre-existing behavior, untouched (surgical-changes rule). The on-demand path is the bounded one.

## Verification Steps

```bash
cd .worktrees/fulfillment-surface/packages/services/ordering
pnpm typecheck && pnpm test          # 100/100
cd ../../protocol/ordering && pnpm test  # 15/15
cd ../../.. && bash tools/check-beacon-domain.sh  # domain firewall (pre-commit mirror)
git diff --stat cycle/fulfillment-surface..feature/fulfillment-s1-platform -- packages/freeside-cli packages/freeside-registry  # MUST be empty
```

## Feedback Addressed (iteration 2, 2026-07-01)

All three review items from `engineer-feedback.md` fixed; suite now **101/101**, typecheck clean.

1. **DEPLOY.md contract drift** → routes table gains `reprobe` (cooldown/429/ambiguous/409 semantics) + `caller_note` + healthz `write_routes`; env table gains `SERVICE_TOKEN_LABEL` + fail-closed note on `SERVICE_TOKEN`; `RUN_MIGRATIONS` now says `migrations/*.sql`; new fail-closed paragraph points at the rotation runbook. (`packages/services/ordering/DEPLOY.md:8-24,33`)
2. **Prototype-chain `in`** → `Object.hasOwn(PRESETS, product)` (`intake.ts:95`); new test: `product: "constructor"` receives the friendly 400 + `available_presets` (`projection.test.ts:139-149`).
3. **Timed-out worlds probe leaking `world_slug`** → `probeWithTimeout` is generic (`<T>`), worlds branch races `probeDetail` itself and reads `world_slug` from the raced success value only — a late-resolving timed-out probe can no longer contribute data (`community-onboarding-orchestrator.ts:103-121` + worlds branch comment "review finding #3").

Non-blocking items acknowledged: timing-safe compare logged as tech debt (pre-existing, both routes, follow-up); `PublicOrderSchema.state` looseness accepted for v0.3.
