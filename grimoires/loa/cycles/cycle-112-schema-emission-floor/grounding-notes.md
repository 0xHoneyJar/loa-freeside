# Grounding notes — cycle-112 (closes SDD §5.2 + §8.1 open items)

Captured during Phase-4 Flatline SDD run (review-independent grounding). Feeds the
sprint plan (Phase 5) and any SDD §8.1 refinement.

## 1. The exact 11 NATS-ACVP emit sites (SDD §5.2 allowlist — was "~11", now enumerated)

Confirmed by transport type (not substring). These are the lint targets; allowlist
seeds here, shrinks via codemod/pilot.

| # | file:line | subject | transport | note |
|---|-----------|---------|-----------|------|
| 1 | `packages/adapters/coexistence/parallel-mode-orchestrator.ts:265` | `parallel.mode.enabled` | INatsPublisher | **PILOT (FR-10)** |
| 2 | `packages/adapters/coexistence/parallel-mode-orchestrator.ts:320` | `parallel.mode.disabled` | INatsPublisher | same file, codemod-eligible |
| 3 | `packages/adapters/coexistence/parallel-mode-orchestrator.ts:483` | `parallel.mode.sync.completed` | INatsPublisher | same file |
| 4 | `packages/adapters/coexistence/shadow-sync-job.ts:331` | `coexist.shadow.sync.complete` | INatsPublisher | |
| 5 | `packages/adapters/coexistence/shadow-sync-job.ts:678` | `coexist.tier.upgraded` | INatsPublisher | cleanest small payload |
| 6 | `packages/adapters/coexistence/shadow-sync-job.ts:763` | `coexist.shadow.digest.send` | INatsPublisher | |
| 7 | `packages/sandbox/src/services/event-router.ts:346` | `targetSubject` (computed) | `jetstream.publish` | **OQ-5 computed case** |
| 8 | `packages/sandbox/src/services/event-router.ts:397` | `targetSubject` (computed) | `jetstream.publish` | **OQ-5 computed case** |
| 9 | `apps/worker/src/services/NatsClient.ts:379` | `subject` (computed) | `jetstream.publish` | NatsClient wrapper's own publish — the codemod target for the worker's generic path |
| 10 | `packages/adapters/security/kill-switch.ts:150` | `internal.killswitch` | `nats.publish` | control-plane broadcast (borderline ACVP — a control event, not a domain event; SDD should decide if it gets a schema or stays an allowlisted control-plane carve-out) |
| 11 | `packages/adapters/security/kill-switch.ts:193` | `internal.killswitch` | `nats.publish` | same |

`packages/events/src/publisher.ts:166` (`nats.publish`) is INSIDE the events
package → lint scope-excluded by definition, NOT an allowlist entry.

## 2. Carve-outs (NG-3 — lint must NOT fire). Confirmed by import.

- `apps/ingestor/src/handlers.ts` ×7 + `apps/ingestor/src/publisher.ts` ×1 →
  **amqplib / RabbitMQ** (`import amqp from 'amqplib'`, ConfirmChannel). The legacy
  AMQP ingestor edge.
- `apps/worker/src/services/StateManager.ts:379` (`this.client.publish`) →
  **ioredis. THIS IS THE COUNCIL'S "Redis side-door."** The universal-bypass risk
  (PRD §7). The SDD lint keys on the NATS transport *type*, so this Redis path is
  out of scope — but the sprint MUST confirm no NATS-ACVP emit is laundered through
  `stateManager.publish` (it isn't today: ConfigReloader + L2Cache use it for
  config-reload + cache-invalidation, both legitimately Redis).
- `apps/worker/src/services/ConfigReloader.ts` ×3 + `…/cache/L2Cache.ts` ×1 → via
  `stateManager.publish` → Redis.
- `themes/sietch/src/services/config/ConfigPublisher.ts:104` (`this.redis.publish`) → ioredis.
- `packages/cli/src/commands/server/backup/NotificationService.ts` ×4 → notifier
  (own `this.publish({...})` method, not a bus).

## 3. `economic-event-dispatch.ts:133` is NOT a lint target

`themes/sietch/src/jobs/economic-event-dispatch.ts:69` →
`private publish: (events: OutboxEvent[]) => Promise<void>` — an injected **outbox
drain** over `OutboxEvent[]`. This is the governance-outbox completeness surface =
**cycle-2 (PRD §10/C2-0)**, not a raw NATS emit. The 11 above stand exactly; this
is correctly excluded.

## 4. SDD §8.1 RESOLVED — FR-13's beacon home (was an open item, is a real finding)

**Finding:** `packages/freeside-registry/registry.yaml` registers **8 external
`*-api` buildings** (sonar-api, identity-api, inventory-api, score-api, storage-api,
mint-api, mediums-api, activities-api), each with its own `packages/protocol/
beacon.yaml` *in its own repo*. **loa-freeside (the platform monolith) is NOT a
registered building and has NO beacon.yaml anywhere in-repo.** Per the factory model
the platform "contains NO feature logic" — it hosts buildings, it isn't one.

So FR-13's "the pilot building SHALL declare acvp_invariants in its BeaconV3" has no
existing home — the coexistence seam lives in the un-beaconed monolith.

**Resolution (honest + closes the meta-gap):** this cycle creates the **first
in-repo beacon** — `packages/events/beacon.yaml`, slug **`freeside-events`**
(visibility: internal, runtime_state: library/not-built) — declaring:

```yaml
acvp_invariants:
  - id: schema_enforcement
    scope: "Every NATS event emitted via emit() is payload-validated against its
            registry schema before signing; raw .publish is unreachable outside packages/events."
    proof_artifact: "tests/acvp/schema_enforcement.test.ts"
    runtime_class: envelope
    status: active
```

…and registers `freeside-events` in `registry.yaml::modules`. This is the exact
closure arrakis-vl8f asked for ("packages/events declares no invariants for the
protocol it defines"). The protocol-definer finally declares its own invariant,
proven by the pilot's emit()-validates-then-rejects test (FR-12).

`validateAcvpBindings` then has a real in-repo target → `contract_status: bound`
(FR-14). NO aspirational-allowlist entry needed (it's `active`, proof-backed).

**Sprint impact:** S5 (coverage) gains a sub-task: "create `packages/events/
beacon.yaml` + register `freeside-events` slug." This is net-new but small, and it
makes loa-freeside's first in-repo beacon — a precedent worth getting right.

## 5. Aspirational-allowlist restagger target (FR-ADOPT-8)

`.freeside/acvp-aspirational-allowlist.yaml` currently stacks ALL entries on
`expires: "2026-08-30"` (sonar-api ×3: event_completeness/monotonicity/audit_replay;
identity-api ×1: idempotency). FR-ADOPT-8 S5 sub-task restaggers these to distinct
dates so they don't all fail-block CI on the same day. (These are external-building
entries; restaggering is a dated-deadline edit, not a code change.)
