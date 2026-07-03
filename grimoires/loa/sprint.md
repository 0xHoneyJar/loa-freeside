# Sprint Plan — The Sandwich Line

> Cycle: sandwich-line (simstim-20260702-923f3fca). Implements sdd.md (flatline-integrated
> `897589ad`). Previous plan archived: sprint.prev-2026-07-02-consumption-truth.md.
> Sprints 1–3 are `/run sprint-plan`-executable (in-repo, `shared/shadow-mode` +
> `platform/ordering` + `shared/shadow-audit`). L-lanes are agent/operator/cross-repo work
> outside run-mode (markers as before). Sequencing (NOT beads blocked-by): S1 → S2 → S3;
> L-1 → L-2 → L-3 serialized; L-4, L-5 parallel any time.
> R-1 slice rule: S1+S2 landing alone = "spine durable, unconsumed" — the cycle report must say
> so if S3's 6c slips.

## Sprint 1: chain + async port (spine 6a + 6b-1, `shared/shadow-mode`)

### S1-T1 — JCS canonicalization lib [SDD 6a]
`packages/protocol/shadow-mode/src/jcs.ts`: RFC 8785 canonicalization (port the approach of
`.claude/adapters/loa_cheval/jcs.py`; cross-test against published JCS vectors + 3 vectors
generated from the python impl). **AC**: vector tests green; no `JSON.stringify` ordering
assumptions anywhere in chain code.

### S1-T2 — chain link + verify (pure) [SDD 6a]
`packages/services/shadow-mode/src/chain.ts`: pure `chainLink(prev, seq, observation, version)`
→ `{prev_hash, hash}` with `hash = sha256(JCS({chain_version, chain_id, seq, prev_hash,
observation}))`; `verifyChain(iterator)` returning first-bad-seq; genesis sentinel constant
(prev_hash = 64 zeros, `chain.genesis` synthetic observation). **AC**: tamper test (one byte →
fails at that seq), replay-determinism test (fixture chain byte-exact), version-bump test.

### S1-T3 — in-memory store gains the chain [SDD 6a]
InMemoryLedgerStore appends through `chainLink` (seq assigned store-side); expose
`verifyChain()`. Freeze semantics in-memory: `chain_frozen` map honored by append. **AC**:
existing 42-test suite green + chain/freeze tests; frozen chain rejects appends until clear.

### S1-T4 — async port refactor with inventory artifact [SDD 6b-1]
FIRST produce the method+caller inventory (every `ILedgerStore` method, every call-site,
before/after signature) into `grimoires/loa/cycles/sandwich-line/port-inventory.md`; THEN flip
the port to async, update reducer/service call-sites mechanically, in-memory adapter wraps sync.
**AC**: inventory committed before the refactor commit; full suite green; zero behavior diffs
(same test assertions, awaited).

## Sprint 2: durable spine (6b-2 + 6b-3, `shared/shadow-mode`)

### S2-T1 — Postgres store + chain append [SDD 6b-2]
`0002_shadow_chain.sql` (shadow_chain + shadow_chain_state) + `PostgresLedgerStore` per the SDD
transaction spec (advisory xact lock; seq inside lock; observation+chain in one txn; duplicate
event_id → false). Tests run against a disposable pg (testcontainers or the repo's pg-test
pattern — reuse whatever `packages/services/shadow-audit`'s pg tests use; if none exists, gate
pg tests behind `PG_TEST_URL` env with a loud skip). **AC**: concurrent-append test (2 clients,
no fork/gap), duplicate-replay test, freeze-row blocks append test.

### S2-T2 — freeze/clear surface [SDD 6a freeze design]
Operator-only clear action (CLI script in the package `bin/chain-admin.ts` — authenticated by
DATABASE_URL possession + logged rationale row), recovery procedure in package README. **AC**:
clear writes cleared_by+rationale; partial verify can freeze but never clear.

### S2-T3 — AppendGrant + JwtProducerPolicy [SDD 6b-3]
Capability-gated append (WeakSet-identity `AppendGrant`, mintable by `JwtProducerPolicy.
authorize` | operator-migration factory | test factory behind test marker); JWT validation per
SDD (pinned iss/aud, exp ≤1h, skew ±60s, zod claims). `StaticProducerPolicy` retired from the
durable path. **AC**: four-case unauthorized test (no token / expired / out-of-scope / forged
grant); grant-less append does not typecheck (compile-time assertion via tsd or a type test).

## Sprint 3: consumption seams (FR-2 + 6c code, `shared/shadow-audit` + `platform/ordering`)

### S3-T1 — capability read on the audit [FR-2]
`GET /v1/collections/:chain/:contract` (open; 200 `{collection, standard}` / 404) + route-
posture test asserting the PRD security-boundary map. **AC**: in-registry/not/malformed tests.

### S3-T2 — probeShadow (ordering) [FR-2]
`shadowAuditApiUrl` config + `probeShadow` (mapLookupStatus + timeout rows) + triage delegation
(policy fallback retained until knob-retirement criteria). **AC**: mapping rows tested;
feature-dark unchanged when unset; delegation test.

### S3-T3 — FAGAN HIGH-3 value-semantics contract test [6c precondition]
Pin token-standard value semantics cross-package (the open finding): one contract test asserting
erc721 vs erc1155 holding-value semantics agree between shadow-audit's ownership sources and the
shadow-mode projection shapes. **AC**: test exists, green, referenced by 6c PR.

### S3-T4 — differential consumer + classifier [SDD 6c]
`subscription_started_at` recorded; pure classifier (`no_backfill_window` vs `true_mismatch`,
boundary cases tested); differential runner comparing sonar-replay vs projection source with
salted-hash divergence logging + ops webhook post; wiring FLAG-GATED (`SHADOW_DIFFERENTIAL_
ENABLED`, default off — turns on in L-3 once deployed against the live host). **AC**: classifier
unit tests; runner tests with fixture sources; structured log contract fields exact.

## L-lanes (NOT run-mode executable)

- **L-1 [AGENT research → OPERATOR verify]** — FR-1a registry mining: assemble
  COLLECTION_REGISTRY + provenance table (worlds manifests via gh, honeyroad, cubquests,
  belt entities, `cast call name()` verification) → operator verification pass. <8 minable →
  tooling-gap issue fires with the provenance table. Subset floor: ≥2 verified.
- **L-2 [AGENT infra + OPERATOR gates]** — FR-1 deploy: Railway service (agent, proven pattern),
  env per SDD §2 (role snapshot IN-IMAGE decision), `test:live` output quoted in runbook
  [OPERATOR authorizes], registry cell added ONLY after green. Then S3-T4's flag flips.
- **L-3 [AGENT]** — FR-3 sandwich: Vercel env (SHADOW_AUDIT_API_URL/_KEY) + redeploy; run ONE
  real audit; author + land `cycles/sandwich-line/first-audit-report.md` with the publication
  checklist (k≥5, allowlist, sign-off line = operator's). Oracle C4/C5 re-run recorded.
- **L-4 [CROSS-REPO freeside-worlds]** — FR-4 manifest durability per SDD §5 (pg-backed store,
  boot import, yaml as export); /coord PR; kill-test = redeploy survival quoted.
- **L-5 [AGENT + CROSS-REPO]** — FR-5 demo: pivot subject from CollectionStat (must pass
  score/worlds probes), full CLI E2E to `fulfilled`, evidence in `cycles/sandwich-line/
  e2e-demo.md`, KEEPER settle-check armed. Parallel: sonar #120 spike (1-day timebox, sonar-api
  via /coord; exit = fix PR or diagnosis doc).

## Lane detachment / PR readiness / fence
Same contracts as consumption-truth: detaching lanes file beads with domain labels + evidence
pointers; sprint PRs open DRAFT and flip ready on green ACs + local suite; operator merges.
Evidence ledger = `grimoires/loa/cycles/sandwich-line/` runbook files; every /coord lane PR
links its runbook section (IMP-011).

## Acceptance for the cycle
G-1 = S1+S2+S3-T4 landed AND L-2 deployed AND the differential ran ≥once live (else report says
"spine durable, unconsumed"). G-2/G-3 = L-2/L-3 evidence. G-4 = S3-T1/T2 + knob retirement or
its criteria pending honestly. G-5 = L-4 kill-test. G-6 = L-5 fulfilled evidence.
