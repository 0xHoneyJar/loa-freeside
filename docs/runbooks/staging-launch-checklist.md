# Staging Launch Readiness Checklist

> Go/no-go gate for staging launch. Maps every PRD goal (G-1 through G-9)
> to specific verification steps. Can be used as a GitHub issue checklist.

## Pre-Requisites

- [ ] AWS credentials configured with staging access
- [ ] `gh` CLI authenticated for all 3 repos (freeside, finn, dixie)
- [ ] ES256 test key generated (`staging.pem`)
- [ ] Node.js installed (for JWT signing via `sign-test-jwt.mjs`)
- [ ] Test data seeded (`./scripts/seed-staging-test-data.sh --ecs-exec --cluster <cluster>`)
- [ ] (Optional) Base Sepolia wallet funded (`SEPOLIA_RPC_URL`, `STAGING_WALLET_KEY`)
- [ ] (Optional) Foundry `cast` installed for x402 on-chain tests

---

## Infrastructure (G-1)

- [ ] All 3 services healthy: `staging-smoke.sh` Phases 1-2 green
- [ ] Service discovery resolving: Cloud Map DNS for finn, dixie, freeside
- [ ] ECS services running desired task count (check CloudWatch dashboard)
- [ ] RDS PostgreSQL accessible from ECS tasks
- [ ] Redis ElastiCache accessible and no evictions

**Verification:** `./scripts/staging-smoke.sh` — Phases P0-1, P0-2 must PASS.

---

## Authentication (G-2)

- [ ] JWKS endpoint serving valid ES256 keys with `kid` field
- [ ] JWT round-trip: freeside -> finn -> dixie chain verified
- [ ] Key rotation procedure tested (see `docs/runbooks/key-rotation.md`)
- [ ] Emergency revocation tested and documented

**Verification:** `./scripts/staging-smoke.sh --test-key staging.pem` — Phase P0-2, P0-3 must PASS.

---

## Core Flow (G-3, G-4)

- [ ] Agent invoke returns model response (Phase 3)
- [ ] Average invoke latency < 10s (PRD G-3)
- [ ] Budget conservation holds sequential (10 requests, invariant checked after each)
- [ ] Budget conservation holds concurrent (5 parallel requests, invariant checked)

**Verification:** `./scripts/staging-smoke.sh --test-key staging.pem --community-id <id>` — Phases P0-3, P0-4 must PASS.

---

## Autopoietic Loop (G-5)

- [ ] Reputation query returns score (Phase 5)
- [ ] Score changes after quality events (Phase 7)
- [ ] Routing observably affected by reputation (Phase 7 — model or priority change)

**Verification:** Phase P1-5 must PASS. Phase P1-7: PASS or SKIP (threshold not met is acceptable, FAIL PLATFORM_BUG is blocking).

---

## Payments (G-6)

- [ ] x402 endpoint returns 402 with payment-required headers (Phase 8 — mandatory)
- [ ] On-chain settlement completes on Base Sepolia (Phase 8 — if wallet configured)
- [ ] Credit note issued after payment proof submitted

**Verification:** Phase P1-8: 402 response validation is mandatory. On-chain payment is optional (SKIP if wallet not configured).

---

## Operations — Reliability (G-7)

- [ ] 3 consecutive full smoke test runs with 0 P0 failures
- [ ] Zero Fly.io deployment references in codebase
- [ ] All deploy scripts reference ECS/Terraform, not Fly.io
- [ ] Key rotation runbook exists and is actionable (`docs/runbooks/key-rotation.md`)

**Verification:**
```bash
# Run 3 consecutive times — all must have 0 P0 failures
for i in 1 2 3; do
  ./scripts/staging-smoke.sh --test-key staging.pem --community-id <id> --json --retries 3
done

# Check for Fly.io references
grep -r "fly\.io\|flyctl\|fly deploy" scripts/ infrastructure/ --include="*.sh" --include="*.tf" --include="*.yml"
# Expected: 0 results
```

---

## Operations — Migration (G-8)

- [ ] All infrastructure managed by Terraform (no manual AWS console changes)
- [ ] `terraform plan` shows no drift
- [ ] Deploy pipeline (`deploy-staging.yml`) works end-to-end
- [ ] Cross-repo orchestration (`staging-deploy-all.sh`) deploys all 3 services

**Verification:**
```bash
cd infrastructure/terraform && terraform plan -detailed-exitcode
# Exit code 0 = no changes needed

./scripts/staging-deploy-all.sh --dry-run
# Should show all 3 repos accessible and workflow triggers planned
```

---

## Monitoring & Observability (G-9)

- [ ] CloudWatch dashboards populated:
  - `overview` — ECS, RDS, ALB, Redis metrics
  - `service-health` — inference latency, billing flow, conservation guard
  - `economic-health` — conservation invariant, cost distribution, credit lots
  - `gateway-proxy` — ingestor, RabbitMQ, worker metrics
- [ ] Alarms configured and tested:
  - CPU/memory alarms fire within 60s of simulated spike
  - Budget overspend alarm triggers on invariant violation
  - JWT validation failure alarm triggers on auth chain break
  - Conservation violation alarm triggers on any breach
- [ ] Log metric filters active (both space-delimited and JSON format)
- [ ] p99 invoke latency alarm configured (threshold: 10s)

**Verification:** Check AWS CloudWatch console for all dashboards. Verify alarms are in OK state (not INSUFFICIENT_DATA).

---

## Chaos Engineering (Optional, Recommended)

- [ ] Duplicate finalization: idempotency verified
- [ ] Over-budget request: correctly rejected (402/429)
- [ ] Concurrent burst (10 parallel): conservation invariant holds

**Verification:** `./scripts/staging-smoke.sh --test-key staging.pem --community-id <id> --chaos`

---

## Launch Decision

| Criteria | Required | Status |
|----------|----------|--------|
| All P0 smoke test phases pass | Yes | |
| 0 P0 failures across 3 consecutive runs | Yes | |
| Conservation invariant holds (sequential + concurrent) | Yes | |
| JWKS with kid field verified | Yes | |
| Key rotation runbook exists | Yes | |
| CloudWatch dashboards populated | Yes | |
| Autopoietic loop observable | Recommended | |
| x402 402 response validated | Recommended | |
| Chaos scenarios pass | Recommended | |

**Launch gate:** All "Required" criteria must be met. "Recommended" items should be tracked as follow-up if not met.

---

## Quick Launch Command

```bash
# Full validation with all flags
./scripts/staging-deploy-all.sh && \
./scripts/staging-smoke.sh \
  --test-key staging.pem \
  --community-id test-community-staging-001 \
  --retries 3 \
  --auto-seed \
  --chaos \
  --json
```
