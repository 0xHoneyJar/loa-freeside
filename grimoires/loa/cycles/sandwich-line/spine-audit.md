# Sandwich-line spine audit — Sprints 1+2 (the priority-1 build, G-1 core)

Scope: `packages/{protocol,services}/shadow-mode`. The member-graph ledger evolved into a
hash-chained, durable, producer-authenticated spine (SDD FR-6a/6b).

| Check | Result |
|---|---|
| Tests | 62 unit + 7 Postgres-integration green (vs postgres:16); tsc --noEmit clean |
| Hash chain | JCS(RFC 8785) + sha256; tamper/replay/version/seq-gap tests; freeze-on-tamper + verify-gated operator clear |
| Durability | PostgresLedgerStore: advisory-xact-lock append (no fork/gap), lazy genesis in-txn, boot verify gate, idempotent freeze |
| Producer-auth | AppendGrant capability UNFORGEABLE (module-private symbol mint, no index export — FAGAN critical closed); JwtProducerPolicy ES256 pinned (none/HS* rejected), exp-iat≤1h, community-bound; grant-less append does not typecheck |
| Secrets | none in diff; CHAIN_ADMIN_TOKEN via env not argv; svc-JWT keys via JWKS |
| Review | FAGAN cross-model council: S1 (2 iters, 6 fixed), S2 (3 iters, critical forgery closed + 12 fixed); 3 documented FAGAN-accepts |
| Named ceiling | pg withTransaction not atomic across append+projection → store MUST NOT back a live producer this cycle (gated; upgrade trigger recorded) |
| C-PROC-001 | code written inside /run sprint-plan (simstim Phase 7) |

VERDICT: APPROVED for the spine build. G-1 metric ("consumer 0→≥1") is NOT yet met — that is
Sprint 3's differential consumer (6c) + the L-lanes (deploy audit, sandwich, demo). Per the R-1
slice rule, S1+S2 landing = "spine durable, unconsumed" — stated honestly.
