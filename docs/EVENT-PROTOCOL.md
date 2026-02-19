# NATS Event Protocol

<!-- cite: loa-freeside:packages/shared/nats-schemas/nats-routing.json -->
<!-- cite: loa-freeside:packages/shared/nats-schemas/src/schemas/gateway-event.ts -->
<!-- cite: loa-freeside:packages/shared/nats-schemas/src/schemas/event-data.ts -->
<!-- cite: loa-freeside:packages/shared/nats-schemas/src/routing.ts -->
<!-- cite: loa-freeside:apps/gateway/src/main.rs -->

> Version: v1.0.0

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

## Related Documentation

- [API-REFERENCE.md](API-REFERENCE.md) — HTTP endpoints (the human-facing API surface)
- [ECONOMICS.md](ECONOMICS.md) — Economic primitives triggered by agent invocations through this protocol
- [ECOSYSTEM.md](ECOSYSTEM.md) — How the 5-repo Loa protocol fits together
- [INFRASTRUCTURE.md](INFRASTRUCTURE.md) — AWS deployment where the gateway and workers run
