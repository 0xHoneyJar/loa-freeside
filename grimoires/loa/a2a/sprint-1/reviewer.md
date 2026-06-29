# Implementation Report — Order System, Sprint 1 (thin order spine)

**Branch**: `cycle/shadow-audit-runtime-ordering` · **Cycle**: shadow-audit-runtime-ordering ·
traces to `grimoires/loa/sprint.md` (Sprint 1), `grimoires/loa/sdd.md` (§3–§9, §13), `grimoires/loa/prd.md`.
**Run**: autonomous `/run sprint-1`. **Domain (ADR-007)**: `platform` + `shared` only — no firewall crossing.

## Executive Summary

Sprint 1 is the M-10 honest thin cut: the smallest thing that fulfills one order end-to-end with the
two correctness must-haves baked in (idempotency H-3, outbox H-4). S1-T1 (`@freeside/ordering-protocol`,
shared) shipped previously (commit `267c2122`). This run built **S1-T2..T6** as the new
`@freeside/ordering-service` (`packages/services/ordering/`, platform): durable order-state store with a
CAS state machine, transactional outbox, config-backed capability resolver behind a PORT, the audit ACL,
the thin orchestrator, and the intake HTTP edge (POST + polling GET).

**Gate**: `tsc --noEmit` clean · **30 tests pass** (5 files) · S1-T1 protocol guard still green (11 tests).

## AC Verification

Each acceptance criterion is quoted verbatim from `grimoires/loa/sprint.md`, with status + file:line evidence.

### S1-T2 — durable order-state store + state machine + idempotency (H-3)
> "test: the same `placed` delivered twice runs the audit **once** (dedupe by `order_id`)"

**✓ Met.** Idempotency is a compare-and-swap on `placed→routing`
(`src/store.ts:140-156` `transition` CAS; `src/order-state.ts:21-41` legal transitions). Proven:
`src/__tests__/orchestrator.test.ts:118-126` ("the same placed delivered twice runs the audit ONCE")
asserts `audit.calls === 1` after two `process()` calls. CAS-miss path:
`src/__tests__/store.test.ts:55-67`. State machine: `src/__tests__/order-state.test.ts` (8 cases).

### S1-T3 — order-intake POST /v1/orders
> "test: valid order → 200 `{order_id}` + persisted `placed`; invalid input → 400; no event on validation failure"

**✓ Met.** `src/intake.ts:38-86` (`POST /v1/orders`): envelope + preset `inputSchema` validation →
`store.placeOrder` (persist `placed` + enqueue `placed.v1`). Proven:
`src/__tests__/intake.test.ts:26-43` (200 + persisted placed + outbox event),
`:45-54` (unknown product → 400 + no event), `:56-66` (bad inputs → 400 + no event).

### S1-T4 — config-backed capability resolver behind PORT (B-1/B-2)
> "test: resolver returns the configured endpoints; `routing.v1` truthfully labels config-resolution; PORT interface documented for the `loa where` swap"

**✓ Met.** PORT + impl: `src/resolver.ts:18-58` (`CapabilityResolver` interface; `ConfigCapabilityResolver`
returns `source:'config'`, fails closed). `loa where` swap documented at `src/resolver.ts:9-16`.
Proven: `src/__tests__/resolver.test.ts:13-29` (configured endpoints + `source==='config'` + fail-closed).
`routing.v1` carries the resolved buildings with `source:'config'`:
`src/orchestrator.ts:80-95`, asserted in the lifecycle-order test `orchestrator.test.ts:62-69`.

### S1-T5 — OrderNatsConsumer thin orchestrator + outbox settle (H-4)
> "test: `order(access-risk-audit)` → `fulfilled` with `AuditOutput` aggregate; kill-after-persist-before-publish → terminal event still publishes from stored state on restart"

**✓ Met** (orchestrator core) / **⏸ [ACCEPTED-DEFERRED]** (NATS runtime mount).
Orchestrator: `src/orchestrator.ts:60-191` (`process` resolve→routing→ACL→audit→producing→settle).
- *fulfilled with AuditOutput*: `orchestrator.test.ts:42-70` (state `fulfilled`, `output` surfaced,
  `result_ref`, ACL maps a real `AuditRequest` — not theater).
- *kill-before-publish → restart publishes terminal*: `orchestrator.test.ts:160-178` (H-4): `process()`
  persists `fulfilled` + enqueues to the durable outbox; a fresh `publishOutbox` drains the terminal event.
  Outbox semantics: `src/lifecycle-publisher.ts:30-44`, `src/store.ts:158-176`.

The `extends BaseNatsConsumer` runtime shell + worker bootstrap is the **deploy step** (M-10) — see the
NOTES.md Decision Log. The orchestrator already exposes a `ProcessResult` (`src/orchestrator.ts:34-38`)
structurally identical to `apps/worker/src/consumers/BaseNatsConsumer.ts:58-62`, so the shell is a
one-line `processMessage → process()` delegation.

### S1-T6 — polling status GET /v1/orders/:id (M-9)
> "test: returns order state + `result_ref`/aggregate; 404 on unknown id"

**✓ Met.** `src/intake.ts:88-106` (`GET /v1/orders/:id` → state + `result_ref` + `output`; 404 unknown).
Proven: `src/__tests__/intake.test.ts:70-83` (known id → state) and `:85-88` (unknown → 404).

### Sprint 1 done-definition
> "internal POST /v1/orders {product:'access-risk-audit', chain, contract, date} → signed lifecycle events on durable JetStream → GET /v1/orders/:id returns fulfilled + the anon AuditOutput aggregate. Idempotent, outbox-durable, in-process, config-resolved."

**⚠ Partial — by design (M-10).** Place → lifecycle events on the durable outbox → polling GET →
`fulfilled` + anon aggregate (`includeRecords:false`) all met and tested. *Signing* of lifecycle events
and the JetStream/worker runtime mount are explicitly sequenced after the first useful order (SDD §13
M-10); the `LifecyclePublisher` PORT is the swap seam. Tracked in NOTES.md Decision Log — not a gap.

## Tasks Completed

| Task | Files | Approach |
|------|-------|----------|
| S1-T2 | `src/order-state.ts`, `src/store.ts`, `src/digest.ts` | Pure state machine; `OrderStore` PORT + `InMemoryOrderStore` (CAS transitions, transactional outbox); deterministic digests |
| S1-T3 | `src/intake.ts` | Hono `POST /v1/orders` — envelope + preset-input validation → atomic persist + outbox enqueue |
| S1-T4 | `src/resolver.ts` | `CapabilityResolver` PORT + `ConfigCapabilityResolver` (`source:'config'`, fail-closed) |
| S1-T5 | `src/orchestrator.ts`, `src/audit-acl.ts`, `src/declared-local-audit-adapter.ts`, `src/lifecycle-publisher.ts` | Thin resumable saga; audit ACL (anti-corruption layer); B-2 declared local adapter; outbox publisher |
| S1-T6 | `src/intake.ts` | Hono `GET /v1/orders/:id` — state + result aggregate; 404 |

Package scaffold: `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts` (barrel), `bin/http.ts`
(intake composition root). 20 git-tracked files (node_modules/dist/tsbuildinfo gitignored).

## Technical Highlights

- **Idempotency = CAS, not a dedupe table.** The first `placed→routing` compare-and-swap wins; redelivery of
  a terminal order acks (H-3), a mid-flight order resumes (`runAudit` is pure → safe re-run). Settle is
  exactly-once via the store CAS.
- **Outbox (H-4), no dual-write.** State change + the event it produces are one atomic step
  (`transition({event})`); terminal events publish from durable stored state. `markPublished` runs only
  after a successful publish → at-least-once on crash, consumers dedupe by `(order_id, subject)`.
- **EVANS bounded contexts honored.** `@freeside/ordering-protocol` never imports the audit's `OrderSchema`
  (S1-T1 guard still green). The generic order meets the sealed audit `Order` in exactly one place —
  `buildAuditRequest` (`src/audit-acl.ts`) — which validates through the audit's `OrderSchema` (fail-closed)
  and maps the operated community from config (`OperatedCommunityRegistry`), fabricating nothing.
- **Single ACL swap point (EULER/SDD §8).** The orchestrator depends only on `AuditPort`; the in-process
  `DeclaredLocalAuditAdapter` and a future HTTP adapter both satisfy it — module→service is one swap.
- **Honest routing (B-2).** Routing events label `source:'config'`; nothing claims agent-navigation it
  didn't perform. The `loa where` backend swaps behind the same resolver PORT (S3-T2).
- **Refusal handling (M-8).** Non-retryable audit refusals settle `failed.v1` with a SANITIZED reason
  (audit's raw cause never leaks to the public topic); retryable refusals NAK (no terminal settle).

## Testing Summary

| File | Cases | Covers |
|------|-------|--------|
| `order-state.test.ts` | 7 | transitions, terminal, illegal-pair guard |
| `store.test.ts` | 8 | placeOrder idempotency, CAS win/miss, atomic outbox, appendEvent, markPublished |
| `resolver.test.ts` | 3 | configured resolve, `source:'config'`, fail-closed |
| `intake.test.ts` | 6 | POST 200/400 (+no-event), GET found/404 |
| `orchestrator.test.ts` | 6 | placed→fulfilled, idempotency, fail-closed, refusal (sanitized + retryable), H-4 durability |

Run: `pnpm --dir packages/services/ordering test` (30 pass) · `pnpm --dir packages/services/ordering typecheck` (clean).

## Known Limitations (all tracked in NOTES.md Decision Log)

- In-memory store backend (Postgres adapter behind the same PORT is the deploy step).
- Lifecycle-event signing deferred (M-10) — PORT in place.
- NATS consumer runtime mount + concrete audit `AuditDeps` deferred (deploy/M-10).
- `order.lifecycle.*` subjects not yet in the `nats-routing.json` SoT (network-scoped fast-follow).
- `order_id` is `randomUUID` (ULID is a drop-in upgrade).

## Verification Steps (reviewer)

```bash
cd packages/services/ordering
pnpm install            # file: workspace deps (no root pnpm-workspace.yaml)
pnpm typecheck          # tsc --noEmit — clean
pnpm test               # vitest — 30 pass
# regression: S1-T1 guard
pnpm --dir ../../protocol/ordering test   # 11 pass (EVANS guard intact)
```
