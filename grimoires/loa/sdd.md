# Software Design Document — The Sandwich Line

> Cycle `sandwich-line` · implements prd.md (flatline-integrated `592aa170`). Grounded in code
> reads 2026-07-03 (worktree off origin/main). Previous SDD archived:
> sdd.prev-2026-07-02-consumption-truth.md.

## 1. Architecture overview

Two parallel serialized tracks + two independent lanes:

```
TRACK A (audit chain):  FR-1a mine registry → FR-1 deploy shadow-audit-api (Railway cell)
                          → FR-2 capability read + probeShadow → FR-3 dashboard env + report
TRACK B (the spine):    FR-6a chain spec → FR-6b Postgres+auth → FR-6c differential consumer
LANE W (worlds):        FR-4 manifest durability  [CROSS-REPO freeside-worlds]
LANE D (demo):          FR-5 pivot order → fulfilled   ·   sonar #120 spike [1d timebox]
```

## 2. FR-1 — deploy shadow-audit-api

Everything is built (PR #387); this is config + infra + registry:
- Railway: new project/service `shadow-audit-api`, root `packages/services/shadow-audit`
  (its Dockerfile + railway.toml exist; healthcheck `/healthz`). Runs via tsx (no build step).
- Env (all boot-throw verified in probe report): `COLLECTION_REGISTRY` (JSON, strict zod),
  `RPC_URL_<chain>` per registry chain, `OPERATED_COMMUNITIES`, `CTA_PRODUCT`/`CTA_CONVERSATION`,
  `SHADOW_AUDIT_API_KEY` (SET — dashboard sends X-API-Key), optional `AUDIT_K` (runtime floor),
  `BELT_GATEWAY_URL` default is correct, `ROLE_SNAPSHOT_PATH` optional (external-mode refused
  without it — acceptable for internal-look reports? NO: internal reports need roles → mount the
  snapshot file or ship it in-image; decide at task time from what `role-source.ts` loads).
- Gate: `pnpm -C packages/adapters test:live` against deployed config; output quoted in runbook
  (per-collection live anchors). Deploy does NOT flip user-facing anything until green.
- Registry cell: `shadow-audit-api` entry with deployment_url + honest beacon note (beacon serving
  not built — do not declare a beacon_url that 404s; note instead).

### FR-1a — registry mining (the operator-challenged task)
Sources in priority order: freeside-worlds manifests (mibera.yaml etc. via gh — local behind),
mibera-honeyroad scripts (Mibera `0x6666397dfe9a8c469bf65dc744cb1c733416c420` CONFIRMED),
cubquests/badge configs across 0xHoneyJar repos (gh search), belt-gateway entity metadata,
on-chain verification (`cast call <addr> name()` per candidate — chain truth is the tiebreak).
Output: `COLLECTION_REGISTRY` JSON + a provenance table (address → sources found) in the runbook
→ ONE operator verification pass. **Tooling-gap finding fires if <8 collections minable**: file
issue "canonical collections config belongs in a registry building" with the provenance table as
evidence. Subset rule: deploy proceeds at ≥2 verified (PRD).

## 3. FR-2 — capability read + probeShadow

- Audit side (`packages/services/shadow-audit/src/http/audit-router.ts` + server wiring): add
  `GET /v1/collections/:chain/:contract` → 200 `{collection, standard}` if the normalized pair is
  in the registry, else 404. OPEN (no auth) — returns membership + static config only, no member
  data. Route-posture test asserts the security boundary map (PRD §Security boundary).
- Ordering side (`packages/services/ordering/src/http-building-probes.ts`): `probeShadow` via the
  established sibling shape — config `shadowAuditApiUrl` (+ optional auth header, default
  `x-api-key`, unused for this open route), mapping = existing `mapLookupStatus` (200→complete,
  404→pending, else blocked) + timeout/redirect rows from the consumption-truth table.
  `kitchen-triage-ports.ts`: shadow delegates to `http.probeShadow` when `shadowAuditApiUrl`
  configured; the producerless policy path remains as fallback UNTIL the knob-retirement exit
  criteria (3 consecutive real probes in deployed logs) → then the knob + env var + DARK log are
  removed in one PR. Semantics note: "complete" here = "the audit CAN cover this collection"
  (capability), which is exactly what shadow_preview gates — the preview becomes producible.
- Tests: route (in-registry/not/malformed), probe mapping rows, delegation-with-url vs policy
  fallback, feature-dark unchanged when unset.

## 4. FR-3 — the sandwich

- Vercel env on freeside-dashboard: `SHADOW_AUDIT_API_URL` + `SHADOW_AUDIT_API_KEY` → redeploy
  (same op as the inventory re-point; client `access-audit/client.ts` is contract-parity-tested).
- The report: run ONE real audit for an operated community via the dashboard/API, then author
  `grimoires/loa/cycles/sandwich-line/first-audit-report.md` meeting the PUBLICATION GATE
  (k≥5 bucketing, field allowlist, operator sign-off line = the publication act). Landing it
  flips oracle C4/C5 (`grimoires/loa/context/audit-mvp-oracle.mjs` re-run recorded).

## 5. FR-4 — worlds manifest durability [CROSS-REPO]

Local checkout is BEHIND main — read merged PR #13 code via gh at task time. Design intent
(assumption-guarded in PRD): swap `FileManifestStore` (`packages/config-service/src/manifest/
store.ts`) for a Postgres-backed store reusing the service's existing durable ConfigStore
connection + migration pattern; the yaml write remains an optional git-artifact export, NOT the
source of truth. Kill-test: place/lookup → redeploy service → lookup still 200 (recorded in
runbook). Fallback if the pg path resists reuse: git-committed manifests via a bot PR (the other
durable option) — decided at task time, surfaced in the /coord PR description.

## 6. FR-5 — demo order (pivot subject)

Subject selection at task time: belt CollectionStat (chain 80094) top collections → candidate
must ALSO pass score/worlds probes (PRD assumption 3). Then the consumption-truth E2E runbook
procedure re-runs end-to-end (place → probes → advances-with-evidence → fulfilled), zero-spend,
same abort conditions. Evidence appended to `grimoires/loa/cycles/sandwich-line/e2e-demo.md`.
KEEPER settle-check armed: a note in the report naming the watch ("next order's contact field").
sonar #120 spike: separate lane, sonar-api repo via /coord, 1-day timebox, exit = fix PR or
diagnosis doc; NEVER blocks this track.

## 7. FR-6 — the spine (packages/{protocol,services}/shadow-mode)

### 6a — hash chain (store-layer, protocol schemas FROZEN)
The chain lives in the STORE layer so the privacy-reviewed protocol v1 schemas stay untouched:
- New table (extend `sql/0001_shadow_mode.sql` lineage with `0002_shadow_chain.sql`):
  `shadow_chain(chain_id text, seq bigint, event_id text UNIQUE FK→shadow_observations,
  prev_hash text, hash text, chain_version text, PRIMARY KEY(chain_id, seq))`.
- `hash = sha256(JCS({chain_version, chain_id, seq, prev_hash, observation}))` — JCS per the
  estate convention (RFC 8785; reuse/port the canonicalization approach of
  `.claude/adapters/loa_cheval/jcs.py` into a small TS `jcs.ts` in the protocol package with
  cross-vectors tested against known JCS test vectors; never `JSON.stringify` order-luck).
- Genesis: seq=0 sentinel event per chain (`chain.genesis` synthetic observation, prev_hash =
  64 zeros). Ordering = seq (monotonic, store-assigned under lock); timestamps are payload.
- `verifyChain(chainId, fromSeq?)`: recompute every hash; ANY mismatch → returns the first bad
  seq + emits fail-loud alarm + freezes the chain. Deterministic replay test = fixture chain
  re-verified byte-exact. Tamper test = flip one byte in a stored payload → verify fails at
  that seq.
- **Freeze/recovery design (blocker cure SKP-002):** state lives in
  `shadow_chain_state(chain_id PK, frozen_at, frozen_reason, first_bad_seq, cleared_at,
  cleared_by)`. Verification sets it ATOMICALLY in its own transaction; the append transaction
  reads it `FOR SHARE` after taking the advisory lock (frozen → append rejected with
  `chain_frozen` error, logged). Partial verification (fromSeq) can only freeze, never clear.
  CLEAR is operator-only: an authenticated admin action (CLI/route requiring the operator
  principal) that writes cleared_at/cleared_by + a mandatory rationale — the clear itself is an
  audit-trail row. Recovery procedure (documented in the package README): freeze → operator
  investigates (verify output names first_bad_seq) → either restore the payload from the
  source-of-truth producer and re-verify, or fork-ack: record rationale, re-anchor genesis at a
  new chain_id, retire the bad chain read-only. No silent repair path exists.
- In-memory store gains the same chain logic (one shared pure `chainLink()` function; stores
  only persist).

### 6b — PostgresLedgerStore + producer-auth (BLOCKING invariant)

**Merge-surface slicing (blocker cure SKP-001a, CRITICAL)** — 6b lands as THREE serialized PRs,
each independently green and reviewable, never one bundled merge:
1. *6b-1 async port refactor* (mechanical): `ILedgerStore` → async. A pre-edit task produces the
   METHOD + CALLER INVENTORY (IMP-007/014: every port method, every call-site, before/after
   signature) as the review artifact; in-memory adapter wraps sync in resolved promises;
   behavior-identical, full suite green.
2. *6b-2 PostgresLedgerStore + chain append* (durability + 6a chain in the store).
3. *6b-3 producer-auth* (JwtProducerPolicy + capability-gated append).

**Append authorization is a STORE-boundary capability (blocker cure SKP-001b, CRITICAL)** — not
a routes-only check. The durable append API takes an `AppendGrant` — an opaque object mintable
ONLY by the auth layer (`JwtProducerPolicy.authorize(...)` → grant scoped to producer_id +
sources[] + event_names[]) or by the operator-principal factory used for migration/replay
(explicitly logged `principal=operator-migration`). Enumerated callers, ALL through grants:
HTTP ingest routes, (future) NATS consumer, the in-memory→Postgres migration/replay path, and
tests (a `testGrant()` factory gated behind the package's test env marker — grep-able, never
importable from src index). A grant-less call does not typecheck; a forged plain-object grant
fails a WeakSet identity check (the estate's reflectable-symbol cure).

**JWT specifics (blocker cure SKP-004):** verify per the existing svc-JWT substrate conventions
(`packages/adapters/agent/jwt-service.ts`): pinned `iss` (the substrate issuer) + `aud =
"shadow-mode-ledger"`, `exp` required (≤1h tokens), clock skew ±60s, revocation = substrate key
rotation (kid-based), claims schema zod-validated `{producer_id: string, sources: string[],
event_names: string[]}` — unknown claim shape = reject. Keys via the substrate's existing
provisioning; never minted ad-hoc.

**Lock/transaction specifics (blocker cure SKP-003):** append = single transaction:
`SELECT pg_advisory_xact_lock(hashtext($chain_id))` → `INSERT observation ON CONFLICT DO
NOTHING` (returns inserted?) → if inserted: `seq = COALESCE((SELECT MAX(seq) FROM shadow_chain
WHERE chain_id=$1), -1) + 1` → compute hash → insert chain row. Isolation: READ COMMITTED is
sufficient — the xact-scoped advisory lock serializes writers per chain; a failed transaction
releases the lock automatically and leaves NO seq gap (seq is computed inside the lock, never
pre-allocated). Retry: caller-level single retry on lock-timeout/serialization errors, then
fail loud. Multi-client concurrent-append test asserts: no fork, no gap, one winner per seq.

**Unauthorized-producer test** included (no token / expired / out-of-scope source / forged grant
object — four cases).

### 6c — differential consumer (decision-grade)
Wire `makeProjectionOwnershipSource` (shadow-audit, built+tested, unwired) as the SHADOW side of
a differential in the deployed audit service: on each audit run, BOTH sources compute the holder
set; comparison = per-(collection, snapshot) set equality; divergence = symmetric difference
COUNTS + hashed wallet ids (never raw lists) logged + posted to the ops webhook. Parity bar for
the record: 3 consecutive parity runs on ≥2 collections (recorded in the cycle report; cutover
explicitly out of cycle). PRECONDITION task: the FAGAN HIGH-3 value-semantics contract test
(token-standard value semantics pinned cross-package) — 6c does not merge before it.
**No-backfill classifier (blocker cure SKP-006), defined:** the projection records
`subscription_started_at` per collection at subscribe time. Snapshot boundary semantics: a
differential run compares holder sets AS OF a snapshot block/time both sources can answer for.
A divergent wallet is classified `no_backfill_window` iff its most recent transfer for that
collection precedes `subscription_started_at` (the projection could not have seen it);
everything else is `true_mismatch`. The parity bar counts ONLY `true_mismatch == 0` runs; the
report always shows both counts side by side. Classifier is a pure function with its own unit
tests (transfer-before/after/at-boundary cases).

**Divergence log privacy (IMP-005):** logged wallet identifiers are salted hashes —
per-cycle salt held in service env (rotating the salt orphans old logs by design), ops-webhook
audience only, 30-day retention note in the runbook. Raw wallet lists never leave the service.

### 6d — doctrine note
`packages/protocol/shadow-mode/README.md` section "The spine thesis": all projections (Discord
permissions, rosters, audits) derive from THIS chain; each new projection ships shadow-first vs
the incumbent; hash chain = the verification root. ~20 lines, links the PRD.

## 7.5 Integrated flatline consensus (IMP items)

- **Role-source decision (IMP-002):** internal-look reports NEED roles → the role snapshot ships
  IN-IMAGE for this cycle (a checked-in, reviewed snapshot file for the operated communities;
  `ROLE_SNAPSHOT_PATH` points inside the image). Acceptance test: boot with the image snapshot →
  audit run includes role data. Live role sync is future work.
- **COLLECTION_REGISTRY contract (IMP-003):** documented in DEPLOY.md with 2 worked examples
  (erc721 + erc1155), key format `"<chainId>/<lowercase-contract>"`, and the provenance-table
  requirement from FR-1a. `test:live` ordering (IMP-015): every deployed collection MUST have a
  green live anchor BEFORE the registry cell is added — the deploy exists but is not declared
  until the gate passes; below-threshold collections are dropped from the env, not shipped dark.
- **FR-4 migration semantics (IMP-006):** at boot, if the pg manifest table is empty and a file
  index exists, import it once (logged); conflicts (same slug both stores) prefer pg; the yaml
  write becomes an export artifact only; rollback = the file path remains readable one release.
- **Publication checklist (IMP-008/013, auditable):** the landed report carries a front-matter
  checklist — k≥5 buckets verified · field allowlist diffed against the template · no joinable
  identifiers · operator sign-off line with date. Review of that checklist IS the audit gate's
  publication check (not vague editorial review).
- **Structured log contract (IMP-010):** appends log `{event: 'ledger.append', chain_id, seq,
  producer_id, event_name}`; rejections `{event: 'ledger.reject', reason, producer_id?}`;
  differential runs `{event: 'differential.run', collection, true_mismatch, no_backfill,
  verdict}`; probe serves `{event: 'capability.probe', chain, contract, hit}` — these fields are
  the acceptance-evidence surface.
- **Probe operational details (IMP-012):** FR-2 probe inherits the consumption-truth table
  (10s timeout, single attempt per reprobe tick, 429→pending) — no new retry machinery.
- **Cross-repo evidence return (IMP-011):** each /coord lane PR links back to the cycle runbook
  section it satisfies; the runbook is the single evidence ledger (as last cycle).

## 8. Security

Producer-auth invariant (6b) · route-posture map asserted by test (FR-2) · publication gate k≥5
enforced editorially + checked in review (the landed report) · secrets only via Railway/Vercel
env (never in registry/provenance tables — addresses are public data) · svc-JWT keys via existing
substrate, never minted ad-hoc.

## 9. Test strategy

Chain: tamper/replay/version/concurrency/unauthorized-producer (6a/6b, one test per PRD AC).
Probe: mapping rows + delegation + dark-unchanged (FR-2). Parity: HIGH-3 contract test (6c
precondition) + differential classifier unit tests. Live: `test:live` output quoted (FR-1);
kill-test redeploy survival (FR-4); E2E runbook evidence (FR-5). Every "works" claim in the cycle
report traces to one of these artifacts.
