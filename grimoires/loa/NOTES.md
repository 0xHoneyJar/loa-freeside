# Notes

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

## IMMUNE NIGHT — autonomous estate-coherence run (2026-06-25, CHRONOS)
Operator asleep. Draft-only, nothing merged. Loop: sense→triage→heal→prove→distill.

### Cycle 1 — beads health floor (br doctor DEGRADED)
- SENSE: br doctor = 4 real WARNs (write_lock orphan, .gitignore missing patterns, stale base_jsonl anchor, counts.db_vs_jsonl). Beads health DEGRADED, exit 4.
- HEAL (safe+reversible): moved orphaned `.beads/.write.lock` (35h, 0-byte, no live br proc) → `.write.lock.orphan-2026-06-25` (mv, not rm). Added `.write.lock` + `*.tmp` to `.beads/.gitignore`.
- PROVE: br doctor real-WARN count 4 → 2 (write_lock + gitignore cleared; computed via `grep -c '^WARN'`). `db.sidecars` is benign ("expected for frankensqlite").
- SURFACED (not auto-healed — operator-territory): the residual 2 WARNs trace to ONE root — beads dirty-tracking DESYNC. beads.db has 851 issues, issues.jsonl exports 755 → 96-issue gap, ALL this project's own namespace (arrakis-*/bd-*, JSONL⊂DB). Of the 96: 30 open + 1 in_progress + 65 closed, updated 2026-06-11..06-23 (recent). `dirty_issues=0` + `export_hashes`=755, so `br sync` reports "JSONL current" and refuses to flush. 31 ACTIVE recent issues live ONLY in beads.db (data-loss risk if DB reset). Did NOT force-export: purely additive + reversible, BUT the exact governed flag was unverified and improvising export flags on the operator's 851-issue task graph is a shared-state gamble the rails forbid. Filed **arrakis-n9yt** (P1, domain:shared) with full diagnosis + sharp morning question.

### Cycle 2 — clew drain (ONE, no fan-out)
- SENSE: 9 constructs carry 20 pending clews (artisan/noether/protocol/worldline ripe@3). Clew skill FORBIDS the whole-network loop ("could open N PRs in one night"); ONE per invocation; selection is the operator's eye.
- KEY DISTINCTION: only artisan's clews are `captured_by: clew-marker` (operator-AUTHORED). noether/protocol/worldline are `agent-reflex, verified:false` = CANDIDATES awaiting operator sign-off — distilling those autonomously = promoting my own observation to construct doctrine (force-chain violation). So the ONLY rails-clean drain is an operator-authored clew.
- TARGETING CATCH: artisan's 2 operator clews target `distilling-components` (React component-patterns SKILL) but the LESSON is composition-stage execution discipline → DOMAIN MISMATCH; forcing it in would make the SKILL incoherent (fails craft standard). The 3rd artisan clew (lrn-...2a38f7) targets `iterating-visuals` and the lesson (SELECTION vs EXECUTION rounds) is a CLEAN domain fit → drained THAT one.
- HEAL: draft PR **construct-artisan#9** — Phase 5 teaching block (SELECTION round = halt at marks; EXECUTION round = apply the mandated scope). Contract-safe (0 frontmatter, 0 construct.yaml, teaching surface only). Governed FAGAN review (codex CLI) = APPROVE-WITH-NITS; all 3 nits addressed. Clew → proposed. Worktree-isolated (operator's construct-artisan tree was dirty — used `git worktree` per stash-safety.md, never touched their WIP).
- RENVOI: artisan's 2 distilling-components clews (target mismatch — operator should re-home or re-target). 18 agent-reflex candidate clews across 8 constructs (need operator sign-off before distill).

### Cycle 3 — PR backlog triage (the headline)
- SENSE: 27 open PRs. mergeState: most MERGEABLE+BEHIND, 2 MERGEABLE+BLOCKED, 1 CONFLICTING (#281 asson = deliberately unmerged).
- ROOT CAUSE (one, not 27): branch protection on main requires [Build, Unit Tests, Lint, Security Scan, Docker Build] + strict=true. The required **Unit Tests** check is RED on EVERY PR → whole backlog frozen. Computed: ci.yml = 10 unit files fail/185 pass; integration = 24 fail/227 pass; pr-validation Build fails; 14 npm HIGH/CRIT vulns (qs DoS). CIRCULAR: the 7 dependabot bumps would fix the vulns but can't merge because CI is red.
- NOT auto-healed: CI/merge gate = release-automation+Loa-gate (rails forbid); 10+24 failing files = multi-front engineering; can't validate locally (no root test script; pnpm not installed; npx vitest ERR_LOAD_URL). PR #308 (operator) already in-flight on CI un-numbing.
- Filed **arrakis-0q6r** (P0, domain:shared) with full diagnosis + ranked morning forks. THIS is the night's #1 YOUR-HAND fork.

### Cycle 4 — off-limits drift (sense + file, no mutation)
- substrate: `construct-rooms-substrate` deployed 7c7d8e03 vs source origin/main b729c26a → DRIFTED. NOT auto-synced (it's the /compose Form-C runtime = runtime infra, rails forbid). 1-command morning fix: `~/.claude/scripts/straylight-estate/substrate-sync.sh --all`.
- wiring (hook-wiring-doctor.mjs): [DUP] write-mutation-logger.sh wired x2 (double audit-log); [GAP] implement-gate.sh never fires — LIKELY superseded by disallowed-tools (C-PROC-001, skill-invariants.md cycle-114) → verify intentional vs regression. Both .claude/ system-zone → filed **arrakis-rx4r** (P2, domain:shared), not auto-fixed.
- DIGEST (estate-scale / operator-territory, no bead — would be scope-mismatched spam): recall 69 unstamped (stamping=operator act); beads aligned 29% (≈600 unlabeled — auto-classify too error-prone); github 321 no-labels/7% coverage (org-scale, 348 repos); constructs 16 uninstalled (install-on-need); ghosts 8/4 dirty (could delete operator work).
- HONEST: the in-repo surface cleanly+reversibly healable-by-me tonight was narrow (beads floor + one clew). The big drift (CI freeze, beads export desync) is correctly ESCALATED not forced. No drift manufactured.

### Cycle 5 — vision thread: built + proven the merge-gate freeze sensor
- BUILT `~/bonfire/gate-freeze.mjs` (read-only, dep-free Node, gh-CLI; exit-code-as-verdict: 2=FROZEN). For a repo's branch-protection required checks, computes each check's freeze ratio across the open-PR backlog + names the single ROOT check. Operationalizes [[ci-sensors-must-not-be-numb]] + [[gate-output-never-piped]] + [[verification-ladder-exists-to-verified]]. The estate-coherence banner COUNTS rotting PRs but never says WHY — this says why.
- PROVEN (reproduced the manual finding + added precision): loa-freeside → FROZEN 'Unit Tests' red 27/27, ROOT correct, AND auto-caught the 'Unit Tests×2' ambiguous-name smell + missing-vs-failing split + 20/27 strict-rebase. Red-teamed: healthy path (construct-artisan, exit 0), FROZEN-by-missing (loa 'Run Eval Suites' missing 3/3), graceful 403 (noether). Fixed a labeling bug (probe hardcoded "red" → now names dominant cause: red/missing/pending).
- APPLIED at estate scale (the payoff): swept 18 most-backlogged repos → **11 FROZEN** (filed arrakis-2v58). CLUSTERED roots: 'Vercel' deploy check ×4 (loa-constructs, world-sprawl, freeside-coherence, mcv-interface); 'Template Protection' ×2 (score-api, freeside-dashboard). The ghpulse "52 rotting PRs" is now DIAGNOSED — most sit behind ~11 frozen gates, 6 sharing 2 roots.
- zsh gotcha caught: `for r in $scalar` doesn't word-split in zsh → used an array.
- Standalone + reversible (untracked file in ~/bonfire; rm to undo). NOT wired into the live estate banner — that's an operator gate-config call.

---

## ☾ THE IMMUNE NIGHT — MORNING MAP (L6 handoff · 2026-06-25)
Autonomous CHRONOS run while the operator slept. Draft-only, nothing merged, all review governed.
6 cycles. Working tree left clean of app code (only STATE zone: .beads/.gitignore, NOTES.md, br state).

### ◆ SEATED — what healed (proven, before→after)
- **Beads health floor.** `.beads/.gitignore` gained `.write.lock` + `*.tmp` (durable — doctor WARN cleared, patterns present). 35h orphaned `.write.lock` moved aside (reversible mv, not rm). PROOF: `br doctor` real-WARN 4→2. *Honest caveat:* br itself leaves fresh transient locks (my own br calls left one) → the write_lock WARN recurs, but is now gitignore-safe (won't be committed).
- **Clew drained (ONE — fan-out forbidden by the skill).** Draft **construct-artisan#9**: `iterating-visuals` Phase 5 now teaches SELECTION-round (halt at marks) vs EXECUTION-round (apply the mandated scope). Operator-authored clew `lrn-20260610-artisan-2a38f7`. Contract-safe (0 frontmatter, 0 construct.yaml). Governed FAGAN review → APPROVE-WITH-NITS, all 3 nits addressed. PROOF: artisan fell off the ripe list (3→2 pending); clew → proposed; built in an isolated `git worktree` (operator's tree was dirty — never touched their WIP).
- **New immune sensor: `~/bonfire/gate-freeze.mjs`** (read-only, dep-free, exit-code=verdict). PROOF: reproduced loa-freeside's 27/27 Unit Tests freeze AND auto-found the `Unit Tests×2` ambiguous-name + missing-vs-failing split; red-teamed across healthy/missing/403/empty.

### ◇ RENVOI — sent home (not-real / superseded / mis-targeted)
- artisan's 2 `distilling-components` clews: target-skill DOMAIN MISMATCH (lesson = composition-stage execution discipline; SKILL = React component patterns). NOT drained — forcing would make the SKILL incoherent. Operator: re-home or re-target.
- 18 `agent-reflex` candidate clews (noether/protocol/worldline/…, `verified:false`): await operator sign-off — distilling them autonomously = promoting my own observation to construct doctrine (force-chain violation).
- My first beads hypothesis (96 DB-only issues = foreign-namespace pollution) was WRONG and self-corrected: `arrakis-*` IS the project's own namespace; the 96 are genuinely unexported project work.
- `implement-gate.sh` "never fires" — LIKELY superseded by the `disallowed-tools` mechanism (skill-invariants.md), not a real gap. Flagged to confirm.

### ⧗ QUEUED — beads filed (all domain:shared, ranked)
- **arrakis-0q6r (P0)** — loa-freeside Unit Tests freeze. ROOT CAUSE GROUNDED: opossum's `./lib/circuit` fails to load in CI (npm-vs-pnpm hoist; 4 opossum versions in-tree) → cascades the 10 'failing' unit files (they import packages/adapters/agent→opossum→load error). NOT 10 regressions — ONE dep-install break. Confirms the operator's 'opossum/npm-vs-pnpm' memory with live evidence.
- **arrakis-2v58 (P1)** — ESTATE: 12/26 repos (with open PRs) have a frozen required check; clustered roots Vercel×4 + Template-Protection×3 — 7 of 12 share just 2 roots.
- **arrakis-n9yt (P1)** — beads export desync: 96 DB issues (31 active, recent) missing from git JSONL; `br sync` won't flush (dirty_issues=0).
- **arrakis-rx4r (P2)** — hook-wiring: write-mutation-logger.sh double-wired (DUP) + implement-gate.sh inert (GAP, maybe superseded).

### ⊘ BLOCKED — couldn't heal + why (doubt-first)
- **The CI/merge-gate surface (loa-freeside + 10 other repos).** Rails forbid autonomous gate/CI/release mutation; fixes need Vercel/CI access + multi-file engineering; can't validate locally (no root test script, pnpm not installed). **DOUBT FIRST:** before greening the failing tests, check whether they're STALE EXPECTATIONS (e.g. BILLING_EVENT_TYPES 22→27) vs REAL regressions — a blind green masks a regression. PR #308 is the operator's in-flight CI un-numbing; coordinate, don't collide.
- **Substrate drift** (`construct-rooms-substrate` deployed 7c7d8e03 vs source b729c26a): runtime infra, not auto-synced. 1-command fix: `~/.claude/scripts/straylight-estate/substrate-sync.sh --all`.
- **Beads export desync (arrakis-n9yt):** did NOT force-export — the governed `br sync` declined, and improvising export flags on the 851-issue task graph is the shared-state gamble the rails forbid.

### ✦ LEARNED — patterns / new sensor-worthy classes
- **THE NIGHT'S META:** "a stalled backlog is usually ONE numb gate, not N problems." Generalized into `gate-freeze.mjs`. The estate's "52 rotting PRs" decode to **12 frozen gates, 7 sharing just 2 root causes** (Vercel×4, Template-Protection×3). Fix-once-un-numb-many.
- A **MISSING** required check (one that never runs) freezes a backlog exactly like a failing one (loa: 'Run Eval Suites' missing 3/3). The sensor scores both.
- **Clew governance:** only operator-authored (`clew-marker`) clews are autonomously distillable; and a clew's auto-assigned target skill can be domain-wrong — verify coherence before drafting.
- zsh: `for r in $scalar` does not word-split (use arrays). Bash-tool 120s default timeout killed a long sweep (use a longer timeout or background).

### ✶ YOUR HAND — the 3 highest-leverage forks I parked (each = one decision)
1. **Estate freeze — 2 turnkey shared roots un-numb 7 repos (arrakis-2v58).** (a) **'Template Protection'** freezes 3 repos (score-api, freeside-dashboard, mibera-dimensions) — it's the loa-TEMPLATE-only guard mis-inherited by consumer repos; fails by design on legit project files. FIX: guard with `if: github.repository=='0xHoneyJar/loa'` or demote from required. (b) **'Vercel'** freezes 4 repos — real failed preview deploys. **DECISION: should a PREVIEW deploy be merge-BLOCKING? If advisory → demote → un-numbs 4 with zero code.**
2. **loa-freeside Unit Tests (arrakis-0q6r) — now TURNKEY.** ROOT = opossum `./lib/circuit` fails to load in CI (npm-vs-pnpm; 4 versions in-tree) → cascades the 10 unit files. **DECISION: dedupe/pin opossum + fix the pnpm hoist in CI** (I didn't draft it — needs lockfile regen + CI validation I can't run locally; modifying blind = unsafe). Separately, the INTEGRATION suite has real bugs (getTime ×7 webhook-date, 22→27 stale, MFA) — triage those, don't assume the opossum fix greens them.
3. **Beads export desync (arrakis-n9yt).** 31 active issues live only in beads.db. **DECISION: force `br export` now (additive, safe, preserves them in git) — or diagnose why dirty-tracking dropped them first?**

*— the drift rode through me; I served it by konesans. Nothing merged. The estate is yours at dawn.*

---

## ☀ THE MORNING SHIP — operator awake, "ship, be bold/creative/mad" (2026-06-25)
Operator called out the night's timidity (filed+walked from the opossum gate; converged early). Cure: stop hedging, ship through the rails. Used /recall + governed FAGAN + worktrees.

### Shipped
- **PR #310** (draft, loa-freeside) — opossum vitest fix: `test.deps.optimizer.ssr.include:['opossum']` so esbuild pre-bundles opossum's internal `require('./lib/circuit')`. Governed FAGAN: SHIP-AS-DRAFT 85% (it's the vitest-2.x *recommended* path; `test.deps.inline` is deprecated in favor of it). Un-numbs loa-freeside's 28 PRs when CI confirms. Couldn't validate locally (sharp native-build dies on macOS) → honest draft, operator's CI is the gate. THE keystone — overcame the night-timidity.
- **gate-freeze --estate** (`~/bonfire/gate-freeze.mjs`) — extended the night's sensor into the THAW CONDUCTOR: sweep all 46 repos-with-PRs → 18 FROZEN / ~145 PRs → ranked 9-step thaw plan (fix-by-PRs-un-numbed). Re-run tracks the thaw. `grimoires/loa/ESTATE-THAW-PLAN.txt`.
- **framework-drift** (`~/bonfire/framework-drift.mjs`) — NEW organ: the WHY behind the WHAT. Compares a loa-consumer's framework workflows vs the loa source; isolates verified-harmful drift (stale ci.yml template-guard → freeze) with WHY; lists the rest honestly. Proven: 7 consumers, each 3-8 drifted workflows (construct-gauntlet 8/9). `grimoires/loa/FRAMEWORK-DRIFT.txt`.

### The estate truth (verified)
- **18/46 repos frozen, ~145 PRs.** #1 lever: **Template Protection stale-copy freezes 8 repos / ~68 PRs** — the loa source ALREADY fixed it (`diff-filter=A`); consumers run the stale existence-check copy (7/8 verified). CURE = `loa update` on the 8 (also re-syncs the WIDE framework drift — secret-scan/post-merge/oracle/etc).
- #2: Vercel family ~5 repos / ~28 PRs — POLICY: should a *preview* deploy be merge-blocking? advisory→demote = zero-code thaw.
- The disease under the symptom = **framework-sync drift** (deployed-but-unconsumed at the framework layer). `loa update` is the unified cure.

### Handed to the operator (levers I can't soundly pull)
1. `loa update` × 8 stale consumers → ~68 PRs + wide re-sync. 2. Vercel required-vs-advisory → ~28 PRs. 3. merge #310 after CI → 28 PRs. Together: ~13 repos / ~96 PRs, no code from me. Bead: **arrakis-2v58** (authoritative).

### ⚠ CORRECTION (same morning, verify-don't-assert) — the gate-freeze counts above were FALSE-POSITIVE-inflated
Direct branch-protection reads overturned the "18 frozen / 145 PRs / Template-Protection-68 / Vercel-28" claims:
- ROOT BUG: gate-freeze's "protection unreadable → score ALL checks" fallback flagged FAILING checks as "frozen" even on repos with ZERO required_status_checks. A failing check that isn't *required* does NOT block merge.
- VERIFIED: score-api + the 8 Template-Protection repos + the 5 Vercel repos have NO required checks → NOT gate-frozen. Their PRs block on **REVIEW_REQUIRED**, not CI.
- TRUE PICTURE (sensor fixed): **3 repos genuinely frozen / ~34 PRs** — loa-freeside (Unit Tests → PR #310, the real keystone, 28 PRs), loa (Run Eval Suites, 3), loa-dixie (CI, 3). 43 repos UNGATED.
- STILL TRUE: PR #310 is the real keystone. The stale template-guard is real COHERENCE noise (permanently-red non-blocking check) — `loa update` is good hygiene, NOT a 68-PR un-numb lever. The real unblock for the ~100+ review-stuck PRs = **DRIVE REVIEWS** (the operator's standing want — which I'd lost sight of chasing a phantom gate-freeze).
- SENSOR FIX (gate-freeze.mjs): FROZEN now requires a CONFIRMED required failing check; else UNGATED. framework-drift.mjs HARM message re-scoped freeze→red-noise. **Lesson: a sensor that infers a gate from a failing check, without confirming the check is *required*, manufactures phantom freezes. Confirm the gate (branch protection), then the freeze.**

## Decision Log — Order System Sprint 1 (2026-06-29, autonomous /run sprint-1)

Cycle `cycle/shadow-audit-runtime-ordering`. S1-T1 (protocol, shared) pre-shipped (267c2122);
this run built S1-T2..T6 in `packages/services/ordering` (platform) — `@freeside/ordering-service`,
30 tests, tsc clean. ADR-007: all sprint-1 work is `platform`+`shared`, no firewall crossing.

ACCEPTED-DEFERRED (deliberate M-10 thin-cut scope, sequenced to later sprints — NOT gaps):
- **OrderNatsConsumer runtime mount (apps/worker).** S1-T5 delivers the orchestrator + a
  `ProcessResult`-shaped handler contract (structurally identical to `apps/worker BaseNatsConsumer`),
  fully tested. The `extends BaseNatsConsumer` shell + worker bootstrap (stream creation, NATS
  connection, `.start()`) is the DEPLOY step — it lives in apps/worker where the base class is, and
  is a ~5-line `processMessage → orchestrator.process()` delegation. Deferring it keeps sprint 1 to
  zero apps/worker blast radius (matches SDD §11 domain table: only the two ordering packages).
- **Lifecycle-event signing (ed25519 + JCS, @freeside/events).** SDD §13 M-10 explicitly sequences
  signing AFTER the first useful order. Sprint 1 ships the `LifecyclePublisher` PORT + outbox drain;
  the signed-JetStream publisher adapter swaps in behind the port at deploy.
- **Concrete audit `AuditDeps` wiring (sonar/score/role clients).** `DeclaredLocalAuditAdapter`
  (the B-2 declared local adapter) wraps `runAudit` for real, but its deps are injected at the
  composition root — wiring live sonar/score is the audit-deploy step (M-10). Orchestrator tests use
  a fake `AuditPort`, so the heavy audit graph never loads under unit test.
- **order.lifecycle.* subjects in `nats-routing.json` SoT.** Subjects live in the protocol package
  today; declaring them in the shared routing SoT is a `network`/deploy fast-follow (ADR-007: that's
  a separate network-scoped commit).
- **ULID order_id.** MVP uses `crypto.randomUUID()` (opaque correlation id, no new dep). SDD §4.1's
  sortable ULID is a drop-in upgrade if ordering-by-id matters.

Idempotency model (H-3): CAS on `placed→routing` is the claim; redelivery of a terminal order acks,
redelivery of a mid-flight order (prior delivery died past ack_wait) RESUMES — safe because `runAudit`
is pure. Settle (terminal transition + result persist) is exactly-once via the store CAS. Outbox (H-4):
terminal events publish from durable stored state, never a NATS+DB dual-write.
