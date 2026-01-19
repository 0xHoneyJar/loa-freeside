# Sprint Plan: Gateway Proxy Pattern Implementation

**Document Version**: 1.0
**Created**: 2026-01-14
**PRD Reference**: `prd-gateway-proxy.md`
**SDD Reference**: `sdd-gateway-proxy.md`

---

## Overview

| Attribute | Value |
|-----------|-------|
| **Total Sprints** | 6 |
| **Sprint Duration** | 1 week each |
| **Team Size** | 1 developer (AI-assisted) |
| **MVP Milestone** | Sprint 4 (feature parity) |
| **Production Ready** | Sprint 6 |

### Sprint Summary

| Sprint | Focus | Key Deliverable |
|--------|-------|-----------------|
| Sprint 1 | Infrastructure Setup | Amazon MQ deployed, queue topology configured |
| Sprint 2 | Ingestor Development | Zero-cache Discord gateway listener |
| Sprint 3 | Worker Foundation | Queue consumers, DiscordRest service |
| Sprint 4 | Handler Migration | All 20 commands migrated, state in Redis |
| Sprint 5 | Integration & Testing | E2E tests, load tests, staging deployment |
| Sprint 6 | Production Cutover | Shadow mode, traffic shift, cleanup |

---

## Sprint 1: Infrastructure Setup

**Goal**: Deploy RabbitMQ infrastructure and prepare the foundation for the Gateway Proxy pattern.

**Milestone**: M1 - Infrastructure Ready

### Tasks

#### TASK-1.1: Deploy Amazon MQ (RabbitMQ)

**Description**: Create Terraform resources for Amazon MQ broker with RabbitMQ engine.

**Files to Create/Modify**:
- `infrastructure/terraform/rabbitmq.tf` (NEW)
- `infrastructure/terraform/variables.tf` (MODIFY)
- `infrastructure/terraform/outputs.tf` (MODIFY)

**Acceptance Criteria**:
- [ ] Amazon MQ broker deployed with RabbitMQ 3.12 engine
- [ ] Single instance for staging, multi-AZ cluster for production
- [ ] Security group allows AMQPS (5671) from ECS tasks
- [ ] Credentials stored in AWS Secrets Manager
- [ ] Management console accessible (15671) for debugging

**Complexity**: Medium

---

#### TASK-1.2: Configure Queue Topology

**Description**: Create RabbitMQ exchanges, queues, and bindings as specified in SDD Section 3.2.2.

**Files to Create**:
- `infrastructure/rabbitmq/setup-topology.sh` (NEW)
- `infrastructure/rabbitmq/definitions.json` (NEW)

**Queue Configuration**:
```
Exchange: arrakis.events (topic)
├── Queue: arrakis.interactions (priority queue, x-max-priority: 10)
├── Queue: arrakis.events.guild (normal queue)
└── Queue: arrakis.dlq (dead-letter queue, TTL: 7 days)
```

**Acceptance Criteria**:
- [ ] Topic exchange `arrakis.events` created
- [ ] Priority queue for interactions with max-priority: 10
- [ ] Normal queue for guild/member events
- [ ] Dead-letter exchange and queue configured
- [ ] All queues are durable with message persistence
- [ ] Script is idempotent (can re-run safely)

**Complexity**: Low

---

#### TASK-1.3: Create Ingestor ECR Repository

**Description**: Add ECR repository for the Ingestor service container images.

**Files to Modify**:
- `infrastructure/terraform/ecs.tf`

**Acceptance Criteria**:
- [ ] ECR repository `arrakis-{env}-ingestor` created
- [ ] Image scanning enabled on push
- [ ] Lifecycle policy keeps last 10 images
- [ ] Output exports repository URL

**Complexity**: Low

---

#### TASK-1.4: Create Ingestor Security Group

**Description**: Define network security for the Ingestor service with minimal attack surface.

**Files to Modify**:
- `infrastructure/terraform/ecs.tf` or `infrastructure/terraform/security.tf` (NEW)

**Security Group Rules**:
```
Ingestor SG:
  Ingress: NONE (no inbound traffic needed)
  Egress:
    - Discord Gateway (wss://gateway.discord.gg:443)
    - RabbitMQ (5671) to RabbitMQ SG
    - CloudWatch Logs (443)
```

**Acceptance Criteria**:
- [ ] Security group created with no ingress rules
- [ ] Egress to RabbitMQ SG on port 5671
- [ ] Egress to HTTPS (443) for Discord Gateway and CloudWatch
- [ ] Properly tagged with environment

**Complexity**: Low

---

#### TASK-1.5: Add RabbitMQ Credentials to Secrets Manager

**Description**: Store RabbitMQ connection URL in AWS Secrets Manager for ECS tasks.

**Files to Modify**:
- `infrastructure/terraform/secrets.tf` or `infrastructure/terraform/ecs.tf`

**Acceptance Criteria**:
- [ ] Secret `arrakis-{env}/rabbitmq-credentials` created
- [ ] Contains connection URL with TLS (`amqps://`)
- [ ] ECS execution role has permission to read secret
- [ ] Secret rotation policy documented (manual for now)

**Complexity**: Low

---

#### TASK-1.6: Update GitHub Actions for Ingestor

**Description**: Add CI/CD pipeline for building and deploying the Ingestor service.

**Files to Create/Modify**:
- `.github/workflows/deploy-ingestor.yml` (NEW)
- `.github/workflows/deploy-staging.yml` (MODIFY - add Ingestor)

**Acceptance Criteria**:
- [ ] Workflow builds Ingestor Docker image
- [ ] Pushes to ECR with staging/production tags
- [ ] Updates ECS service with new task definition
- [ ] Triggered on changes to `apps/ingestor/**`

**Complexity**: Medium

---

### Sprint 1 Exit Criteria

- [ ] `terraform apply` succeeds with new RabbitMQ resources
- [ ] RabbitMQ management console accessible
- [ ] Queue topology visible in management UI
- [ ] ECR repository exists for Ingestor
- [ ] Security groups properly configured
- [ ] All secrets in Secrets Manager

---

## Sprint 2: Ingestor Development

**Goal**: Build the lightweight Discord Gateway listener that publishes events to RabbitMQ.

**Milestone**: M2 - Ingestor MVP

### Tasks

#### TASK-2.1: Create Ingestor Package Structure

**Description**: Set up the `apps/ingestor` package with TypeScript configuration.

**Files to Create**:
```
apps/ingestor/
├── package.json
├── tsconfig.json
├── Dockerfile
├── .dockerignore
└── src/
    ├── index.ts
    ├── config.ts
    └── types.ts
```

**Acceptance Criteria**:
- [ ] Package uses ESM (`"type": "module"`)
- [ ] TypeScript strict mode enabled
- [ ] Dependencies: discord.js, amqplib, pino (logger)
- [ ] Dockerfile with multi-stage build
- [ ] `npm run build` produces `dist/` output

**Complexity**: Low

---

#### TASK-2.2: Implement Zero-Cache Discord Client

**Description**: Configure discord.js Client with all caching disabled per SDD Section 3.2.1.

**Files to Create/Modify**:
- `apps/ingestor/src/client.ts` (NEW)

**Implementation**:
```typescript
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
  ],
  makeCache: Options.cacheWithLimits({
    GuildMemberManager: 0,
    UserManager: 0,
    MessageManager: 0,
    // ... all managers set to 0
  }),
  sweepers: {
    messages: { interval: 60, lifetime: 60 },
  },
});
```

**Acceptance Criteria**:
- [ ] All cache managers set to 0 or minimal
- [ ] Sweepers configured for aggressive cleanup
- [ ] Memory usage <50MB under test load
- [ ] Gateway connects successfully
- [ ] Shard ready events fire correctly

**Complexity**: Medium

---

#### TASK-2.3: Implement RabbitMQ Publisher

**Description**: Create the publisher that sends Discord events to RabbitMQ queues.

**Files to Create**:
- `apps/ingestor/src/publisher.ts` (NEW)
- `apps/ingestor/src/types/events.ts` (NEW)

**Implementation**:
```typescript
interface IngestorPublisher {
  connect(): Promise<void>;
  publish(event: DiscordEventPayload): Promise<void>;
  isHealthy(): boolean;
  close(): Promise<void>;
}
```

**Routing Logic**:
| Event Type | Routing Key | Priority |
|------------|-------------|----------|
| INTERACTION_CREATE (command) | interaction.command.{name} | 10 |
| INTERACTION_CREATE (button) | interaction.button.{id} | 8 |
| GUILD_MEMBER_ADD | member.join | 5 |
| GUILD_MEMBER_REMOVE | member.leave | 5 |

**Acceptance Criteria**:
- [ ] Connects to RabbitMQ with TLS
- [ ] Publishes to topic exchange `arrakis.events`
- [ ] Uses correct routing keys per event type
- [ ] Sets priority for interaction events
- [ ] Messages are persistent (`deliveryMode: 2`)
- [ ] Handles connection failures gracefully
- [ ] Reconnects automatically on disconnect

**Complexity**: High

---

#### TASK-2.4: Wire Event Handlers to Publisher

**Description**: Connect Discord.js event handlers to publish events to RabbitMQ.

**Files to Create/Modify**:
- `apps/ingestor/src/handlers.ts` (NEW)
- `apps/ingestor/src/index.ts` (MODIFY)

**Events to Handle**:
- `interactionCreate` - Slash commands, buttons, modals
- `guildMemberAdd` - New member joins
- `guildMemberRemove` - Member leaves
- `guildMemberUpdate` - Member role/nickname changes
- `messageCreate` - Messages (low priority)

**Acceptance Criteria**:
- [ ] All relevant events published to queue
- [ ] Event payload includes metadata (eventId, timestamp, shardId)
- [ ] Interaction events include interactionId and token
- [ ] No business logic in handlers (serialize and publish only)
- [ ] Error logging for failed publishes

**Complexity**: Medium

---

#### TASK-2.5: Implement Health Check Endpoint

**Description**: Create health check for ECS task health verification.

**Files to Create**:
- `apps/ingestor/src/health.ts` (NEW)

**Health Check Logic**:
```typescript
// Healthy if:
// 1. Discord WebSocket connected
// 2. RabbitMQ connection alive
// 3. Memory usage <75MB
```

**Acceptance Criteria**:
- [ ] HTTP endpoint on port 8080 (or configurable)
- [ ] Returns 200 if healthy, 503 if unhealthy
- [ ] Checks Discord client ready state
- [ ] Checks RabbitMQ channel open
- [ ] Checks memory usage threshold
- [ ] Response includes diagnostic JSON

**Complexity**: Low

---

#### TASK-2.6: Create ECS Task Definition for Ingestor

**Description**: Add Terraform resource for Ingestor ECS task and service.

**Files to Modify**:
- `infrastructure/terraform/ecs.tf`

**Configuration**:
- CPU: 256 vCPU
- Memory: 512 MB
- No load balancer (outbound only)
- Health check: HTTP on health endpoint

**Acceptance Criteria**:
- [ ] Task definition with correct resource allocation
- [ ] Secrets injected: DISCORD_BOT_TOKEN, RABBITMQ_URL
- [ ] Environment variables: NODE_ENV, SHARD_COUNT
- [ ] CloudWatch logs configured
- [ ] Health check command defined
- [ ] Service deployed to private subnets

**Complexity**: Medium

---

#### TASK-2.7: Unit Tests for Ingestor

**Description**: Write unit tests for publisher and event handlers.

**Files to Create**:
```
apps/ingestor/tests/
├── publisher.test.ts
├── handlers.test.ts
└── health.test.ts
```

**Acceptance Criteria**:
- [ ] Publisher tests mock RabbitMQ channel
- [ ] Verify correct routing keys used
- [ ] Verify priority settings
- [ ] Handler tests verify payload structure
- [ ] Health check tests cover all conditions
- [ ] Test coverage >80%

**Complexity**: Medium

---

### Sprint 2 Exit Criteria

- [ ] Ingestor builds and runs locally
- [ ] Docker image pushes to ECR
- [ ] Ingestor deploys to staging ECS
- [ ] Gateway connects to Discord
- [ ] Events appear in RabbitMQ queues
- [ ] Memory stays <50MB under load
- [ ] Health check returns 200

---

## Sprint 3: Worker Foundation

**Goal**: Build the Worker service foundation with queue consumers and Discord REST integration.

**Milestone**: M3 - Worker Skeleton

### Tasks

#### TASK-3.1: Create Worker Package Structure

**Description**: Set up the `apps/worker` package structure, reusing shared code from sietch.

**Files to Create**:
```
apps/worker/
├── package.json
├── tsconfig.json
├── Dockerfile
├── .dockerignore
└── src/
    ├── index.ts
    ├── config.ts
    ├── consumers/
    │   └── index.ts
    ├── services/
    │   └── index.ts
    └── handlers/
        └── index.ts
```

**Acceptance Criteria**:
- [ ] Package uses ESM
- [ ] TypeScript strict mode
- [ ] Dependencies: amqplib, discord.js (REST only), ioredis, drizzle-orm
- [ ] Shared packages from sietch accessible
- [ ] `npm run build` produces `dist/`

**Complexity**: Low

---

#### TASK-3.2: Implement InteractionConsumer

**Description**: Create the consumer that processes interaction events from RabbitMQ.

**Files to Create**:
- `apps/worker/src/consumers/InteractionConsumer.ts`

**Implementation** (per SDD Section 3.2.3):
```typescript
class InteractionConsumer {
  async consume(msg: ConsumeMessage): Promise<void> {
    // 1. Parse payload
    // 2. Defer response immediately
    // 3. Process command
    // 4. Send followup
    // 5. Ack message
  }
}
```

**Acceptance Criteria**:
- [ ] Consumes from `arrakis.interactions` queue
- [ ] Defers response within 100ms of receiving message
- [ ] Parses DiscordEventPayload correctly
- [ ] Routes to appropriate command handler
- [ ] Acks message on success
- [ ] Nacks with requeue on retryable errors
- [ ] Nacks without requeue on permanent errors (DLQ)
- [ ] Prefetch count configurable (default: 10)

**Complexity**: High

---

#### TASK-3.3: Implement EventConsumer

**Description**: Create the consumer for guild/member events.

**Files to Create**:
- `apps/worker/src/consumers/EventConsumer.ts`

**Events Handled**:
- `member.join` - Process new member eligibility
- `member.leave` - Clean up member data
- `member.update` - Handle role changes

**Acceptance Criteria**:
- [ ] Consumes from `arrakis.events.guild` queue
- [ ] Routes to appropriate event handler
- [ ] No response deferral needed (background processing)
- [ ] Proper error handling with DLQ routing
- [ ] Idempotent processing (handle duplicate events)

**Complexity**: Medium

---

#### TASK-3.4: Implement DiscordRestService

**Description**: Create REST-only Discord client for Worker responses.

**Files to Create**:
- `apps/worker/src/services/DiscordRest.ts`

**Methods** (per SDD Section 5.2):
```typescript
class DiscordRestService {
  deferReply(interactionId, token): Promise<void>;
  sendFollowup(appId, token, payload): Promise<void>;
  editOriginal(appId, token, payload): Promise<void>;
  assignRole(guildId, userId, roleId): Promise<void>;
  removeRole(guildId, userId, roleId): Promise<void>;
  sendDM(userId, payload): Promise<void>;
}
```

**Acceptance Criteria**:
- [ ] Uses discord.js REST class (not Client)
- [ ] Rate limit handling with exponential backoff
- [ ] Proper error types for different failure modes
- [ ] Logs all API calls with trace context
- [ ] Does NOT require bot token (uses interaction tokens)

**Complexity**: Medium

---

#### TASK-3.5: Implement Redis State Manager

**Description**: Create centralized state management in Redis for cross-worker consistency.

**Files to Create**:
- `apps/worker/src/services/StateManager.ts`

**State Types**:
```typescript
interface StateManager {
  // Cooldowns
  setCooldown(cmd: string, userId: string, ttlMs: number): Promise<void>;
  getCooldown(cmd: string, userId: string): Promise<number | null>;

  // Sessions
  setSession(type: string, userId: string, data: object, ttlMs: number): Promise<void>;
  getSession(type: string, userId: string): Promise<object | null>;
  deleteSession(type: string, userId: string): Promise<void>;

  // Rate limits (already in Redis via express-rate-limit)
}
```

**Key Patterns**:
- `cd:{command}:{userId}` - Cooldowns
- `sess:{type}:{userId}` - Sessions
- `rl:{identifier}:{endpoint}` - Rate limits

**Acceptance Criteria**:
- [ ] All state operations use Redis
- [ ] Consistent key naming convention
- [ ] TTL set on all keys (no memory leaks)
- [ ] Connection pooling
- [ ] Error handling for Redis failures
- [ ] Fallback behavior when Redis unavailable

**Complexity**: Medium

---

#### TASK-3.6: Create Worker ECS Task Definition

**Description**: Add Terraform resource for Worker ECS task and service with auto-scaling.

**Files to Modify**:
- `infrastructure/terraform/ecs.tf`

**Configuration**:
- CPU: 512 vCPU
- Memory: 1024 MB
- Auto-scaling: 2-20 based on queue depth
- No load balancer (pulls from queue)

**Acceptance Criteria**:
- [ ] Task definition with correct resources
- [ ] Secrets: RABBITMQ_URL, DATABASE_URL, REDIS_URL
- [ ] Environment: DISCORD_APPLICATION_ID, NODE_ENV
- [ ] Does NOT have DISCORD_BOT_TOKEN
- [ ] Auto-scaling policy based on queue depth
- [ ] CloudWatch logs configured
- [ ] Service in private subnets

**Complexity**: Medium

---

#### TASK-3.7: Unit Tests for Worker Foundation

**Description**: Write unit tests for consumers and services.

**Files to Create**:
```
apps/worker/tests/
├── consumers/
│   ├── InteractionConsumer.test.ts
│   └── EventConsumer.test.ts
├── services/
│   ├── DiscordRest.test.ts
│   └── StateManager.test.ts
```

**Acceptance Criteria**:
- [ ] Consumer tests mock RabbitMQ and Discord REST
- [ ] Verify defer happens within 3s
- [ ] Verify correct ack/nack behavior
- [ ] StateManager tests use Redis mock
- [ ] DiscordRest tests mock HTTP calls
- [ ] Test coverage >80%

**Complexity**: Medium

---

### Sprint 3 Exit Criteria

- [ ] Worker builds and runs locally
- [ ] Consumers connect to RabbitMQ
- [ ] DiscordRest can defer and send followups
- [ ] StateManager reads/writes Redis
- [ ] Worker deploys to staging ECS
- [ ] Can process test events from queue

---

## Sprint 4: Handler Migration

**Goal**: Migrate all 20 slash commands and event handlers to the Worker service.

**Milestone**: M4 - Feature Parity

### Tasks

#### TASK-4.1: Audit In-Memory State in Sietch

**Description**: Find all Map/Set usages in discord handlers that need Redis migration.

**Files to Audit**:
- `themes/sietch/src/discord/commands/*.ts`
- `themes/sietch/src/services/discord/handlers/*.ts`
- `themes/sietch/src/services/discord/processors/*.ts`

**Acceptance Criteria**:
- [ ] Document all local state usage
- [ ] Categorize: cooldowns, sessions, caches
- [ ] Identify migration strategy for each
- [ ] No blocking issues found

**Complexity**: Low

---

#### TASK-4.2: Migrate Low-Complexity Commands (7 commands)

**Description**: Migrate simple read-only commands that don't require complex state.

**Commands**:
1. `/stats` - Read-only statistics
2. `/position` - Simple query
3. `/threshold` - Config display
4. `/directory` - List display
5. `/resume` - State resume
6. `/register-waitlist` - Simple insert
7. `/leaderboard` - Pagination

**Files to Create**:
- `apps/worker/src/handlers/commands/stats.ts`
- `apps/worker/src/handlers/commands/position.ts`
- `apps/worker/src/handlers/commands/threshold.ts`
- `apps/worker/src/handlers/commands/directory.ts`
- `apps/worker/src/handlers/commands/resume.ts`
- `apps/worker/src/handlers/commands/register-waitlist.ts`
- `apps/worker/src/handlers/commands/leaderboard.ts`

**Acceptance Criteria**:
- [ ] Each command responds via REST API
- [ ] Embeds render correctly
- [ ] Database queries work with RLS
- [ ] Error responses handled gracefully
- [ ] Unit tests for each command

**Complexity**: Medium

---

#### TASK-4.3: Migrate Medium-Complexity Commands (7 commands)

**Description**: Migrate commands with database writes or role management.

**Commands**:
1. `/profile` - Database + embed
2. `/badges` - Image generation
3. `/alerts` - Subscription management
4. `/naib` - Role assignment
5. `/onboard` - Setup wizard
6. `/admin-stats` - Admin only
7. `/admin-badge` - Admin only

**Files to Create**:
- `apps/worker/src/handlers/commands/profile.ts`
- `apps/worker/src/handlers/commands/badges.ts`
- `apps/worker/src/handlers/commands/alerts.ts`
- `apps/worker/src/handlers/commands/naib.ts`
- `apps/worker/src/handlers/commands/onboard.ts`
- `apps/worker/src/handlers/commands/admin-stats.ts`
- `apps/worker/src/handlers/commands/admin-badge.ts`

**Acceptance Criteria**:
- [ ] Role assignments use DiscordRest service
- [ ] Image generation still works
- [ ] Subscriptions stored in PostgreSQL
- [ ] Admin commands check permissions
- [ ] Unit tests for each command

**Complexity**: High

---

#### TASK-4.4: Migrate High-Complexity Commands (6 commands)

**Description**: Migrate commands with blockchain RPC, multi-step flows, or security sensitivity.

**Commands**:
1. `/check-eligibility` - Blockchain RPC (HIGH)
2. `/verify` - Wallet verification (HIGH)
3. `/water-share` - Multi-step flow (HIGH)
4. `/admin-migrate` - Migration utility (HIGH)
5. `/admin-takeover` - Emergency admin (HIGH)
6. `/admin-water-share` - Admin utility (MEDIUM)

**Files to Create**:
- `apps/worker/src/handlers/commands/check-eligibility.ts`
- `apps/worker/src/handlers/commands/verify.ts`
- `apps/worker/src/handlers/commands/water-share.ts`
- `apps/worker/src/handlers/commands/admin-migrate.ts`
- `apps/worker/src/handlers/commands/admin-takeover.ts`
- `apps/worker/src/handlers/commands/admin-water-share.ts`

**Acceptance Criteria**:
- [ ] Blockchain calls don't block (already deferred)
- [ ] Multi-step flows use Redis sessions
- [ ] Wallet verification security preserved
- [ ] Admin commands have proper authorization
- [ ] Comprehensive error handling
- [ ] Unit tests with mocked RPC

**Complexity**: High

---

#### TASK-4.5: Migrate Event Handlers

**Description**: Migrate guild/member event handlers to Worker.

**Files to Migrate**:
- `themes/sietch/src/services/discord/handlers/EventHandler.ts`
- `themes/sietch/src/services/discord/processors/*.ts`

**Files to Create**:
- `apps/worker/src/handlers/events/memberJoin.ts`
- `apps/worker/src/handlers/events/memberLeave.ts`
- `apps/worker/src/handlers/events/memberUpdate.ts`

**Acceptance Criteria**:
- [ ] New member eligibility check works
- [ ] Role assignment on join works
- [ ] Member leave cleanup works
- [ ] Audit logging preserved
- [ ] Idempotent processing

**Complexity**: Medium

---

#### TASK-4.6: Migrate Embed Builders

**Description**: Copy embed builder utilities to Worker package.

**Files to Copy**:
- `themes/sietch/src/discord/embeds/*.ts` -> `apps/worker/src/embeds/`

**Acceptance Criteria**:
- [ ] All embed builders available in Worker
- [ ] No breaking changes to embed structure
- [ ] Shared types exported correctly

**Complexity**: Low

---

#### TASK-4.7: State Migration to Redis

**Description**: Migrate all identified in-memory state to Redis.

**Based on TASK-4.1 Audit**:
- Cooldowns -> Redis with TTL
- Sessions -> Redis with TTL
- Caches -> Redis or remove

**Acceptance Criteria**:
- [ ] All cooldowns use StateManager
- [ ] All sessions use StateManager
- [ ] No local Map/Set for cross-request state
- [ ] TTLs set appropriately
- [ ] Backward compatible during migration

**Complexity**: Medium

---

#### TASK-4.8: Integration Tests for All Commands

**Description**: Create integration tests that verify commands work end-to-end.

**Files to Create**:
- `apps/worker/tests/integration/commands.test.ts`

**Test Approach**:
1. Publish mock event to RabbitMQ
2. Worker consumes and processes
3. Verify Discord REST calls made
4. Verify database state updated

**Acceptance Criteria**:
- [ ] All 20 commands have integration tests
- [ ] Tests use local RabbitMQ container
- [ ] Tests use local PostgreSQL container
- [ ] Tests mock Discord REST (no real API)
- [ ] CI runs integration tests

**Complexity**: High

---

### Sprint 4 Exit Criteria

- [ ] All 20 slash commands work via Worker
- [ ] All event handlers work via Worker
- [ ] No in-memory state remains
- [ ] Integration tests pass
- [ ] Feature parity with monolith achieved

---

## Sprint 5: Integration & Testing

**Goal**: Comprehensive testing, load testing, and staging deployment.

**Milestone**: M5 - Staging Ready

### Tasks

#### TASK-5.1: End-to-End Test Suite

**Description**: Create E2E tests that verify the full Gateway Proxy flow.

**Files to Create**:
- `tests/e2e/gateway-proxy.test.ts`

**Test Scenarios**:
1. Slash command: User -> Gateway -> Ingestor -> Queue -> Worker -> REST -> User
2. Member join: Gateway -> Ingestor -> Queue -> Worker -> Role assignment
3. Worker crash: Events buffered in queue, processed on recovery
4. Ingestor restart: Gateway reconnects, no event loss

**Acceptance Criteria**:
- [ ] E2E tests run against staging environment
- [ ] Tests verify complete flow
- [ ] Tests verify fault tolerance
- [ ] Tests verify no event loss
- [ ] Automated in CI (staging only)

**Complexity**: High

---

#### TASK-5.2: Load Testing Suite

**Description**: Create load tests using k6 to verify performance targets.

**Files to Create**:
- `tests/load/gateway-proxy.js`
- `tests/load/config.json`

**Load Profile** (per SDD Section 10.3):
```yaml
stages:
  - duration: 1m, target: 100    # Ramp up
  - duration: 5m, target: 1000   # Sustain
  - duration: 1m, target: 5000   # Spike
  - duration: 5m, target: 1000   # Return
  - duration: 1m, target: 0      # Ramp down
```

**Thresholds**:
- Ingestor latency p99 < 50ms
- Worker latency p99 < 100ms
- Error rate < 0.1%

**Acceptance Criteria**:
- [ ] Load tests simulate realistic traffic
- [ ] Thresholds match SDD requirements
- [ ] Results exported to CloudWatch
- [ ] Dashboard shows load test metrics
- [ ] Runbook for interpreting results

**Complexity**: Medium

---

#### TASK-5.3: Chaos Testing

**Description**: Verify system resilience under failure conditions.

**Test Scenarios**:
1. Kill Worker container - Events buffer, new worker picks up
2. Kill Ingestor container - Gateway reconnects, no event loss
3. RabbitMQ connection drop - Reconnection works
4. Redis unavailable - Graceful degradation
5. Database connection pool exhaustion - Circuit breaker triggers

**Acceptance Criteria**:
- [ ] Each scenario documented
- [ ] Recovery time measured
- [ ] No data loss in any scenario
- [ ] Alerts fire correctly
- [ ] Runbook for each failure mode

**Complexity**: High

---

#### TASK-5.4: Monitoring Dashboard

**Description**: Create CloudWatch dashboard for Gateway Proxy metrics.

**Files to Create**:
- `infrastructure/terraform/monitoring.tf` (or add to existing)

**Metrics** (per SDD Section 8.1):
- Ingestor: events.published, memory.mb, gateway.latency.ms
- RabbitMQ: queue.depth.interactions, queue.depth.events, dlq.depth
- Worker: processing.latency.ms, error.rate, messages.processed

**Acceptance Criteria**:
- [ ] Dashboard shows all key metrics
- [ ] Alarms configured for thresholds
- [ ] SNS topic for alert notifications
- [ ] Dashboard accessible via AWS Console
- [ ] Documented in runbook

**Complexity**: Medium

---

#### TASK-5.5: Deploy to Staging

**Description**: Deploy complete Gateway Proxy stack to staging environment.

**Deployment Order**:
1. RabbitMQ (already deployed in Sprint 1)
2. Ingestor service (new)
3. Worker service (updated)
4. API service (unchanged, but verify integration)

**Acceptance Criteria**:
- [ ] All services running in staging
- [ ] Ingestor connects to Discord Gateway
- [ ] Events flow through queue to Workers
- [ ] Commands respond correctly
- [ ] Monitoring shows healthy metrics
- [ ] No errors in CloudWatch logs

**Complexity**: Medium

---

#### TASK-5.6: Shadow Mode Implementation

**Description**: Implement feature flag to run both old and new paths simultaneously.

**Files to Modify**:
- `themes/sietch/src/index.ts`
- `themes/sietch/src/services/discord.ts`

**Implementation**:
```typescript
const USE_GATEWAY_PROXY = process.env.USE_GATEWAY_PROXY === 'true';

if (USE_GATEWAY_PROXY) {
  // Events go to queue (Ingestor handles gateway)
  logger.info('Gateway Proxy mode enabled');
} else {
  // Legacy: direct gateway connection
  await discordService.connect();
}
```

**Acceptance Criteria**:
- [ ] Feature flag controls gateway mode
- [ ] Both paths can run simultaneously
- [ ] Metrics distinguish old vs new path
- [ ] Easy toggle via environment variable
- [ ] No code changes required for switch

**Complexity**: Low

---

#### TASK-5.7: Documentation Update

**Description**: Update all documentation for the new architecture.

**Files to Create/Update**:
- `docs/architecture/gateway-proxy.md` (NEW)
- `docs/runbook/gateway-proxy-ops.md` (NEW)
- `README.md` (UPDATE)
- `CONTRIBUTING.md` (UPDATE)

**Acceptance Criteria**:
- [ ] Architecture diagram in docs
- [ ] Runbook covers common operations
- [ ] Troubleshooting guide
- [ ] Local development setup
- [ ] Deployment procedures

**Complexity**: Medium

---

### Sprint 5 Exit Criteria

- [ ] E2E tests pass in staging
- [ ] Load tests meet thresholds
- [ ] Chaos tests show resilience
- [ ] Monitoring dashboard operational
- [ ] Shadow mode works
- [ ] Documentation complete
- [ ] Ready for production cutover

---

## Sprint 6: Production Cutover

**Goal**: Safely migrate production traffic to Gateway Proxy architecture.

**Milestone**: M7 - Production Live

### Tasks

#### TASK-6.1: Production Infrastructure Deployment

**Description**: Deploy Gateway Proxy infrastructure to production.

**Steps**:
1. Apply Terraform for production RabbitMQ
2. Verify queue topology
3. Deploy Ingestor service (0 tasks initially)
4. Deploy Worker service (0 tasks initially)

**Acceptance Criteria**:
- [ ] Production RabbitMQ deployed (multi-AZ)
- [ ] Ingestor task definition ready
- [ ] Worker task definition ready
- [ ] Security groups correct
- [ ] Secrets in Secrets Manager

**Complexity**: Medium

---

#### TASK-6.2: Gradual Traffic Migration

**Description**: Incrementally shift traffic from monolith to Gateway Proxy.

**Migration Phases**:
1. **0% traffic**: Deploy services with 0 tasks
2. **Shadow mode**: Ingestor receives events, also forwarded to legacy
3. **10% traffic**: Enable 1 Worker, disable 10% of legacy
4. **50% traffic**: Scale Workers, disable half of legacy
5. **100% traffic**: All Workers active, legacy disabled

**Acceptance Criteria**:
- [ ] Each phase has rollback point
- [ ] Metrics tracked at each phase
- [ ] No errors above threshold at any phase
- [ ] Complete migration within 4 hours
- [ ] Communication plan for team

**Complexity**: High

---

#### TASK-6.3: Rollback Procedure Verification

**Description**: Test and document rollback procedure.

**Rollback Steps** (per SDD Section 11.2):
1. Stop Ingestor service
2. Scale down Workers
3. Deploy previous API version (with embedded Discord)
4. Verify legacy path working
5. Drain queue to DLQ

**Acceptance Criteria**:
- [ ] Rollback tested in staging
- [ ] Rollback completes in <15 minutes
- [ ] No event loss during rollback
- [ ] Runbook documented
- [ ] Team trained on procedure

**Complexity**: Medium

---

#### TASK-6.4: Remove Legacy Discord Code

**Description**: Clean up monolithic Discord code after successful migration.

**Files to Remove/Archive**:
- `themes/sietch/src/services/discord.ts` - Archive
- `themes/sietch/src/services/discord/` - Archive
- `themes/sietch/src/discord/` - Migrate remaining utilities

**Acceptance Criteria**:
- [ ] Legacy code archived (not deleted immediately)
- [ ] No references to old DiscordService
- [ ] Entry point updated to remove Discord connect
- [ ] API service still works
- [ ] Telegram integration unchanged

**Complexity**: Low

---

#### TASK-6.5: Performance Baseline

**Description**: Establish production performance baseline for ongoing monitoring.

**Metrics to Baseline**:
- Event ingestion latency (p50, p95, p99)
- Event processing latency (p50, p95, p99)
- Memory usage (Ingestor, Worker)
- Queue depth (normal operations)
- Error rate

**Acceptance Criteria**:
- [ ] Baseline metrics documented
- [ ] Alerts tuned based on baseline
- [ ] Dashboard shows baseline thresholds
- [ ] Weekly review scheduled
- [ ] Capacity planning document

**Complexity**: Low

---

#### TASK-6.6: Post-Migration Validation

**Description**: Verify all functionality works correctly in production.

**Validation Checklist**:
- [ ] All 20 slash commands work
- [ ] Member join/leave processing works
- [ ] Role assignments work
- [ ] Notifications work
- [ ] Admin commands work
- [ ] No elevated error rates
- [ ] Performance meets targets

**Acceptance Criteria**:
- [ ] All checklist items verified
- [ ] 24-hour soak test passes
- [ ] No customer-facing issues
- [ ] Team sign-off obtained

**Complexity**: Medium

---

#### TASK-6.7: Final Documentation and Handoff

**Description**: Complete all documentation and knowledge transfer.

**Deliverables**:
- Architecture decision record (ADR)
- Operational runbook (final)
- Troubleshooting guide
- On-call procedures
- Capacity planning guide

**Acceptance Criteria**:
- [ ] All documentation reviewed
- [ ] Team trained on operations
- [ ] On-call rotation updated
- [ ] Incident response updated
- [ ] Project retrospective completed

**Complexity**: Low

---

### Sprint 6 Exit Criteria

- [ ] Production running on Gateway Proxy
- [ ] No legacy Discord code active
- [ ] All metrics healthy
- [ ] Documentation complete
- [ ] Team trained
- [ ] Project complete

---

## Risk Register

| Risk | Probability | Impact | Mitigation | Sprint |
|------|-------------|--------|------------|--------|
| RabbitMQ latency higher than expected | Medium | High | Benchmark in Sprint 1, tune settings | 1 |
| discord.js caching difficult to disable | Low | High | Test in Sprint 2, fallback to discord.js-light | 2 |
| State migration breaks features | Medium | High | Comprehensive testing in Sprint 4 | 4 |
| Production cutover causes incidents | Medium | High | Gradual migration, rollback ready | 6 |
| Memory leaks in Ingestor | Low | Medium | Load test in Sprint 5 | 5 |
| Queue depth grows unbounded | Low | High | Auto-scaling, alerts in Sprint 5 | 5 |

---

## Success Metrics

| Metric | Current | Target | Verification |
|--------|---------|--------|--------------|
| Max Servers | ~100 | 10,000+ | Load testing |
| Response Latency (p99) | Unknown | <100ms | APM monitoring |
| Gateway Uptime | Coupled | 99.99% | Independent health checks |
| Memory per Shard | ~500MB | <50MB | Container metrics |
| Horizontal Scale Time | N/A | <60s | Auto-scaling test |
| Worker Recovery | Full restart | <5s | Chaos testing |

---

## Dependencies

### External Dependencies

| Dependency | Required By | Risk |
|------------|-------------|------|
| Amazon MQ availability | Sprint 1 | Low (managed service) |
| Discord API stability | All sprints | Low (mature API) |
| Berachain RPC | Sprint 4 | Medium (mitigated by pattern) |

### Internal Dependencies

| Task | Depends On | Sprint |
|------|------------|--------|
| TASK-2.3 (Publisher) | TASK-1.2 (Queue topology) | 2 depends on 1 |
| TASK-3.2 (InteractionConsumer) | TASK-2.3 (Publisher) | 3 depends on 2 |
| TASK-4.2-4.4 (Commands) | TASK-3.4 (DiscordRest) | 4 depends on 3 |
| TASK-5.5 (Staging deploy) | TASK-4.8 (Integration tests) | 5 depends on 4 |
| TASK-6.2 (Traffic migration) | TASK-5.5 (Staging deploy) | 6 depends on 5 |

---

## Appendix

### A. File Inventory

**New Files to Create** (approximately):
- `apps/ingestor/` - ~15 files
- `apps/worker/` - ~40 files
- `infrastructure/` - ~5 files
- `tests/` - ~20 files
- `docs/` - ~5 files

**Files to Archive**:
- `themes/sietch/src/services/discord.ts`
- `themes/sietch/src/services/discord/`

**Files to Modify**:
- `themes/sietch/src/index.ts`
- `infrastructure/terraform/ecs.tf`
- `.github/workflows/*.yml`

### B. Command Migration Reference

| Command | Complexity | Sprint | Dependencies |
|---------|------------|--------|--------------|
| `/stats` | Low | 4 | Database read |
| `/position` | Low | 4 | Database read |
| `/threshold` | Low | 4 | Config read |
| `/directory` | Low | 4 | Database read |
| `/resume` | Low | 4 | Redis session |
| `/register-waitlist` | Low | 4 | Database write |
| `/leaderboard` | Low | 4 | Pagination |
| `/profile` | Medium | 4 | Database + embed |
| `/badges` | Medium | 4 | Image generation |
| `/alerts` | Medium | 4 | Subscriptions |
| `/naib` | Medium | 4 | Role assignment |
| `/onboard` | Medium | 4 | Setup wizard |
| `/admin-stats` | Medium | 4 | Admin check |
| `/admin-badge` | Medium | 4 | Admin check |
| `/check-eligibility` | High | 4 | Blockchain RPC |
| `/verify` | High | 4 | Wallet verification |
| `/water-share` | High | 4 | Multi-step flow |
| `/admin-migrate` | High | 4 | Migration utility |
| `/admin-takeover` | High | 4 | Emergency admin |
| `/admin-water-share` | Medium | 4 | Admin utility |

---

**Document Status**: Ready for Implementation

**Next Step**: `/implement sprint-1`
