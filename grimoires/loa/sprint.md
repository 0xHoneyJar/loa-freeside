# Sprint Plan — Shadow Mode Ledger (`shadow-mode-api`) · Sprint 1 (MVP)

> **Cycle**: shadow-mode-ledger · traces to `grimoires/loa/sdd.md` + `prd.md` (v1).
> **Branch**: `feat/shadow-mode-ledger` (worktree off origin/main). **Scope**: `shared/shadow-mode`. **Beads label**: `domain:shared`.
> **Goal**: a runnable in-memory shadow member-graph ledger passing AC-1..AC-10, reusing shadow-audit schemas, with the trust boundary fail-closed.
> **Out of scope** (SDD §13): live NATS, dashboard UI, coexistence ScyllaDB removal, score bands, live Postgres + svc-JWT wiring (seams only).

## Approach

Test-first. Two packages mirroring `shadow-audit`: `packages/protocol/shadow-mode`
(`@freeside/shadow-mode-protocol`) and `packages/services/shadow-mode`
(`@freeside/shadow-mode-service`). The handoff reference impl (`shadow-ledger.ts`,
`fixtures.ts`, `server.ts`) is the executable contract; harden it behind ports + the
fail-closed producer policy + atomic idempotent append.

## Sprint 1 tasks (schema-first; each verifies against an SDD/PRD acceptance criterion)

| ID | Task | Verification (AC / SDD) | Deps |
|----|------|--------------------------|------|
| T1.1 | `protocol/shadow-mode` scaffold: package.json (mirror shadow-audit deps), tsconfig, vitest; `envelope.ts` (`EventEnvelope<shadow.event.v1>` + `ShadowEvent` union) + `events.ts` (8 payload schemas incl. `identity.link.revoked.v1`), all Zod `.strict()`. | Schemas parse valid fixtures; reject extra keys (`.strict()` test). SDD §2/§3/§11 | — |
| T1.2 | Domain types: `subject.ts` (ShadowSubject + `merge_provenance`), `edge.ts` (ShadowEdge/ShadowObservation/TruthStatus), `divergence.ts`, `report.ts` (re-export shadow-audit AuditOutput vocab), `common.ts` (SourceKind/WalletRef/alias helpers). | Types compile; alias helpers deterministic (lowercased wallet). SDD §3 | T1.1 |
| T1.3 | `topics.ts`: 8 `buildTopic()` helpers (hounfour 3-segment) — pure additive export. | All 8 names validate the segment regex; unit test asserts exact subjects. SDD §11 | T1.1 |
| T1.4 | `service/shadow-mode` scaffold + `ports/ledger-store.ts` (`appendObservationIfAbsent`→bool, `withTransaction`, queries — NO mutation method) + `adapters/in-memory-store.ts` (atomic check-and-set). | **AC-1** idempotent: same `event_id` twice → 1 observation, 2nd `duplicate`. SDD §4/§5.1 | T1.2 |
| T1.5 | `shadow-ledger.ts` reducer: `ingest` (atomic, transactional) + apply handlers (discord/sonar/incumbent/freeside/config) + edges idempotent per `(event_id,edge_kind)`. | **AC-1**, **AC-2** (discord-only stays unresolved), **AC-3** (wallet-only stays wallet_only). SDD §5.0–5.2 | T1.4 |
| T1.6 | Conservative subject merge + provenance + revoke-downgrade: identity.*.linked merges aliases/roles, re-points edges, records `merge_provenance`; `identity.link.revoked.v1` downgrades `verified→observed_only` + flags re-split. | **AC-4** (verified merge), **AC-10** (provenance + revoke accepted+downgrade). SDD §5.3 | T1.5 |
| T1.7 | Divergence classification: `match`/`freeside_higher`/`incumbent_higher`/`mismatch` via `role_rank`, with human reason. | **AC-5**. SDD §5.4 | T1.5 |
| T1.8 | `ports/producer-policy.ts` + `adapters/static-producer-policy.ts` (FAIL-CLOSED: source×name×community) + `adapters/allow-all-policy.ts` (test double, guarded outside NODE_ENV=test). | **AC-9** (non-identity source emitting identity.*.linked → reject; cross-community → reject). SDD §8 | T1.2 |
| T1.9 | `access-audit.ts`: `createAccessAuditReport` reusing `@freeside/shadow-audit-protocol` AuditOutput/AccessDecisionRecord vocab; mandatory caveats; AccessDecisionRecord emitted only for EVM-wallet subjects with evidence. | **AC-6** (summary counts + caveats, shaped to AuditOutput). SDD §6 | T1.6, T1.7 |
| T1.10 | `http/shadow-router.ts` (Hono, mirror audit-router): `POST /events` (verifyProducer→ingest, 202/401), `GET …/member-graph`, `…/unresolved`, `…/shadow/divergences`, `POST …/reports/access-audit` (201), `GET /health`. Zod-validate envelope (400). | Router integration test: each endpoint returns expected shape; 401 on policy reject. SDD §10 | T1.8, T1.9 |
| T1.11 | Read-only boundary: port-surface test (no mutation method) **+** dependency-boundary import test (no mutation-capable upstream client imported). | **AC-7**. SDD §7 | T1.10 |
| T1.12 | First-consumer binding: fixture deriving the shadow-audit aggregate (`holder_turnover`/`sold_lapsed`/`stale_access`) from ledger projections. | **AC-8**. SDD §6.2 | T1.9 |
| T1.13 | `sql/0001_shadow_mode.sql` (Postgres seam from handoff schema.sql, ownership-scoped) — present, not wired. `fixtures.ts` + `index.ts`/`server.ts` (port of handoff) + e2e smoke (ingest demo → report). | Build green; smoke test ingests demoEvents → member-graph + report. SDD §9/§12 | T1.10 |

## Acceptance gate (sprint done)

- `pnpm -C packages/protocol/shadow-mode test` and `pnpm -C packages/services/shadow-mode test` green.
- `typecheck` passes both packages.
- AC-1..AC-10 each have ≥1 runnable test (table above).
- Trust boundary fail-closed by default; read-only enforced by dependency-boundary test.
- Surgical diff: only `packages/{protocol,services}/shadow-mode` + 8 topics in `packages/events`. Commit scope `shared/shadow-mode`.

## Risk / sequencing notes

- T1.5/T1.6 are the logic core (idempotency + conservative merge) — most test-dense; do not collapse.
- The handoff `shadow-ledger.ts` is the reference; port it but harden idempotency to atomic-append and policy to fail-closed (flatline SDD findings).
- Postgres + svc-JWT are seams this sprint (no live infra), per SDD §13.

## Trust-boundary honesty (flatline sprint SKP-001, sev 920 — load-bearing)

The envelope `source` field is **self-asserted** by the caller. So `StaticProducerPolicy`
checking "only `identity_api` may emit `identity.*.linked.v1`" is a **structural** gate
(rejects malformed source×name×community combos) — it is **NOT yet a real trust boundary**,
because nothing authenticates that the caller IS identity-api. The real boundary requires
**producer authentication** (svc-JWT binding `source`↔verified caller, SDD §8 `SvcJwtPolicy`),
which is deferred (no live emitters this cycle). Implementation MUST:
- Mark the static policy in-code: `// loa:shortcut: source is self-asserted; structural gate
  only. Real boundary needs producer-auth (svc-JWT). Upgrade trigger: first live emitter / any
  deployed (non-test) POST /events.`
- NOT advertise the endpoint as authenticated. AC-9 proves the **structural** rejection only.
- Keep `AllowAllPolicy` guarded so it cannot be the default outside `NODE_ENV=test`.

## Concurrency model (flatline sprint SKP-002/003)

- In-memory adapter: the check-and-set inside `appendObservationIfAbsent` is **synchronous**
  (no `await` between read and write) → atomic under JS's single-threaded event loop; the
  reducer `apply` runs synchronously after a fresh insert, so ingest is all-or-throw (no
  partial-await window). Single-writer by construction.
- Postgres adapter: idempotency rests on the `event_id` PRIMARY KEY + `INSERT … ON CONFLICT
  DO NOTHING RETURNING`; `withTransaction` wraps observation append + projection updates in one
  DB transaction (rollback on handler throw). Documented; not wired this cycle.

## Appendix A — Acceptance criteria (inlined so the sprint is self-contained; flatline SKP-004)

Source of truth: `prd.md` §6 + `sdd.md` §12. Verbatim:

- **AC-1** Replaying the same `event_id` twice is idempotent (one observation, 2nd → `duplicate`).
- **AC-2** A Discord-only member stays `attribution_quality != verified` until identity-api verifies.
- **AC-3** A wallet-only chain actor stays `wallet_only` until identity-api verifies.
- **AC-4** A verified `identity.wallet.linked`/`identity.account.linked` merges the alias into the `identity_user` conservatively (aliases+roles unioned, edges re-pointed).
- **AC-5** Divergence classified `match`/`freeside_higher`/`incumbent_higher`/`mismatch` with a human reason, honoring `role_rank`.
- **AC-6** Access-audit report has evidence/summary counts + caveats, reusing the shadow-audit `AuditOutput` shape.
- **AC-7** No mutation of Discord/upstream — port-surface test **+** dependency-boundary import test.
- **AC-8** The shadow-audit aggregate is derivable from ledger projections (first-consumer fixture).
- **AC-9** Ingest **structurally** rejects unauthorized `source`×`name` (non-identity emitting `identity.*.linked`) and cross-community `community_id` (negative tests). (Not a producer-auth boundary — see Trust-boundary honesty.)
- **AC-10** A merge records provenance; `identity.link.revoked.v1` is accepted, recorded, and downgrades the subject `verified → observed_only`.
