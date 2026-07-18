# CR-013 signing-key custody — game-day verification runbook

**Evidence ID:** EV-G1B4-key-custody-game-day  
**Owner:** platform-deployment-owner  
**Renewal:** every 90 days  
**Package:** `@freeside/signing-key-custody-protocol`

This runbook exercises production signing-key custody without placing private
keys in application repositories. Each drill produces observable evidence that
registry propagation, fail-closed intake, and dependency quarantine behave as
specified in sprint CR-013.

## Preconditions

- Production registry published to the pinned distribution channel (not git).
- Ordering consumes `PinnedKeyRegistry` + `gateSignedIntake()` before CR-009 verify.
- ≥2 independent NTP or cloud time sources configured for database skew probes.
- On-call has KMS/HSM revoke/rotate permissions and registry publish access.

## Observability checklist

Before each drill, capture:

| Signal | Source |
|--------|--------|
| `registry_id`, `registry_generation`, `age_ms`, `is_stale` | `registryObservability()` |
| `measured_offset_ms`, `offset_uncertainty_ms`, `regional_divergence_ms` | `timeHealthObservability()` |
| `intake_blocked`, `block_reason` | `TimeHealthSnapshot` |
| Active signing keys per producer | pinned registry document |

## Drill 1 — Overlap rotation

1. Publish registry generation N+1 with overlapping `activated_at` / `revoked_at`
   windows for previous and next production keys.
2. Confirm producers sign with the new key while consumers accept both during overlap.
3. After overlap ends, revoke previous key in generation N+2.
4. **Pass:** envelopes verify through overlap; post-revocation envelopes from old key reject with `revoked_signing_key`.

## Drill 2 — Emergency compromise

1. Mark compromised key via `CompromiseEvent` and publish emergency registry generation.
2. Execute `buildEmergencyRevocationPlan()` — quarantine signed intake enabled.
3. **Pass:** intake rejects compromised key with `compromised_signing_key`; dependency ledger quarantines affected stream until clean generation pinned.

## Drill 3 — Registry staleness

1. Stop registry refresh beyond `max_staleness_ms`.
2. Attempt signed envelope intake.
3. **Pass:** `registry_stale` rejection before signature verification; observability shows `is_stale: true`.

## Drill 4 — Database clock jump (>2s skew)

1. Induce or simulate database clock offset >2000ms from authoritative sources.
2. Attempt signed intake and authorization lease issuance.
3. **Pass:** `database_clock_skew_exceeded` blocks intake; leases are not issued on skewed clock.

## Drill 5 — Time-source loss

1. Reduce authoritative sources below 2 (simulate NTP outage or network partition).
2. **Pass:** `insufficient_time_sources` blocks intake fail-closed.

## Drill 6 — Regional divergence

1. Configure sources reporting >500ms inter-region median spread (test harness or controlled skew injection).
2. **Pass:** `time_source_divergence` blocks intake until sources reconcile.

## Drill 7 — Recovery

1. Restore registry refresh, republish current generation, restore ≥2 time sources within skew threshold.
2. Replay quarantined envelopes after baseline catch-up.
3. **Pass:** `intake_blocked: false`, `last_good_at` updated, dependency intake resumes without accepting stale registry.

## Fixture vs production gate

T1 drills may use `key_class_scope: "fixture"` registries only. Production
release gates (G1B-4) require `satisfiesProductionReleaseGate()` over a
production-scoped registry — fixture proof must not satisfy this check.

## Evidence retention

Store for each drill:

- Registry generation snapshots (public metadata only)
- Time-health snapshots before/during/after
- Rejection reason codes from intake gate
- Operator timestamp and environment identifier

Attach evidence to CR-013 / G1B-4 gate closure in the collection-report coordinator.
