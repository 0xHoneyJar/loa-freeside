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
