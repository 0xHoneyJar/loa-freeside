# NATS Wire Schema Governance

This document describes how the cross-language NATS wire format is maintained between the Rust gateway and TypeScript workers.

## Why This Exists

**BB60-20 Incident:** The Rust gateway serialized an interaction field as `token` while the TypeScript consumer expected `interaction_token`. The mismatch caused silent message drops in production. This governance model prevents that class of bug.

## Schema Ownership

The **committed JSON fixtures** in `fixtures/` are the neutral source of truth — neither Rust nor TypeScript "owns" the wire format. Both sides must conform to the fixtures.

| Layer | Owner | Location |
|-------|-------|----------|
| Wire format fixtures | Shared (neutral) | `packages/shared/nats-schemas/fixtures/` |
| Zod schemas | TypeScript | `packages/shared/nats-schemas/src/schemas/` |
| GatewayEvent struct | Rust | `apps/gateway/src/events/serialize.rs` |
| Routing config | Shared (JSON) | `packages/shared/nats-schemas/nats-routing.json` |

## How to Add a New Event Type

1. **Add the Rust serializer** in `serialize.rs` — new `Event::*` arm returning `GatewayEvent`
2. **Create a fixture** in `fixtures/{event-name}.json` with deterministic values
3. **Add a Zod data schema** in `schemas/event-data.ts`
4. **Export** from `src/index.ts`
5. **Add conformance tests**:
   - Rust: Add to `fixture_conformance` module in `serialize.rs` and `ALL_FIXTURES` in `tests/wire_format.rs`
   - TypeScript: Add to `fixture-conformance.test.ts` and `wire-format-roundtrip.test.ts`
6. **Update `KNOWN_EVENT_TYPES`** in `gateway-event.ts`
7. **Update routing** in `nats-routing.json` if the event needs a specific subject

## How to Rename a Field

1. **Update the Rust serializer** — change the field name in the `serde_json::json!` block
2. **Regenerate fixtures**: `REGENERATE_FIXTURES=1 cargo test -p arrakis-gateway --test wire_format`
3. **Update the Zod schema** — rename the field in the corresponding `*DataSchema`
4. **Run both test suites**: `scripts/test-wireformat.sh`
5. **Commit the updated fixtures** — the CI freshness check will fail if you forget

## CI Verification

The `gateway-ci.yml` workflow includes:

1. **Cargo test** — runs Rust fixture conformance tests (both unit and integration)
2. **Anyhow boundary lint** — ensures domain errors are used instead of anyhow
3. **Wire format fixture freshness** — regenerates fixtures from Rust and checks for drift

TypeScript tests run in the nats-schemas package CI.

## Transport vs Enrichment Schemas (BB60-S5-1)

Interaction schemas are split into two tiers:

- **Transport** (`InteractionTransportPayloadSchema`): Strict — only the 3 fields Rust produces
- **Enriched** (`InteractionPayloadSchema`): Permissive — transport + optional middleware fields

See `schemas/interaction-payload.ts` for details. The Hounfour RFC's Tool Calling Contract (loa-finn#31 §5.3) uses the same pattern for normalizing tool calls across model providers.
