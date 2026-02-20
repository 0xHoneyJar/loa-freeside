# NATS Event Protocol

<!-- cite: loa-freeside:packages/shared/nats-schemas/nats-routing.json -->
<!-- cite: loa-freeside:packages/shared/nats-schemas/src/schemas/gateway-event.ts -->
<!-- cite: loa-freeside:packages/shared/nats-schemas/src/schemas/event-data.ts -->
<!-- cite: loa-freeside:packages/shared/nats-schemas/src/routing.ts -->
<!-- cite: loa-freeside:apps/gateway/src/main.rs -->

> Version: v1.1.0

This document describes the NATS event protocol — the machine-facing API surface of the Loa platform. While the [API Reference](API-REFERENCE.md) covers HTTP endpoints for human-driven integrations, this protocol is how platform components communicate internally and how Layer 5 products subscribe to real-time events.

---

## Overview

The event protocol connects the Rust gateway (Discord WebSocket → NATS) to TypeScript workers via JetStream. All messages use the `GatewayEvent` envelope schema defined in loa-hounfour. JSON fixtures committed in loa-hounfour are the neutral source of truth — both TypeScript Zod validation and Rust `serde` deserialization validate against the same fixtures.

```
Discord WebSocket
      │
      ▼
Rust Gateway (apps/gateway)
      │  serializes to GatewayEvent
      ▼
NATS JetStream
      │  subject from NATS_ROUTING
      ▼
TypeScript Worker
      │  validates via Zod schemas
      ▼
Agent invocation / event processing
```

---

## Streams

<!-- cite: loa-freeside:packages/shared/nats-schemas/nats-routing.json -->

3 JetStream streams, defined in `nats-routing.json`:

| Stream | Subjects | Description |
|--------|----------|-------------|
| `COMMANDS` | `commands.>` | Slash command interactions |
| `EVENTS` | `events.>` | Guild and member lifecycle events |
| `ELIGIBILITY` | `eligibility.>` | Token eligibility checks |

The routing configuration is language-neutral JSON consumed by both TypeScript (via `import`) and Rust (via CI-enforced test). Do not edit `nats-routing.json` without updating both sides.

---

## Subject Namespaces

<!-- cite: loa-freeside:packages/shared/nats-schemas/nats-routing.json -->

### Commands

| Subject | Description |
|---------|-------------|
| `commands.interaction` | Slash command interaction from Discord |

### Guild Events

| Subject | Description |
|---------|-------------|
| `events.guild.join` | Bot added to a guild |
| `events.guild.leave` | Bot removed from a guild |
| `events.guild.update` | Guild configuration changed |

### Member Events

| Subject | Description |
|---------|-------------|
| `events.member.join` | Member joined a guild |
| `events.member.leave` | Member left a guild |
| `events.member.update` | Member profile updated (roles, nickname) |

---

## GatewayEvent Envelope

<!-- cite: loa-freeside:packages/shared/nats-schemas/src/schemas/gateway-event.ts#L24-L45 -->

Every message on the NATS wire matches this envelope schema. The Zod definition mirrors the Rust `GatewayEvent` struct in `serialize.rs` field-for-field.

| Field | Type | Description |
|-------|------|-------------|
| `event_id` | `string` (UUIDv4) | Unique event identifier |
| `event_type` | `string` | Dot-separated event classifier (e.g., `guild.join`) |
| `shard_id` | `number` (int, ≥ 0) | Discord shard that produced the event |
| `timestamp` | `number` (int, ≥ 0) | Unix epoch milliseconds (`u64` in Rust → `number` in JS) |
| `guild_id` | `string \| null` | Discord guild snowflake (null for DM events) |
| `channel_id` | `string \| null` | Discord channel snowflake |
| `user_id` | `string \| null` | Discord user snowflake |
| `data` | `unknown` | Event-specific payload (see Event Data Schemas below) |

### Forward Compatibility

The `data` field is typed as `z.unknown()` intentionally. New event types from the Rust gateway are accepted without schema changes on the TypeScript side. A future v2 may replace this with a discriminated union keyed on `event_type`, but the current design prioritizes forward compatibility over compile-time exhaustiveness.

---

## Event Type → Subject Mapping

<!-- cite: loa-freeside:packages/shared/nats-schemas/nats-routing.json -->

7 known event types, each mapped to a NATS subject:

| Event Type | Subject | Stream |
|-----------|---------|--------|
| `interaction.create` | `commands.interaction` | COMMANDS |
| `guild.join` | `events.guild.join` | EVENTS |
| `guild.leave` | `events.guild.leave` | EVENTS |
| `guild.update` | `events.guild.update` | EVENTS |
| `member.join` | `events.member.join` | EVENTS |
| `member.leave` | `events.member.leave` | EVENTS |
| `member.update` | `events.member.update` | EVENTS |

### Known Event Type Guard

<!-- cite: loa-freeside:packages/shared/nats-schemas/src/schemas/gateway-event.ts#L63-L78 -->

The `KNOWN_EVENT_TYPES` constant and `isKnownEventType()` guard provide a dispatch safety mechanism. Consumers can log warnings on unrecognized event types without rejecting them — enabling the Rust gateway to add new event types without breaking existing workers.

---

## Event Data Schemas

<!-- cite: loa-freeside:packages/shared/nats-schemas/src/schemas/event-data.ts -->

Each event type has a corresponding Zod schema for its `data` payload. These schemas validate the **minimum contract** — they use `.passthrough()` where the Rust side serializes additional fields that TypeScript consumers don't currently need.

### guild.join

<!-- cite: loa-freeside:packages/shared/nats-schemas/src/schemas/event-data.ts#L26-L32 -->

| Field | Type | Required |
|-------|------|----------|
| `id` | `string` | Yes |
| `name` | `string` | No |
| `member_count` | `number` (int) | No |

Uses `.passthrough()` — Rust serializes the full Twilight guild object (40+ fields). This schema validates only the fields the worker reads.

### guild.leave

<!-- cite: loa-freeside:packages/shared/nats-schemas/src/schemas/event-data.ts#L39-L41 -->

| Field | Type | Required |
|-------|------|----------|
| `unavailable` | `boolean` | No |

### guild.update

No specific data schema exists in `event-data.ts` for `guild.update`. The `data` field uses the forward-compatibility pattern (`z.unknown()`) from the GatewayEvent envelope. Rust serializes the Twilight guild object with the updated fields — consumers should treat the payload as opaque and extract only the fields they need. A typed schema may be added in a future version when worker requirements stabilize.

### member.join

<!-- cite: loa-freeside:packages/shared/nats-schemas/src/schemas/event-data.ts#L52-L55 -->

| Field | Type | Required |
|-------|------|----------|
| `username` | `string` | Yes |
| `discriminator` | `number \| null` | Yes |

### member.leave

<!-- cite: loa-freeside:packages/shared/nats-schemas/src/schemas/event-data.ts#L63 -->

Rust sends `Value::Null` — payload is `null` or an empty object.

### member.update

<!-- cite: loa-freeside:packages/shared/nats-schemas/src/schemas/event-data.ts#L70-L73 -->

| Field | Type | Required |
|-------|------|----------|
| `roles` | `string[]` | Yes |
| `nick` | `string \| null` | Yes |

### interaction.create

<!-- cite: loa-freeside:packages/shared/nats-schemas/src/schemas/event-data.ts#L87-L91 -->

| Field | Type | Required |
|-------|------|----------|
| `interaction_id` | `string` | Yes |
| `interaction_type` | `string` | Yes |
| `interaction_token` | `string` | Yes |

Note: The field is `interaction_token` (not `token`) per BB60-20 fix.

---

## Subscription Patterns

NATS JetStream supports wildcard subscriptions for flexible event consumption:

### By Guild (all events for a specific guild)

```
# Subscribe to all guild events
events.guild.>

# Subscribe to all member events
events.member.>
```

### By Event Type (specific event across all guilds)

```
# Only join events
events.guild.join
events.member.join
```

### Wildcard (all events)

```
# All events on the EVENTS stream
events.>

# All commands
commands.>
```

### Consumer Groups

JetStream consumers support durable subscriptions with queue groups for horizontal scaling. Multiple worker instances can share a consumer group — JetStream delivers each message to exactly one consumer in the group.

---

## Gateway Architecture

<!-- cite: loa-freeside:apps/gateway/src/main.rs -->

The Rust/Axum gateway bridges Discord WebSocket connections to NATS JetStream:

| Component | Technology | Purpose |
|-----------|-----------|---------|
| WebSocket Client | Twilight (Rust) | Discord gateway connection |
| HTTP Server | Axum | Health checks, metrics |
| Message Bus | NATS JetStream | Event publication |
| Serialization | serde_json | Discord events → GatewayEvent JSON |

### Shard Pool

The gateway manages a pool of Discord shards. Each shard maintains an independent WebSocket connection. The `shard_id` field in `GatewayEvent` identifies which shard produced the event, enabling consumers to track per-shard health and ordering.

### Schema Agreement

The critical invariant: JSON fixtures committed in loa-hounfour are validated by both sides:
- **Rust**: `serde` deserialization tests against fixtures
- **TypeScript**: Zod `.parse()` tests against the same fixtures

This ensures the Rust serialization and TypeScript validation agree on the wire format without requiring a shared code generation step.

---

## Relationship to Hounfour

<!-- cite: loa-freeside:packages/shared/nats-schemas/src/routing.ts -->

The NATS schema package in loa-freeside (`packages/shared/nats-schemas/`) provides the TypeScript-side implementation of contracts defined by loa-hounfour:

| Concept | Canonical Source | Freeside Implementation |
|---------|-----------------|------------------------|
| Event envelope | `GatewayEventSchema` (hounfour) | `gateway-event.ts` Zod schema |
| Stream/subject config | `nats-routing.json` (shared) | `routing.ts` TypeScript loader |
| Event data schemas | Rust serialize.rs (gateway) | `event-data.ts` Zod schemas |
| Protocol types | `@0xhoneyjar/loa-hounfour` | Direct npm dependency |

The `NATS_ROUTING` export from `routing.ts` is the single source of truth for stream names, subject prefixes, and event-type-to-subject mapping within the TypeScript codebase.

---

## Failure Modes

<!-- cite: loa-freeside:apps/gateway/src/main.rs -->
<!-- cite: loa-freeside:packages/shared/nats-schemas/src/schemas/gateway-event.ts -->

| Failure | Behavior | Rationale |
|---------|----------|-----------|
| **NATS unreachable (gateway)** | Gateway buffers events in memory; drops oldest on overflow. Shard connections remain alive — Discord events accumulate until NATS recovers. | Losing events is preferable to losing shard connections. Gateway recovery is faster than Discord reconnection. |
| **Consumer lag (JetStream)** | JetStream redelivers unacknowledged messages after the ack timeout. Consumers receive duplicates — idempotency must be handled at the worker level. | At-least-once delivery is the JetStream default. Exactly-once requires consumer-side deduplication via `event_id`. |
| **Deserialization failure (Zod)** | Worker logs a structured warning with the raw payload and continues. The message is acknowledged (not redelivered) to prevent poison-message loops. | A single malformed event should not block the consumer. The `z.unknown()` data field absorbs most schema mismatches; Zod failures indicate envelope-level corruption. |
| **Gateway restart (shard reconnection)** | Twilight re-establishes WebSocket connections per shard. Discord sends a READY event with missed events via the gateway's resume sequence. Brief gap possible if resume fails — Discord falls back to full reconnection. | Discord's gateway protocol handles reconnection natively. The `shard_id` field enables consumers to detect per-shard gaps. |
| **Duplicate delivery** | JetStream may redeliver on ack timeout or consumer restart. Workers must use `event_id` (UUIDv4) for deduplication. | At-least-once is the safe default; exactly-once delivery requires application-level idempotency. |

### Message Ordering

NATS JetStream preserves ordering within a single subject. Events published to `events.guild.join` arrive in publication order. Cross-subject ordering is **not guaranteed** — a `member.join` event may arrive before the corresponding `guild.join` if they were published to different subjects in rapid succession.

---

## Stability Tiers

<!-- cite: loa-freeside:packages/shared/nats-schemas/nats-routing.json -->
<!-- cite: loa-freeside:packages/shared/nats-schemas/fixtures/ -->
<!-- cite: loa-freeside:packages/shared/nats-schemas/SCHEMA-GOVERNANCE.md -->

The event protocol uses the same two-tier stability model as [API-REFERENCE.md](API-REFERENCE.md). When Layer 5 products (loa-dixie) subscribe to NATS events, they need the same stability guarantees as HTTP API consumers. The `GatewayEvent` envelope schema is arguably *more* foundational than any HTTP endpoint — HTTP endpoints are consumed by humans; NATS events are consumed by autonomous agents.

### Tier 1 — Stable

These subjects, schemas, and stream names are guaranteed stable. Breaking changes follow a **2-cycle deprecation policy** documented in [API-CHANGELOG.md](API-CHANGELOG.md).

| Element | Type | Stable Since |
|---------|------|-------------|
| `GatewayEvent` envelope schema | Schema | v1.0.0 |
| `COMMANDS` stream | Stream | v1.0.0 |
| `EVENTS` stream | Stream | v1.0.0 |
| `ELIGIBILITY` stream | Stream | v1.0.0 |
| `events.guild.>` subject pattern | Subject | v1.0.0 |
| `events.member.>` subject pattern | Subject | v1.0.0 |
| `commands.interaction` subject | Subject | v1.0.0 |

**Evidence of stability:** All Tier 1 schemas have committed JSON fixtures in `packages/shared/nats-schemas/fixtures/` validated by both TypeScript (Zod) and Rust (serde) in CI. The fixture-based cross-language validation (see [SCHEMA-GOVERNANCE.md](../packages/shared/nats-schemas/SCHEMA-GOVERNANCE.md)) ensures wire-format stability across implementations.

**Deprecation process:** Changes to Tier 1 elements require:
1. Two development cycles of deprecation notice in [API-CHANGELOG.md](API-CHANGELOG.md)
2. A new fixture added alongside the deprecated fixture
3. Both old and new fixtures passing CI for the deprecation period

### Tier 2 — Unstable

These elements may change without notice. Consumers should handle them defensively.

| Element | Type | Reason |
|---------|------|--------|
| Event data payload shapes beyond the 6 documented types | Schema | New event types may be added from Rust gateway |
| `guild.update` data payload | Schema | Uses `z.unknown()` forward-compatibility pattern |
| `eligibility.>` subject structure | Subject | Eligibility subsystem under active development |
| Consumer group naming conventions | Configuration | Deployment-specific; may vary between environments |
| Wildcard subject extensions beyond documented patterns | Subject | New namespaces may be introduced |

### Promotion Criteria

A Tier 2 element may be promoted to Tier 1 when:
1. Stable for 2+ development cycles without breaking changes
2. Documented in this file with full schema specification
3. Covered by committed JSON fixtures in `packages/shared/nats-schemas/fixtures/`
4. Cross-language validation tests pass (TypeScript Zod + Rust serde)

---

## Versioning & Stability

This document follows the **Protocol Document** governance tier defined in [DEVELOPER-GUIDE.md](DEVELOPER-GUIDE.md#document-versioning). Changes to Tier 1 elements (envelope schema, stream names, stable subjects) require a major version bump and core team review. See the [Stability Tiers](#stability-tiers) section above for the full classification.

---

## Related Documentation

- [API-REFERENCE.md](API-REFERENCE.md) — HTTP endpoints (the human-facing API surface)
- [ECONOMICS.md](ECONOMICS.md) — Economic primitives triggered by agent invocations through this protocol
- [ECOSYSTEM.md](ECOSYSTEM.md) — How the 5-repo Loa protocol fits together
- [INFRASTRUCTURE.md](INFRASTRUCTURE.md) — AWS deployment where the gateway and workers run
- [DEVELOPER-GUIDE.md](DEVELOPER-GUIDE.md#document-versioning) — Document versioning governance
