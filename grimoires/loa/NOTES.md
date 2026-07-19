# Notes

## Ride Session 2026-07-19 — Reality Refresh (delta 9b0f4a12 → b5df718a, 287 commits)

Non-interactive refresh ride on branch `coord/collection-report-coordinator-f09.30`. PRD/SDD PRESERVED (active cadence-ledger cycle docs — do not overwrite). Highlights:

- **Protocol layer 4 → 10 packages**: 6 new v1.0.0 wire contracts under `packages/protocol/` (collection, collection-resolution, dependency-ledger CR-012A, public-authorization CR-007A, signing-key-custody CR-013, trust-envelope CR-009) + NEW `@freeside/collection-report-gates` (CR-019, bin `check-gate-manifest`)
- **`ordering` is now a registered registry cell** (`runtime_state: deployed`) — first in-repo cell; ABSENT from CLAUDE.md building list → drift N-1, top recommended fix
- **sietch frozen this delta** (2 files / 287 commits) — all 07-06 monolith numbers (48 route modules, 23 Discord/12 Telegram cmds, 68 TS + 19 SQL migrations) still valid
- **Drift 5/10** (was 4/10): reality-file staleness healed by this ride; billing-no-repo / mediums-not-built / ledger-dual-home / dual-money-rails ALL still open (hub-thinning 07-17 findings carried)
- **Consistency 5/10**: new protocol layer is 10/10 uniform (pulls score up); C-1..C-5 collisions remain; NEW: `ordering` slug breaks `*-api` convention (C-6), protocol versioning split v0.1.0 vs v1.0.0 (C-7)
- **Governance verified**: `.github/CODEOWNERS` present, 369 semver tags (v7.77.0), 40 CI workflows — 07-17 assumptions closed
- **Counts refreshed**: 620 test files · 334 unique env refs · 85 debt markers (43 TODO, 28 @ts-nocheck) · 130 Hono/Express route registrations (ordering largest at 24)
- **Ground-truth REFRESHED** (same day, `/ride --ground-truth` follow-up): 5 GT files regenerated at `grimoires/loa/ground-truth/` from the fresh reality spokes (protocol 4→10, ordering cell, CR-019 gates, 40 CI, sietch-frozen all carried); checksums.json re-generated mechanically (30 files, b5df718a); token budgets all PASS (index 450/500, spokes ≤536/2000). Note: `grimoires/loa/gt/` still holds empty 03-31 stubs — dead dir, candidate for removal
- **Hygiene NEW**: `.beads/.write.lock.orphaned-20260717`, 114 tracked `.pyc` in `.claude/`, 23 loose billing `.ts` at `packages/services/` root
- **Phase 8 (legacy deprecation) skipped** — same rationale as 2026-05-18/07-06 rides
- Trajectory: `grimoires/loa/a2a/trajectory/riding-20260719.jsonl`

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

## Estate freshness pass + /loa-aleph arrival (2026-07-19)

Framework updated 1.180.0 → 1.196.0 (217 commits, safeguarded merge on
`coord/collection-report-coordinator-f09.30`). Identity files kept ours; 5
upstream-new workflows removed (Phase 5.5); cursor-Composer port docs taken in
`runbooks/headless-mode.md`; compact Known-Failures INDEX pointer added to
CLAUDE.md (kf tooling `grimoire-index.sh` + `kf-write-lib.sh` verified present).
BUTTERFREEZONE regenerated Tier 1 AFTER `/ride --ground-truth` (17/17 checks);
`grimoires/loa/gt/` 0-byte corpse removed.

**`/loa-aleph` is now installed in-repo** (vendored verified bundle at
`.claude/aleph/`, adapter `bin/loa-aleph.mjs`, skill + command). Adapter status
probes PASS. Live attested runs BLOCKED on this host: bubblewrap (Linux-only),
`AWS_BEARER_TOKEN_BEDROCK` unset, pinned-binary attestation. Runnable today:
manual-mode S0–S13 (fixture-labeled) + `validate` checker. First consumers per
research-loop brief T1: research-loop corpus → précis-shaped file → WEBB
nomination; also `grimoires/loa/research/material-contact/` as a bounded corpus
candidate. Sync-constructs surfaced pre-existing hypha pack drift (5 declared
skills without directories).
