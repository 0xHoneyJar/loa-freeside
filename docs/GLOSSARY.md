# Concept Glossary — New Concepts in Agent Economies

<!-- cite: loa-freeside:packages/adapters/agent/budget-manager.ts -->
<!-- cite: loa-freeside:packages/core/ports/agent-gateway.ts -->
<!-- cite: loa-freeside:packages/shared/nats-schemas/src/schemas/gateway-event.ts -->
<!-- cite: loa-freeside:packages/adapters/agent/ensemble-accounting.ts -->
<!-- cite: loa-freeside:packages/adapters/agent/pool-mapping.ts -->

> Version: v1.0.0

This glossary defines the key concepts of the Loa protocol. It is not a dictionary — it is a conceptual map for developers transitioning from traditional web development to agent economic infrastructure.

Each entry answers five questions: What is it? Why does it matter? What's the closest thing you already know? Where has something similar been done at scale? Where can you learn more?

**How to use this glossary:** If you're new to the Loa ecosystem, read the first three entries (Conservation Invariant, Budget Atomicity, Lot Lifecycle) in order — they form a conceptual progression. The remaining entries can be read in any order as you encounter the concepts in the codebase.

---

## Table of Contents

| Concept | Traditional Equivalent | Source Doc |
|---------|----------------------|------------|
| [Conservation Invariant](#conservation-invariant) | Double-entry bookkeeping | [ECONOMICS.md](ECONOMICS.md) |
| [Budget Atomicity](#budget-atomicity) | Transaction isolation | [ECONOMICS.md](ECONOMICS.md) |
| [Lot Lifecycle](#lot-lifecycle) | Payment authorization | [ECONOMICS.md](ECONOMICS.md) |
| [Conviction Scoring](#conviction-scoring) | Access control list | [ECONOMICS.md](ECONOMICS.md) |
| [Pool Routing](#pool-routing) | Load balancing | [ECONOMICS.md](ECONOMICS.md) |
| [Ensemble Strategy](#ensemble-strategy) | Redundant systems | [ECONOMICS.md](ECONOMICS.md) |
| [Capability Tier](#capability-tier) | Subscription plan | [ECONOMICS.md](ECONOMICS.md) |
| [GatewayEvent](#gatewayevent) | HTTP request envelope | [EVENT-PROTOCOL.md](EVENT-PROTOCOL.md) |
| [Stability Tier](#stability-tier) | API versioning | [API-REFERENCE.md](API-REFERENCE.md) |
| [BYOK](#byok) | Customer-managed keys | [ECONOMICS.md](ECONOMICS.md) |
| [Token-Gating](#token-gating) | Paywall middleware | [ECOSYSTEM.md](ECOSYSTEM.md) |
| [Forward Compatibility](#forward-compatibility) | Backward compatibility | [EVENT-PROTOCOL.md](EVENT-PROTOCOL.md) |
| [Fail-Closed Reservation](#fail-closed-reservation) | Circuit breaker | [ECONOMICS.md](ECONOMICS.md) |
| [Agent Economic Citizenship](#agent-economic-citizenship) | Service identity | [ECOSYSTEM.md](ECOSYSTEM.md) |

---

## Conservation Invariant

**What:** A set of 14 canonical mathematical properties (I-1 through I-14) that the economic system must never violate. The most recognizable is I-1: `available + reserved + consumed = original` for every budget lot. Others include: committed plus reserved never exceeds the budget limit (I-5), transfer credits equal debits (I-6), a lot in a terminal state cannot be mutated (I-8), and shadow billing must not diverge from primary billing (I-14).

**Why it matters:** In a multi-agent economy where communities delegate spending authority to autonomous agents, the conservation invariant is what makes that delegation safe. It is the foundational promise that the books will always balance. Any change to a conservation invariant definition is always a major version bump — even a clarification. This is what elevates Loa from a billing system to an economic *protocol* that external products can build against with verifiable safety guarantees.

**Traditional parallel:** Double-entry bookkeeping (every credit has a corresponding debit). In banking, this is a regulatory requirement enforced by auditors. In Loa, it is protocol-level enforcement via database constraints, application assertions, and periodic reconciliation.

**Industry parallel:** Stripe's idempotency keys prevent double-charges per transaction. The conservation invariant prevents double-spending at a more fundamental level — not per-transaction but per-lot across the entire lifecycle. The canonical properties are defined in loa-hounfour (like the Kubernetes API spec) and imported by loa-freeside (like a cloud provider implementing the spec).

**Learn more:** [ECONOMICS.md](ECONOMICS.md) § Conservation Invariant | Canonical source: `@0xhoneyjar/loa-hounfour/integrity`

---

## Budget Atomicity

**What:** The guarantee that every budget operation — checking available capacity and incrementing the reservation counter — happens as a single, indivisible unit. Implemented via Redis Lua scripts (`EVALSHA`): the entire check-and-reserve sequence executes in one Lua call, which Redis serializes atomically. No other command can interleave between the check and the increment.

The two-counter model tracks `committed` (finalized actual spend) and `reserved` (pending holds for in-flight requests) as separate Redis keys per community per month. Effective spend = `committed + reserved`. A request is denied when `effective_spend + estimated_cost > limit`.

**Why it matters:** Without atomicity, two concurrent requests could both pass the budget check and together exceed the limit — a classic TOCTOU (time-of-check to time-of-use) race condition. The Lua script eliminates this entirely. Additionally, the finalize script uses `DEL` as an atomic claim signal: only one winner (finalize vs. reaper) can `DEL` the reservation key and get return value `1`, ensuring no double-debit.

**Traditional parallel:** Database transactions with `SELECT ... FOR UPDATE` — locking a row during a read-then-write operation to prevent concurrent modification. The Redis Lua approach is equivalent but without distributed locks: it uses the serialized execution model of Lua within Redis instead.

**Industry parallel:** Stripe's payment intents use a similar two-phase pattern with server-side atomicity. AWS Lambda's concurrency limits are enforced by an atomic counter that prevents overallocation. The Lua-in-Redis approach is closer to Google's Zanzibar (authorization at scale) where relationship checks are atomic and serialized.

**Learn more:** [ECONOMICS.md](ECONOMICS.md) § Budget Accounting | Source: `packages/adapters/agent/budget-manager.ts`, `packages/adapters/agent/lua/budget-reserve.lua`

---

## Lot Lifecycle

**What:** The three-phase state machine that every AI inference request follows:

```
reserve() → [inference executes] → finalize() → [audit log enqueued]
     │                                    │
     │ (TTL expires before finalize)      │ (reservation already reaped)
     └──→ reap() → reclaim reserved       └──→ LATE_FINALIZE
```

1. **reserve()** — Before inference, atomically check budget and hold estimated cost. Fail-closed: if Redis is unreachable, deny the request.
2. **finalize()** — After inference, move the reserved hold to committed at actual cost. Returns unused reservation capacity to available budget. Fail-open: if Redis is unreachable, log and return `FINALIZED` anyway.
3. **reap()** — Background job reclaims reserved amounts for lots that timed out before finalization (prevents reserved counter growing unbounded).

**Why it matters:** The lot lifecycle is the unit of economic accountability. It ties a specific user request to a specific budget hold, enabling: idempotent retry (clients resend with the same `idempotencyKey`), audit trail reconstruction, and reconciliation of drift from async failures. Every agent invocation produces exactly one lot — no exceptions.

**Traditional parallel:** The authorize/capture pattern in payment processing. A hotel holds your card at check-in (reserve) and charges on checkout (finalize). If you never check out, the hold expires after 72 hours (reap). The `LATE_FINALIZE` state is the edge case where the hold expired but the guest still checked out — the charge is applied directly.

**Industry parallel:** AWS Reserved Instances follow a similar lifecycle: reservation → utilization → expiry. Uber's trip pricing holds an estimated fare (reserve), charges the actual metered fare (finalize), and auto-cancels unstarted trips (reap).

**Learn more:** [ECONOMICS.md](ECONOMICS.md) § Lot Lifecycle | Source: `packages/adapters/agent/budget-manager.ts`

---

## Conviction Scoring

**What:** A 9-tier system that maps a community member's BGT (Berachain Governance Token) holdings — or leaderboard rank — to an access tier. Higher conviction (more BGT or higher rank) unlocks more capable, more expensive model pools. Tiers range from Hajra (6.9 BGT) through Naib (top 1–7 on leaderboard). Rank-based tiers always override BGT-based tiers.

BGT amounts are stored as `bigint` in wei (18 decimals) and never exposed externally — the tier label is public, the raw amount is private.

**Why it matters:** Conviction scoring is the access control layer that prevents free-riding on expensive AI models. It creates economic skin-in-the-game: the tokens you hold determine what you can access. It also provides a rank-based path for top community contributors who don't hold large token positions, ensuring meritocratic access alongside economic access.

**Traditional parallel:** Subscription tiers (Free / Pro / Enterprise). Conviction scoring is the web3-native version: instead of a monthly payment determining your tier, on-chain token holdings or governance participation determine it. The computational outcome is identical — a tier label that gates API capabilities — but the input is verifiable and decentralized.

**Industry parallel:** GitHub's contributor access model (Triage → Write → Maintain → Admin) is role-based like the rank tiers. Discord's server boost levels gate features based on collective investment. Conviction scoring combines both patterns: individual economic stake *and* community standing.

**Learn more:** [ECONOMICS.md](ECONOMICS.md) § Capability Tiers | Source: `themes/sietch/src/services/TierService.ts`

---

## Pool Routing

**What:** The system that translates a caller's model alias (e.g., `cheap`, `reasoning`, `native`) and access level (`free`, `pro`, `enterprise`) into a concrete pool ID for routing to loa-finn. Five pools exist: `cheap`, `fast-code`, `reviewer`, `reasoning`, `architect`. Each maps to a default AI provider.

The `native` alias resolves tier-dependently, giving "best pool I'm entitled to" semantics without exposing internals. Unauthorized pool requests silently fall back to the caller's tier default, preventing confused-deputy privilege escalation. Pool IDs function as unforgeable capability tokens (Dennis & Van Horn, 1966).

**Why it matters:** Pool routing is the enforcement layer between a user's conviction tier and the actual AI model that serves them. It enables per-deployment provider reconfiguration (`POOL_PROVIDER_HINTS` env var) without code changes, and provides a security barrier against privilege escalation where a low-tier caller could forge a high-tier pool claim.

**Traditional parallel:** API gateway route tables or feature flags by subscription tier. The pool router is like a gateway rule: "if user.plan == 'free', proxy to model/lite; else proxy to model/pro" — but made tamper-proof by binding the pool claim into the request context.

**Industry parallel:** Kubernetes pod scheduling with resource quotas and node affinity. Pools are like node pools (GPU nodes, CPU nodes, spot nodes) and the tier system is like namespace resource quotas that determine which node pools a workload can target. Cloudflare's tiered CDN routing (free → shared PoP, enterprise → dedicated PoP) follows the same pattern.

**Learn more:** [ECONOMICS.md](ECONOMICS.md) § Pool Routing | Source: `packages/adapters/agent/pool-mapping.ts`

---

## Ensemble Strategy

**What:** A multi-model orchestration mode where a single `/invoke` request fans out to multiple AI models simultaneously or sequentially. Three strategies are supported:

| Strategy | Behavior |
|----------|----------|
| `best_of_n` | Invoke N models in parallel; pick the best response |
| `consensus` | Invoke N models; accept only if a quorum agrees |
| `fallback` | Try models in sequence; stop at first success |

Budget reservation is multiplied by the number of platform-budget models (BYOK models excluded from the multiplier to avoid over-reservation). Per-model cost attribution in `model_breakdown` enables communities to see exactly which model consumed which portion of their budget.

**Why it matters:** Ensemble strategies enable quality improvements (best_of_n), reliability guarantees (fallback), and confidence scoring (consensus) without requiring clients to manage multi-model orchestration. The economic accounting layer makes this transparent — communities can audit per-model costs rather than seeing an opaque total.

**Traditional parallel:** Load balancing strategies and read replicas. `fallback` = primary/replica failover. `best_of_n` = speculative execution (send the same request to multiple backends, use the best). `consensus` = quorum reads in distributed databases (Cassandra's `QUORUM` consistency level).

**Industry parallel:** Google's Gemini uses internal ensemble strategies for quality scoring. Netflix's Zuul gateway implements similar fallback-chain routing. The novel element is per-model economic decomposition — AWS Bedrock charges per model but doesn't decompose ensemble costs; Loa does.

**Learn more:** [ECONOMICS.md](ECONOMICS.md) § Ensemble Strategies | Source: `packages/adapters/agent/ensemble-accounting.ts`

---

## Capability Tier

**What:** The derived access level (`free`, `pro`, `enterprise`) computed from a user's conviction score and used as the runtime identity of every request. It determines which pools are accessible, what the default pool is, and the budget limit that applies. The mapping from conviction tier to capability tier is defined canonically in loa-hounfour via `TIER_POOL_ACCESS` and `TIER_DEFAULT_POOL`.

**Why it matters:** Capability tier is the single, stable abstraction that separates the on-chain world (BGT holdings, NFT ownership, rank) from the off-chain API world (which pools you can call, what you're charged). Everything above it reasons about access levels; everything below it reasons about conviction scores and blockchain state. It is the boundary point.

**Traditional parallel:** OAuth scopes or RBAC roles. A capability tier is exactly like a user role (`free`, `pro`, `enterprise`) that gates API features — the difference is that the role is derived from verifiable on-chain state rather than a database flag set by an admin.

**Industry parallel:** AWS IAM policies derived from organizational unit (OU) membership. The OU determines the policy; the policy determines the permissions. Similarly, conviction determines the tier; the tier determines the pool access. Slack's workspace plans (Free → Pro → Business+) gate feature access identically — but Loa's tiers are trustlessly derived rather than admin-assigned.

**Learn more:** [ECONOMICS.md](ECONOMICS.md) § Capability Tiers | Source: `packages/core/ports/agent-gateway.ts` (`AccessLevel`), `packages/adapters/agent/pool-mapping.ts`

---

## GatewayEvent

**What:** The canonical wire-format envelope wrapping every message published to NATS JetStream by the Rust gateway. Defined in loa-hounfour and implemented as both a Zod schema (TypeScript) and a `serde` struct (Rust), with JSON fixtures in `packages/shared/nats-schemas/fixtures/` that both sides validate against in CI.

Every GatewayEvent carries: `event_id` (UUIDv4 for deduplication), `event_type` (dot-separated classifier like `guild.join`), `shard_id`, `timestamp`, `guild_id`, `channel_id`, `user_id`, and `data` (event-specific payload typed as `z.unknown()` for forward compatibility).

**Why it matters:** GatewayEvent is the machine-facing API contract — arguably more foundational than any HTTP endpoint, because HTTP endpoints are consumed by humans while NATS events are consumed by autonomous agents. Cross-language fixture validation ensures the Rust serialization and TypeScript validation never silently diverge, even though they share no generated code.

**Traditional parallel:** A webhook payload envelope (Stripe's `Event` object, GitHub's webhook structure). Every event has a type field and a data payload; the receiver checks the type to decide how to handle data. The `event_id` serves the same purpose as Stripe's idempotency key on webhooks.

**Industry parallel:** CloudEvents (CNCF specification) defines a standard envelope for event-driven architectures with similar fields (`id`, `type`, `source`, `time`, `data`). GatewayEvent is effectively a domain-specific CloudEvents envelope optimized for Discord-to-agent routing, with the critical addition of cross-language fixture validation.

**Learn more:** [EVENT-PROTOCOL.md](EVENT-PROTOCOL.md) § GatewayEvent Envelope | Source: `packages/shared/nats-schemas/src/schemas/gateway-event.ts`

---

## Stability Tier

**What:** A two-level classification applied to every API surface (HTTP endpoints and NATS event schemas) that declares the breaking-change guarantee for consumers:

| Tier | Guarantee | Policy |
|------|-----------|--------|
| **Tier 1 — Stable** | Backwards-compatible | 2-cycle deprecation notice in API-CHANGELOG.md |
| **Tier 2 — Unstable** | Best-effort | May change without notice |

Promotion from Tier 2 to Tier 1 requires: 2+ cycles of stability, full documentation, committed JSON fixtures, and cross-language validation tests passing.

**Why it matters:** Stability tiers give downstream consumers (Layer 5 products like loa-dixie) a contractual basis for planning. Without them, any refactor could silently break autonomous agents. The 2-cycle deprecation policy ensures consuming teams have time to migrate before a breaking change lands. This is especially critical for NATS events, where consumers may be deployed independently of the platform.

**Traditional parallel:** Semantic versioning combined with API deprecation policies (Stripe's API version pinning, Node.js LTS release cadence). Tier 1 = "LTS" — you can depend on it. Tier 2 = "current/experimental" — consume at your own risk.

**Industry parallel:** Kubernetes API group versioning (`v1` stable, `v1beta1` pre-release, `v1alpha1` experimental) follows the same pattern with explicit promotion criteria. gRPC's stability annotations serve the same purpose. The Loa approach is simpler (two tiers vs. three) but includes the unique cross-language fixture validation requirement.

**Learn more:** [API-REFERENCE.md](API-REFERENCE.md) § Stability Tiers | [EVENT-PROTOCOL.md](EVENT-PROTOCOL.md) § Stability Tiers

---

## BYOK

**What:** Bring Your Own Key — communities register their own AI provider API keys (OpenAI or Anthropic) with the platform. When BYOK is active, inference costs are charged to the community's own provider account rather than platform budget. The `accounting_mode` becomes `BYOK_NO_BUDGET`, and `byok_cost_micro` tracks costs separately from `platform_cost_micro`.

Key storage uses envelope encryption: a per-key DEK is generated, the API key is encrypted with AES-256-GCM, and the DEK is wrapped by AWS KMS. The BYOK egress path applies 9 security layers including S2S JWT validation, SSRF defense, JTI replay protection, and payload integrity verification.

**Why it matters:** BYOK enables communities with enterprise AI contracts to use those contracts through the Loa platform without consuming shared budget. This is critical for large communities with custom pricing or compliance requirements. The envelope encryption and 9-layer egress security ensure BYOK keys are never exposed to the platform operator — a zero-trust boundary.

**Traditional parallel:** Self-hosted API keys with a proxy layer. Like using your own SMTP credentials through a managed email service — you get the platform's deliverability features while controlling the underlying account.

**Industry parallel:** AWS KMS Customer Managed Keys (CMK), Cloudflare's Keyless SSL, or Snowflake's customer-managed encryption keys. The pattern is identical: the platform's secure infrastructure proxies your credentials so you get platform-level security (audit trail, rate limiting, replay protection) while retaining ownership of the key material.

**Learn more:** [ECONOMICS.md](ECONOMICS.md) § BYOK | Source: `packages/adapters/agent/byok-manager.ts`, `packages/adapters/agent/byok-proxy-handler.ts`

---

## Token-Gating

**What:** The mechanism by which access to the AI agent gateway — and the specific model pools within it — is conditioned on on-chain token holdings. A user must hold sufficient BGT or achieve a sufficient leaderboard rank to receive a Discord role granting access to slash commands and agent invocations.

Token-gating operates at two levels: **entry-level** (eligibility sync verifies on-chain holdings and assigns/revokes Discord roles) and **request-level** (the `AgentRequestContext` carries `nftId`, `tier`, `accessLevel`, and `allowedModelAliases`, which the gateway enforces on every invocation).

**Why it matters:** Token-gating is the economic premise of the platform. It aligns access rights with on-chain participation, preventing anonymous or uncommitted actors from consuming expensive AI compute. It creates a virtuous cycle: higher participation unlocks better models, incentivizing deeper engagement. This is not authentication — it is *economic authorization*.

**Traditional parallel:** Paywall or subscription-check middleware. Like Express middleware that checks `if (!user.isPro) return res.status(403)`, but the "subscription" is verified against a decentralized blockchain rather than a database row.

**Industry parallel:** Collab.Land's token-gated Discord/Telegram communities. Guild.xyz's role-based NFT gating. The Loa approach goes further: token holdings don't just gate community *access* — they gate computational *capability tiers*, creating a continuous economic relationship between on-chain stake and off-chain utility.

**Learn more:** [ECOSYSTEM.md](ECOSYSTEM.md) § The Web4 Connection | Source: `themes/sietch/src/services/eligibility.ts`, `themes/sietch/src/services/TierService.ts`

---

## Forward Compatibility

**What:** A design principle where the `GatewayEvent.data` field is typed as `z.unknown()` rather than a strict discriminated union. New event types from the Rust gateway are accepted and passed through by TypeScript workers without causing deserialization failures. The `isKnownEventType()` guard allows workers to log warnings on unrecognized types without rejecting them. Per-event schemas use `.passthrough()` to accept additional fields from Rust that TypeScript doesn't currently need.

**Why it matters:** In a polyglot system (Rust gateway + TypeScript workers), schema evolution is inevitable. Forward compatibility means the Rust side can add new event types without requiring a coordinated, synchronous upgrade of all TypeScript consumers. Workers log unrecognized types and continue — they don't crash or poison-pill the consumer group. This decouples the deployment cadence of the gateway from all downstream consumers.

**Traditional parallel:** Postel's Law ("be conservative in what you send, be liberal in what you accept") applied to JSON APIs. Same principle behind OpenAPI's `additionalProperties: true` or protobuf's unknown field preservation.

**Industry parallel:** Kafka consumers that handle schema evolution via Avro's forward compatibility mode. gRPC's unknown field preservation. Stripe's webhook payloads that add new fields without incrementing the API version. The principle is universal in event-driven architectures — the Loa implementation is notable for its cross-language fixture validation that ensures both sides agree on the known fields while tolerating unknown ones.

**Learn more:** [EVENT-PROTOCOL.md](EVENT-PROTOCOL.md) § Forward Compatibility | Source: `packages/shared/nats-schemas/src/schemas/gateway-event.ts`

---

## Fail-Closed Reservation

**What:** A safety policy for `BudgetManager.reserve()`: if Redis is unreachable during the budget check-and-reserve operation, the method returns `BUDGET_EXCEEDED` — denying the inference request — rather than allowing it to proceed untracked. This is deliberately asymmetric with `finalize()`, which is fail-*open*: if Redis is unreachable during finalization, the method returns `FINALIZED` and relies on reconciliation to catch drift.

**Why it matters:** "Never execute inference you cannot account for." Inference that runs without a reservation is unbillable, unauditable, and could allow budget overruns. A brief service disruption (denied requests during Redis outage) is preferable to untracked spend. The inverse policy for finalize is equally deliberate: blocking response delivery because Redis failed during cost recording would be a poor user experience with no economic benefit, since the inference has already run and the cost has already been incurred.

**Traditional parallel:** A payment processor that declines transactions when its fraud detection service is unreachable. The safe default is "deny" when you can't verify, not "allow and hope."

**Industry parallel:** Netflix's Hystrix circuit breaker pattern with "fail-fast" semantics. AWS API Gateway's default deny when a Lambda authorizer times out. Financial systems universally apply fail-closed for authorization (reject if you can't verify) and fail-open for logging (don't block transactions because the audit log is down). Loa's reserve/finalize asymmetry follows this exact principle.

**Learn more:** [ECONOMICS.md](ECONOMICS.md) § Failure Modes | Source: `packages/adapters/agent/budget-manager.ts`

---

## Agent Economic Citizenship

**What:** The principle that every AI agent invocation is a first-class economic actor with identity (wallet address), community (tenantId), access level (tier), budget allocation, and a complete audit trail. The `AgentRequestContext` is the economic passport carried by every request: `tenantId`, `userId`, `nftId`, `tier`, `accessLevel`, `allowedModelAliases`, `idempotencyKey`, and `traceId`.

Every invocation produces an `AuditLogEntry` with: community, user wallet, model alias, token counts, actual cost, estimated cost, and trace ID. Capability audit events (`pool_access`, `byok_usage`, `ensemble_invocation`) provide fleet-wide observability.

**Why it matters:** Economic citizenship means agents are not anonymous compute consumers — they are accountable participants in the platform economy. This enables per-user cost attribution, community-level budget governance, audit log reconstruction, cross-session reconciliation, and the basis for agent-to-agent economic contracts. The `AgentWalletPrototype` hints at the next evolution: agents that own assets and transact autonomously.

**Traditional parallel:** Multi-tenant SaaS resource accounting (AWS Cost Explorer per-account, per-tag). Every API call is tagged with an account ID so costs can be attributed, chargebacks computed, and anomalies detected.

**Industry parallel:** Kubernetes service accounts with pod identity and RBAC — every workload has a verifiable identity and resource quota. The novel element in Loa is the convergence of *on-chain* identity (wallet, NFT) with *off-chain* economic accountability (budget, audit trail), creating a bridge between Web3 ownership and AI compute governance. This is what the project calls "Web4."

**Learn more:** [ECOSYSTEM.md](ECOSYSTEM.md) § The Web4 Connection | Source: `packages/core/ports/agent-gateway.ts` (`AgentRequestContext`), `packages/adapters/agent/capability-audit.ts`

---

## Related Documentation

- [ECOSYSTEM.md](ECOSYSTEM.md) — How the 5-repo Loa protocol fits together
- [ECONOMICS.md](ECONOMICS.md) — Economic primitives: budget accounting, conservation, tiers
- [EVENT-PROTOCOL.md](EVENT-PROTOCOL.md) — NATS event protocol for real-time subscriptions
- [API-REFERENCE.md](API-REFERENCE.md) — Full endpoint reference with stability tiers
- [DEVELOPER-GUIDE.md](DEVELOPER-GUIDE.md) — Developer learning path and contribution practices
