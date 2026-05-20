# Notes

## cycle-049 `discovery-loop` — `/run sprint-plan` (domain: network)

**Run**: autonomous `/run sprint-plan`, all 4 sprints, consolidated PR. Branch `feature/sprint-plan-20260519-230932`.

### Session Continuity
- **Sprint 1**: COMPLETED — review + audit approved (commits `1cb5c7af`, `80db6b68`).
- **Sprint 2**: COMPLETED — review + audit approved (commits `cf31c4ab`, `b5ee0585`).
- **Sprint 3**: implementation complete — gateway 25/25 tests, freeside-cli 6/6 tests, both `tsc` clean. Awaiting `/review-sprint` + `/audit-sprint`. (D-S3-1 + D-S3-2 below.)

### D-S3-1 — gateway build environment fixed (operator-authorized)

The Sprint 3 blocker — `apps/mcp-gateway` could not `pnpm install` (`ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`: `workspace:*` deps + a nested `pnpm-workspace.yaml` globbing a non-existent `packages/*`) — was surfaced to the operator, who **authorized the fix**. Applied:

- `apps/mcp-gateway/package.json` — deps converted `workspace:*` → `file:../../packages/{beacon-schema,freeside-registry}` (matching the working `freeside-cli`/`freeside-registry` pattern); `packageManager` `pnpm@8.15.9 → 9.15.9`; `test` script → `tests/*.test.ts` glob.
- `apps/mcp-gateway/pnpm-workspace.yaml` — removed (no longer a workspace).
- `apps/mcp-gateway/pnpm-lock.yaml` — regenerated as lockfile v9.
- `apps/mcp-gateway/Dockerfile` — reworked for a repo-root build context (the `file:` packages live outside `apps/mcp-gateway/`).

**Verified**: `pnpm -C apps/mcp-gateway install` succeeds; `tsc` builds clean; 21/21 existing gateway tests pass. This also **retroactively satisfies Sprint 1 AC #2** (gateway `tsc` succeeds with the reconciled import, no two-name collision) — the D-S1-1 deferral is now closed.

**Deploy caveat**: the Docker/Railway path is reworked but NOT verified (no Docker in this environment; CI runs package `tsc`/test, not a Docker build). Before the next production deploy: set the Railway service Root Directory to the repo root and run a deploy smoke-test. Tracked for a follow-up.

### D-S3-2 — `freeside-registry` ships `tests/fixtures` (file:-dep packaging fix)

The `freeside-score.beacon.yaml` fixture is **runtime data**, not only test data — `registry.yaml` declares `beacon_fixture: tests/fixtures/freeside-score.beacon.yaml`, and every consumer of `@freeside/freeside-registry` resolves it via `loadBeacon`. pnpm `file:` directory deps are *packed* per the `files` array; `tests/` was excluded, so the gateway's and cli's copied `@freeside/freeside-registry` lacked the fixture → `loadBeacon` ENOENT'd → `freeside-score` silently skipped from the manifest. Fix: `tests/fixtures` added to `packages/freeside-registry/package.json` `files`; gateway + cli re-installed. (The fixture's dual-use — test data AND shipped registry data — is inherent to the cycle's deliberate fixture-driven design; PRD §7.)

Also: the `apps/mcp-gateway` test script gained `--test-force-exit` — `app.ts` boot fires a fire-and-forget `refreshAllBeacons()` network call (`app.ts:106`) whose in-flight fetches otherwise keep the `node:test` process alive ~20s+. `--test-force-exit` is the canonical fix for fire-and-forget boot work; the 21 existing gateway tests are unaffected.

### Decision Log

**D-S1-1 — Sprint 1 AC #2 (gateway `tsc`) accepted-deferred to Sprint 3.**
AC #2 (sprint.md:78): *"`pnpm build` / `tsc -b` on `apps/mcp-gateway` succeeds with the reconciled import (no two-name collision)."* Status: **⚠ Partial / [ACCEPTED-DEFERRED]**.

The Sprint-1-owned half — the R-1 import reconciliation — is complete and verified: zero `@0xhoneyjar/beacon-schema` refs remain in `apps/mcp-gateway/` (grep across `src/`, `package.json`, `Dockerfile`, `tests/`, lockfile); the imported symbols (`BeaconV2JsonSchema`, `BeaconV2Schema`, `BeaconV2`) are all exported from `@freeside/beacon-schema` (`packages/beacon-schema/src/index.ts:11-37`); only one package name now exists in the gateway graph, so a "two-name collision" is structurally impossible.

A full gateway `tsc` could not be run — the gateway is in a pre-existing, Sprint-1-independent broken build state: `apps/mcp-gateway/node_modules` absent; lockfile is `lockfileVersion: '6.0'` against installed pnpm 9.15.9; the gateway lockfile/`pnpm-workspace.yaml` expect `apps/mcp-gateway/packages/beacon-schema/` which does not exist (the gateway is Docker-built with the repo root as context — `Dockerfile` `COPY packages ./packages` pulls the repo-root `packages/` in — and cannot `pnpm install` standalone). This predates cycle-049. The sprint plan sequences gateway wiring + build to **Sprint 3** (Task 3.1); the R-1 risk note anticipates it ("If left unresolved, Sprint 3's build fails").
**Carry-forward for Sprint 3**: reproduce the gateway build environment (Docker context or local `packages/` link) and confirm `tsc` clean before Task 3.1. R-1 rename is a satisfied precondition.

**D-S2-1 — beacon-loader discriminates V2/V3 by decode-attempt, NOT by `schema_version` (deviation from SDD §3.2 / sprint Task 2.3).**

SDD §3.2 and sprint Task 2.3 specify the beacon-loader "Discriminate on in-YAML `schema_version`: `"3"` → `decodeBeaconV3`; absent/`"2"` → tag `legacy`." That specification is **impossible against the shipped schema** and is a spec error:

- `BeaconV3Schema = Schema.extend(BeaconV2Schema, …)` and `BeaconV2Schema.schema_version` is `Schema.Literal("2")`. A V3 beacon therefore MUST carry `schema_version: "2"` — `decodeBeaconV3` rejects `"3"`. The pre-existing `freeside-inventory-v3.yaml` fixture (a V3 beacon) uses `schema_version: "2"` and decodes clean — empirical proof.
- Following the spec literally: a `"3"` beacon routes to `decodeBeaconV3` which then *rejects* it (wrong version) → never decodes; a `"2"` V3 beacon gets mis-tagged `legacy`. Either path makes AC-3 ("fixture decodes clean against BeaconV3Schema") unsatisfiable.

**Resolution**: `schema_version` is always `"2"`; V3-ness is signalled by the V3 *fields* (`is`/`is_not`/`cycle_state`/belts), not the version string. `beacon-loader.ts` discriminates by **decode-attempt** — try `BeaconV3Schema` (clean decode ⇒ v3); else try `BeaconV2Schema` (clean decode ⇒ legacy); else `error`. This satisfies every Sprint 2 AC (AC-3 fixture decodes; "V2 detected → legacy"; malformed → error) and matches the existing fixture. The `freeside-score.beacon.yaml` fixture uses `schema_version: "2"`.

This was flagged in Sprint 1 (review Concern 3, NOTES Known Limitation #4). The root fix — making `schema_version` accept `"2"|"3"` — would require editing `beacon-v2.ts`, which is out of scope for this cycle (S1 SDD §3.1: "BeaconV2Schema base struct unchanged"). Surfaced for `/review-sprint` + `/audit-sprint` scrutiny.

### Observations
- Stale `@0xhoneyjar/beacon-schema` package-name comments remain in `packages/beacon-schema/src/index.ts:1` and `tests/schema.test.ts:2` (header comments only — not imports, outside Sprint 1's named scope). TEND-sweep candidate.
- ADR-007 body outside Appendix A still narrates `composes_with` (~lines 107/124/205/288) — decision-record history; Task 1.5 was scoped to the normative spec (Appendix A) per the sprint plan AC.

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
