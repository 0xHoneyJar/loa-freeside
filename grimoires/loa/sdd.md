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
  seq + emits fail-loud alarm + sets a `chain_frozen` flag the append path checks (appends
  rejected until operator ack clears it). Deterministic replay test = fixture chain re-verified
  byte-exact. Tamper test = flip one byte in a stored payload → verify fails at that seq.
- In-memory store gains the same chain logic (one shared pure `chainLink()` function; stores
  only persist).

### 6b — PostgresLedgerStore + producer-auth (BLOCKING invariant)
- **Port async-ification (the honest wide refactor):** `ILedgerStore` is synchronous today
  (in-memory-shaped: `appendObservationIfAbsent(...): boolean`, `withTransaction<T>(fn:()=>T)`).
  A real Postgres adapter cannot be sync. Change the port to async (`Promise<...>`), update the
  reducer/service call-sites (mechanical, contained in the package), in-memory adapter wraps
  sync in resolved promises. This is the largest mechanical surface of 6b — named, not hidden.
- PostgresLedgerStore implements the async port over `sql/0001` + `0002`: append = ONE
  transaction { advisory lock on chain_id → insert observation ON CONFLICT DO NOTHING → if
  inserted: seq = max+1, compute hash, insert chain row }. Duplicate (chain_id,seq) is
  structurally impossible under the lock; duplicate event_id returns false (existing idempotency
  contract). Concurrent-append test via two parallel clients.
- **Producer auth**: the append path (HTTP/NATS ingest — `src/http` ingest routes) verifies a
  svc-JWT (existing substrate: `packages/adapters/agent/jwt-service.ts` conventions) whose
  claims carry `producer_id` + allowed `sources[]`/`event_names[]`; `StaticProducerPolicy` is
  replaced by `JwtProducerPolicy` implementing the existing `IProducerPolicy` port. No token or
  out-of-scope append → 401/403 + logged. There is NO code path that reaches
  `appendObservationIfAbsent` without a verified principal in the durable configuration.
  Unauthorized-producer test included.

### 6c — differential consumer (decision-grade)
Wire `makeProjectionOwnershipSource` (shadow-audit, built+tested, unwired) as the SHADOW side of
a differential in the deployed audit service: on each audit run, BOTH sources compute the holder
set; comparison = per-(collection, snapshot) set equality; divergence = symmetric difference
COUNTS + hashed wallet ids (never raw lists) logged + posted to the ops webhook. Parity bar for
the record: 3 consecutive parity runs on ≥2 collections (recorded in the cycle report; cutover
explicitly out of cycle). PRECONDITION task: the FAGAN HIGH-3 value-semantics contract test
(token-standard value semantics pinned cross-package) — 6c does not merge before it.
NOTE: the projection source has no backfill (deploy-time subscription) — early runs will show
expected divergence on pre-subscription history; the differential report must CLASSIFY
"no-backfill window" divergences separately from true mismatches (else the parity bar is
unreachable and the signal is noise).

### 6d — doctrine note
`packages/protocol/shadow-mode/README.md` section "The spine thesis": all projections (Discord
permissions, rosters, audits) derive from THIS chain; each new projection ships shadow-first vs
the incumbent; hash chain = the verification root. ~20 lines, links the PRD.

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
