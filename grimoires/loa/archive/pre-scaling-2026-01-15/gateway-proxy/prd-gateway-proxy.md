# Product Requirements Document: Gateway Proxy Pattern

**Document Version**: 1.0
**Status**: Draft
**Created**: 2026-01-14
**Last Updated**: 2026-01-14

---

## Executive Summary

This PRD defines the architectural transformation of Arrakis from a monolithic Discord bot to a **Gateway Proxy Pattern** architecture. This change is mandatory for supporting enterprise-scale Discord deployments (10,000+ servers, 5M+ users) without gateway blocking, state fragmentation, or cascading failures.

**Key Decision**: Full rewrite approach using RabbitMQ as the message queue, with the Ingestor deployed as a separate ECS service.

---

## 1. Problem Statement

### 1.1 Current State

Arrakis operates as a monolithic Discord bot where the Gateway WebSocket connection, command processing, and blockchain queries share the same Node.js event loop.

> *Source: gateway-proxy-pattern-research.md:52-57*

**Critical Risks at Scale:**

| Risk | Description | Impact |
|------|-------------|--------|
| **Gateway Blocking** | Slow blockchain RPC calls (200ms-2s) block the Discord WebSocket heartbeat | Bot appears online but stops responding ("zombie state") |
| **State Fragmentation** | Local in-memory state (cooldowns, sessions) breaks when sharding | Inconsistent user experience across shards |
| **Database Contention** | RLS queries under 10k server load exhaust connection pools | Cascading timeouts, service unavailability |
| **Memory Exhaustion** | discord.js default caching stores millions of user objects | OOM crashes, degraded performance |

> *Source: gateway-proxy-pattern-research.md:70-77*

### 1.2 Why Now?

1. **Pre-launch Window**: Arrakis has not yet launched publicly. Implementing the correct architecture now avoids costly migration under production load.
2. **Competitive Positioning**: Enterprise Discord bots (MEE6, Collab.Land) already use Gateway Proxy patterns. Arrakis must match this capability.
3. **Web3 Specificity**: Blockchain RPC latency is unavoidable. The architecture must isolate these calls from the Discord heartbeat.

---

## 2. Product Vision

### 2.1 Vision Statement

Transform Arrakis into an **enterprise-grade, infinitely scalable Discord platform** capable of serving 5M+ users with sub-100ms response times, zero downtime during traffic spikes, and complete fault isolation between gateway connections and business logic.

### 2.2 Success Criteria

| Metric | Current | Target | Method |
|--------|---------|--------|--------|
| **Max Servers** | ~100 (estimated) | 10,000+ | Load testing |
| **Response Latency (p99)** | Unknown | <100ms | APM monitoring |
| **Gateway Uptime** | Coupled to app | 99.99% (independent) | Separate health checks |
| **Memory per Shard** | ~500MB | <50MB | Ingestor resource metrics |
| **Horizontal Scale Time** | N/A | <60s | Auto-scaling policy |
| **Worker Recovery** | Full restart | <5s (queue resume) | Chaos testing |

---

## 3. User & Stakeholder Context

### 3.1 Primary Users

| Persona | Description | Key Needs |
|---------|-------------|-----------|
| **Community Admin** | Manages Discord server with Arrakis | Reliable bot response, no "zombie" states |
| **End User** | Discord member checking eligibility | Fast slash command responses |
| **DevOps Engineer** | Maintains Arrakis infrastructure | Independent scaling, clear failure domains |

### 3.2 Stakeholder Requirements

| Stakeholder | Requirement | Priority |
|-------------|-------------|----------|
| **Product** | Support 10k+ servers without architectural changes | P0 |
| **Engineering** | Fault isolation between gateway and business logic | P0 |
| **Operations** | Independent scaling of Ingestor vs Workers | P1 |
| **Security** | No degradation of RLS tenant isolation | P0 |

---

## 4. Functional Requirements

### 4.1 Core Components

#### FR-1: Ingestor Service ("The Ear")

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| FR-1.1 | Ingestor connects to Discord Gateway via WebSocket | Successful login, shard ready events |
| FR-1.2 | Ingestor has ZERO business logic | No database queries, no blockchain calls |
| FR-1.3 | Ingestor pushes all events to RabbitMQ | Event payload includes shard ID, timestamp |
| FR-1.4 | Ingestor disables all discord.js caching | Memory usage <50MB per shard |
| FR-1.5 | Ingestor survives Worker crashes | Gateway stays connected during worker restart |
| FR-1.6 | Ingestor supports automatic sharding | ShardingManager or Kurasuta integration |

#### FR-2: Message Queue (RabbitMQ)

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| FR-2.1 | Queue accepts Discord events from Ingestor | Events persisted with delivery guarantee |
| FR-2.2 | Queue supports multiple consumers | Workers can scale horizontally |
| FR-2.3 | Queue provides dead-letter handling | Failed events routed to DLQ for analysis |
| FR-2.4 | Queue supports priority routing | Interaction events prioritized over presence |

#### FR-3: Worker Service ("The Brain")

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| FR-3.1 | Worker consumes events from RabbitMQ | Event processing with acknowledgment |
| FR-3.2 | Worker executes all business logic | Score Service, chain queries, database writes |
| FR-3.3 | Worker replies via Discord REST API | No WebSocket dependency |
| FR-3.4 | Worker is stateless | All state in Redis/PostgreSQL |
| FR-3.5 | Worker supports horizontal scaling | N workers process in parallel |
| FR-3.6 | Worker handles interaction timeouts | Defer response within 3s, followup later |

#### FR-4: State Management

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| FR-4.1 | All session state stored in Redis | No local Map objects for cross-shard data |
| FR-4.2 | Cooldowns stored in Redis | Consistent across all workers |
| FR-4.3 | Rate limit buckets in Redis | Distributed rate limiting |
| FR-4.4 | Database connections pooled via PgBouncer | Connection pool not exhausted at scale |

### 4.2 User Stories

#### US-1: Slash Command Execution
```
As a Discord user,
When I execute /check-eligibility,
Then I receive a response within 3 seconds,
Even if blockchain RPC takes 2 seconds,
Because the gateway is not blocked.
```

#### US-2: Mass Event Handling
```
As a community admin,
When 1000 users join simultaneously,
Then the bot processes all guildMemberAdd events,
Without dropping any or going offline,
Because events are queued and processed asynchronously.
```

#### US-3: Worker Failure Recovery
```
As a DevOps engineer,
When a Worker container crashes,
Then the Ingestor remains connected,
And events are re-processed when workers recover,
Because the queue provides durability.
```

#### US-4: Horizontal Scaling
```
As a DevOps engineer,
When traffic spikes 10x,
Then I can scale Workers from 2 to 20,
Without touching the Ingestor,
Because they are independently deployable.
```

---

## 5. Technical & Non-Functional Requirements

### 5.1 Performance Requirements

| Metric | Requirement | Rationale |
|--------|-------------|-----------|
| **Event Ingestion Latency** | <10ms from Gateway to Queue | Heartbeat must not be blocked |
| **Event Processing Latency** | <100ms (p99) for interactions | Discord timeout is 3s |
| **Queue Throughput** | 10,000 events/second | 5M users, peak activity |
| **Memory (Ingestor)** | <50MB per shard | Caching disabled |
| **Memory (Worker)** | <512MB per instance | Standard ECS task |

### 5.2 Reliability Requirements

| Requirement | Target | Method |
|-------------|--------|--------|
| **Gateway Uptime** | 99.99% | Independent health checks |
| **Message Durability** | 100% (no loss) | RabbitMQ persistent queues |
| **Worker Recovery** | <5s | Auto-restart, queue resume |
| **Graceful Degradation** | Yes | Circuit breakers on external calls |

### 5.3 Security Requirements

| Requirement | Description |
|-------------|-------------|
| **Tenant Isolation** | RLS policies unchanged, enforced at Worker level |
| **Queue Security** | RabbitMQ with TLS, authentication |
| **Secret Management** | Discord token in Ingestor only, not in Workers |
| **Audit Trail** | All events logged with correlation IDs |

### 5.4 Infrastructure Requirements

| Component | Technology | Deployment |
|-----------|------------|------------|
| **Ingestor** | Node.js + discord.js (minimal) | ECS Fargate (separate service) |
| **Queue** | RabbitMQ (Amazon MQ or self-hosted) | Managed service preferred |
| **Workers** | Node.js + existing Sietch logic | ECS Fargate (auto-scaling) |
| **State** | Redis (existing) | ElastiCache |
| **Database** | PostgreSQL + PgBouncer | RDS + connection pooling |

---

## 6. Scope & Prioritization

### 6.1 MVP (Phase 1)

| Feature | Priority | Rationale |
|---------|----------|-----------|
| Ingestor service with zero caching | P0 | Core architecture change |
| RabbitMQ integration | P0 | Message durability |
| Worker consuming from queue | P0 | Business logic execution |
| Discord REST API responses | P0 | Decouple from gateway |
| Redis state migration | P0 | Stateless workers |
| All 33 slash commands working | P0 | Feature parity |

### 6.2 Phase 2 (Post-MVP)

| Feature | Priority | Rationale |
|---------|----------|-----------|
| Automatic sharding (Kurasuta) | P1 | Multi-core utilization |
| PgBouncer integration | P1 | Connection pooling |
| Priority queue routing | P2 | Interaction prioritization |
| Dead-letter queue dashboard | P2 | Operational visibility |
| RPC rotation for blockchain | P2 | Rate limit handling |

### 6.3 Out of Scope

| Feature | Reason |
|---------|--------|
| Multi-region deployment | Complexity; defer to Phase 3 |
| Custom sharding algorithm | Use existing libraries |
| WebSocket compression | discord.js handles this |
| Telegram Gateway Proxy | Telegram already separate |

---

## 7. Risks & Dependencies

### 7.1 Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| RabbitMQ adds latency | Medium | High | Use Amazon MQ in same region; benchmark |
| discord.js caching hard to disable | Low | High | Use `makeCache: Options.cacheWithLimits({})` |
| Interaction timeout (3s) exceeded | Medium | Medium | Defer response immediately, followup |
| State migration breaks features | Medium | High | Comprehensive integration tests |

### 7.2 External Dependencies

| Dependency | Owner | Risk |
|------------|-------|------|
| Discord API stability | Discord | Low (mature API) |
| RabbitMQ/Amazon MQ availability | AWS | Low (managed service) |
| Berachain RPC latency | External | Medium (mitigated by proxy pattern) |

### 7.3 Assumptions

1. Discord's 2,500 server sharding threshold is not reached in Phase 1
2. RabbitMQ can handle 10k events/second with standard configuration
3. Existing Redis instance has capacity for additional state
4. Team has RabbitMQ operational experience (or will use managed service)

---

## 8. Success Metrics & Monitoring

### 8.1 Key Performance Indicators

| KPI | Baseline | Target | Measurement |
|-----|----------|--------|-------------|
| Gateway disconnections/day | Unknown | <1 | CloudWatch metrics |
| Event processing latency (p99) | Unknown | <100ms | APM (Datadog/New Relic) |
| Worker error rate | Unknown | <0.1% | Application logs |
| Queue depth (steady state) | N/A | <100 | RabbitMQ metrics |
| Memory usage (Ingestor) | ~500MB | <50MB | Container metrics |

### 8.2 Monitoring Requirements

| System | Metrics | Alerts |
|--------|---------|--------|
| **Ingestor** | Shard status, memory, event rate | Disconnect, OOM |
| **RabbitMQ** | Queue depth, consumer count, DLQ | Backlog >1000, DLQ >0 |
| **Workers** | Processing time, error rate, throughput | Latency >1s, errors >1% |
| **Redis** | Memory, connections, hit rate | Memory >80%, connections >1000 |

---

## 9. Timeline & Milestones

| Milestone | Description | Sprint |
|-----------|-------------|--------|
| **M1: Architecture Design** | SDD complete, approved | Sprint 1 |
| **M2: Ingestor MVP** | Gateway connected, events to queue | Sprint 2 |
| **M3: Worker Migration** | All commands processing from queue | Sprint 3-4 |
| **M4: State Migration** | All state in Redis, stateless workers | Sprint 4 |
| **M5: Integration Testing** | Full E2E tests, load testing | Sprint 5 |
| **M6: Staging Deployment** | Deploy to staging environment | Sprint 5 |
| **M7: Production Cutover** | Blue-green deployment to production | Sprint 6 |

---

## 10. Appendix

### A. Glossary

| Term | Definition |
|------|------------|
| **Gateway** | Discord's WebSocket connection for real-time events |
| **Ingestor** | Lightweight service that only handles Gateway connection |
| **Worker** | Stateless service that processes business logic |
| **Shard** | Subset of Discord guilds handled by one Gateway connection |
| **DLQ** | Dead-letter queue for failed event processing |

### B. References

- [Discord Sharding Documentation](https://discord.com/developers/docs/topics/gateway#sharding)
- [discord.js Caching Guide](https://discordjs.guide/popular-topics/caching.html)
- [RabbitMQ Best Practices](https://www.rabbitmq.com/production-checklist.html)
- Internal: `gateway-proxy-pattern-research.md`

### C. Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-01-14 | Use RabbitMQ over Redis Streams | Industry standard, better delivery guarantees for pre-launch |
| 2026-01-14 | Separate ECS service for Ingestor | Fault isolation, independent scaling |
| 2026-01-14 | Full rewrite over incremental | Pre-launch window allows clean implementation |
| 2026-01-14 | Target 5M users architecture | Build once, scale immediately when needed |

---

**Document Status**: Ready for Architecture Review

**Next Step**: `/architect` to create Software Design Document
