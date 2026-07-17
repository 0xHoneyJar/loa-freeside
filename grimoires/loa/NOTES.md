# Notes

## Session Continuity — /ride hub-thinning 2026-07-17

- **Forced fresh `/ride`** for Thin Hub extraction scope.
- Archived prior PRD/SDD → `prd.shadow-audit-mvp.md`, `sdd.shadow-audit-mvp.md`.
- New `prd.md` / `sdd.md` = Thin Hub (KEEP Spice Gate, EXTRACT billing/mediums, cut over ledger).
- Reality refreshed: `reality/{structure,entry-points,services,api-surface,hub-thinning-verdicts,hygiene-report,index}.md`.
- Drift **4/10**; claims A-3..A-10, D-1..D-3 **VERIFIED**.
- **Next:** archive ledger `cycle-053` → open Thin Hub cycle; `/architect` or bead the PRD goals G-1..G-6; operator decide BYOK mount vs DELETE-CANDIDATE and ledger-first vs mediums-first.
- Trajectory: `grimoires/loa/a2a/trajectory/riding-20260717.jsonl`.

---


## 🚨 Decision Log — cycle-053 Sprint 2 (global 416), 2026-07-12 — CRITICAL: sonar cross-chain collision

- **THE BUG (found by the FIRST live call, not by 199 green unit tests).** The public teaser against the real
  thj Honeycomb returned `reconstruction-failed: mint of already-owned tokenId 1`. Root cause: **sonar
  collection ids are NOT unique across chains** — `Honeycomb` and `HoneyJar1..6` each exist on BOTH Ethereum
  (1) and Berachain (80094). The Transfer GraphQL filtered on `{collection, blockNumber}` **only — no chain**
  — so every chain's rows merged into ONE ownership replay, the same tokenId was minted once per chain, and
  `reconstructOwnership` hit its invariant. `blockNumber._lte` is per-chain too, so the bound was meaningless
  across a merged set.
- **Blast radius: EVERYTHING on real data.** The same reconstruction path serves the authed audit (**G-2, the
  spine**) and the public teaser (**G-5**) — and *every* thj collection is multi-chain ("our own community is
  the most multichain there is"). The product could not have worked on real thj data.
- **The fix was local.** sonar has ALWAYS served `Transfer.chainId: Int!` (schema.graphql:23) — it was simply
  never filtered on. Threaded `chainId` through `TransferPageArgs` → the GraphQL where-clause → `ownershipAtBlock`
  /`holderDiff` → `ownership-source.ts` (which already HAD the chain and dropped it on the floor). Commit `4e63ae01`.
- **LESSON (the expensive one).** 199 unit tests were green the entire time — they all use **fakes**, and the
  fakes were self-consistent. Fixture self-consistency is not correctness. The live-correctness gate the
  DEPLOY.md runbook demanded ("the unit suite proves the algorithm with injected fakes — NOT the live values")
  was exactly right, and only executing it found this. **Deploy-and-probe is a test, and it is the one that
  mattered.** Regression test now pins the chain in BOTH the fetcher args and the wire GraphQL.
- **The refusal was CORRECT behavior.** The service refused (`reconstruction-failed`, 422) rather than serving
  a wrong holder set. "Never silently wrong" is what turned a silent data-corruption bug into a loud one.

## Decision Log — cycle-053 (shadow-audit-mvp) Sprint 1 (global 415), 2026-07-10

- **RE-SCOPE.** The plan's "~35-line box" premise was stale — the shadow-audit service is ~2966 LOC,
  FAGAN-reviewed across prior cycles. S1-T1/T2/T3 were already built + tested (175 green); closed as
  VERIFIED-DONE beads with `file:line` evidence. Only the genuine S1↔S3 seam (S1-T4) + tests (T5) +
  contract pin (T6) were built. Operator-confirmed re-scope.
- **[ACCEPTED-DEFERRED] S1-T4 AC "stale → refused".** The ratified design (`mode-resolver.ts:6-7,51-52`)
  DELIBERATELY serves a stale snapshot as `dogfood-full` with an `uncertain` label — it does NOT refuse.
  Only an *absent* snapshot refuses (external-mode). Member-level ">2× freshness" refusal is S4-T3. The AC
  wording contradicts the ratified design; the design wins (Authority Ladder). Ingestion feeds this
  existing freshness path unchanged — no new staleness logic.
- **DEVIATION-with-rationale: durable store = write-through file, NOT Postgres.** IMP-002 required durable
  ingestion state and suggested "reuse the profiles Postgres." The audit service is deliberately
  dependency-free (file-backed role source, in-memory event/rate state — `server.ts` F4). Durability is a
  write-through file (atomic, seeded on boot), same posture as the existing in-memory `loa:shortcut`
  markers — meets the AC ("DURABLE / holds latest per community") without adding a DB to a dependency-free
  service. Upgrade trigger: multi-replica ingestion → shared store keyed by community. Marked in
  `role-store.ts`.
- **Topology:** built in the main checkout on `feat/shadow-audit-mvp` (not an isolated worktree — a fresh
  worktree of this pnpm monorepo has no built dep dist; the env yak-shave wasn't worth it for a narrow
  build with no live concurrent session). Commits are path-scoped to avoid the filthy working tree.

## Sprint Planning Session 2026-07-09 — waggle-s1 sprint plan

Sprint plan generated at `grimoires/loa/sprint.md` (4 sprints, 28 tasks). Ledger: cycle-waggle-s1 registered, global sprints #411-414, next_sprint_number=415, active_cycle=cycle-waggle-s1. Beads: 4 epics + 28 tasks created (E1=arrakis-rv5eo, E2=arrakis-khh9j, E3=arrakis-6hqfl, E4=arrakis-rp1f1), domain+sprint labels per ADR-007, same-domain deps only (cross-domain ordering lives in sprint.md, not beads — rule 5).

Key planning decisions:
- Sprint slicing = SDD §9 phases 1:1 (already ADR-007-sliced); flatline §12 deltas assigned to the phase where their subject lands (§12.1/12.4→S3, §12.2/12.3/12.8→S2, §12.5/12.9-AST→S4, §12.7 smoke lane→S1 CI + S4 verification)
- Sprint 3 = three domain-isolated monolith PRs (PR-A platform/services events endpoint, PR-B network/registry conformance_ref, PR-C platform/tools doctor) + dashboard lane
- FR-7/G-4 pulse work placed in S4 per PRD acceptance rule (tested sink + queued digest; webhook NOT a dependency) — NOT deferred to S2 despite sdd.md:371 "stubbed" phrasing; PRD G-4 is binding
- Task 2.1 (Bearer mint contract) is P0 GATING with loud-block + identity-api order as circuit breaker
- Suite order honors cut-vertex rule: inventory first (S1), then activities/audit (S2), ordering (S3)

Watch items for /implement: sprint:N bead labels collide across cycles (pre-existing arrakis-l8yk carries sprint:2) — filter by epic:<id> labels instead; beads health DEGRADED (br doctor issues) pre-existing.

---


## Architect Session 2026-07-09 — waggle-s1 SDD

SDD generated at `grimoires/loa/sdd.md` from waggle-s1 PRD. Key state for sprint planning:

- **9 decisions D-1..D-9**; sprint slicing pre-cut in SDD §9 (4 phases, ADR-007 domain-isolated: platform/services, network/registry, platform/tools as three separate monolith PRs + dashboard-repo PRs)
- **Grounded corrections to carry**: (a) FR-3 AC4 names `metadata/:contract/:tokenId` but dashboard actually consumes `/holdings/:wallet`, `/nfts/:contract/owner/:address`, `/profile/:address` — suites pin actual consumption; (b) FR-4 "JetStream feed" satisfied via NEW `GET /v1/orders/events` HTTP log-read of `order_outbox` (seq cursor) — outbox IS the log JetStream drains from, no dual-write; JetStream-direct rejected (dashboard has zero NATS plumbing, part-serverless)
- **Zero-deploy win**: shadow-audit is already deployable (bin/http.ts + Dockerfile + railway.toml, header names the dashboard's dormant client verbatim) — FR-2 is env + delete-MOCK_AUDIT + Railway service, no extraction
- **Data risk R-7 sharpened**: activities-api event tables EMPTY per registry notes (write path not wired 2026-05-30) — FR-1 AC1 needs ≥1 real badge grant; Phase-2 precondition
- **Blockers/open**: Discord webhook URL (S2), badge grants existence, top-20 worlds order pin, ordering events auth posture (internal-trust MVP)

---

## Ride Session 2026-05-18 — Codebase Re-Ride

The Loa rode through. Replaced 3-month-stale reality artifacts. Highlights:

- **Drift score 7.3/10** — code is well-documented; main drift is planning artifacts lagging shipped reality
- **Cycle-048 (World Hosting) is shipped, not DRAFT**: 4 worlds live (rektdrop, mibera, apdao, score-api) per `infrastructure/terraform/world-*.tf`. Old PRD preserved at `prd.md.cycle-048-bak`
- **2 GAPS**: `packages/contracts/` referenced in CLAUDE.md does not exist; needs decision (implement or remove ref)
- **9 hygiene flags**: 2 CLIs (`packages/cli` vs `packages/gaib-cli`), in-tree adapter duplication in `themes/sietch/src/packages/`, brand surface drift (loa-freeside/arrakis/sietch/freeside), multiple PRDs without archive discipline
- **All 11 expected ride artifacts persisted** (11/11)
- **Consistency 6.5/10**: three naming conventions coexist in `themes/sietch/src/services/` (kebab-case ~24, PascalCase ~7, lowercase ~16) — recommend convention in CONTRIBUTING.md; no mass rename
- **Trajectory log**: 12 entries in `grimoires/loa/a2a/trajectory/riding-20260518.jsonl`
- **PRD/SDD grounding**: 89%/88% [GROUNDED]
- **5 INFERRED items** to validate next pass: dual-bus cutover state, Trigger.dev task count, Tempo tracing live/planned, packages/core/domain enumeration, postinstall CI timing
- **Phase 8 (legacy deprecation) intentionally skipped**: 339 doc files include many active per-package READMEs; mass prepend would generate noise without operator triage

Next steps recommended:
1. Reclassify cycle-048 PRD as IMPLEMENTED with evidence pointer
2. Establish `grimoires/loa/archive/{cycle-NNN}/` discipline
3. Decide canonical CLI between `packages/cli` and `packages/gaib-cli`
4. Either implement or remove `packages/contracts/` reference from CLAUDE.md
5. Document the 4-name surface (loa-freeside / @arrakis / sietch / freeside) in README

---

# cycle-044 Notes — Staging Integration Launch Readiness

## Launch Readiness Report (Task 5.6)

### Goal Assessment

| Goal | Status | Evidence |
|------|--------|----------|
| G-1 Parallel dev | PASS | ecs-dixie.tf, ecs-finn.tf, ecs.tf — 3 independent service definitions |
| G-2 ES256 auth chain | READY | Canonical secrets created, bootstrap script validated, JWKS endpoint in smoke test |
| G-3 Agent invoke E2E | READY | staging-smoke.sh Phase 3 validates JWT round-trip + invoke |
| G-4 Budget conservation | READY | staging-smoke.sh Phase 4 validates invariant across 10 invocations |
| G-5 Reputation loop | READY | staging-smoke.sh Phase 5 validates dixie reputation query |
| G-6 x402 payment | DEFERRED | Base Sepolia integration requires testnet funding + RPC config |
| G-7 3x green smoke | PENDING | Requires live staging — run `staging-smoke.sh` 3x after first deploy |
| G-8 Fly.io cleanup | PASS | All Arrakis Fly.io refs removed; upstream URLs whitelisted |
| G-9 Monitoring | PASS | CloudWatch alarms for all 3 services, RDS connection budget alarm |

### Deferred Items

| Item | Severity | Rationale |
|------|----------|-----------|
| NATS event streaming | Low | `NATS_OPTIONAL=true` (IMP-009) — reputation uses direct DB writes |
| Discord bot channel | Low | Not blocking staging — Discord integration is application-layer |
| x402 Base Sepolia | Medium | Testnet wallet funding + RPC endpoint needed before validation |
| Production App Mesh/mTLS | Low | Staging uses plaintext HTTP in VPC per SDD §4.5 |

### Environment Inventory

| Service | URL | CPU/Mem | Image |
|---------|-----|---------|-------|
| Freeside (API) | staging.api.arrakis.community | 512/1024 | arrakis-staging-api:$SHA |
| Freeside (Worker) | — (internal) | 256/512 | arrakis-staging-api:$SHA |
| Finn | finn.arrakis-staging.local:3000 | 512/1024 | arrakis-staging-finn:$SHA |
| Dixie | dixie.staging.arrakis.community | 256/512 | arrakis-staging-dixie:$SHA |
| PgBouncer | pgbouncer.arrakis-staging.local | 256/512 | — |

### Operational Readiness

- [x] Terraform IaC for all services
- [x] Migration task definitions (one-shot, not startup)
- [x] Secret bootstrap script (idempotent)
- [x] Key rotation script (8-step dual-kid)
- [x] Emergency revocation script (<5min target)
- [x] Staging smoke test (6 phases, P0/P1 classification)
- [x] CI/CD pipeline with migration hard gates
- [x] CloudWatch alarms (health, CPU, memory, RDS connections)
- [ ] First deploy to staging (operational)
- [ ] 3x consecutive green smoke runs (G-7)
- [ ] Key rotation dry run on live staging

### Staging Declaration

**Status: READY FOR FIRST DEPLOY**

All Terraform resources defined, scripts created, CI/CD pipeline updated. Staging launch requires running `terraform apply` + `bootstrap-staging-secrets.sh` + first deploy cycle.

---

# cycle-040 Notes

## Rollback Plan (Multi-Model Adversarial Review Upgrade)

### Full Rollback

Single-commit revert restores all previous defaults:

```bash
git revert <commit-hash>
```

### Partial Rollback — Disable Tertiary Only

```yaml
# .loa.config.yaml — remove or comment out:
hounfour:
  # flatline_tertiary_model: gemini-2.5-pro
```

Flatline reverts to 2-model mode (Opus + GPT-5.3-codex). No code changes needed.

### Partial Rollback — Revert Secondary to GPT-5.2

```yaml
# .loa.config.yaml
flatline_protocol:
  models:
    secondary: gpt-5.2

red_team:
  models:
    attacker_secondary: gpt-5.2
    defender_secondary: gpt-5.2
```

Also revert in:
- `.claude/defaults/model-config.yaml`: `reviewer` and `reasoning` aliases back to `openai:gpt-5.2`
- `.claude/scripts/gpt-review-api.sh`: `DEFAULT_MODELS` prd/sdd/sprint back to `gpt-5.2`
- `.claude/scripts/flatline-orchestrator.sh`: `get_model_secondary()` default back to `gpt-5.2`

## Decisions

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-02-26 | Cache: result stored [key: integrit...] | Source: cache |
| 2026-02-26 | Cache: result stored [key: clear-te...] | Source: cache |
| 2026-02-26 | Cache: result stored [key: clear-te...] | Source: cache |
| 2026-02-26 | Cache: result stored [key: stats-te...] | Source: cache |
| 2026-02-26 | Cache: result stored [key: stats-te...] | Source: cache |
| 2026-02-26 | Cache: result stored [key: test-sec...] | Source: cache |
| 2026-02-26 | Cache: result stored [key: test-key...] | Source: cache |
| 2026-02-26 | Cache: PASS [key: test-key...] | Source: cache |
| 2026-02-26 | Cache: PASS [key: test-key...] | Source: cache |
| 2026-02-26 | Cache: result stored [key: integrit...] | Source: cache |
| 2026-02-26 | Cache: result stored [key: clear-te...] | Source: cache |
| 2026-02-26 | Cache: result stored [key: clear-te...] | Source: cache |
| 2026-02-26 | Cache: result stored [key: stats-te...] | Source: cache |
| 2026-02-26 | Cache: result stored [key: stats-te...] | Source: cache |
| 2026-02-26 | Cache: result stored [key: test-sec...] | Source: cache |
| 2026-02-26 | Cache: result stored [key: test-key...] | Source: cache |
| 2026-02-26 | Cache: PASS [key: test-key...] | Source: cache |
| 2026-02-26 | Cache: PASS [key: test-key...] | Source: cache |
## Blockers

None.

## Session Continuity — doctor-acvp sprint-1 (2026-05-30, --local autonomous run)

Cycle `doctor-acvp-network-plane`, sprint-1 (global 400), branch `feat/doctor-acvp-network-plane`. RUNNING, --local (no push/PR until bug-332 merges to main — operator-side).
- **DONE (committed, verified):** T1 `aea3787b` (AcvpInvariant status+runtime_class, 29/29) · T2 `7c78c683` (validateAcvpBindings pure core + 15 fixture tests, 44/44 unit + typecheck). beacon-schema organ complete.
- **READY next:** T3 (.3 — freeside-cli: recover beacon-resolve.ts VERBATIM from dist/beacon-loader.js:40-105 + copy lib/jcs.ts from events/jcs.ts:23-42 + deps canonicalize^2/@noble/hashes^1.6.0 + ModuleEntry beacon_fixture/deployment_url/runtime_state/notes) · T6 (.5 — .freeside/acvp-aspirational-allowlist.yaml).
- **BLOCKED:** T4 (.4 doctor pipeline, needs T3) → T7 (.6 cluster-compliance acvp-bindings job report-only + RED yq/glob fix, needs T4). Cross-repo T5a/.7 (mediums) + T5b/.8 (sonar) + T8/.9 (flip-to-fail-block) deferred — /coord dispatch after T4.
- SDD (flatline-hardened, FL-B0/B1/HC0-6/D0): grimoires/loa/cycles/doctor-acvp-network-plane/sdd.md. Resume: `/run-resume` or re-`/implement sprint-1`.

## doctor-acvp sprint-1 — HALTED at clean boundary (2026-05-30)

**DONE + committed (verified):** T1 `aea3787b` · T2 `7c78c683` · T3a `89b8e9ff` (registry loader+ModuleEntry) · T3b `18fbcd01` (cli jcs+deps) · T6 `6da9f84a` (allowlist). beacon-schema + registry + cli-substrate + allowlist organs complete. Tests green: beacon-schema 44/44, registry 7/7, cli jcs 4/4; all typecheck clean.

**BLOCKER (operator action):** run `pnpm install` (confirm the node_modules-purge prompt). Does two things: (1) syncs pnpm-lock.yaml for freeside-cli's new deps canonicalize@^2 + @noble/hashes@^1.6.0 (else CI --frozen-lockfile fails); (2) resets node_modules so cross-package imports resolve cleanly (I hand-synced per-package pnpm store copies + symlinked canonicalize/@noble into cli to pass tests locally — `pnpm install` supersedes those hacks). All deps are already in the pnpm store → should be offline-capable.

**RESUME after `pnpm install`:** `/run-resume` (state HALTED). Ready: T4 (.4 doctor pipeline — replace stub per SDD §3, import loadBeacon + validateAcvpBindings, enumerate check union, doctor.test.ts + ~10 fixtures §7.3) → then T7 (.6 cluster-compliance acvp-bindings job report-only + RED yq/glob fix). Cross-repo T5a/T5b + T8 flip = /coord dispatch after T4.

**Still pending (operator, from before):** merge bug/sprint-bug-332 → main before any feature PR lands (I'm --local, no PR yet).

## doctor-acvp sprint-1 — REVIEW-CONVERGED + wrapped (2026-05-30)

In-repo sprint-1 (cycle doctor-acvp-network-plane, branch feat/doctor-acvp-network-plane, --local) is COMPLETE + FAGAN-converged. 75 tests green (beacon-schema 46, registry 7, cli 22); all typecheck + workflow valid.
- **Commits** (off keystone adf7bb92): T1 aea3787b · T2 7c78c683 · T3a 89b8e9ff · T3b 18fbcd01 · T6 6da9f84a · T4 cd3a2de5 · T7 0b8e7edd · G-4 a9ae1cf2 · FAGAN-iter1 8825cf68 · FAGAN-iter2 843c7a84.
- **FAGAN gate**: iter-1 (18 findings) caught a CRITICAL fail-open regression (displaced `exit 1` — audit gate stopped blocking PRs) + 4 majors → fixed. iter-2 (12, critical gone) closed silent-aspiration (unverifiable receipt→aspirational), --remote fixture-substitution, cross-slug receipt confused-deputy, fail-closed expiry, symlink-safe resolution → fixed. Converged. Verdict artifacts: grimoires/loa/a2a/fagan/doctor-acvp-fagan{,-v2}.json.
- **OPERATOR-BOUND to land** (in order): (1) merge bug/sprint-bug-332 → main (required Unit Tests context); (2) push feat/doctor-acvp-network-plane + open the PR (I'm --local, no PR opened); note packages/* are standalone (per-package install, no root workspace lockfile) — the acvp-bindings CI job installs+builds per-package.
- **FOLLOW-UPS (beads, cycle doctor-acvp-network-plane)**: T5a/.7 (mediums Tier-A build:beacon+acvp:verify), T5b/.8 (sonar), T8/.9 (flip acvp-bindings → fail-block after receipts), + FAGAN-accepts (yq SHA-pin / local-file strictness / shared helper). All cross-repo T5a/T5b via /coord.

## Decision Log — cycle-112 S3 (2026-05-31)
- [ACCEPTED-DEFERRED] T3.1/T3.2 codemod tool + T3.3 bulk migration of the 10 non-pilot
  raw-NATS sites. Rationale: PRD NG-4 ("only the pilot migrates this cycle; the rest
  allowlisted + tracked") + ts-morph/jscodeshift not in repo (no autonomous dep install).
  Pattern documented in cycles/cycle-112-schema-emission-floor/migration-runbook.md;
  demonstrated by the S4 pilot. Tracked: arrakis-yc49. Allowlist trajectory corrected
  (after S4 pilot: entries 10; bulk follow-up: entries 0, emitRaw 3).
- T3.0 RESOLVED: internal.killswitch gets a real KillSwitchSignal schema (sign the
  control signal — forged kill-switch = DoS vector); migration deferred with the rest.

## Decision Log — cycle-112 S4 (2026-05-31)
- [ACCEPTED-DEFERRED] T4.2 production wiring of parallel-mode-orchestrator.ts onto emit().
  Rationale: crosses into packages/adapters/coexistence (vitest framework, constructor-sig
  change + factory + new @0xhoneyjar/events workspace dep) — cannot validate that suite in
  this environment; modifying blind is unsafe. The pilot LOOP + recovery are PROVEN
  end-to-end in packages/events/tests/pilot.test.ts (the test-harness consumer = SDD design),
  pattern in migration-runbook.md. Tracked: arrakis-we22. Allowlist stays at 11 (honest —
  raw .publish still present) until the production line lands.

## Decision Log — cycle-112 S5 (2026-05-31)
- [ACCEPTED-DEFERRED] T5.4 contract_status:bound for events-api/schema_enforcement.
  The invariant is DECLARED (first in-repo beacon, closes arrakis-vl8f) + backed by a
  green proof test, but `bound` needs the acvp:verify commit-bound receipt pipeline.
  Honest interim: aspirational + dated (2026-09-25) in .freeside/acvp-aspirational-allowlist.yaml,
  NOT a faked green. Tracked: arrakis-5ryf. events-api slug is an `-api`-naming-law concession
  for a library (mcp omitted, no served URL).

---

## ◆ SHADOW MODE LEDGER cycle (simstim · 2026-06-25) — continuity block

**Goal:** `/goal` — run /simstim + /run sprint-plan with `shadow-mode-ledger-handoff.zip` as context.
**simstim_id:** simstim-20260625-68853ea1 · **branch:** feat/shadow-mode-ledger (worktree `/Users/zksoju/Documents/GitHub/loa-freeside-shadow-mode`, off origin/main 5d69285a).

**DECISION (operator-confirmed 2026-06-25): EVOLUTION-AWARE, not greenfield.**
shadow-mode-api = the MISSING member-graph composition spine. Build as evolution:
- REUSE `@freeside/shadow-audit-protocol` sealed schemas (AuditOutput/AccessDecisionRecord) for the report.
- First consumer = the existing shadow-audit Access Audit (#306) — the deployed-but-unconsumed cure.
- RECONCILE the coexistence `IShadowLedger`/ScyllaDB (incumbent-vs-Arrakis accuracy tracker; ports defined, no impl) — legacy, distinct store; `shadow_divergences` NAME COLLISION resolved by separate Postgres ownership.
- EXTEND `packages/events` with 8 hounfour topics (all validate the 3-segment convention).
- Lives in-monolith: `packages/{protocol,services}/shadow-mode`, scope `shared/shadow-mode`.

**Grounding done:** /recall (community-management-hexagonal + deployed-but-unconsumed + identity-api-substrate); Explore mapped existing shadow-audit + coexistence; read existing shadow-ledger port+adapter; resolved branch topology (local main STALE, origin/main current).

**Artifacts:** grimoires/loa/{prd,sdd,sprint}.md (this worktree). Old connecting-surface cycle archived → grimoires/loa/cycles/connecting-surface-shadow-access-audit/.

**Pipeline progress:** PRD ✓ (flatline integrated 4 findings: ingest authN/authZ CRITICAL, per-source authz, read-only dep-boundary, identity unlink → NFR-1..5 + AC-9/10). SDD ✓ (flatline running). NEXT: sprint plan → flatline → beads → /run sprint-plan (impl→review→audit).

**Config:** added `simstim.enabled: true` to worktree .loa.config.yaml (worktree-local, NOT operator's main checkout). Flatline routes via cheval headless (env-key readiness check "lies" — real dispatch works, $0 subscription).

### ✦ SHADOW MODE LEDGER — pipeline complete (2026-06-25)
- PRD→flatline(4)→SDD→flatline(7)→sprint→flatline(7) = 18 findings integrated across 3 multi-model gates.
- IMPLEMENT: 2 packages (@freeside/shadow-mode-{protocol,service}), 43 files, +4365 lines. **38 tests green** (AC-1..AC-10).
- Committed d392295e; pushed feat/shadow-mode-ledger; **DRAFT PR #316**.
- REVIEW: FAGAN cross-model review dispatched on the diff (adversarial-review.sh config-disabled → used FAGAN). AUDIT: self-audit clean (no secrets/eval/exec; read-only dependency-boundary test passes).
- Beads: 13 created (cycle:shadow-mode-ledger); dep-graph got inverted (br dep direction) → bookkeeping friction, partial close. NOT load-bearing (work is in the commit/PR).
- Worktree: /Users/zksoju/Documents/GitHub/loa-freeside-shadow-mode (off origin/main 5d69285a). Operator's main checkout + uncommitted packages/events WIP untouched.

---

## Discovery Session 2026-07-01 — Issue #415 (Fulfillment Orchestrator epic)

- Trigger: /plan (discovering-requirements) against https://github.com/0xHoneyJar/loa-freeside/issues/415
- Context assessment: LARGE (173 files / ~21k lines) — scoped ingestion to issue-cited sources, not full sweep
- Reality files: mtime 2026-06-30 but governance-quarantined (`use_label: do_not_use_for_action`, /ride capture 2026-05-18, "CORPSE") — using live-code ingestion instead
- Citation gap: `grimoires/loa/context/harness-upstream-discovery/rfc-issue-draft.md` cited in #415 does NOT exist — locating implement-gate.sh / Worldline Harness RFC separately
- 4 parallel ingestors dispatched: ordering spine, Loa post-PR gates, freeside-cli+topology, related-issue states

### Ingestion synthesis (3 of 4 reports in — 2026-07-01)

**Loa post-PR gates (verified file:line):**
- Mechanical TODAY: bridge-orchestrator.sh → findings JSON; post-pr-triage.sh:254-281 classify_action (BLOCKER→dispatch_bug gated on --auto-triage, HIGH→log_only, PRAISE→lore_candidate); 3 queues (.run/bridge-pending-bugs.jsonl, bridge-lore-candidates.jsonl, trajectory jsonl w/ mandatory reasoning, schema-validated)
- STILL PROSE: bug-queue CONSUMPTION (nothing reads bridge-pending-bugs.jsonl; run-bridge-reference.md:100-107 = prose for "next /bug"); Amendments A2 (review cross-ref) + A3 (lore aggregation) unbuilt
- Phase machine: POST_PR_AUDIT→CONTEXT_CLEAR→E2E_TESTING→FLATLINE_PR→BRIDGEBUILDER_REVIEW(config-gated, default OFF)→READY_FOR_HITL
- No typed capsule at READY_FOR_HITL; load-bearing artifact = .run/bridge-triage-convergence.json (post-pr-triage.sh:590-602)
- CORRECTION to #415: "loa #1036 DISS-003 DEGRADED" is likely mislabel — DEGRADED convergence hardening is loa #1025/sprint-bug-210; #1036 = orchestrator keys on exit code not convergence_state (visibility fix, OPEN)

**freeside-cli + topology (verified):**
- CLI verbs: list/inspect/doctor only, ALL read-only, switch-dispatch (bin/freeside-cli.ts:45-91); status:scaffold; NO auth primitive — grant-gating lives at EXTERNAL loa-cli launcher; write verbs need auth surface decision
- Registry: NO ordering entry in registry.yaml — ordering-service invisible to doctor
- Deploy topology: ordering-service = in-monolith package (packages/services/ordering), OWN Railway service (railway.toml, Dockerfile port 8090), OWN Postgres (DATABASE_URL, store-factory.ts:6-8); bundles shadow-audit-service in-process
- KEY: orchestrator ALREADY EXISTS both ways — embedded fire-and-forget in HTTP edge (bin/http.ts:10,17-19 onPlaced→orchestrator.process) AND sibling worker (bin/worker.ts, ReProbeWorker 15min interval, same composition.ts:51, shared Postgres). Epic's open Q is really "promote sibling worker to primary" not "build from scratch"
- Dashboard: EXTERNAL freeside-dashboard (Vercel) via ORDERING_SERVICE_URL/TOKEN (DEPLOY.md:66-74); operator-dash does NOT consume ordering

**Related issues (verified 2026-07-01):**
- #401 OPEN — StubTriagePorts.shadow.probe hardcoded `blocked` → zero-operator fulfill impossible; core blocker
- #405 OPEN — discord channel health gate, deps freeside-characters + identity-api#45
- #375/#386 OPEN — shared-red CI merge-blindness (every PR inherits red gates)
- sonar-api #117 MERGED 2026-07-01; #111 (Azuki E2E) OPEN — stuck on manual advance-ingredient curl (order 6ddc06f5)
- transmission.md: order system built (16 modules, 54 green tests) but deployed-but-unconsumed; registry edge + grant missing
- CITATION GAPS in #415: harness-upstream-discovery/ does not exist; NO "Worldline Harness RFC" in repo; implement-gate.sh = .claude/hooks/compliance/implement-gate.sh (PreToolUse compliance hook, different thing)

### Ordering-spine ingestion (4th report, recovered from transcript)

- OrderState (order-state.ts:15): placed→routing→producing→fulfilled|failed (CAS transitions, store.ts:180-201). IngredientStatus (preset.ts:79): pending|in_progress|complete|blocked|optional
- TWO presets shipped (preset.ts:117,131): access-risk-audit (deployed composition injects NoopAudit — NOT live) + community-onboarding (LIVE): sonar/score/worlds_manifest=pending, discord_observer=optional, shadow_preview=blocked; fulfillable when 3 complete + shadow complete|optional + world_slug (community-onboarding-orchestrator.ts:39)
- ORCHESTRATOR ALREADY EXISTS: in-process onPlaced fire-and-forget (bin/http.ts:17) + sibling ReProbeWorker (reprobe-worker.ts:31, 15-min interval) + IngredientEnqueueService fan-out (ingredient-enqueue.ts:34, GitHub issue OR HTTP enqueue)
- NOT wired: NO NATS consumer; LifecyclePublisher = RecordingPublisher only (lifecycle-publisher.ts:17) — outbox events NEVER published; not in registry.yaml; order signing built not wired
- advance-ingredient (intake.ts:149): optional Bearer SERVICE_TOKEN — NO AUTH if env unset (NFR flag); auto-unblocks shadow_preview (orchestrator:196-203); CAS-safe
- Probes: HttpBuildingProbes real for sonar/score/worlds (http-building-probes.ts:57); shadow_preview stub-blocked (= #401)
- Commit trail through PR #397 (4f91f372 kitchen K0-K3); zero uncommitted changes

### Session collision + worktree isolation (2026-07-01 ~18:05)

- Another session switched the shared working tree's branch (goal-validator → worldline-417, reset --hard in reflog) mid-simstim; uncommitted prd.md/sdd.md were swept into their `temp-signoff-418` stash
- Recovered non-destructively via `git show stash@{0}:<path>` (stash left intact for the other session)
- This cycle now lives in worktree `.worktrees/fulfillment-surface` on branch `cycle/fulfillment-surface` (cut from origin/main) — artifacts committed immediately; simstim state copied to worktree .run/
- LESSON: multi-session repo work needs worktree isolation from the start; uncommitted grimoires artifacts in a shared tree are one checkout away from loss

### S2 branch context pin (fulfillment-surface, re-added — branch cut predates S1 NOTES commit)
- Ordering-service URL: https://ordering-service-production.up.railway.app (healthz ok, postgres store)
- G-1 fixture: order 6ddc06f5-0c6f-42b8-8377-768a4c2a302e (Azuki) — producing; score=pending, sonar=blocked, worlds_manifest=complete
- S2 entry gate: PR-A not yet deployed at S2 build time — probe verb built against the SDD contract fixture; differential test env-gated (ORDERING_DIFFERENTIAL=1); gate re-checked before G-1 demo

## Decision Log — cycle consumption-truth S1 (2026-07-02)
- [RESHAPE, gate-task-triggered] S1-T2 "probeShadow HTTP leg" DEFERRED to a producer-decision bead;
  S1 ships `SHADOW_PREVIEW_UNAVAILABLE_POLICY=pending|optional` (default pending) instead.
  Grounds (observed): no deployed shadow-audit (registry-absent, unprobeable); in-process adapter
  explicitly unwired (composition.ts:61 NoopAudit; M-10); GET /v1/audit REQUIRES owner_wallet the
  community-onboarding preset does not carry; RunEvent carries no contract identity (no runs-read).
  #401 is missing a PRODUCER, not a probe. Full contract notes: grimoires/loa/cycles/consumption-truth/e2e-runbook.md.
  Auth header observed = X-API-Key (NOT Bearer) — recorded for the future probe adapter.
- FAGAN convergence (3 iters, cap): i1 codex-major fixed (policy-masks-producer); i2 cursor 2-major fixed
  (injection-based producer signal; fail-closed fence fetch) + 2 cleanups; i3 codex APPROVED, took
  dirty-tree fence union + empty-count + dedup. FAGAN-ACCEPTS (rationale): constructor-policy-without-warn
  (factory is the sole production composition path — composition.ts only calls createKitchenTriagePorts);
  test-seam export resetShadowProducerlessWarning (existing codebase pattern, no prod caller).

## Decision Log — cycle sandwich-line S1 (2026-07-03)
- FAGAN sprint-1: 3 iters. Fixed: reserved genesis namespace · verify-gated clear (both voices
  converged) · head-integrity on append · serialized txn queue · 409 chain_frozen route · JCS
  non-plain-object rejection. ACCEPTS w/ rationale: AC-7 regex claim (phantom — regex needs
  'role' prefix, suite green); full-verify-per-append (O(n) — head-check O(1) + periodic verify;
  checkpoint requirement carried into S2-T1).

## Decision Log — cycle sandwich-line S2 (2026-07-03)
- FAGAN S2: 3 iters, verdict converged on the load-bearing critical (AppendGrant _mint
  forgery) — CLOSED via module-private symbol mint + no package-index export; both voices
  dropped it by i3. Also fixed: head-check-before-insert (no orphan), boot-gate on append,
  admin token via env (not argv), non-silent clear, JWT exp-iat≤1h, SvcJwtProducerPolicy +
  community binding, explicit-opt-in structural policy (no silent unauthed default), idempotent
  freeze insert, jsonb-roundtrip hash proof (empirically green).
- FAGAN-ACCEPTS (rationale): (1) PostgresLedgerStore.withTransaction is not one atomic txn across
  append+projection — NAMED ceiling + gated: the pg store MUST NOT back a live producer this cycle
  (FR-6 scope: only the flag-gated read-only differential; no NATS consumer). Upgrade trigger =
  client-scoped txn through ingest before any producer cutover. (2) communities-empty = unrestricted
  is deliberate (trusted global producers e.g. a cluster-wide sonar indexer); a token that omits it
  is a config choice, documented. (3) deployed-marker robustness moot — no deployed shadow-mode
  server this cycle; producerPolicyFromEnv is the future single wiring point, fail-closed by default.

## Decision Log — cycle sandwich-line S3 (2026-07-03)
- Worlds data-loss fix (Fork-2, slotted ahead): worlds-api PR #15 — PgManifestStore + migration
  0002 + kill-test (manifest survives redeploy); 55 unit + 3 pg green. Cross-repo, operator merges.
- Sprint 3 code complete (T1-T4): S3-T1 audit GET /v1/collections capability read (open, rate-limited,
  key-exempt); S3-T2 ordering probeShadow (validates body, precedence real>policy>stub); S3-T3
  value-semantics contract test (sonar-replay vs projection agree per standard, per-token-vs-net
  divergence documented — 6c precondition); S3-T4 differential + no-backfill classifier (flag-gated,
  salted-hash divergence logs, unknown-time→no_backfill never inflates parity). FAGAN S3: i1 6 findings
  (1 critical false-positive on unwired-registry — bin/ was outside diff filter), i2 codex APPROVED@0 +
  cursor 0-findings = converged. shadow-audit 161 + ordering 122 tests green, both typecheck clean.
- G-1 (consumer 0→≥1) still NOT met: the differential is CODE-complete + flag-gated OFF; it only
  runs live once shadow-audit deploys (L-2, operator COLLECTION_REGISTRY + test:live) and the flag flips.
  Remaining L-lanes all operator-gated: L-1 registry mining+verify, L-2 deploy, L-3 sandwich+report, L-5 demo.

## collections-sot checkpoint (2026-07-03)
- **Base topology (operator: "comprehensive, fix root problems"):** MERGED cycle/sandwich-line
  (#429 spine) into cycle/collections-sot. #429 was open/REVIEW_REQUIRED but its redness is
  UNRELATED pre-existing monolith CI (sietch webhook flake being fixed on
  fix/webhook-insert-failure-retriable-503; aws-embedded-metrics dep). Spine's own unit tests
  pass. The worktree had a broken PARTIAL leak of the spine (38 tc errors); merge replaced it
  with the real committed spine. All verified green (protocol 37, service 71, audit 161).
  → collections-sot now CONTAINS #429. Ship implication: either collections-sot PR supersedes
  #429, or #429 merges first then collections-sot rebases on main.
- **Sprint 1 DONE + FAGAN-clean:** S1-T1 identity choke point, S1-T2 CollectionEntity +
  content-addressed observation factories, S1-T3 store fold (chain=SoT, table=projection).
  FAGAN caught 1 HIGH (derived-label ratify silently ignored → now fail-closed) + 2 MEDIUM
  (token_standard validation, verify-on-read) — all fixed + tested.
- **Next:** S2 (freeside collections sync/propose/ratify distiller) → S3 (query + shadow-audit
  collapse kill-test + drift). S2 open Q: propose/ratify reach the ledger via store+DATABASE_URL
  or shadow-mode HTTP API.

## collections-sot COMPLETE (2026-07-03) — all 3 sprints, 295 tests green
- **S1** identity choke point + CollectionEntity/observation factories + store fold (chain=SoT,
  projection=fold, verify-on-read). FAGAN: 1 HIGH (derived-ratify silently ignored→fail-closed) + 2 MED fixed.
- **S2** distiller: ground() (belt + ERC-165 raw eth_call + world heuristic, injectable FR-7 seam) +
  propose (born-low) + ratify (single-consume cockpit grant, subjective-only). Reproduces the 24-collection proof.
- **S3** query (lexical + provenance badge, contested-withheld) + SETTLE GATE (shadow-audit reads the
  ratified snapshot fail-closed, env=break-glass; G-4 kill-test) + drift (re-derive/classify, contested
  never-overwrites, fails loud). + CLI bin (6 verbs) + live belt/RPC clients.
- **End-to-end proven:** distill→propose→ratify→snapshot→settle, all trust signals gate correctly.
- Packages: protocol 37 / shadow-mode 91(+7 pg-skip) / shadow-audit 167, 0 tc errors.
- **Ships on the merged #429 spine.** Second FAGAN (S2/S3) running. NOT YET pushed/PR'd — operator decides
  how collections-sot ships vs #429 (supersede, or #429-first-then-rebase).
- **Remaining (deploy/follow-on, not domain logic):** wire COLLECTION_SNAPSHOT_PATH in the shadow-audit
  deploy (generate snapshot via `collections export-snapshot` in a build step); the 7 pg-integration tests
  need a live postgres; QMD-source registration of the entity export (documented seam, next cycle).

## datastore-legibility bridge — S1 foundation built (2026-07-03, RESUMABLE)
- Bridge `bridge-20260703-fbeb2d` (depth 3), branch cycle/datastore-legibility.
- DONE + committed + tested: S1-T1 (register shadow-mode/shadow-audit/worker/operator-dash as
  registry modules, 10 registry tests) · S1-T2 (host_fp salted-correlation helper in
  packages/adapters/storage/host-fp.ts, 9 tests; creds excluded from preimage, fail-closed salt).
- REMAINING S1: S1-T3 (ordering GET /admin/data-store authed self-report — wire into ordering Hono
  app + a PostgresOrderStore.dataStoreFacts() method) · S1-T4 (freeside-cli doctor --data mode
  reusing hardenedBeaconFetcher). Then S2 (fan-out + registry data_store label layer) · S3
  (projection + drift-loud + git-commit --propose ratify) · bridgebuilder review iterations (×3).
- RESUME: `/run-bridge --resume` (bridge state + beads arrakis-knaa..uqj0 + run-state persist).
  Beads S1-T3=arrakis-knaa, S1-T4=arrakis-0muf, S2-T1=824h, S2-T2=68eb, S3-T1=prx8, S3-T2=30tk, S3-T3=uqj0.

## Autopoiesis cycle — architect open-question resolutions (2026-07-03, live-tree grounded)
- **OQ-1 RESOLVED (branch protection)**: default `github.token` CANNOT read/write branch protection —
  `administration` is not a grantable GITHUB_TOKEN scope (confirmed `immune-doctors.yml:33-38`). Existing
  pattern: `IMMUNE_DOCTOR_GH_TOKEN` fine-grained PAT (Administration:read), gated on `ref=main && non-PR`
  (pwn-request defense, `immune-doctors.yml:75-82`). → FR-1d required-check migration + FR-4 promotion are
  NOT PR-time CI actions; design as a gated main-branch job with an admin-WRITE PAT, or operator-run.
- **OQ-2 RESOLVED (S2 smoke consumers)**: `@freeside/cluster-fp` ← `packages/services/ordering`;
  `@freeside/adapters` ← `packages/services/shadow-audit` (the KNOWN-BROKEN import path — how the break bites);
  `@freeside/ordering-protocol` ← `packages/services/ordering`.
- **OQ-5 STILL OPEN (upstream loa path)**: which repo/path owns `bridge-orchestrator.sh` — needs the loa repo;
  defer to FR-3b issue-filing time (FR-3b acceptance = issue filed, does NOT block S3).

## Bridge reconciliation — 2026-07-03 (autopoiesis)
- Prior `/run-bridge` JACKED_OUT as silent no-op (bridge-20260703-fbeb2d): 0 sprints/0 findings — hit stale HALTED DSL run-state (the `arrakis-run-bridge-resume-silent-noop-flzl` bug).
- Two plans were tangled: run-state=plan-datastore-legibility (HALTED, S2/S3 op-gated) vs on-disk sprint.md=autopoiesis (uncommitted).
- Operator chose: drive **autopoiesis** on a **fresh branch off main**.
- Actions: preserved uncommitted plan (f0c16945) → new branch `cycle/autopoiesis` off origin/main (40bf29e7, single-domain, path-domain-check clean) → archived stale run-state to `.run/*.prev-dsl-*` → fresh bridge `bridge-20260703-5f9926`.
- DSL cycle left intact: `cycle/datastore-legibility` branch + open PRs #433/#434 untouched.

### S1 Decision Log (autopoiesis, 2026-07-03)
- **[ACCEPTED-DEFERRED] immune-check.sh local doctors[] extension (part of S1-T8).** The sprint asked to also add scope-checks as a 4th doctor in the LOCAL banner `tools/immune-check.sh`. Deferred: that file's aggregation + its 106-line test are tightly coupled to exactly 3 doctors (a 3×3 severity matrix); adding a 4th is a refactor of working, tested code with real regression risk to the estate-immune banner — out of proportion to its value (a local convenience view). The sensor is fully **consumable** without it: its own `--probe`/`--json`, the ground-truth lint registration, and the new advisory `scope-checks` job in `.github/workflows/immune-doctors.yml` (the CI surface where "green means something" actually bites). Upgrade trigger: when immune-check.sh next gets a structural touch, generalize its doctor loop to N doctors + fixture-parametrize the test, then fold scope-checks/consumption/false-green in together.

### S1 review outcome (autopoiesis, 2026-07-03)
- Adversarial self-review (2 lenses: scope/shell + flip/security) surfaced 2 flags; BOTH resolved as artifacts, no real defects:
  1. scope_for_diff "false-narrow transitive walk" = FALSE ALARM — test subshell inherited `continue`→`claude --continue` alias (see [[continue-alias-shell-contamination]]); clean-bash repro returns the full transitive closure; bats (clean shell) always passed.
  2. flip-promote "PAT leak" = FALSE POSITIVE — PAT value never echoed (only var-name in REFUSED msgs + `<your-pat>` template).
- Confirmed green in clean env: validator REJECTS missing/invalid exit_code; flip-ready precondition guards the gh API; transitive scope walk correct. S1 = 50 tests + lint, no findings.
- NOTE: the two dispatched review agents stalled (~7min, no output) — root cause = they ran Bash repros hitting the `continue` alias → nested `claude --continue` hangs. Stopped them; did the review inline in clean bash instead.

### S2+S3 fan-out complete + E2E evidence (autopoiesis, 2026-07-03)
- **S2 Consumption Doctor** — `tools/consumption-doctor.sh` (dist→build+import / src→resolve+import under real consumer resolution; consumable/unconsumable/no-consumer). 5 bats green. Real-tree G-2: `@freeside/adapters`→flag (dist unbuilt), `@freeside/ordering-protocol`→pass. (cluster-fp re-home was DSL-branch work, absent here — doctor reports the real tree, not the AC's assumed list.)
- **S3 False-Green Sensor** — `tools/false-green-sensor.sh` (JACKED_OUT+0/0/0→suspect; absent/partial/malformed→insufficient, missing≠zero, untrusted-body counters-only). 10 bats green. Grounds arrakis-run-bridge-resume-silent-noop-flzl. **S3-T1 salvaged** from a stalled agent (it wrote a correct sensor before hanging on the `continue` alias during a repro); S3-T2 bats authored fresh.
- **S3-T3 upstream issue**: filed 0xHoneyJar/loa#1174 (bridge-orchestrator silent-JACKED_OUT with reproduction). FR-3b DONE (does not block on the fix landing).
- **S3-T5 E2E — all 4 goals validated (re-runnable commands, clean-shell `env -i bash`):**
  - G-1: `SCOPE_DIFF_CMD='printf "packages/services/ordering/src/x.ts\n"' tools/scope-checks-sensor.sh` → pass (1 pkg/1 cmd); lockfile → full.
  - G-2: `tools/consumption-doctor.sh @freeside/adapters` → flag(2); `... @freeside/ordering-protocol` → pass(0).
  - G-3: false-green replay no-op → suspect(2); real-work state → pass(0).
  - G-4: flip-report on a seeded-qualifier last-10 ledger → flip-ready (operator promotion→blocking proven in s1-acceptance).
- Full cycle: 65 tests green (56 bats + 9 sh); ground-truth lint green (8 instruments grounded, 3 test fixtures suppressed).
- Deferred (unchanged): immune-check.sh local doctors[] extension for all 3 sensors — same rationale as S1 (tested-file refactor; sensors fully consumable via CI + --probe/--json).

### SDD authored — cadence-ledger (2026-07-04)
- `grimoires/loa/sdd.md` written from prd.md + rehomed brief. All grounding re-verified live (registry.ts shape, probe.mjs:153-190 contract, ADR-012 appendix, SCALE.md Guardrail-2 SLO table, freeside-cli real-registry decode path, CI-lane gap, domain classifier).
- **FR-2 pre-resolved at design time**: live probe 2026-07-05T00:47Z — score-api `/` → 302 `Location: /v1/health`; direct `GET /v1/health` → 200 `{"status":"ok",...,"service":"score-api"}`; `/health` → 404. SDD D-8 declares `/v1/health`+200+marker; sprint re-verifies at populate time. DO-NOT-TRANSCRIBE flag dischargeable.
- Key decisions: service block = probe.mjs 5 fields + `probed_at`/`probe_source` provenance (NFR-5, inert to probe.mjs); `service.deployment_url` required + filter-equal to entry-level url; expectations = Schema.Union discriminated on probe_kind (gh-workflow absent ⇒ decode fails, FR-3 mechanical); graphql-lag fully generic (endpoint/query/rows_path/key/minuend/subtrahend/thresholds); uniqueness+format via decode-time filters; new CI lane `.github/workflows/registry-cli-tests.yml` (workflow path is domain-unclassified ⇒ PR stays single-domain network).
- Watch-items for sprint: inventory-api appendix value expected-stale (new `-3f25` deploy serves open /health 200 — re-probe decides); sonar chain_metadata host (belt-gateway vs hyperindex id) live-verified at populate; SVM projection verify-or-omit; OQ-1 operator call = declare `ordering` service block (recommended yes).

---

## spiral-spiral-20260706-489b18-cycle-1 — Make Numb CI Gates Honest

### RC-1 Reproduction (2026-07-06)

**Command**: `vitest run --workspace vitest.workspace.ts --project integration --reporter=verbose` in `themes/sietch/` with full env placeholder set.

**Result**: `Test Files  22 failed | 231 passed | 1 skipped (254)` · `Tests  114 failed | 6244 passed | 32 skipped`

**Classification**: DOES NOT REPRODUCE as collector crash — `vitest.workspace.ts` already carries the RC-1 fix (comment: "RC-1 fix: deps.optimizer.ssr and server.deps are declared explicitly in each project"; commit `685246cf`). The collector runs successfully: 231 of 254 test files pass. The 22 failing files fail due to actual code bugs:

- `billing-agent-sovereignty.test.ts`: unhandled rejection `SqliteError: table system_config has no column named metadata` (schema column missing from test's in-memory SQLite)
- `story-fragments.test.ts`: assertion failures (`expect(result).toBe(true)`, `Cannot read properties of undefined (reading '0')`, etc.)
- 20 additional test files with assertion/logic failures

**Q-1 answer**: The billing-referrals failures are not a Postgres dependency (SQLite is used) — they are actual test logic failures. The 22 file failures represent committed code bugs, not a CI configuration issue.

**Fix**: None within `shared/` scope. Each failing test file needs a separate bead for its own bug fix. T-2 closes with evidence: collector crash RC-1 is already fixed; residual failures are out-of-scope code bugs. Required env vars are all present in ci.yml (added in `5df7d0d3`).

**T-2 exit codes**: RC-1 reproduction command exit 1 (non-zero due to test failures). Integration-tests check is still red but due to legitimate code bugs, not CI misconfiguration.

---

### RC-2 Reproduction (2026-07-06)

**Commands** (per PRD §RC-2):

```
pnpm install --frozen-lockfile      → exit 0 (lockfile is current)
./node_modules/.bin/vitest run --config vitest.agent-ci.config.ts   → exit 0 (23 files, 448 pass, 1 skip)
npx vitest run --config vitest.agent-ci-integration.config.ts       → exit 1
```

**RC-2 integration config result**: `Test Files  2 failed | 4 passed (6)` · `Tests  68 passed | 22 skipped`

Failures:
- `tests/integration/agent-gateway.test.ts`: `Cannot find package 'ioredis'` (dynamic import at beforeAll; ioredis in `themes/sietch/node_modules` and `packages/adapters/node_modules` but NOT in root `node_modules`)
- `tests/integration/audit-trail.integration.test.ts`: `Cannot find package 'pg'` (import at module top-level via `db-harness.ts`; pg in `themes/sietch/node_modules` only)

**Classification**: RC-2 REPRODUCES (integration vitest config, exit 1). Root cause: ioredis and pg are not in root node_modules; `server.deps.moduleDirectories` in the vitest config lists `themes/sietch/node_modules` but Vite's module resolution fails to find the packages there for dynamic and top-level imports.

**Q-2 answer (from RC-2b)**: pnpm-lock.yaml is NOT stale; `pnpm install --frozen-lockfile` exits 0. RC-2b does not reproduce.

**Fix applied (T-3)**: Added explicit `resolve.alias` entries for `ioredis` and `pg` in `vitest.agent-ci-integration.config.ts`, following the existing `zod` alias pattern. This directly resolves both packages from `themes/sietch/node_modules`, bypassing Vite's generic module resolution.

**T-3 exit codes**: Before fix: exit 1. After fix: exit 0 (both ioredis-dependent tests skip via skipIf/describe.skipIf; audit-trail skips via `SKIP = !process.env.PG_TEST_URL`).

---

### RC-3 Reproduction (2026-07-06)

**Commands** (adapted to macOS — Linux yq binary not applicable):

```
yq --version                                                       → yq version v4.50.1 (mikefarah) ✓
yq -o=json '.modules' packages/freeside-registry/registry.yaml | python3 -m json.tool   → exit 0
bash .github/scripts/audit-cluster-cells.sh                       → exit 0 (8 cells audited)
```

**Classification**: RC-3 DOES NOT REPRODUCE on macOS at HEAD. Registry parse is valid (exit 0). audit-cluster-cells.sh runs cleanly. The yq binary on this system (v4.50.1, mikefarah) works correctly.

**Q-3 answer**: Private cell repos (sonar-api line missing from cell-list output) may return 403 — current script classifies them as UNREACHABLE and adds to WARN_CELLS (does not fail job). The workflow's audit step already handles this via the `|| continue` pattern.

**Fix applied (T-4)**:
1. SHA-256 hardening: Added `sha256sum --check --strict` for `yq_linux_amd64 v4.44.3` (hash: `a2c097180dd884a8d50c956ee16a9cec070f30a7947cf4ebf87d5f36213e9ed7`) before `chmod +x` in `cluster-compliance.yml`.
2. Registry parse guard: Added null/empty check after `yq -o=json '.modules'`; if null/empty emits `::error::` and exits 1.
3. 403/404 inaccessible classification: Updated audit step to classify `UNREACHABLE` cells as `inaccessible` (::warning::), not failing the job.

**T-4 exit codes**: `yq --version` → mikefarah line ✓. SHA-256 check → pass (when binary matches). Parse guard → exits 1 on null/empty .modules.

---

## Immune-Check Result (2026-07-06)

**Command**: `bash tools/immune-check.sh`

**Output**:
```
╓─ immune-check · estate immune doctors · 2026-07-06T02:19Z
     (no output — exit 0)
     (no output — exit 0)
     ✓ ground-truth-lint · 8 instrument(s) grounded (candidates=9, suppressed=3)
  ╙─ ✓ VERDICT: HEALTHY (exit 0)
```

**Exit code**: 0 (HEALTHY) — gate-freeze-sensor and instrument-truth-sensor both clean, ground-truth-lint passes 8 instruments.

## Signal Verification (T-6) (2026-07-06)

**Method**: Used `IMMUNE_LINT_PROBE_CMD` test seam (documented in `tools/immune-check.sh` header — "fixture-driven, no live deps") to inject a simulated lint violation without touching framework-zone files.

**Command**:
```bash
IMMUNE_LINT_PROBE_CMD='echo "T6 deliberate signal break"; exit 1' bash tools/immune-check.sh
```

**Output**:
```
╓─ immune-check · estate immune doctors · 2026-07-06T02:21Z
     (no output — exit 0)
     (no output — exit 0)
     T6 deliberate signal break
  ╙─ ⚠ VERDICT: PROBLEM (exit 2)
```

**Exit code**: 2 (PROBLEM) — confirms that a lint violation (exit 1 from check-instrument-ground-truth.sh, remapped to sev 2) correctly drives immune-check to exit 2. Gate is not numb.

No files were mutated — the test seam is an env override, no revert required.

## /ride reality+ground-truth refresh (2026-07-06)

Scope: **Reality + Ground Truth refresh** (PRD/SDD preserved). Integrity gate (Phase 0.2) failed on
benign stale checksums (2026-01-17 vs framework 1.180.0) — user-authorized override, logged to trajectory.
Ran 6 parallel read-only extractors; synthesized against code (CODE IS TRUTH).

Retired the 2026-05-18 CORPSE. Refreshed: `reality/{index,structure,architecture-overview,api-surface,`
`data-models,entry-points,hygiene-report}.md`, `drift-report.md`, `ground-truth/{index,architecture,`
`api-surface,contracts,behaviors}.md` + `ground-truth/checksums.json` (13 files) + `.reality-meta.json`.

Key drift findings:
- **C1 (Conflict)**: namespace migrated `@arrakis/*` → `@freeside/*` (0 `@arrakis` refs; 18 `@freeside/*` + 3 `@0xhoneyjar/*`). **AGENTS.md still stale** — Chain Provider examples reference `@arrakis/adapters/chain`.
- **C2**: monolith → hexagonal federation (11 registry cells, 8 external `*-api`).
- **Shadows**: freeside-cli, mcp-gateway, operator-dash, BeaconV3, `@0xhoneyjar/events`, shadow-mode/shadow-audit/ordering services — all undocumented in the corpse.
- **Ghosts/gaps**: beacon subdomains 404 cluster-wide; no CI canary for cluster secret-parity; mint/ledger/mediums not fully deployed.

Follow-ups (see `drift-report.md`, not auto-applied): refresh AGENTS.md namespace; secret-parity CI canary; workspace dep dedupe (viem/zod/jose); `@ts-nocheck` (27) burn-down.

## 2026-07-13 — /architect member-legibility: loa-freeside grounding (SOT-1)

Read directly (not inferred):

- **PRD §8 path is WRONG.** collections-sot is `packages/services/shadow-audit/src/collection-sot.ts`
  (consumer) + `packages/services/shadow-mode/src/collections/*` (producer). The PRD says
  `packages/services/shadow-mode/` for both.
- **Open Question #1 ANSWERED mechanically.** `tools/lib/domain-classify.sh`:
  `packages/services/*` → **platform**; `packages/protocol/*` → **shared**. The firewall
  (`path-domain-check.yml`) fires only on platform∧network. This cycle touches **zero**
  network paths. **SOT-1 does not split; the firewall cannot fire.**
- **The snapshot contract is DUPLICATED, hand-written twice**, no shared package:
  producer `shadow-mode/src/collections/export-snapshot.ts` (`CollectionSnapshotRow`),
  consumer `shadow-audit/src/collection-sot.ts` (`EntitySnapshotSchema`). Adding
  inventory-api (a *different repo*) as consumer #3 forces a hoist into
  `packages/protocol/shadow-mode/` (= `domain:shared`).
- **Snapshot row schema**: `{chain, contract, collection_key, token_standard, world?,
  world_validated, contested}`. It carries **no** metadataStrategy, no totalSupply, no
  mirror version. Label vocab is a CLOSED union: `token_standard | collection_key | world | role`
  (DERIVED: standard/key · SUBJECTIVE/ratify-only: world/role).
- **shadow-mode is NOT a deployed service** — package.json has only `test`/`typecheck`.
  No build, no start, no Dockerfile. It is a library + the `bin/collections.ts` CLI
  (`sync|propose|ratify|query|drift|export-snapshot`). ⇒ a `GET /snapshot` HTTP seam would
  require standing up a new deploy. **Publish the snapshot as an artifact instead.**
- **`COLLECTION_SNAPSHOT_PATH` is `readFileSync` at BOOT** (`shadow-audit/bin/http.ts:107-115`).
  Not runtime-refreshable, and a local-file contract cannot cross a repo boundary.
- **The version-pointer already exists in production**: CloudFront KeyValueStore,
  `KVS <world>/<collection>:current_version = v1-YYYY-MM-DD`, over `s3://thj-assets`,
  fronted by `metadata.0xhoneyjar.xyz` (JSON) + `assets.0xhoneyjar.xyz` (images).
  Rollback = delete the KVS key. **FR-3f's "version-as-epoch" is already the live pattern —
  do not design a new one.** (Provenance: 2026-06-07 ops decision, analytics/permission-requests.jsonl.)
- All 4 external buildings LIVE on Railway (registry.yaml `modules`): inventory/sonar/storage/score.

**Design consequence**: the mirrored-ness of a collection is answered by the *existence of its
KVS pointer* — no new label, no new state, the closed union stays closed (PRD §6 thesis holds).

### External-repo grounding (4 Explore agents, 2026-07-13)

**storage-api** — the biggest lift; the PRD's "~70% written" is true of the LIBRARY only.
- E-2 CONFIRMED and sharper than the PRD: `ingestAssets` (`packages/storage-client/src/ingest-assets.ts:362-398`)
  has NO status check, NO magic-byte sniff, NO size cap. It never sees a `Response` — all byte-trust is
  delegated to an injected `FetchBytes` port **that has no production implementation** (zero non-test
  callers of `ingestAssets` in the repo). The only "is it an image" test is a string compare of the
  *claimed* `Content-Type` (`:157-163`). A 200-with-HTML-body labelled `image/png` passes.
  `alreadyMirrored` (`:241-255`) is existence-only → a poisoned object is NEVER re-fetched or corrected.
- **NO sharp/jimp/libvips anywhere.** FR-3d variants need a net-new dep. (`asset-pipeline`'s Lambda
  transform is NOT in this repo.)
- `scripts/snapshot-external-collection.ts` **DOES NOT EXIST** (the registry-seam brief was wrong).
- CloudFront KVS `current_version`: **NO implementation.** Only prose + a `RouteBacking` union member
  `'cf-function-kv-manifest'` (`packages/protocol/src/url-contract.ts:157-163`). The pointer flip is a
  hand-run `aws cloudfront-keyvaluestore put-key`, not code. (Corrects my earlier inference.)
- **NO `.github/` at all.** R-3 confirmed: zero CI.

**sonar-api**
- Azuki block `config.yaml:593-596`, address `0xed5af...4133`, labelled `# azuki_kitchen_e2e`. No `start_block`.
- Per-contract `start_block` **IS** supported (Envio's own JSON schema; HoneyJar/Honeycomb use it). Fix is mechanical.
- chain-1 default `start_block: 13090020` (`config.yaml:558-559`) — the Milady block, as the PRD said.
- **`tokenURI` → ZERO hits. Multicall3 → ZERO hits.** `resolveTokenUris` is 100% greenfield. Chain layer =
  viem, two hand-rolled copy-pasted `createPublicClient`s, no shared factory.
- **NO REST route returns token IDs / supply / holders.** Only `/health`, `/v1/collections/:chain/:addr/status`,
  `POST .../ingest`. The real path is the belt-gateway GraphQL `Token` entity, paged.
- ⚠ **NEW BLOCKER, not in the PRD**: `belt-build.yml` Gate 1 `pnpm verify:belt-config` is **BLOCKING** and
  enforces that `config.mibera.yaml` is byte-identical to `config.yaml` on address/start_block. **The Azuki
  edit must be mirrored or CI fails.**
- ⚠ **PR #150 is a HIGH/DIRECT collision** — per-chain config split; `config.1.yaml` is a generated mirror
  carrying the same Azuki address. Post-#150 the fix belongs in `config.1.yaml`. Must sequence.
- ⚠ **PR #152** builds a *second* independent supply/coverage computation (`scripts/gate2-evm-parity.ts`).
  FR-4c's "authoritative denominator" must reconcile with it or we ship two competing definitions.

**inventory-api**
- `COLLECTION_REGISTRY` is a module-level `const` (`src/collection-registry.ts:91`), 8 rows.
  **ZERO hits for `COLLECTION_SNAPSHOT_PATH`.** No env/file/DB loading of any kind. The seam does not exist.
- `MetadataStrategy` = exactly 3 arms (`:6-9`): `{kind:"codex"} | {kind:"sovereign"; slug} | {kind:"sovereign-world"}`.
  ⇒ **the PRD's thesis holds**: Azuki lands as `{kind:"sovereign", slug:"azuki"}`, union stays closed.
- `getProfilePicture` (`src/inventory.ts:378-386`) — confirmed `pageSize:1` + `nfts[0]`.
- **No `GET /collections`. No `POST /profiles`. No batch endpoint at all** (only POST is `/mcp`).
- Framework is **Hyper** — a bespoke vendored Bun-native framework (`src/hyper/core/*`), NOT hono/express.
  Tests = vitest. CI = `.github/workflows/test.yml` (exists, hermetic).
- Sovereign metadata URL `{BASE}/{world}/{slug}/{tokenId}` — **no version segment** ⇒ the version is
  resolved behind CloudFront, which is exactly why the KVS pointer is the epoch seam.

**KEY DESIGN COLLAPSE**: decoding the image to make the variants **IS** the poison gate. You cannot
`sharp()`-decode an HTML error page, a 0-byte body, or a truncated PNG. E-2 (FR-3 gate) and FR-3d
(variants) are ONE mechanism, not two.

### /architect member-legibility — SDD landed (grimoires/loa/sdd.member-legibility.md)

Design got SMALLER than the PRD assumed. Three workstreams collapsed into existing substrate:
1. **Variants need no image processing.** `@0xhoneyjar/asset-pipeline` already ships
   `CloudFront /_optimize?w=&fmt=&q=` → Lambda. No `sharp` in storage-api. FR-3d = DECLARE
   variants, don't materialize. Kills ~20k derived objects + a dependency.
2. **Mirrored-ness = the KVS pointer's existence.** No new label, no new table. The closed
   `MetadataStrategy` union stays closed — the PRD's architectural thesis survives.
3. **E-2's subject is NEW code.** There is NO production `fetchBytes` anywhere in storage-api
   (only test fakes). The poison gate has nothing to harden — it must be written. Still the hard gate.

**Root cause of FR-4a found**: `sonar-api/src/kitchen/config-patcher.ts` →
`appendTrackedErc721ToChainBlock()` does `normalizeAddress()` and NOTHING else — no `eth_getCode`.
The onboarding pipeline WROTE the ghost address. ⇒ **automating onboarding (G-3) without a liveness
gate mass-produces this bug.** SONAR-1 must ship sonar#159's gate, not just the config fix. (R-12)

**Open questions all resolved**: OQ-1 firewall cannot fire (zero network paths; `packages/services/*`
=platform, `packages/protocol/*`=shared, gate is platform∧network). OQ-2 mirror does NOT auto-trigger
on ratify — 4 CLI verbs, zero PRs, which is all G-3 asks. OQ-3 storage-api CI is a STOR-2 prerequisite
(it has ZERO workflows today). OQ-4 retired by sequencing DASH-0 first.

**PRD corrections (7)**: lifecycle enum is 4 states not 5 (`no_longer_holds` is a quality-bands reason
code, NOT a lifecycle state); `roles.ts` is in freeside-dashboard NOT score-api; issue #96 is CLOSED and
DASH-1 is ~60% merged (only the batch BFF is missing); `scripts/snapshot-external-collection.ts` does
NOT exist; R-2 downgrades to LOW (member-pfp.ts + member-avatar.tsx are clean).

**NEW risks**: R-10 score-api local checkout is 69 commits stale (ground on origin/main only).
R-11 coverage-per-page would read "100 of 100" on a 4,406 roster — the Purupuru bug in a new coat.
R-12 the unvalidated-address onboarding pipeline (above).

### /architect member-legibility — SDD v1.1 landed (2026-07-13)

`grimoires/loa/sdd.member-legibility.md`. A v1.0 existed (strong doc, converged independently on the
same architecture). I **corrected it rather than replaced it**. Two classes of change:

1. **A retraction, forced by a live probe.** v1.0's headline claim — *"don't materialize variants,
   asset-pipeline's `/_optimize` Lambda does it on read"* — was **FALSE**. Probe:
   `GET assets.0xhoneyjar.xyz/…png?w=64&fmt=webp` → **200 · image/png · 149,262 bytes, byte-identical
   to the original.** CloudFront ignores the params; **the Lambda is not wired.** The live `image` field
   is also still a flat string, not `MetadataImageStruct`. ⇒ `sharp` IS required, variants ARE
   materialized. Root cause: **grounded on a README, not the deploy — capability read as liveness.**
   (Same shape as deployed-but-unconsumed `ingestAssets` / never-populated `COLLECTION_SNAPSHOT_PATH`.)
2. **Three sonar blockers found by reading CI, not source** — absent from both the PRD and v1.0:
   - `verify:belt-config` is a **BLOCKING** gate: a lone `config.yaml` Azuki edit **turns the build red**;
     `config.mibera.yaml` must be mirrored in the same commit.
   - **PR #150** moves the file the fix lives in (`config.1.yaml`), carries the same wrong address, and its
     generator once corrupted 101 addresses parsing bare `0x` as hex ints. **`/coord` must reconcile it
     BEFORE SONAR-1 is dispatched.**
   - **PR #152** builds a *second* coverage denominator → FR-4c must reconcile or we ship two "coverage"es.

Also: split **STOR-0** (stand up storage-api CI — the repo has **no `.github/` at all**) out of STOR-2, since
the E-2 poison gate is a security control that would otherwise ship with zero regression protection.

**The design's central economy**: the `sharp` decode needed for the variants **IS** the E-2 poison gate
(you cannot decode an HTML error page, a 0-byte body, or a truncated PNG). One mechanism, two requirements.

---

## 2026-07-13 — `/sprint-plan` → `sprint.member-legibility.md` (sprints #421–#426 registered)

**Output:** `grimoires/loa/sprint.member-legibility.md` · **Ledger:** `cycle-member-legibility` added, 6 sprints,
globals **#421–#426**, `next_sprint_number: 427`. **`active_cycle` deliberately left on `cycle-053`** (it is
HALTED mid-flight and owns the generic slots per PRD D-4) — **flipping it is an operator act at `/run` time.**

### The one thing sprint-planning changed about the task graph

**The SDD's §11 task graph (9 tasks) predates its own ADDENDUM and is stale.** The ADDENDUM's live probes found:

1. **The write half and the read half have never been connected.** `ingestCollectionMetadata` writes
   `{world}/{collection}/metadata/v/{version}/{tokenId}.json`; `inventory-api` reads `{world}/{collection}/{tokenId}`.
   Live: the flat key → **200**, the versioned key → **403**. Shipping the mirror as designed would have written
   10k Azuki documents to keys that **403 to the only consumer that reads them**.
2. **The KVS `current_version` pointer does not exist.** `cf-function-kv-manifest` is a declared `RouteBacking`
   union member with **no implementation anywhere** — a type and a prose comment.

⇒ The plan adds **two tasks the SDD's task table does not contain**:
- **CDN-0** — `terraform import` both CloudFront distributions. They are in **no repo's IaC**, and *the available
  IAM credential cannot even `ListDistributions`*. **🔒 OPERATOR-BLOCKED. Blocks CDN-1 → STOR-2's AC-RT → S3–S6.**
- **CDN-1** — build the CloudFront Function + KVS pointer + `flip-version` CLI. **Highest blast radius in the cycle:**
  it MUST fall through to the flat key on a KVS miss, or **every existing collection 403s the moment it deploys.**

### Sprint shape (39 tasks)

| S | Global | Theme | Deps |
|---|---|---|---|
| 1 | #421 | **The honest floor + the parallel front** — DASH-0 (identicon + coverage), STOR-0 (CI), SONAR-1 (address + `eth_getCode` gate), CDN-0, E-3/E-4 | **none** |
| 2 | #422 | Chain truth + the CDN pointer — SONAR-2, CDN-1 | S1 |
| 3 | #423 | The mirror + the poison bar — STOR-2, **AC-RT** | S1, S2 |
| 4 | #424 | The registry seam — SOT-1 (**the only `loa-freeside` PR**, `shared/collections-sot`) | S3 |
| 5 | #425 | The join layer — INV-4 | S4 |
| 6 | #426 | Delete the switch · batch · toggle · **E2E goal validation** | S5 |

**The counter-design to `member-pfp-2026-07`'s failure** (4-of-5 shipped, the 5th was the only user-visible one,
so the cycle produced **zero observable value for 11 days while looking 80% done**): **DASH-0 ships in Sprint 1,
alone, and is independently valuable.** Sprints 2→6 are strictly serial — **if this cycle gets cut, cut it after
Sprint 1, not mid-chain.**

### Blockers to surface NOW
- **CDN-0 IAM grant** (CloudFront read + TF state). Day-1 operator action. Five of six sprints depend on it.
- **`/coord` preflight** before any sonar dispatch: PR **#150** merge-state (it moves the file SONAR-1 edits),
  PR **#152** (competing coverage denominator), dashboard **#129** (CONFLICTING), and dashboard `main`'s
  **ECS-deploy RED** (else DASH-0 ships to a broken deploy).
- **E-4 (license check, 5 targets, ~1h, human)** is the cheapest kill in the cycle. **Run it first.**
- Beads health is **DEGRADED** (`br doctor` reports issues) — fix before creating Sprint-4 beads.

## 2026-07-16 — dig-search fail-closed (logged per DIG rule)
k-hole dig-search.ts failed closed: EXA_API_KEY not set in session env (both invocations, INVALID_CONFIG). Fell back to WebSearch for top-lab R&D grounding. Fix: export EXA_API_KEY (key exists per k-hole PR#29 lineage) or add to session env.
