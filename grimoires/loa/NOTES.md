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

---

## Legba cycle-1 — dispatch record (simstim-20260611-7a68ab09)

Three L6 handoff artifacts authored, validated (frontmatter + ts + canonical-id),
content-addressed via the lib's own derivation (`_handoff_canonical_for_id` → JCS → sha256):

| handoff | target repo | content-address | brief |
|---|---|---|---|
| hounfour schemas | loa-hounfour | `sha256:510fece7afd8897d9a67292ee9667d6c29229079a4320308033550857978cb74` | `grimoires/loa/handoffs/2026-06-11-legba-cycle1-hounfour-schemas.md` |
| ghost-door lint | construct-compositions | `sha256:41ad5be54b86b2ffde90dd59d94d7c1d3ef29e4aa09c1afcc708f73e299115f4` | `grimoires/loa/handoffs/2026-06-11-legba-cycle1-ghost-door-lint.md` |
| named-defect patches | construct-rooms-substrate | `sha256:8688ccb02e97ae39886e62af47a18500a3e5b48988ae9b16bec92c907c4d6659` | `grimoires/loa/handoffs/2026-06-11-legba-cycle1-named-defect-patches` (patches/ dir) |

### Decision Log — L6 atomic-publish gated on operator registry (NOT bypassed)
`handoff_write`'s strict operator-verification (`structured_handoff.verify_operators`
defaults true) rejects the emit: `from=loa-freeside-legba-cycle1` and the target
repos are not in `grimoires/loa/operators.md` (which holds one stub entry,
`deep-name`). Flipping the gate to warn-mode OR registering operators is a
**governance act** — out of autonomous scope (auth/persistence/Loa-gate, no
creative latitude). The artifacts + content-addresses stand; the atomic publish
is one operator action away (register the dispatching identity, or set
`structured_handoff.verify_operators: false` if the stub registry is leftover).

### Bug surfaced (deployment seam, real): `structured-handoff-lib.sh` repo-root resolution
Under zsh `source`, `_LOA_HANDOFF_REPO_ROOT` resolved to `$HOME` (read a stale
global `~/.run/machine-fingerprint` with an empty `fingerprint` value → exit 6).
Under `bash` it resolves correctly to the repo. Same class as the playtest's
base-dir-dependent verdict finding — a path resolution that assumes a shell/root
that isn't guaranteed. Worth a System-Zone follow-up bead.

---

## Asson cycle-1 — dispatch record (simstim-20260611-0d76ae77)

L6 handoff authored + validated (frontmatter+ts+canonical-id), content-addressed via the lib's own `_handoff_canonical_for_id`:

| handoff | target | content-address | brief |
|---|---|---|---|
| veve schema | loa-hounfour | `sha256:7ee71b35a5056093f5816565f3786367b8d56ca2ad1c1d44d62a3ff5fbbcddd9` | `grimoires/loa/handoffs/2026-06-11-asson-veve-schema.md` |

### Decision Log — L6 atomic-publish gated on machine-fingerprint (NOT bypassed)
`handoff_write` refused with `[CROSS-HOST-REFUSED]`: the stored machine-fingerprint
(af5c02…, Jun 7) ≠ current (5c40…) — a network/hostname drift on the SAME operator
machine, not a different host. Resetting the fingerprint is a guardrail change,
out of autonomous scope (same posture as the Legba operator-registry gate). The
artifact + content-address stand; the atomic publish is one operator act away
(`.run/machine-fingerprint` refresh if this is genuinely the same machine, or the
documented L6 cross-host recovery).

### Decision Log — asson cycle-3 keyring binding (audit MEDIUM, pinned)
Cycle-1 security audit (Paranoid Cypherpunk) APPROVED with one MEDIUM pinned as a
**cycle-3 precondition**: `doctor()` verifies the attestation signature against a
caller-supplied `publicKey` but does NOT assert that key's identity equals the
attestation's `signed_by_key_id` (`asson.mjs:158,161`). Harmless in cycle 1 (no
keyring → fail-closed `unattested`), but before cycle-3's CI key ceremony lets the
`attestation` tier mean "trusted", the doctor MUST either take `(signerId,
publicKey)` and assert `keyId(signerId, keyVersion) === signed_by_key_id`, or bind
`key_id` to key material. Two LOW notes: treeHash follows symlinks (use lstatSync
when attestation hardens); dev_signature keys are ephemeral/non-persisted (document
in README). Full audit: `a2a/sprint-1/auditor-sprint-feedback.md`.

### Asson cycle-2 — implementation grounding (pre-flatline)
- **freeside-cli already declares `"@freeside/asson": "workspace:*"` but it's BROKEN**: no pnpm-workspace.yaml exists (empty), and the other siblings use `file:../` (`@freeside/freeside-registry: file:../freeside-registry`, `@freeside/beacon-schema: file:../beacon-schema`, linked into node_modules via pnpm). Cycle-2 fix (task 2.1/2.2): switch asson's dep to `file:../asson` to match the working pattern. Micro [[deployed-but-unconsumed-pattern]] — dep declared, never made resolvable.
- **asson is `.mjs`, no build/dist**: the `file:../asson` link points at the package dir; `exports."."` → `./src/asson.mjs` (runtime), `types` → `./src/asson.d.ts`. asson stays zero-runtime-dep (CL-1).
- **asson public API for the `.d.ts`** (asson.mjs): `ASSON_VERSION`, `jcs`, `sha256`, `hashObj`, `hashOutput`, `treeHash`, `createSigner`, `attestBuild`, `verifyAttestation`, `invoke`, `runVectors`, `harvestVector`, `toCommandPolicy`, `doctor`. (liveness.mjs): `DEFAULT_POLICY`, `budgetStatus`, `detectStall`, `detectSpin`, `paceCheck`, `checkpointPacket`, `livenessVerdict`.
- **freeside-cli verb pattern**: TS NodeNext+strict; verbs `src/verbs/*.ts` (return code/report), exported from `src/index.ts`, dispatched by `switch(verb)` in `bin/freeside-cli.ts`; existing `doctor` verb = the BeaconV3/registry doctor (asson MUST namespace as `asson <sub>`).

### Decision Log — asson cycle-2 CL-5↔SDD harvest reconciliation
Sprint-2 invariant CL-5 said "attest --write is the ONLY file-mutating path." But SDD
§4.5 (higher authority, Flatline-reviewed) says `asson harvest <dir> -- <argv>` "appends
a pinned vector to the veve" — i.e. harvest legitimately mutates. Reconciled in favor of
the SDD: `attest` is the only ATTESTATION-writing path (guarded by --write + pre-persist
verify); `harvest` appends vectors and is guarded instead by the B7 double-run determinism
guard (refuses to pin a non-deterministic tool). AC #3 marked ⚠ Partial-reconciled, not a
gap. Also pinned for cycle-3: ASSON_VERSION (0.1.0) ≠ package.json (0.2.0) — cosmetic, left
surgical; and L3-attested-dev needs --public-key <pem> at the CLI until the cycle-3 keyring
resolves the key from signed_by_key_id (the same pinned audit MEDIUM).

### Decision Log — asson cycle-3: the pinned MEDIUM is CLOSED
The cycle-1 audit MEDIUM (doctor verifies against a caller-supplied key with no key_id↔publicKey binding) is RESOLVED. `doctor(veve, dir, {keyring})` resolves `signed_by_key_id → public_key_pem` via `resolveSigner` (active-only) and verifies against THAT — forged id unresolvable (AS-KR), wrong-key fails signature. The CI ceremony (`ci-key-ceremony.mjs`) mints attestation-tier sigs; private keys live 0600 under gitignored `packages/asson/.run/asson-keys/` (verified via git check-ignore). `keyring/signers.json` ships `{}` (public keys only). Two LOW carried: --public-key fallback is explicit-trust (keyring is the trusted path); no rotation/expiry (revoke only). Gotcha logged: pnpm store COPIES asson → `pnpm install` after editing the package to propagate .d.ts to freeside-cli.

### Decision Log — asson cycle-4: liveness watchdog (read-only sensor)
`freeside-cli asson watchdog <span-log.jsonl>` runs liveness.mjs#livenessVerdict over a Legba span log → 4 reproducible verdicts (stall→reap, spin→compact_then_present, budget→checkpoint_and_present, pace→pace_alert), exit 1 intervention / 3 warn / 0 continue. The seam is ONE-WAY: asson reads Legba's output, never modifies Legba. The SubagentStop hook wiring is System Zone (operator-gated) → NOT wired here (scope guard keeps `.claude/` clean). KEY INTEGRATION CHECK before wiring: verify the span-log shape `{record:{ts,kind,tool,input_hash},record_hash}` against a real Legba flight-recorder.jsonl. Cycle-4 driven from SDD §7 row 4 directly (no separate sprint doc — leave-local efficiency).

### Decision Log — asson cycle-5: comms gate (3 INDEPENDENT linters) — LADDER COMPLETE
`comms-gate.mjs` screens competitive-REL comms through 3 independent linters (AS-9/B5): legal-register (asson lexicon-lint, the ONLY one asson owns) + voice (ai-stench) + product-vocab (vocabulary-bank). Each a separate process with its own exit; the gate ORs them — NO orchestration, NO shared lexicon. Proven independent (legal-only/voice-only/vocab-only each fire alone). Absent linter → skipped+reported, never silent pass. The .claude/ hook registration is operator-gated (handoff); the finn spawn-time CommandPolicy PROPOSAL is a loa-finn handoff. bats stubs the 2 external linters for CI-portability (real ai-stench verified manually). **The 5-cycle asson ladder is COMPLETE, gated, leave-local.**

## 2026-06-21 — Sprint-1 extraction-migration (resumed via /run-resume)

- **T3 · dependency-rule lint (FR-7, G-5)** ✅ committed `72885c2a` (`domain:platform`).
  `tools/lint/dep-rule.sh` (authoritative, segment-anchored, allowlist-ratchet, `--self-test`),
  `packages/core/.eslintrc.cjs` (editor mirror), wired required `Dependency Rule (G-5)` job in
  `pr-validation.yml`. Verified: clean core / detects planted import / no false positives / shellcheck clean.
- **T2 · security/MFA disposition** ✅ DECIDED `STAYS-PLATFORM` (NOT → identity-api). Recorded in
  `extraction-manifest.yaml` `decisions[security-mfa-disposition]` with caller-inventory (0 external
  consumers) + threat-model (platform's own admin/operational auth, not end-user identity). Clears the
  Phase-0 gate that blocked sprint-completion + T6. NaibSecurityGuard.integration stays required → FIX-PLATFORM (T5).
  - **Threat-model finding (SKP-006 in reverse):** the destructive-op MFA guard is deployed-but-unconsumed
    in the monolith live path → filed **`arrakis-kjbf`** (`domain:platform`, bug). Verify vs deployed
    gateway before acting (dont-ground-on-extracted-monolith).
- Remaining autonomous: T4 (quarantine-with-teeth + manifest validator), T5 (platform-stays BUG fixes —
  needs docker Redis + seeded env), T6 (ledger parity proof, read-only HALT-on-mismatch). T7/T8 operator-gated.
