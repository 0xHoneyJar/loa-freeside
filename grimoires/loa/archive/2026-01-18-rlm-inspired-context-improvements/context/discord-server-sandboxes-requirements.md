# Discord Server Sandboxes - Requirements Context

## Feature Branch
`feature/discord-server-sandboxes` (based off `staging`)

## Primary Use Cases (Priority Order)

1. **Testing/QA** (IMMEDIATE) - Isolated environments for testing bot features before production
2. **Dev Environments** - Each developer gets their own sandbox for local development
3. **Multi-tenant** - Separate sandbox per customer/tenant for SaaS offering (FUTURE)
4. **Demo/Sales** - Spin up sandboxes for demos and tear down after (FUTURE)

## Scope for Initial Implementation

**Goal:** Testing out features which will be added to the Discord bot

**Future Vision:** Developer platform where other bot developers can build on top of Arrakis (paid service - not prioritized now)

## Components (Initial)

For testing purposes, recommend:
- Bot instance with isolated config
- Namespaced database schema (shared RDS, isolated schema/tenant)
- Redis namespace isolation
- Isolated queue bindings in RabbitMQ

NOT needed initially:
- Completely separate AWS resources (too expensive for testing)
- Full infrastructure isolation (reserved for paid multi-tenant later)

## Management Interface

1. **CLI commands** (PRIMARY) - `bd` or custom CLI to create/destroy sandboxes
2. **API endpoints** (SECONDARY) - REST API to provision sandboxes programmatically

NOT needed initially:
- Discord slash commands for sandbox management

## Key Requirements

1. **Zero-config / Minimal setup** - Should be trivial to spin up
2. **Minimal token/API credentials required** - Reduce friction
3. **Easy rollout and teardown** - Quick to create and destroy
4. **Developer-friendly** - Primarily used by internal devs

## Questions to Answer in Planning

1. What Discord credentials are needed per sandbox? (Bot token, App ID, etc.)
2. Can we share a single Discord application with multiple bot instances?
3. How do we isolate database state per sandbox?
4. How do we route Discord events to the correct sandbox?
5. What naming convention for sandboxes? (e.g., `sandbox-{dev-name}`, `sandbox-{uuid}`)
6. How long should sandboxes persist? Auto-cleanup?

## Technical Considerations

- Leverage existing multi-tenant architecture from SaaS platform work
- Consider `tenant_id` based isolation already in the codebase
- RLS (Row Level Security) policies may help with DB isolation
- NATS subject namespacing for event routing
