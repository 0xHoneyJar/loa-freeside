# Product Requirements Document: Discord Server Sandboxes

**Version**: 1.0
**Date**: January 17, 2026
**Status**: DRAFT - Pending Approval
**Feature Branch**: `feature/discord-server-sandboxes`
**Base Branch**: `staging`

---

## Document Traceability

| Section | Primary Source | Secondary Sources |
|---------|---------------|-------------------|
| Requirements | grimoires/loa/context/discord-server-sandboxes-requirements.md | User interview responses |
| Architecture | packages/adapters/storage/tenant-context.ts | apps/worker/src/services/TenantContext.ts |
| Infrastructure | infrastructure/terraform/ | apps/gateway/.env.example |

**Related Documents**:
- `grimoires/loa/prd.md` v2.0 (Arrakis Genesis - Parent PRD)
- `grimoires/loa/sdd.md` (Software Design Document)

---

## 1. Executive Summary

### 1.1 Product Overview

**Discord Server Sandboxes** is a developer tooling feature that enables isolated testing environments for the Arrakis Discord bot. Each sandbox provides a logically isolated instance that can be trivially spun up and torn down, leveraging the existing multi-tenant architecture.

**Key Value Proposition**: Zero-config sandbox creation for internal developers, with a path toward a paid developer platform for third-party bot builders.

### 1.2 Problem Statement

**Current State:**
- Testing new bot features requires either:
  - Using production environment (risky)
  - Manual setup of isolated test environments (time-consuming)
- No standardized way to create isolated Discord bot instances
- Developers need to manage separate Discord tokens, database schemas, and queue bindings manually

**Target State:**
- Single CLI command creates fully isolated sandbox environment
- Shared infrastructure (RDS, Redis, RabbitMQ) with logical isolation
- Automatic cleanup and lifecycle management
- Foundation for future developer platform

**Why Now:**
- Multi-tenant architecture already exists (RLS, TenantContext)
- Staging environment deployed and operational
- Need for QA/testing environments before production rollout
- Future revenue opportunity via developer platform

### 1.3 Vision

Sandboxes become the **foundation for Arrakis's developer ecosystem**:

- **Phase 1 (Now)**: Internal testing/QA tool for Arrakis team
- **Phase 2 (Near-term)**: Developer environments for each team member
- **Phase 3 (Future)**: Paid multi-tenant platform for third-party bot developers

### 1.4 Success Metrics

| Category | Metric | Target | Measurement |
|----------|--------|--------|-------------|
| **Usability** | Time to create sandbox | <30 seconds | CLI timing |
| **Usability** | Required configuration | 0-1 parameters | CLI flags count |
| **Isolation** | Data leakage between sandboxes | 0 incidents | Security audit |
| **Reliability** | Sandbox creation success rate | >99% | CLI exit codes |
| **Cleanup** | Auto-cleanup of stale sandboxes | 100% after TTL | Cron job logs |
| **Developer Experience** | Commands to full operational sandbox | 1 command | Documentation |

---

## 2. User & Stakeholder Context

### 2.1 Primary Users

| User Type | Description | Primary Need |
|-----------|-------------|--------------|
| **Internal Developers** | Arrakis engineering team | Isolated dev environments for local development |
| **QA/Testing** | Internal QA (immediate priority) | Isolated test environments for feature validation |

### 2.2 Future Users (Not in Initial Scope)

| User Type | Description | Timeline |
|-----------|-------------|----------|
| **Demo/Sales** | Spin up sandboxes for customer demos | Future |
| **Third-party Developers** | Bot developers building on Arrakis | Future (paid platform) |

### 2.3 User Stories

**Internal Developer**:
```
As an Arrakis developer,
I want to create an isolated sandbox with one command,
So that I can test my feature changes without affecting other developers or production.
```

**QA Engineer**:
```
As a QA engineer,
I want to spin up a sandbox for each feature branch,
So that I can test features in isolation before they're merged.
```

**DevOps**:
```
As a DevOps engineer,
I want sandboxes to automatically clean up after a configurable TTL,
So that we don't accumulate orphaned resources.
```

---

## 3. Functional Requirements

### 3.1 Core Features (MVP)

#### FR-1: Sandbox Creation

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1.1 | CLI command `bd sandbox create [name]` creates a new sandbox | P0 |
| FR-1.2 | Auto-generate sandbox name if not provided (e.g., `sandbox-{dev-name}-{random}`) | P0 |
| FR-1.3 | Return sandbox ID and connection details on creation | P0 |
| FR-1.4 | Support optional `--discord-token` flag for custom bot token | P1 |
| FR-1.5 | Support `--ttl` flag for auto-cleanup (default: 24h) | P1 |

#### FR-2: Sandbox Isolation

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-2.1 | Database isolation via PostgreSQL schema per sandbox | P0 |
| FR-2.2 | Redis namespace isolation via key prefix | P0 |
| FR-2.3 | RabbitMQ isolation via dedicated exchange/queue bindings | P0 |
| FR-2.4 | NATS subject namespace isolation | P0 |
| FR-2.5 | Tenant context automatically set based on sandbox ID | P0 |

#### FR-3: Sandbox Management

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-3.1 | CLI command `bd sandbox list` shows all sandboxes | P0 |
| FR-3.2 | CLI command `bd sandbox destroy <id>` tears down sandbox | P0 |
| FR-3.3 | CLI command `bd sandbox status <id>` shows sandbox health | P1 |
| FR-3.4 | Automatic cleanup of sandboxes past TTL | P1 |
| FR-3.5 | CLI command `bd sandbox connect <id>` outputs environment variables | P1 |

#### FR-4: Discord Integration

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-4.1 | Support single Discord application with multiple bot instances | P0 |
| FR-4.2 | Route Discord events to correct sandbox via guild_id mapping | P0 |
| FR-4.3 | Sandbox must register which guild_ids it handles | P0 |
| FR-4.4 | Support shared Discord token with guild-based routing (default) | P0 |
| FR-4.5 | Support dedicated Discord token per sandbox (optional) | P2 |

### 3.2 API Requirements (Secondary)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-5.1 | REST endpoint `POST /api/sandboxes` creates sandbox | P2 |
| FR-5.2 | REST endpoint `GET /api/sandboxes` lists sandboxes | P2 |
| FR-5.3 | REST endpoint `DELETE /api/sandboxes/:id` destroys sandbox | P2 |
| FR-5.4 | REST endpoint `GET /api/sandboxes/:id/status` returns status | P2 |

---

## 4. Technical Requirements

### 4.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     Discord Gateway (Rust)                       │
│  - Receives all events                                          │
│  - Routes based on guild_id → sandbox mapping                   │
└────────────────────────────┬────────────────────────────────────┘
                             │ NATS JetStream
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Event Router Service                          │
│  - Looks up sandbox_id from guild_id                            │
│  - Publishes to sandbox-specific NATS subject                   │
│  - Subject: events.{sandbox_id}.{event_type}                    │
└────────────────────────────┬────────────────────────────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        ▼                    ▼                    ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│  Sandbox A    │    │  Sandbox B    │    │  Sandbox C    │
│  Worker       │    │  Worker       │    │  Worker       │
│  ─────────    │    │  ─────────    │    │  ─────────    │
│  Schema: a    │    │  Schema: b    │    │  Schema: c    │
│  Redis: a:*   │    │  Redis: b:*   │    │  Redis: c:*   │
│  Queue: a.*   │    │  Queue: b.*   │    │  Queue: c.*   │
└───────────────┘    └───────────────┘    └───────────────┘
```

### 4.2 Database Isolation

**Approach**: PostgreSQL schema-per-sandbox (leverages existing RLS)

```sql
-- Create sandbox schema
CREATE SCHEMA sandbox_{id};

-- Set search_path for sandbox connections
SET search_path TO sandbox_{id}, public;

-- RLS policies already filter by community_id
-- Sandbox uses synthetic community_id = sandbox_id
```

**Existing Infrastructure**:
- `TenantContext` class in `packages/adapters/storage/tenant-context.ts`
- `set_tenant_context()` PostgreSQL function
- RLS policies on all tenant tables

### 4.3 Redis Isolation

**Approach**: Key prefix namespace

```typescript
// Sandbox Redis wrapper
class SandboxRedis {
  constructor(private redis: Redis, private sandboxId: string) {}

  async get(key: string): Promise<string | null> {
    return this.redis.get(`sandbox:${this.sandboxId}:${key}`);
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    await this.redis.set(`sandbox:${this.sandboxId}:${key}`, value, ttl);
  }
}
```

### 4.4 Queue Isolation (RabbitMQ)

**Approach**: Dedicated exchange/queue bindings per sandbox

```typescript
// Sandbox queue bindings
const sandboxExchange = `sandbox.${sandboxId}.events`;
const sandboxQueue = `sandbox.${sandboxId}.worker`;

await channel.assertExchange(sandboxExchange, 'topic');
await channel.assertQueue(sandboxQueue);
await channel.bindQueue(sandboxQueue, sandboxExchange, '#');
```

### 4.5 NATS Subject Isolation

**Approach**: Subject namespace

```
# Production subjects
events.guild_message_create
commands.slash_command

# Sandbox subjects (namespaced)
sandbox.{sandbox_id}.events.guild_message_create
sandbox.{sandbox_id}.commands.slash_command
```

### 4.6 Discord Event Routing

**Challenge**: Route Discord events to the correct sandbox based on guild_id.

**Solution**: Guild-to-sandbox mapping table

```sql
CREATE TABLE sandbox_guild_mapping (
  guild_id VARCHAR(20) PRIMARY KEY,
  sandbox_id UUID NOT NULL REFERENCES sandboxes(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Event Router Logic**:
```typescript
async function routeEvent(event: DiscordEvent) {
  const sandboxId = await getSandboxForGuild(event.guild_id);

  if (sandboxId) {
    // Route to sandbox-specific subject
    await nats.publish(`sandbox.${sandboxId}.events.${event.type}`, event);
  } else {
    // Route to production subject
    await nats.publish(`events.${event.type}`, event);
  }
}
```

### 4.7 Sandbox Lifecycle

```
┌─────────┐     ┌──────────┐     ┌─────────┐     ┌───────────┐
│ PENDING │────▶│ CREATING │────▶│ RUNNING │────▶│ DESTROYING│
└─────────┘     └──────────┘     └─────────┘     └───────────┘
                                       │                │
                                       │ TTL expires    │
                                       ▼                ▼
                                 ┌──────────┐    ┌───────────┐
                                 │  EXPIRED │───▶│ DESTROYED │
                                 └──────────┘    └───────────┘
```

**Cleanup Process**:
1. Cron job runs every 15 minutes
2. Finds sandboxes where `expires_at < NOW()`
3. Marks as EXPIRED
4. Cleanup worker:
   - Drops PostgreSQL schema
   - Deletes Redis keys with prefix
   - Deletes RabbitMQ exchange/queues
   - Removes guild mapping
   - Marks as DESTROYED

---

## 5. Non-Functional Requirements

### 5.1 Performance

| Requirement | Target |
|-------------|--------|
| Sandbox creation time | <30 seconds |
| Sandbox destruction time | <15 seconds |
| Event routing latency overhead | <5ms |

### 5.2 Security

| Requirement | Implementation |
|-------------|----------------|
| No cross-sandbox data access | RLS policies, schema isolation |
| No cross-sandbox event leakage | NATS subject ACLs, guild mapping |
| Sandbox credentials isolated | Per-sandbox Redis namespace |
| Audit trail | Log sandbox creation/destruction events |

### 5.3 Scalability

| Metric | Initial Target | Future Target |
|--------|----------------|---------------|
| Concurrent sandboxes | 10 | 1,000+ (paid platform) |
| Sandboxes per developer | 3 | Unlimited (paid tier) |

### 5.4 Reliability

| Requirement | Target |
|-------------|--------|
| Sandbox creation success rate | 99% |
| Cleanup completion rate | 100% |
| Data isolation guarantee | 100% |

---

## 6. Scope Definition

### 6.1 In Scope (MVP)

| Feature | Description |
|---------|-------------|
| CLI sandbox management | `bd sandbox create/list/destroy/status/connect` |
| Database isolation | PostgreSQL schema per sandbox |
| Cache isolation | Redis key prefix per sandbox |
| Queue isolation | RabbitMQ exchange/queue per sandbox |
| Event routing | Guild-to-sandbox mapping |
| Auto-cleanup | TTL-based sandbox expiration |
| Shared Discord token | Single bot, multiple sandboxes via guild routing |

### 6.2 Out of Scope (MVP)

| Feature | Reason | Future Phase |
|---------|--------|--------------|
| REST API for sandbox management | CLI is primary interface | Phase 2 |
| Dedicated Discord tokens per sandbox | Complexity, not needed for testing | Phase 3 |
| Discord slash commands for management | Not developer-friendly | Never |
| Completely separate AWS resources | Too expensive for testing | Paid tier only |
| Multi-tenant billing | Not needed for internal use | Phase 3 |
| Third-party developer access | Requires auth, billing, docs | Phase 3 |

### 6.3 Assumptions

1. Developers have access to the `bd` CLI tool
2. Developers have AWS credentials for staging environment
3. A shared Discord bot token exists for sandbox testing
4. Existing multi-tenant architecture (RLS, TenantContext) is stable

### 6.4 Constraints

1. Must use existing shared RDS instance (cost constraint)
2. Must use existing Redis cluster (cost constraint)
3. Must integrate with existing NATS JetStream setup
4. Discord rate limits apply across all sandboxes sharing a token

---

## 7. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Discord rate limiting across sandboxes | Medium | High | Implement GlobalDiscordTokenBucket (already exists in themes/sietch) |
| Schema explosion in PostgreSQL | Low | Medium | Limit concurrent sandboxes per developer, auto-cleanup |
| Orphaned resources from failed cleanup | Medium | Low | Idempotent cleanup, monitoring dashboard |
| Event routing latency | Low | Medium | Cache guild-to-sandbox mapping in Redis |
| Cross-sandbox data leakage | Low | Critical | RLS policies, security audit, integration tests |

---

## 8. Dependencies

### 8.1 Internal Dependencies

| Dependency | Status | Owner |
|------------|--------|-------|
| Multi-tenant TenantContext | Complete | packages/adapters/storage |
| RLS policies | Complete | infrastructure/migrations |
| NATS JetStream | Complete | infrastructure/terraform |
| Redis cluster | Complete | infrastructure/terraform |
| bd CLI | Complete | tools/bd |

### 8.2 External Dependencies

| Dependency | Status | Notes |
|------------|--------|-------|
| Discord Bot Application | Exists | Need to configure for sandbox guilds |
| AWS staging environment | Deployed | Route 53, ECS, RDS all operational |

---

## 9. Open Questions

| # | Question | Owner | Status |
|---|----------|-------|--------|
| 1 | What Discord credentials are needed per sandbox? | Engineering | **Answered**: Shared token with guild-based routing |
| 2 | Can we share a single Discord application with multiple bot instances? | Engineering | **Answered**: Yes, via guild-to-sandbox mapping |
| 3 | How do we isolate database state per sandbox? | Engineering | **Answered**: Schema-per-sandbox + RLS |
| 4 | How do we route Discord events to the correct sandbox? | Engineering | **Answered**: Guild-to-sandbox mapping table |
| 5 | What naming convention for sandboxes? | Engineering | **Answered**: `sandbox-{dev-name}-{random}` |
| 6 | How long should sandboxes persist? Auto-cleanup? | Engineering | **Answered**: 24h default TTL, configurable |

---

## 10. Implementation Phases

### Phase 1: Foundation (MVP)

**Goal**: Basic sandbox creation and destruction for internal testing

| Sprint | Deliverable |
|--------|-------------|
| S-SB-1 | Sandbox data model, schema creation, cleanup job |
| S-SB-2 | CLI commands: create, list, destroy |
| S-SB-3 | Event routing with guild-to-sandbox mapping |
| S-SB-4 | Redis/RabbitMQ namespace isolation |

### Phase 2: Developer Experience

**Goal**: Polish and API access

| Sprint | Deliverable |
|--------|-------------|
| S-SB-5 | CLI: status, connect commands |
| S-SB-6 | REST API endpoints |
| S-SB-7 | Documentation and onboarding guide |

### Phase 3: Platform (Future)

**Goal**: Multi-tenant developer platform

| Sprint | Deliverable |
|--------|-------------|
| S-SB-8 | Dedicated Discord token support |
| S-SB-9 | Billing integration |
| S-SB-10 | Third-party developer portal |

---

## 11. Acceptance Criteria

### 11.1 MVP Acceptance

```gherkin
Feature: Discord Server Sandbox Creation

Scenario: Developer creates a sandbox
  Given I am an Arrakis developer with CLI access
  When I run "bd sandbox create"
  Then a new sandbox is created in <30 seconds
  And I receive the sandbox ID and connection details
  And the sandbox has isolated database schema
  And the sandbox has isolated Redis namespace
  And the sandbox has isolated RabbitMQ bindings

Scenario: Developer destroys a sandbox
  Given I have a running sandbox with ID "test-123"
  When I run "bd sandbox destroy test-123"
  Then the sandbox is marked for destruction
  And all associated resources are cleaned up
  And the sandbox no longer appears in "bd sandbox list"

Scenario: Sandbox auto-cleanup
  Given a sandbox was created with default TTL (24h)
  When 24 hours have passed
  Then the cleanup job marks it as expired
  And all resources are cleaned up automatically

Scenario: Event routing to sandbox
  Given a sandbox is registered for guild "123456789"
  When a Discord event arrives for guild "123456789"
  Then the event is routed to the sandbox's NATS subject
  And production workers do not receive the event
```

---

## 12. Appendix

### A. CLI Command Reference

```bash
# Create a sandbox (auto-generated name)
bd sandbox create

# Create a named sandbox
bd sandbox create my-feature-test

# Create with custom TTL (48 hours)
bd sandbox create --ttl 48h

# List all sandboxes
bd sandbox list

# Show sandbox status
bd sandbox status <sandbox-id>

# Get connection details (exports as env vars)
bd sandbox connect <sandbox-id>
# Output:
# export SANDBOX_ID=abc123
# export DATABASE_SCHEMA=sandbox_abc123
# export REDIS_PREFIX=sandbox:abc123:
# export NATS_PREFIX=sandbox.abc123.

# Destroy a sandbox
bd sandbox destroy <sandbox-id>

# Destroy all sandboxes (with confirmation)
bd sandbox destroy --all
```

### B. Database Schema

```sql
CREATE TABLE sandboxes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(64) NOT NULL UNIQUE,
  owner VARCHAR(64) NOT NULL,  -- developer username
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  schema_name VARCHAR(64) NOT NULL UNIQUE,
  discord_token_id UUID,  -- NULL = shared token
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  destroyed_at TIMESTAMPTZ,
  CONSTRAINT valid_status CHECK (status IN ('pending', 'creating', 'running', 'expired', 'destroying', 'destroyed'))
);

CREATE TABLE sandbox_guild_mapping (
  guild_id VARCHAR(20) PRIMARY KEY,
  sandbox_id UUID NOT NULL REFERENCES sandboxes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sandboxes_status ON sandboxes(status);
CREATE INDEX idx_sandboxes_expires ON sandboxes(expires_at) WHERE status = 'running';
CREATE INDEX idx_sandbox_guild_mapping_sandbox ON sandbox_guild_mapping(sandbox_id);
```

### C. Configuration

```yaml
# .env or config file
SANDBOX_DEFAULT_TTL_HOURS: 24
SANDBOX_MAX_PER_DEVELOPER: 3
SANDBOX_CLEANUP_INTERVAL_MINUTES: 15
SANDBOX_DISCORD_TOKEN: ${SHARED_DISCORD_BOT_TOKEN}
```

---

**Document Status**: DRAFT - Pending Approval
**Next Steps**: Review by engineering team, then proceed to SDD creation
