# Software Design Document: Gateway Proxy Pattern

**Document Version**: 1.0
**Status**: Draft
**Created**: 2026-01-14
**Last Updated**: 2026-01-14
**PRD Reference**: `prd-gateway-proxy.md`

---

## 1. Executive Summary

This SDD defines the technical architecture for transforming Arrakis from a monolithic Discord bot to a **Gateway Proxy Pattern** architecture. The design separates the Discord Gateway WebSocket connection (Ingestor) from business logic processing (Workers) using RabbitMQ as the message queue.

### Key Architectural Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Message Queue | RabbitMQ (Amazon MQ) | Industry standard, AMQP protocol, managed service available |
| Ingestor Runtime | Node.js + discord.js (minimal) | Same language as existing codebase, minimal learning curve |
| Worker Runtime | Node.js (existing Sietch) | Reuse existing business logic with refactoring |
| State Store | Redis (existing ElastiCache) | Already deployed, proven at scale |
| Database | PostgreSQL + PgBouncer | Connection pooling for high concurrency |

---

## 2. Current Architecture Analysis

### 2.1 Existing Component Map

```
themes/sietch/
├── src/
│   ├── index.ts                    # Main entry - couples API, Discord, Telegram
│   ├── config.ts                   # Configuration management
│   ├── services/
│   │   ├── discord.ts              # DiscordService class (MONOLITHIC)
│   │   └── discord/
│   │       ├── handlers/           # Event handlers
│   │       │   ├── EventHandler.ts
│   │       │   ├── InteractionHandler.ts
│   │       │   └── AutocompleteHandler.ts
│   │       ├── operations/         # Role management, DMs
│   │       ├── embeds/             # Embed builders
│   │       └── processors/         # Eligibility processing
│   ├── discord/
│   │   ├── commands/               # 18 slash commands
│   │   ├── embeds/                 # UI embeds
│   │   └── interactions/           # Modal/button handlers
│   ├── api/                        # Express REST API
│   ├── db/                         # Database layer
│   └── telegram/                   # Telegram bot (already separate)
```

### 2.2 Current Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    CURRENT MONOLITHIC FLOW                       │
└─────────────────────────────────────────────────────────────────┘

User Interaction
      │
      ▼
┌──────────────┐
│   Discord    │
│   Gateway    │ WebSocket
└──────┬───────┘
       │
       ▼
┌──────────────────────────────────────────────────┐
│            themes/sietch/src/index.ts            │
│  ┌─────────────────────────────────────────────┐ │
│  │          DiscordService (COUPLED)           │ │
│  │  • Gateway connection (client.login)        │ │
│  │  • Event handlers (same event loop)         │ │
│  │  • Blockchain RPC calls (BLOCKING)          │ │
│  │  • Database queries (BLOCKING)              │ │
│  │  • Role management (REST API)               │ │
│  └─────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
       │                    │                    │
       ▼                    ▼                    ▼
  ┌─────────┐        ┌──────────┐         ┌──────────┐
  │ Berachain│        │PostgreSQL│         │  Discord │
  │   RPC    │        │   RDS    │         │ REST API │
  └─────────┘        └──────────┘         └──────────┘
```

**Critical Coupling Points:**
1. `themes/sietch/src/index.ts:27-28` - `discordService.connect()` on same process as API
2. `themes/sietch/src/services/discord.ts:122` - `client.login()` shares event loop
3. Event handlers execute blockchain calls on WebSocket thread

### 2.3 Identified Risks at Scale

| Component | Current State | Risk at 10k Servers |
|-----------|--------------|---------------------|
| `DiscordService.client` | Single Client instance | Memory exhaustion from cached objects |
| `client.login()` | Same process as API | Gateway heartbeat blocked by RPC |
| Event handlers | Synchronous on WebSocket | Zombie state during slow queries |
| PostgreSQL connections | Direct via Drizzle | Pool exhaustion under load |
| State (cooldowns, sessions) | Unknown (needs audit) | If in-memory, breaks with sharding |

---

## 3. Target Architecture

### 3.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       GATEWAY PROXY PATTERN ARCHITECTURE                     │
└─────────────────────────────────────────────────────────────────────────────┘

                                  Discord Users
                                       │
                                       ▼
                              ┌─────────────────┐
                              │  Discord API    │
                              │  (WebSocket)    │
                              └────────┬────────┘
                                       │
                    ┌──────────────────┴──────────────────┐
                    │                                      │
                    ▼                                      ▼
           ┌─────────────────┐                   ┌─────────────────┐
           │   INGESTOR 1    │                   │   INGESTOR N    │
           │  (Shard 0-999)  │                   │ (Shard N*1000+) │
           │                 │                   │                 │
           │ • Zero caching  │                   │ • Zero caching  │
           │ • Event → Queue │                   │ • Event → Queue │
           │ • <50MB memory  │                   │ • <50MB memory  │
           └────────┬────────┘                   └────────┬────────┘
                    │                                      │
                    └──────────────────┬───────────────────┘
                                       │
                                       ▼
                    ┌─────────────────────────────────────────┐
                    │             RABBITMQ CLUSTER            │
                    │           (Amazon MQ - Managed)         │
                    │                                         │
                    │  ┌─────────────┐ ┌─────────────┐       │
                    │  │ interactions│ │   events    │       │
                    │  │  (priority) │ │  (normal)   │       │
                    │  └─────────────┘ └─────────────┘       │
                    │                                         │
                    │  ┌─────────────┐                       │
                    │  │     DLQ     │ (dead-letter)         │
                    │  └─────────────┘                       │
                    └────────────────────┬────────────────────┘
                                         │
              ┌──────────────────────────┼──────────────────────────┐
              │                          │                          │
              ▼                          ▼                          ▼
     ┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
     │    WORKER 1     │       │    WORKER 2     │       │    WORKER N     │
     │                 │       │                 │       │                 │
     │ • Stateless     │       │ • Stateless     │       │ • Stateless     │
     │ • RPC calls     │       │ • RPC calls     │       │ • RPC calls     │
     │ • DB queries    │       │ • DB queries    │       │ • DB queries    │
     │ • REST replies  │       │ • REST replies  │       │ • REST replies  │
     └────────┬────────┘       └────────┬────────┘       └────────┬────────┘
              │                          │                          │
              └──────────────────────────┼──────────────────────────┘
                                         │
              ┌──────────────────────────┼──────────────────────────┐
              │                          │                          │
              ▼                          ▼                          ▼
     ┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
     │     Redis       │       │   PostgreSQL    │       │  Discord REST   │
     │  (ElastiCache)  │       │   (RDS + PgB)   │       │      API        │
     └─────────────────┘       └─────────────────┘       └─────────────────┘
```

### 3.2 Component Specifications

#### 3.2.1 Ingestor Service ("The Ear")

**Purpose**: Lightweight Discord Gateway listener with zero business logic.

```typescript
// apps/ingestor/src/index.ts (PROPOSED STRUCTURE)

import { Client, GatewayIntentBits, Options } from 'discord.js';
import amqp from 'amqplib';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
  ],
  // CRITICAL: Disable ALL caching
  makeCache: Options.cacheWithLimits({
    ...Options.DefaultMakeCacheSettings,
    GuildMemberManager: 0,
    UserManager: 0,
    MessageManager: 0,
    PresenceManager: 0,
    VoiceStateManager: 0,
    GuildScheduledEventManager: 0,
    ThreadManager: 0,
    ThreadMemberManager: 0,
    ReactionManager: 0,
    ReactionUserManager: 0,
    StageInstanceManager: 0,
    GuildStickerManager: 0,
    GuildEmojiManager: 0,
    GuildBanManager: 0,
    GuildInviteManager: 0,
    AutoModerationRuleManager: 0,
  }),
  sweepers: {
    ...Options.DefaultSweeperSettings,
    messages: { interval: 60, lifetime: 60 },
  },
});
```

**Specifications:**

| Attribute | Value | Rationale |
|-----------|-------|-----------|
| Memory Target | <50MB per shard | Caching disabled |
| CPU | 256 vCPU (Fargate) | Event forwarding only |
| Scaling | 1 task per 2,500 servers | Discord sharding requirement |
| Dependencies | discord.js, amqplib | Minimal footprint |
| Health Check | WebSocket connected + queue writable | Both paths must work |

#### 3.2.2 Message Queue (RabbitMQ)

**Queue Topology:**

```
┌──────────────────────────────────────────────────────────────┐
│                    RABBITMQ TOPOLOGY                          │
└──────────────────────────────────────────────────────────────┘

Exchange: arrakis.events (topic)
    │
    ├─► Queue: arrakis.interactions (priority)
    │   Binding: interaction.*, interaction.command.*, interaction.button.*
    │   Settings:
    │     • x-max-priority: 10
    │     • durable: true
    │     • dead-letter-exchange: arrakis.dlx
    │
    ├─► Queue: arrakis.events.guild (normal)
    │   Binding: guild.*, member.*
    │   Settings:
    │     • durable: true
    │     • dead-letter-exchange: arrakis.dlx
    │
    └─► Queue: arrakis.dlq (dead-letter)
        Binding: # (from arrakis.dlx)
        Settings:
          • message-ttl: 604800000 (7 days)
          • durable: true
```

**Event Payload Schema:**

```typescript
interface DiscordEventPayload {
  // Metadata
  eventId: string;          // UUID v4
  eventType: string;        // e.g., 'interaction.command.check-eligibility'
  timestamp: number;        // Unix ms
  shardId: number;          // Origin shard

  // Routing
  guildId: string;          // For tenant isolation
  channelId?: string;
  userId?: string;

  // Discord-specific
  interactionId?: string;   // For deferred responses
  interactionToken?: string;// For followup webhooks

  // Payload
  data: Record<string, unknown>;
}
```

#### 3.2.3 Worker Service ("The Brain")

**Purpose**: Stateless business logic processor consuming from RabbitMQ.

**Structure (Refactored from themes/sietch):**

```
apps/worker/
├── src/
│   ├── index.ts              # Worker entry point (queue consumer)
│   ├── config.ts             # Configuration
│   ├── consumers/
│   │   ├── InteractionConsumer.ts
│   │   ├── EventConsumer.ts
│   │   └── index.ts
│   ├── handlers/             # Business logic (from existing)
│   │   ├── commands/         # Slash command handlers
│   │   ├── events/           # Guild/member event handlers
│   │   └── index.ts
│   ├── services/             # Shared services
│   │   ├── DiscordRest.ts    # REST-only Discord client
│   │   ├── ChainService.ts   # Blockchain queries
│   │   ├── ScoreService.ts   # Conviction scoring
│   │   └── index.ts
│   ├── packages/             # Reused from sietch
│   │   ├── adapters/
│   │   ├── core/
│   │   └── security/
│   └── utils/
```

**Consumer Implementation:**

```typescript
// apps/worker/src/consumers/InteractionConsumer.ts

import amqp from 'amqplib';
import { REST, Routes } from 'discord.js';
import { handleSlashCommand } from '../handlers/commands/index.js';

export class InteractionConsumer {
  private channel: amqp.Channel;
  private rest: REST;

  async consume(msg: amqp.ConsumeMessage): Promise<void> {
    const payload: DiscordEventPayload = JSON.parse(msg.content.toString());

    try {
      // Defer response immediately (within 3s)
      await this.rest.post(
        Routes.interactionCallback(payload.interactionId!, payload.interactionToken!),
        { body: { type: 5 } } // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
      );

      // Process command (may take 2s+ for RPC)
      const result = await handleSlashCommand(payload);

      // Send followup
      await this.rest.post(
        Routes.webhook(process.env.DISCORD_APPLICATION_ID!, payload.interactionToken!),
        { body: result }
      );

      this.channel.ack(msg);
    } catch (error) {
      // Requeue or send to DLQ based on error type
      this.channel.nack(msg, false, isRetryable(error));
    }
  }
}
```

**Specifications:**

| Attribute | Value | Rationale |
|-----------|-------|-----------|
| Memory | 512MB (Fargate) | Business logic + RPC connections |
| CPU | 512 vCPU | Computation-heavy operations |
| Scaling | Auto (2-20 based on queue depth) | Handle traffic spikes |
| Stateless | All state in Redis/PostgreSQL | Horizontal scaling |
| Prefetch | 10 messages | Throughput optimization |

---

## 4. Data Flow Specifications

### 4.1 Slash Command Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    SLASH COMMAND EXECUTION FLOW                          │
└─────────────────────────────────────────────────────────────────────────┘

Timeline: ────────────────────────────────────────────────────────────────►
          0ms        10ms       100ms      1000ms     2500ms     3000ms

User: /check-eligibility
          │
          ▼
Discord Gateway ──► Ingestor
                      │
                      │ <10ms (CRITICAL)
                      ▼
                   RabbitMQ
                      │
                      │ ~50ms (queue latency)
                      ▼
                   Worker
                      │
                      │ Immediate defer (within 3s deadline)
                      ▼
Discord REST ◄──── POST /interactions/:id/:token/callback
                      │      { type: 5 } // DEFERRED
                      │
                      │ ~2000ms (blockchain RPC)
                      ▼
                   Score Calculation
                      │
                      │ ~500ms (database, Redis)
                      ▼
Discord REST ◄──── POST /webhooks/:app/:token
                      │      { embeds: [...] }
                      │
                      ▼
                   User sees response
```

### 4.2 Guild Member Join Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    GUILD MEMBER JOIN FLOW                                │
└─────────────────────────────────────────────────────────────────────────┘

guildMemberAdd Event
          │
          ▼
Ingestor (Shard N)
          │
          │ Serialize to JSON, no processing
          ▼
RabbitMQ: arrakis.events.guild
          │
          │ Routing key: member.join
          ▼
Worker (Any)
          │
          ├──► Check eligibility (Redis cache first)
          │         │
          │         ├──► Cache HIT: Return cached eligibility
          │         │
          │         └──► Cache MISS: Query Berachain RPC
          │                   │
          │                   └──► Update Redis cache (TTL: 5min)
          │
          ├──► Log to PostgreSQL (audit trail)
          │
          └──► Assign roles via Discord REST API
                      │
                      ▼
               PUT /guilds/:id/members/:id
               { roles: [...] }
```

### 4.3 State Synchronization

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    STATE MANAGEMENT ARCHITECTURE                         │
└─────────────────────────────────────────────────────────────────────────┘

                    ┌─────────────────────────────────┐
                    │            REDIS                │
                    │      (State Authority)          │
                    └─────────────────────────────────┘
                                   │
           ┌───────────────────────┼───────────────────────┐
           │                       │                       │
           ▼                       ▼                       ▼
   ┌───────────────┐       ┌───────────────┐       ┌───────────────┐
   │  Cooldowns    │       │  Sessions     │       │  Rate Limits  │
   │               │       │               │       │               │
   │ Key Pattern:  │       │ Key Pattern:  │       │ Key Pattern:  │
   │ cd:{cmd}:{id} │       │ sess:{type}:  │       │ rl:{ip}:{ep}  │
   │               │       │      {userId} │       │               │
   │ TTL: varies   │       │ TTL: 15min    │       │ TTL: 1min     │
   │ per command   │       │               │       │               │
   └───────────────┘       └───────────────┘       └───────────────┘

State Migration Required:
┌────────────────────────────────────────────────────────────────┐
│ CURRENT (in themes/sietch - NEEDS AUDIT)                       │
│                                                                 │
│ ✗ Local Map objects for cooldowns (breaks with sharding)       │
│ ✗ Session state in memory (lost on restart)                    │
│ ✓ Rate limiting already uses Redis (via express-rate-limit)    │
│                                                                 │
│ MIGRATION TASKS:                                                │
│ 1. Audit all Map/Set usages in discord handlers                │
│ 2. Migrate to Redis with consistent key patterns               │
│ 3. Implement TTL cleanup for all state keys                    │
└────────────────────────────────────────────────────────────────┘
```

---

## 5. API Contracts

### 5.1 Ingestor → RabbitMQ

**Publisher Interface:**

```typescript
interface IngestorPublisher {
  /**
   * Publish Discord event to appropriate queue
   */
  publish(event: DiscordEventPayload): Promise<void>;

  /**
   * Health check - can write to queue
   */
  isHealthy(): boolean;
}
```

**Routing Rules:**

| Event Type | Routing Key | Queue | Priority |
|------------|-------------|-------|----------|
| `INTERACTION_CREATE` (command) | `interaction.command.{name}` | interactions | 10 (high) |
| `INTERACTION_CREATE` (button) | `interaction.button.{customId}` | interactions | 8 |
| `INTERACTION_CREATE` (modal) | `interaction.modal.{customId}` | interactions | 8 |
| `GUILD_MEMBER_ADD` | `member.join` | events | 5 |
| `GUILD_MEMBER_REMOVE` | `member.leave` | events | 5 |
| `GUILD_MEMBER_UPDATE` | `member.update` | events | 3 |
| `MESSAGE_CREATE` | `message.create` | events | 1 (low) |

### 5.2 Worker → Discord REST

**Discord REST Wrapper:**

```typescript
// apps/worker/src/services/DiscordRest.ts

import { REST, Routes } from 'discord.js';

export class DiscordRestService {
  private rest: REST;

  constructor(token: string) {
    this.rest = new REST({ version: '10' }).setToken(token);
  }

  /**
   * Defer an interaction response (must be within 3s)
   */
  async deferReply(interactionId: string, token: string): Promise<void>;

  /**
   * Send followup message after deferral
   */
  async sendFollowup(applicationId: string, token: string, payload: InteractionResponse): Promise<void>;

  /**
   * Edit the original deferred response
   */
  async editOriginal(applicationId: string, token: string, payload: InteractionResponse): Promise<void>;

  /**
   * Assign role to guild member
   */
  async assignRole(guildId: string, userId: string, roleId: string): Promise<void>;

  /**
   * Remove role from guild member
   */
  async removeRole(guildId: string, userId: string, roleId: string): Promise<void>;

  /**
   * Send DM to user
   */
  async sendDM(userId: string, payload: MessagePayload): Promise<void>;
}
```

### 5.3 Worker → Database

**Connection Pooling (PgBouncer):**

```
┌──────────────────────────────────────────────────────────────────┐
│                    DATABASE CONNECTION FLOW                       │
└──────────────────────────────────────────────────────────────────┘

Worker 1 ──┐                         ┌─── PostgreSQL (RDS)
Worker 2 ──┼───► PgBouncer (ECS) ───►│   Connection Limit: 100
Worker 3 ──┤    Pool Size: 200       │   RLS Policies Active
...        │    Mode: transaction    │
Worker N ──┘                         └───────────────────────────────

Configuration:
┌─────────────────────────────────────────────────────────────────┐
│ [pgbouncer]                                                     │
│ pool_mode = transaction                                         │
│ max_client_conn = 200                                           │
│ default_pool_size = 20                                          │
│ reserve_pool_size = 5                                           │
│ reserve_pool_timeout = 3                                        │
│                                                                 │
│ [databases]                                                     │
│ arrakis = host=arrakis-production-postgres.xxx.rds port=5432    │
│           dbname=arrakis auth_user=arrakis_admin                │
└─────────────────────────────────────────────────────────────────┘
```

---

## 6. Infrastructure Design

### 6.1 AWS Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          VPC: 10.0.0.0/16                               │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                     PUBLIC SUBNETS (10.0.1.x)                       │ │
│  │  ┌─────────────────────────────────────────────────────────────┐   │ │
│  │  │                Application Load Balancer                     │   │ │
│  │  │                (api.arrakis.community)                       │   │ │
│  │  └─────────────────────────────────────────────────────────────┘   │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                    │                                     │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                    PRIVATE SUBNETS (10.0.2.x)                       │ │
│  │                                                                      │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                 │ │
│  │  │  ECS:       │  │  ECS:       │  │  ECS:       │                 │ │
│  │  │  Ingestor   │  │  Worker     │  │  API        │                 │ │
│  │  │  (1+ tasks) │  │  (2-20)     │  │  (2+ tasks) │                 │ │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘                 │ │
│  │         │                │                │                         │ │
│  │         └────────────────┼────────────────┘                         │ │
│  │                          │                                          │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                 │ │
│  │  │  Amazon MQ  │  │  ElastiCache│  │  RDS        │                 │ │
│  │  │  (RabbitMQ) │  │  (Redis)    │  │  (Postgres) │                 │ │
│  │  │             │  │             │  │             │                 │ │
│  │  └─────────────┘  └─────────────┘  └─────────────┘                 │ │
│  │                                                                      │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Terraform Resources (Additions to ecs.tf)

```hcl
# New Ingestor Task Definition
resource "aws_ecs_task_definition" "ingestor" {
  family                   = "${local.name_prefix}-ingestor"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256   # Minimal - just event forwarding
  memory                   = 512   # <50MB target with buffer
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name  = "ingestor"
      image = "${aws_ecr_repository.ingestor.repository_url}:${var.image_tag}"

      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "SHARD_COUNT", value = "auto" },
        { name = "RABBITMQ_QUEUE", value = "arrakis.events" }
      ]

      secrets = [
        { name = "DISCORD_BOT_TOKEN", valueFrom = "..." },
        { name = "RABBITMQ_URL", valueFrom = "..." }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.ingestor.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ingestor"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "node healthcheck.js"]
        interval    = 10
        timeout     = 5
        retries     = 3
        startPeriod = 30
      }
    }
  ])
}

# Ingestor Service - NO load balancer (outbound only)
resource "aws_ecs_service" "ingestor" {
  name            = "${local.name_prefix}-ingestor"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.ingestor.arn
  desired_count   = var.ingestor_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = module.vpc.private_subnets
    security_groups  = [aws_security_group.ingestor.id]
    assign_public_ip = false
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
}

# Amazon MQ (RabbitMQ)
resource "aws_mq_broker" "rabbitmq" {
  broker_name        = "${local.name_prefix}-rabbitmq"
  engine_type        = "RabbitMQ"
  engine_version     = "3.12"
  host_instance_type = var.environment == "production" ? "mq.m5.large" : "mq.t3.micro"
  deployment_mode    = var.environment == "production" ? "CLUSTER_MULTI_AZ" : "SINGLE_INSTANCE"

  user {
    username = "admin"
    password = random_password.rabbitmq.result
  }

  encryption_options {
    use_aws_owned_key = true
  }

  logs {
    general = true
  }

  subnet_ids         = var.environment == "production" ? module.vpc.private_subnets : [module.vpc.private_subnets[0]]
  security_groups    = [aws_security_group.rabbitmq.id]
}

# Security Group for RabbitMQ
resource "aws_security_group" "rabbitmq" {
  name_prefix = "${local.name_prefix}-rabbitmq-"
  vpc_id      = module.vpc.vpc_id

  ingress {
    from_port       = 5671
    to_port         = 5671
    protocol        = "tcp"
    security_groups = [aws_security_group.ingestor.id, aws_security_group.ecs_tasks.id]
    description     = "AMQPS from ECS tasks"
  }

  ingress {
    from_port       = 15671
    to_port         = 15671
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_tasks.id]
    description     = "Management console"
  }
}
```

### 6.3 Auto-Scaling Configuration

```hcl
# Worker Auto-Scaling based on RabbitMQ queue depth
resource "aws_appautoscaling_target" "worker" {
  max_capacity       = 20
  min_capacity       = 2
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.worker.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "worker_queue_depth" {
  name               = "${local.name_prefix}-worker-queue-depth"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.worker.resource_id
  scalable_dimension = aws_appautoscaling_target.worker.scalable_dimension
  service_namespace  = aws_appautoscaling_target.worker.service_namespace

  target_tracking_scaling_policy_configuration {
    target_value       = 100  # Target 100 messages per worker
    scale_in_cooldown  = 300
    scale_out_cooldown = 60

    customized_metric_specification {
      metric_name = "ApproximateNumberOfMessagesVisible"
      namespace   = "AWS/AmazonMQ"
      statistic   = "Average"
      dimensions {
        name  = "Broker"
        value = aws_mq_broker.rabbitmq.id
      }
      dimensions {
        name  = "Queue"
        value = "arrakis.interactions"
      }
    }
  }
}
```

---

## 7. Migration Strategy

### 7.1 Phase Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       MIGRATION PHASES                                   │
└─────────────────────────────────────────────────────────────────────────┘

Phase 1: Infrastructure Setup (Sprint 1)
├── Deploy Amazon MQ (RabbitMQ)
├── Create Ingestor ECR repository
├── Set up queue topology
└── PgBouncer deployment

Phase 2: Ingestor Development (Sprint 2)
├── Create apps/ingestor package
├── Implement zero-cache Discord client
├── Implement RabbitMQ publisher
├── Deploy to staging
└── Verify gateway stability

Phase 3: Worker Migration (Sprint 3-4)
├── Extract handlers from themes/sietch
├── Implement queue consumers
├── Replace WebSocket with REST
├── State migration to Redis
└── Integration testing

Phase 4: Cutover (Sprint 5)
├── Shadow mode (dual-write)
├── Gradual traffic shift
├── Monitoring verification
└── Full cutover

Phase 5: Cleanup (Sprint 6)
├── Remove monolithic Discord code
├── Archive old service
└── Documentation update
```

### 7.2 File Migration Map

```
CURRENT LOCATION                          → TARGET LOCATION
────────────────────────────────────────────────────────────────────────────
themes/sietch/src/services/discord.ts     → REMOVE (replaced by Ingestor)
themes/sietch/src/services/discord/       → apps/worker/src/handlers/

themes/sietch/src/discord/commands/       → apps/worker/src/handlers/commands/
  ├── check-eligibility.ts                → (unchanged handler, new consumer)
  ├── profile.ts                          → (unchanged handler, new consumer)
  └── ...                                 → ...

themes/sietch/src/discord/embeds/         → apps/worker/src/embeds/
themes/sietch/src/discord/interactions/   → apps/worker/src/handlers/interactions/

themes/sietch/src/packages/               → apps/worker/src/packages/ (SHARED)
  ├── adapters/                           → (reused as-is)
  ├── core/                               → (reused as-is)
  └── security/                           → (reused as-is)

NEW FILES:
apps/ingestor/                            → NEW - Minimal gateway listener
  ├── src/
  │   ├── index.ts                        → Main entry point
  │   ├── publisher.ts                    → RabbitMQ publisher
  │   └── healthcheck.ts                  → Health check endpoint
  └── Dockerfile

apps/worker/                              → NEW - Refactored business logic
  ├── src/
  │   ├── index.ts                        → Queue consumer entry
  │   ├── consumers/                      → Queue consumers
  │   ├── services/DiscordRest.ts         → REST-only Discord client
  │   └── handlers/                       → Business logic (migrated)
  └── Dockerfile
```

### 7.3 Backward Compatibility

During migration, both paths must work:

```typescript
// Feature flag for gradual rollout
const USE_GATEWAY_PROXY = process.env.USE_GATEWAY_PROXY === 'true';

if (USE_GATEWAY_PROXY) {
  // New path: consume from queue
  await startQueueConsumer();
} else {
  // Legacy path: direct gateway connection
  await discordService.connect();
}
```

---

## 8. Observability & Monitoring

### 8.1 Metrics

| Component | Metric | Target | Alert Threshold |
|-----------|--------|--------|-----------------|
| **Ingestor** | `ingestor.events.published` | >0 | = 0 for 1min |
| **Ingestor** | `ingestor.memory.mb` | <50MB | >75MB |
| **Ingestor** | `ingestor.gateway.latency.ms` | <10ms | >50ms |
| **RabbitMQ** | `queue.depth.interactions` | <100 | >1000 |
| **RabbitMQ** | `queue.depth.events` | <500 | >5000 |
| **RabbitMQ** | `dlq.depth` | 0 | >0 |
| **Worker** | `worker.processing.latency.ms` | <100ms (p99) | >500ms |
| **Worker** | `worker.error.rate` | <0.1% | >1% |
| **Worker** | `worker.messages.processed` | - | <10/min per worker |

### 8.2 Distributed Tracing

```typescript
// Correlation ID flow
interface TraceContext {
  traceId: string;      // Root trace ID (from Ingestor)
  spanId: string;       // Current span
  parentSpanId?: string;// Parent span
}

// Ingestor: Create root trace
const traceId = crypto.randomUUID();
const event: DiscordEventPayload = {
  eventId: crypto.randomUUID(),
  traceContext: { traceId, spanId: traceId },
  // ...
};

// Worker: Continue trace
const workerSpan = {
  traceId: event.traceContext.traceId,
  spanId: crypto.randomUUID(),
  parentSpanId: event.traceContext.spanId,
};
```

### 8.3 CloudWatch Dashboards

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    ARRAKIS GATEWAY PROXY DASHBOARD                       │
├─────────────────────────────────────────────────────────────────────────┤
│ ┌─────────────────────┐ ┌─────────────────────┐ ┌─────────────────────┐ │
│ │ Gateway Status      │ │ Queue Depth         │ │ Worker Health       │ │
│ │ ● Shard 0: OK       │ │ interactions: 45    │ │ Running: 4/4        │ │
│ │ ● Shard 1: OK       │ │ events: 123         │ │ Errors: 0.02%       │ │
│ │ Memory: 38MB avg    │ │ DLQ: 0 ✓            │ │ Latency p99: 87ms   │ │
│ └─────────────────────┘ └─────────────────────┘ └─────────────────────┘ │
│                                                                          │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ Event Processing Rate (events/sec)                                   │ │
│ │                                                                       │ │
│ │  100 ├────────────────────────────────────────────────────────────┤  │ │
│ │      │    ▄▄▄▄      ▄▄▄▄▄▄▄                                       │  │ │
│ │   50 ├──▄█████▄──▄██████████▄──────────────────────────────────┤  │ │
│ │      │▄████████████████████████▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄   │  │ │
│ │    0 └────────────────────────────────────────────────────────────┘  │ │
│ │       00:00  02:00  04:00  06:00  08:00  10:00  12:00  14:00  16:00  │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 9. Security Considerations

### 9.1 Secret Management

| Secret | Location | Access |
|--------|----------|--------|
| `DISCORD_BOT_TOKEN` | Secrets Manager | Ingestor ONLY |
| `RABBITMQ_URL` | Secrets Manager | Ingestor + Workers |
| `DATABASE_URL` | Secrets Manager | Workers + API |
| `REDIS_URL` | Secrets Manager | Workers + API |
| `DISCORD_APPLICATION_ID` | Environment | Workers (for REST) |

**Critical**: Discord bot token MUST NOT be in Worker containers. Workers use REST API with application ID + interaction token.

### 9.2 Network Security

```
┌──────────────────────────────────────────────────────────────────────┐
│                    SECURITY GROUP RULES                               │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  Ingestor SG                                                          │
│  ├── Egress: Discord Gateway (wss://gateway.discord.gg)              │
│  ├── Egress: RabbitMQ (5671) → RabbitMQ SG                           │
│  └── Egress: CloudWatch Logs                                          │
│                                                                       │
│  Worker SG                                                            │
│  ├── Ingress: None (pulls from queue)                                │
│  ├── Egress: RabbitMQ (5671) → RabbitMQ SG                           │
│  ├── Egress: PostgreSQL (5432) → RDS SG                              │
│  ├── Egress: Redis (6379) → ElastiCache SG                           │
│  ├── Egress: Discord REST API (HTTPS)                                │
│  ├── Egress: Berachain RPC (HTTPS)                                   │
│  └── Egress: CloudWatch Logs                                          │
│                                                                       │
│  RabbitMQ SG                                                          │
│  ├── Ingress: Ingestor SG (5671 AMQPS)                               │
│  ├── Ingress: Worker SG (5671 AMQPS)                                 │
│  └── Ingress: Worker SG (15671 Management - optional)                │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

### 9.3 RLS Preservation

Row-Level Security policies remain unchanged. Workers connect to PostgreSQL with the same tenant context:

```sql
-- Existing RLS policy (unchanged)
CREATE POLICY tenant_isolation ON member_profiles
  USING (community_id = current_setting('app.community_id')::uuid);

-- Worker sets context before queries
SET LOCAL app.community_id = 'uuid-of-guild';
```

---

## 10. Testing Strategy

### 10.1 Unit Tests

```typescript
// apps/ingestor/tests/publisher.test.ts
describe('IngestorPublisher', () => {
  it('should publish interaction events to priority queue', async () => {
    const publisher = new IngestorPublisher(mockChannel);
    await publisher.publish({
      eventType: 'interaction.command.check-eligibility',
      // ...
    });
    expect(mockChannel.publish).toHaveBeenCalledWith(
      'arrakis.events',
      'interaction.command.check-eligibility',
      expect.any(Buffer),
      { priority: 10, persistent: true }
    );
  });
});

// apps/worker/tests/consumers/InteractionConsumer.test.ts
describe('InteractionConsumer', () => {
  it('should defer response within 3 seconds', async () => {
    const consumer = new InteractionConsumer(mockChannel, mockRest);
    const startTime = Date.now();

    await consumer.consume(mockMessage);

    expect(mockRest.post).toHaveBeenCalledWith(
      expect.stringContaining('/callback'),
      { body: { type: 5 } }
    );
    expect(Date.now() - startTime).toBeLessThan(3000);
  });
});
```

### 10.2 Integration Tests

```typescript
// tests/integration/gateway-proxy.test.ts
describe('Gateway Proxy Integration', () => {
  it('should process slash command end-to-end', async () => {
    // 1. Simulate Discord event
    const event = createMockInteractionEvent('/check-eligibility');

    // 2. Publish to RabbitMQ (simulating Ingestor)
    await testPublisher.publish(event);

    // 3. Wait for Worker to process
    await waitForMessage(event.eventId);

    // 4. Verify Discord REST was called
    expect(mockDiscordRest.sendFollowup).toHaveBeenCalledWith(
      expect.any(String),
      event.interactionToken,
      expect.objectContaining({ embeds: expect.any(Array) })
    );
  });
});
```

### 10.3 Load Tests

```yaml
# k6 load test configuration
stages:
  - duration: 1m
    target: 100    # Ramp up to 100 events/sec
  - duration: 5m
    target: 1000   # Sustain 1000 events/sec
  - duration: 1m
    target: 5000   # Spike to 5000 events/sec
  - duration: 5m
    target: 1000   # Return to baseline
  - duration: 1m
    target: 0      # Ramp down

thresholds:
  ingestor_latency_p99:
    - 'p(99)<50'   # Ingestor must forward in <50ms
  worker_latency_p99:
    - 'p(99)<100'  # Worker must process in <100ms
  error_rate:
    - 'rate<0.001' # Error rate <0.1%
```

---

## 11. Rollback Plan

### 11.1 Rollback Triggers

| Condition | Threshold | Action |
|-----------|-----------|--------|
| Gateway disconnections | >5/hour | Rollback Ingestor |
| Worker error rate | >1% for 5min | Scale down, investigate |
| Queue depth | >10,000 for 10min | Rollback to monolith |
| P99 latency | >1s for 15min | Rollback to monolith |

### 11.2 Rollback Procedure

```bash
# 1. Stop Ingestor service
aws ecs update-service --cluster arrakis-production-cluster \
  --service arrakis-production-ingestor --desired-count 0

# 2. Scale down Workers
aws ecs update-service --cluster arrakis-production-cluster \
  --service arrakis-production-worker --desired-count 0

# 3. Deploy previous API version (with embedded Discord)
aws ecs update-service --cluster arrakis-production-cluster \
  --service arrakis-production-api \
  --task-definition arrakis-production-api:PREVIOUS_VERSION

# 4. Verify legacy path is working
curl https://api.arrakis.community/health

# 5. Drain RabbitMQ queues to DLQ for later analysis
```

---

## 12. Appendix

### A. Command Inventory

Current slash commands to migrate (18 total):

| Command | Handler File | Complexity | Notes |
|---------|--------------|------------|-------|
| `/check-eligibility` | check-eligibility.ts | High | Blockchain RPC |
| `/profile` | profile.ts | Medium | Database + embed |
| `/leaderboard` | leaderboard.ts | Medium | Pagination |
| `/stats` | stats.ts | Low | Read-only |
| `/badges` | badges.ts | Medium | Image generation |
| `/position` | position.ts | Low | Simple query |
| `/threshold` | threshold.ts | Low | Config display |
| `/alerts` | alerts.ts | Medium | Subscription management |
| `/directory` | directory.ts | Low | List display |
| `/naib` | naib.ts | Medium | Role assignment |
| `/water-share` | water-share.ts | High | Multi-step flow |
| `/verify` | verify.ts | High | Wallet verification |
| `/onboard` | onboard.ts | Medium | Setup wizard |
| `/resume` | resume.ts | Low | State resume |
| `/register-waitlist` | register-waitlist.ts | Low | Simple insert |
| `/admin-stats` | admin-stats.ts | Medium | Admin only |
| `/admin-badge` | admin-badge.ts | Medium | Admin only |
| `/admin-migrate` | admin-migrate.ts | High | Migration utility |
| `/admin-takeover` | admin-takeover.ts | High | Emergency admin |
| `/admin-water-share` | admin-water-share.ts | Medium | Admin utility |

### B. Glossary

| Term | Definition |
|------|------------|
| **Gateway** | Discord's WebSocket connection for real-time events |
| **Ingestor** | Lightweight service that only handles Gateway connection |
| **Worker** | Stateless service that processes business logic |
| **Shard** | Subset of Discord guilds handled by one Gateway connection |
| **DLQ** | Dead-letter queue for failed event processing |
| **PgBouncer** | PostgreSQL connection pooler |
| **AMQP** | Advanced Message Queuing Protocol (RabbitMQ) |

### C. References

- [Discord Sharding Documentation](https://discord.com/developers/docs/topics/gateway#sharding)
- [discord.js Caching Guide](https://discordjs.guide/popular-topics/caching.html)
- [RabbitMQ Best Practices](https://www.rabbitmq.com/production-checklist.html)
- [Amazon MQ for RabbitMQ](https://docs.aws.amazon.com/amazon-mq/latest/developer-guide/rabbitmq.html)
- PRD: `prd-gateway-proxy.md`
- Research: `gateway-proxy-pattern-research.md`

---

**Document Status**: Ready for Implementation Planning

**Next Step**: `/sprint-plan grimoires/loa/sdd-gateway-proxy.md`
