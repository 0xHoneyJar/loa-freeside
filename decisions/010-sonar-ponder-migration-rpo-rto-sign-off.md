# ADR-010: Sonar-Ponder Migration — RPO/RTO Sign-Off + A-4 Production Cutover Authorization

**Status**: Accepted (operator-signed 2026-05-27)
**Date**: 2026-05-27
**Cycle**: `sonar-ponder-migration-v1`
**Coordinator**: [sonar-ponder-coordinator](https://github.com/0xHoneyJar/sonar-api/issues/40)
**Predecessor**: [ADR-009](009-freeside-hexagonal-federation.md) (cluster composition + per-cell harness)
**Authority**: operator (zksoju · zerkereth@gmail.com)

## Decision

Operator authorizes the **Sonar-Ponder substrate migration** (envio → Ponder, belt-by-belt) under the following recovery targets, after empirical validation via Sprints A-0 through A-3.5:

| Target | Value | Rationale |
|---|---|---|
| **RPO** (Recovery Point Objective) | **≤ 2 hours** | Worst-case data loss if cutover catastrophically fails. Achieved by `scripts/snapshot-pre-cutover.sh` cron at 2h cadence + outbox deterministic-ID idempotency (cookbook §T-A0.9). |
| **RTO** (Recovery Time Objective) | **≤ 30 minutes** | Wall-clock outage during rollback. Procedure: replay pre-cutover metadata snapshot via `scripts/cutover-hasura-tracking.sh rollback` (empirically measured at **716ms-1.27s** during A-3 staging dry-run 2026-05-27). 30-min budget covers worst-case Postgres state divergence requiring snapshot restore. |

These are the SDD `§RPO + RTO targets` defaults. Operator considered tighter (10min RTO / 30min RPO) and looser (2h RTO / 6h RPO) variants and chose the defaults — empirical margin is large; tighter wouldn't have meaningfully changed risk posture; looser would have accepted unjustified data loss given the easy achievement of 2h/30min.

## A-4 production cutover authorization

Operator authorizes A-4 dispatch within the **next 24 hours**, in a low-traffic window of operator's choosing. A-4 deliverables (agent-doable):

- `scripts/deploy-blue.sh` — Railway deploy wrapper for the blue belt (`belt-indexer-green` service flip)
- `scripts/ac-1-through-6-validate.sh` — per-AC validation harness against blue post-deploy
- `scripts/abort-threshold-check.sh` — auto-abort guard during the cutover window
- `scripts/nats-reconciliation-24h.sh` — double-emit reconciliation across the 24h observation window

The actual cutover execution (Railway deploy, Hasura metadata swap to blue, traffic flip, observation) remains operator-led.

## Why now (empirical evidence)

Sprints A-0 through A-3.5 produced concrete evidence that the migration is safe to attempt:

| Sprint | Evidence | Verdict |
|---|---|---|
| **A-0** | Ponder 0.16.6 API verified against real install. 10/10 tasks PASS. Cookbook produced 9 SDD corrections (C-1..C-6, D-1, D-2, R-1). | API model sound. |
| **A-1** | 34 Mibera entities + uint256-safe schema + cutover/snapshot scripts + index parity audit (7/7 mirrored, 0 gap rows). | Schema deployable. |
| **A-2** | 11 handlers ported · sync-status + reorg-safe-emit + NATS publisher + outbox/DLQ/alerts. 166 unit tests green. AC-A-7 byte-parity **empirical 10/10**. | Handler runtime byte-identical to envio. |
| **A-3** | 35 Hasura contract tests + reorg drill + rollback drill + reconnect drill + staging runbook. **T-A3.9 reorg drill PASS empirical** (20 events × 5 replays = 0 dupes against real green Postgres, 7.2s). Caught 4 cutover-script defects. | Outbox idempotency proven; cutover defects surfaced before production. |
| **A-3.5** | All 4 cutover defects patched + dry-run re-run end-to-end against `belt-hasura-green`. Cutover apply: `is_consistent: true`, 0 inconsistencies. Rollback RTO: 767ms. | Cutover script production-ready. |

## What this ADR does NOT authorize

- Auto-dispatch of A-4 execution itself. Agent writes the deploy/validation/reconciliation scripts; operator runs them in the chosen cutover window.
- Tightening or loosening the RPO/RTO targets without an amendment to this ADR.
- Skipping the 24-hour NATS double-emit reconciliation post-cutover (per Flatline SKP-001).
- Cutover of the green-belt subset (HoneyJar / Crayons / ApDAO / Apiculture / Aquabera-wall / Badge1155 / BGT / Fatbera) — those are scoped to Sprint B-1. Blue belt = Mibera-belt only.

## Open items operator must complete before A-4 execution

- [ ] Find sietch-discord's real production query logs + replace the 5 synthesized fixtures in `test/hasura-contract/fixtures/queries.json` (A-3 flagged this gap)
- [ ] Validate consumer reconnect drill against real client implementations (mediums, sietch-discord, freeside-score) — A-3's drill uses mock subscribers
- [ ] Schedule the cutover window (low-traffic, on-call coverage)
- [ ] Confirm Railway alerting webhook target for `[OUTBOX-DLQ-ALERT]` log marker (A-2 T-A2.9)

## References

- Master plan: `grimoires/loa/{prd,sdd,sprint}.md`
- Cookbook (the gate): `grimoires/loa/spikes/ponder-api-verification/COOKBOOK.md`
- Cutover script (post-A-3.5): `scripts/cutover-hasura-tracking.sh` (in `0xHoneyJar/sonar-api`)
- Reorg drill: `scripts/reorg-drill.sh`
- Coordinator: [sonar-ponder-coordinator](https://github.com/0xHoneyJar/sonar-api/issues/40)
- Flatline SKP-001 (RPO/RTO criticality): cycle `sonar-ponder-migration-v1` Flatline integration log
- ADR-009 (cluster composition predecessor): [009-freeside-hexagonal-federation.md](009-freeside-hexagonal-federation.md)

## Signed

Operator: **zksoju** (zerkereth@gmail.com) — 2026-05-27
