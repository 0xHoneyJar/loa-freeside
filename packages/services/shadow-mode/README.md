# @freeside/shadow-mode-service

The **shadow-mode-api** member-graph ledger — a read-only, append-only building that
composes a community's member graph from upstream events and serves projections
(member graph, unresolved list, divergences, access-audit report). It mutates **nothing**
upstream (Discord / identity / Sonar / billing / scoring).

See `grimoires/loa/{prd,sdd,sprint}.md` for the full design. Reference contract:
`@freeside/shadow-mode-protocol`.

## Run

```bash
pnpm install
pnpm test         # 31 tests (AC-1..AC-10 + FAGAN regressions)
pnpm typecheck
```

## Architecture

`POST /events → IProducerPolicy (fail-closed) → ShadowLedger.ingest → ILedgerStore`
(append-only observations) → reduced into subjects / aliases / edges / divergences →
read projections + the access-audit report (which reuses `@freeside/shadow-audit-protocol`).

## Operational ceilings (MVP — read before deploying)

This is a **fixture-driven MVP**. The following are deliberate, tracked fast-follows
(Bridgebuilder review, PR #316) — NOT yet production-ready:

| Ceiling | Status | Upgrade trigger |
|---|---|---|
| **Trust boundary** — the envelope `source` is self-asserted; `StaticProducerPolicy` is a *structural* gate only | `loa:shortcut` in `static-producer-policy.ts` | First live emitter — wire producer-auth via the identity-api svc-JWT substrate (`SvcJwtPolicy`) |
| **Persistence** — `InMemoryLedgerStore` is unbounded and single-process; `sql/0001_shadow_mode.sql` is a seam with **no adapter and no PG test** | seam only | Build `PostgresLedgerStore` against the SQL + a contract test BEFORE pointing any live producer at the ledger. Do NOT back a live producer with the in-memory adapter. |
| **First consumer** — the access-audit binding is demonstrated by a fixture (AC-8), not a wired swap of the live audit-service | fixture | Wire the existing `shadow-audit` service to read ledger projections — until then the spine is itself deployed-but-unconsumed |
| **Projections** — `getMemberGraph` / `getUnresolved` return the full set (no pagination) | unbounded read | Add pagination before any community larger than a demo fixture |
| **Identity conflict** — an identity-vs-identity link conflict is recorded as an `identity_conflict_*` edge + leaves both subjects, but is not surfaced in the projection summary and the shared alias re-points to the last writer | flag-only | Surface conflicts in the projection (a flag / unresolved entry) and freeze the contested alias rather than re-pointing it |
| **Transactionality** — in-memory `withTransaction` has no rollback on a projection throw | `loa:shortcut` in `in-memory-store.ts` | The Postgres adapter MUST provide real transactional rollback |

The contract (`@freeside/shadow-mode-protocol`), the reducer logic, and the fail-closed
authz / read-only / idempotency guarantees ARE production-shaped and tested; the items
above are the wiring + scale work between MVP and a deployed building.
