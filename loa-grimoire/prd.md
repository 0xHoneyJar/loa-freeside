# Product Requirements Document: Arrakis v5.0

**Version**: 5.2
**Date**: December 30, 2025
**Status**: APPROVED - Coexistence Architecture Added
**Codename**: The Transformation

---

## Document Traceability

| Section | Primary Source | Secondary Sources |
|---------|---------------|-------------------|
| Problem Statement | arrakis-saas-architecture.md §1-2 | v4.1 PRD, CHANGELOG |
| Two-Tier Chain Provider | arrakis-saas-architecture.md §3.7 | 15 audit rounds |
| Themes System | arrakis-saas-architecture.md §4 | SietchTheme, BasicTheme |
| Hexagonal Architecture | arrakis-saas-architecture.md §5 | Loa framework patterns |
| Infrastructure Phases | arrakis-saas-architecture.md §10 | Implementation prompt |
| WizardEngine | arrakis-saas-architecture.md §7 | Discord API constraints |
| Hardening Requirements | arrakis-v5-code-review.md §9 | KillSwitchProtocol.ts, ScoreServiceAdapter.ts |
| Coexistence Architecture | ARRAKIS_COEXISTENCE_ARCHITECTURE.md | Collab.Land, Matrica, Guild.xyz docs |

---

## 1. Executive Summary

### 1.1 Product Overview

**Arrakis v5.0 "The Transformation"** refactors the Sietch codebase from a bespoke Berachain Discord bot into a **multi-tenant, chain-agnostic SaaS platform**. This architectural transformation enables any community to deploy token-gated infrastructure through a guided wizard interface—similar to how Shopify enables merchants to launch stores without code.

### 1.2 Problem Statement

**Current State (v4.1):**
- Single-tenant Discord bot for BGT holders
- Hardcoded 9-tier Dune-themed progression
- SQLite database (no multi-tenancy)
- Direct viem/RPC coupling to Berachain
- Manual onboarding process

**Target State (v5.0):**
- Multi-tenant SaaS platform (1000+ communities)
- Configurable themes (BasicTheme free, SietchTheme premium)
- PostgreSQL with Row-Level Security
- Chain-agnostic via Score Service API
- Self-service WizardEngine onboarding
- FAANG-tier infrastructure (Vault, BullMQ, Redis)

**Why Now:**
- v4.1 infrastructure is stable (33 sprints completed)
- Score Service enables chain abstraction (closed-source)
- Theme System enables product differentiation
- Market demand for token-gated community tooling
- 15 adversarial audit rounds validated the architecture

### 1.3 Vision

Arrakis becomes a **"Shopify for token-gated communities"**:

- **For community operators**: Self-service wizard deploys full infrastructure
- **For developers**: Hexagonal architecture enables clean extensibility
- **For enterprises**: Multi-tenant with RLS, Vault encryption, audit trails
- **For the ecosystem**: Chain-agnostic support (EVM, Solana, future chains)

### 1.4 Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Communities onboarded | 100 in 6 months | Database count |
| Onboarding completion rate | >80% | Wizard funnel analytics |
| SietchTheme parity | 100% identical to v4.1 | Regression test suite |
| Score Service resilience | <1% degraded requests | Circuit breaker metrics |
| Discord 429 rate | 0 global bans | API error logs |
| Tenant isolation | 100% RLS coverage | Security audit |

### 1.5 Preserved v4.1 Capabilities

**CRITICAL**: All v4.1 features MUST continue working with SietchTheme:

| Feature | Sprint | Preservation Strategy |
|---------|--------|----------------------|
| 9-tier progression | 15-18 | Extract to SietchTheme |
| Badge system (10 types) | 16-17 | Extract to theme badges |
| Weekly digest | 20 | Per-tenant scheduling |
| Telegram bot | 30-33 | Platform adapter |
| Stripe billing | 23-29 | Theme subscription tiers |
| Cross-platform identity | 30 | IdentityService unchanged |

---

## 2. User Personas

### 2.1 Primary: Community Operator

**Profile:**
- Token project founder or community lead
- Has Discord/Telegram server, wants token-gating
- Non-technical (cannot deploy code)
- Wants quick setup without developer dependency

**Pain Points:**
- Complex Collab.Land configuration
- No tiered progression systems available
- Manual eligibility management
- No badge/gamification options

**Goals:**
- 15-minute self-service deployment
- Configurable tiers and badges
- Automatic role management
- Analytics dashboard

### 2.2 Secondary: Enterprise Admin

**Profile:**
- Multi-community operator (DAO, NFT collective)
- Needs multi-tenant management
- Compliance requirements (audit trails)
- Custom theme requirements

**Pain Points:**
- Managing multiple Discord servers manually
- No unified member view across communities
- Compliance burden for audit trails
- Vendor lock-in to single chain

**Goals:**
- Single dashboard for all communities
- Custom enterprise themes
- Full audit trail and compliance
- Chain-agnostic flexibility

### 2.3 Tertiary: Platform Developer

**Profile:**
- Building integrations on Arrakis
- Needs API access and extensibility
- Wants to contribute themes/adapters

**Pain Points:**
- Tightly coupled codebase
- No extension points
- Limited documentation

**Goals:**
- Clean hexagonal architecture
- Port/adapter extensibility
- Theme marketplace participation

---

## 3. Architecture Overview

### 3.1 Two-Tier Chain Provider (Resilience Architecture)

> Source: arrakis-saas-architecture.md §3.7

**Critical Decision**: Separate blockchain queries into two tiers for resilience:

```
TIER 1: Native Reader (Always Available)
  └── Binary checks: hasBalance(), ownsNFT()
  └── Direct viem RPC, minimal dependencies
  └── Core token-gating survives Score outages

TIER 2: Score Service (Complex Queries)
  └── Ranking, history, cross-chain aggregation
  └── Circuit Breaker with cached fallback
  └── Graceful degradation when unavailable
```

**Degradation Matrix:**

| Query Type | Score DOWN | Fallback Behavior |
|------------|------------|-------------------|
| Token Balance | ✅ Works | Native Reader |
| NFT Ownership | ✅ Works | Native Reader |
| Rank Threshold | ⚠️ Degraded | Balance check (permissive) |
| Never Redeemed | ⚠️ Degraded | Cached or deny (safe) |
| Activity Score | ❌ Unavailable | Return 0 or cached |

### 3.2 Themes System (Configuration Abstraction)

> Source: arrakis-saas-architecture.md §4

**Critical Decision**: Abstract tier/badge/naming into injectable themes:

```typescript
interface IThemeProvider {
  getTierConfig(): TierDefinition[];
  getBadgeConfig(): BadgeDefinition[];
  getNamingConfig(): NamingConfig;
  evaluateTier(rank: number): TierResult;
  evaluateBadges(member: MemberContext): EarnedBadge[];
}
```

**Built-in Themes:**

| Theme | Tiers | Badges | Pricing |
|-------|-------|--------|---------|
| BasicTheme | 3 (Gold/Silver/Bronze) | 5 | Free |
| SietchTheme | 9 (Naib→Outsider) | 10+ | Premium |
| Custom | Unlimited | Unlimited | Enterprise |

### 3.3 Hexagonal Architecture

```
┌─────────────────────────────────────────────┐
│              Domain Layer                    │
│   Asset | Community | Role | Eligibility    │
├─────────────────────────────────────────────┤
│              Service Layer                   │
│   WizardEngine | SyncService | ThemeEngine  │
├─────────────────────────────────────────────┤
│           Infrastructure Layer               │
│   TwoTierChainProvider | DiscordAdapter     │
│   DrizzleStorageAdapter | VaultAdapter      │
└─────────────────────────────────────────────┘
```

---

## 4. Functional Requirements

### Phase 0: Two-Tier Chain Provider (Foundation)

#### FR-5.0.1: Native Blockchain Reader

**Description**: Lightweight viem client for binary checks.

**Acceptance Criteria**:
- [ ] `hasBalance(address, token, minAmount)` returns boolean
- [ ] `ownsNFT(address, collection, tokenId?)` returns boolean
- [ ] `getBalance(address, token)` returns bigint
- [ ] No Score Service dependency
- [ ] <100ms response time

#### FR-5.0.2: Score Service Adapter

**Description**: HTTP client for complex Score API queries.

**Acceptance Criteria**:
- [ ] Implements `IChainProvider` interface
- [ ] `getRankedHolders(asset, limit)` returns ranked list
- [ ] `getAddressRank(address, asset)` returns rank or null
- [ ] `checkActionHistory(address, action)` returns boolean
- [ ] Circuit breaker with 50% error threshold
- [ ] Cached fallback on circuit open

#### FR-5.0.3: Two-Tier Orchestration

**Description**: Coordinate Native Reader and Score Service.

**Acceptance Criteria**:
- [ ] `checkBasicEligibility()` uses Native Reader only
- [ ] `checkAdvancedEligibility()` uses Score with fallback
- [ ] Degraded mode returns `source: 'native_degraded'`
- [ ] Metrics track circuit state changes
- [ ] All 141 existing tests pass

### Phase 1: Themes System

#### FR-5.1.1: Theme Interface

**Description**: Port definition for theme providers.

**Acceptance Criteria**:
- [ ] `IThemeProvider` interface defined in `packages/core/ports/`
- [ ] Methods: `getTierConfig()`, `getBadgeConfig()`, `getNamingConfig()`
- [ ] Methods: `evaluateTier()`, `evaluateBadges()`
- [ ] Subscription tier enforcement (free/premium/enterprise)

#### FR-5.1.2: BasicTheme Implementation

**Description**: Free tier theme with 3 tiers and 5 badges.

**Acceptance Criteria**:
- [ ] 3 tiers: Gold (1-10), Silver (11-50), Bronze (51-100)
- [ ] 5 badges: Early Adopter, Veteran, Top Tier, Active, Contributor
- [ ] Generic naming (no themed language)
- [ ] Available to all subscription tiers

#### FR-5.1.3: SietchTheme Implementation

**Description**: Premium Dune-themed progression (v4.1 parity).

**Acceptance Criteria**:
- [ ] 9 tiers: Naib, Fedaykin Elite, Fedaykin, Fremen, Wanderer, Initiate, Aspirant, Observer, Outsider
- [ ] 10+ badges: First Wave, Veteran, Diamond Hands, Council, Survivor, Streak Master, Engaged, Contributor, Pillar, Water Sharer
- [ ] Dune naming conventions (STILLSUIT, NAIB COUNCIL, etc.)
- [ ] **REGRESSION**: Identical tier/badge results to v4.1 hardcoded logic
- [ ] Premium subscription required

#### FR-5.1.4: Theme Registry

**Description**: Runtime theme selection per community.

**Acceptance Criteria**:
- [ ] `ThemeRegistry.get(themeId)` returns theme instance
- [ ] `getAvailableThemes(subscriptionTier)` filters by tier
- [ ] Theme overrides supported for enterprise
- [ ] Hot-reload themes without restart

### Phase 2: PostgreSQL + RLS

#### FR-5.2.1: Database Migration

**Description**: Migrate from SQLite to PostgreSQL.

**Acceptance Criteria**:
- [ ] Drizzle ORM schema defined
- [ ] All tables have `community_id` column
- [ ] Migration script preserves existing data
- [ ] Delete `profiles.db` after validation

#### FR-5.2.2: Row-Level Security

**Description**: Tenant isolation via RLS policies.

**Acceptance Criteria**:
- [ ] RLS enabled on all tenant tables
- [ ] Policy: `community_id = current_setting('app.current_tenant')::UUID`
- [ ] Tenant context set per request
- [ ] **SECURITY**: Cross-tenant access returns empty result
- [ ] RLS regression test suite

#### FR-5.2.3: Drizzle Storage Adapter

**Description**: Type-safe database access with tenant context.

**Acceptance Criteria**:
- [ ] Implements `IStorageProvider` interface
- [ ] Constructor receives `tenantId`
- [ ] All queries scoped to tenant
- [ ] Badge lineage recursive queries work
- [ ] All 141 tests pass with PostgreSQL

### Phase 3: Redis + Hybrid State

#### FR-5.3.1: Wizard Session Store

**Description**: Redis-backed session persistence.

**Acceptance Criteria**:
- [ ] Session saved with 15-minute TTL
- [ ] Session ID is idempotency key
- [ ] Wizard survives Discord 3s timeout
- [ ] `/resume` command retrieves session
- [ ] Container restart doesn't lose session

#### FR-5.3.2: Hybrid State Model

**Description**: PostgreSQL runtime + S3 shadow for audit history.

**Acceptance Criteria**:
- [ ] Shadow state stored after each apply
- [ ] S3 backup of manifest history
- [ ] Git-style versioning of configs
- [ ] Drift detection compares 3 states (desired/shadow/actual)

### Phase 4: BullMQ + Global Token Bucket

#### FR-5.4.1: Synthesis Queue

**Description**: Async Discord operations via BullMQ.

**Acceptance Criteria**:
- [ ] Queue: `discord-synthesis`
- [ ] 3 retry attempts with exponential backoff
- [ ] Rate limiter: 5 concurrent, 10 jobs/sec
- [ ] Dead letter queue for failed jobs

#### FR-5.4.2: Global Distributed Token Bucket

**Description**: Platform-wide Discord rate limiting.

**Acceptance Criteria**:
- [ ] Redis-based token bucket (50 tokens/sec)
- [ ] Shared across all workers/tenants
- [ ] `acquireWithWait()` for blocking acquisition
- [ ] **CRITICAL**: 0 global 429 bans
- [ ] Metrics for bucket exhaustion

#### FR-5.4.3: Reconciliation Controller

**Description**: Kubernetes-style drift reconciliation.

**Acceptance Criteria**:
- [ ] Compares desired vs shadow vs actual state
- [ ] Generates minimal diff operations
- [ ] Scheduled every 6 hours via trigger.dev
- [ ] On-demand via `/reconcile` command
- [ ] Admin notification for detected drift

### Phase 5: Vault Transit + Kill Switch

#### FR-5.5.1: Vault Transit Integration

**Description**: HSM-backed cryptographic operations.

**Acceptance Criteria**:
- [ ] No `PRIVATE_KEY` in environment variables
- [ ] All signing via Vault Transit API
- [ ] Audit log of signing operations
- [ ] Key rotation capability

#### FR-5.5.2: Kill Switch

**Description**: Emergency policy revocation.

**Acceptance Criteria**:
- [ ] MFA-protected kill switch endpoint
- [ ] Revokes all agent signing permissions
- [ ] Freezes synthesis operations
- [ ] Admin notification on activation

### Phase 6: OPA Pre-Gate + HITL

#### FR-5.6.1: Policy-as-Code Pre-Gate

**Description**: OPA validates Terraform before human review.

**Acceptance Criteria**:
- [ ] OPA policies for hard blocks:
  - Delete PersistentVolume → AUTO-REJECT
  - Delete Database → AUTO-REJECT
  - Disable RLS → AUTO-REJECT
- [ ] Infracost budget check (>$5k → AUTO-REJECT)
- [ ] Risk scoring for human context

#### FR-5.6.2: Human-in-the-Loop Gate

**Description**: Human approval for infrastructure changes.

**Acceptance Criteria**:
- [ ] Terraform plan displayed in Slack/Discord
- [ ] Approval required for apply
- [ ] MFA for high-risk approvals
- [ ] 24-hour timeout with auto-reject
- [ ] Audit trail of all approvals

---

## 5. WizardEngine

### FR-5.7.1: Wizard State Machine

**Description**: 8-step onboarding flow.

**States:**
1. `INIT` - Welcome, community name
2. `CHAIN_SELECT` - Select blockchain(s)
3. `ASSET_CONFIG` - Enter contract address
4. `ELIGIBILITY_RULES` - Configure thresholds
5. `ROLE_MAPPING` - Define tier roles
6. `CHANNEL_STRUCTURE` - Select template or customize
7. `REVIEW` - Preview manifest
8. `DEPLOY` - Execute synthesis

**Acceptance Criteria**:
- [ ] State persisted in Redis (15-min TTL)
- [ ] Each step is a separate Discord modal
- [ ] `deferReply()` called within 3 seconds
- [ ] `/resume {session_id}` recovers state
- [ ] Analytics track funnel completion

---

## 6. Non-Functional Requirements

### NFR-5.1: Performance

| Metric | Target |
|--------|--------|
| Basic eligibility check | <100ms |
| Advanced eligibility check | <500ms |
| Wizard step response | <3s (Discord limit) |
| Synthesis completion | <5 minutes |

### NFR-5.2: Security

- [ ] RLS enforced on all tenant tables
- [ ] No secrets in environment variables (Vault)
- [ ] All signing operations audited
- [ ] Kill switch tested quarterly
- [ ] SOC 2 Type II compliance roadmap

### NFR-5.3: Reliability

| Metric | Target |
|--------|--------|
| Uptime | 99.9% |
| Score Service degradation | <1% requests |
| Data durability | 99.999999999% (S3) |
| Recovery Time Objective | <15 minutes |

### NFR-5.4: Scalability

| Metric | Target |
|--------|--------|
| Concurrent tenants | 1,000+ |
| Communities per tenant | 100 |
| Members per community | 100,000 |
| Synthesis throughput | 10 ops/sec |

---

## 7. Migration Strategy

### 7.1 Phase Sequence

| Phase | Weeks | Focus | Blocking Dependency |
|-------|-------|-------|---------------------|
| 0 | 1-2 | Two-Tier Chain Provider | None (foundation) |
| 1 | 3-4 | Themes System | Phase 0 |
| 2 | 5-8 | PostgreSQL + RLS | Phase 1 |
| 3 | 9-10 | Redis + Hybrid State | Phase 2 |
| 4 | 11-12 | BullMQ + Token Bucket | Phase 3 |
| 5 | 13-14 | Vault Transit | Phase 4 |
| 6 | 15-16 | OPA + HITL | Phase 5 |

### 7.2 Validation Checkpoints

**After each phase:**
- [ ] All 141 existing tests pass
- [ ] SietchTheme produces identical results to v4.1
- [ ] No regression in Telegram bot functionality
- [ ] Security audit of new components

### 7.3 Files to Delete After Migration

```bash
# Phase 0 complete:
rm src/services/chain.ts  # → TwoTierChainProvider

# Phase 2 complete:
rm profiles.db  # → PostgreSQL
```

---

## 8. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Score Service outage | Medium | High | Two-Tier Provider with Native fallback |
| Discord global 429 | Medium | Critical | Global Token Bucket |
| RLS bypass | Low | Critical | Automated regression tests |
| Theme regression | Medium | High | SietchTheme parity test suite |
| Wizard timeout | High | Medium | Redis session + /resume command |
| Vault unavailable | Low | High | Circuit breaker + cached signatures |

---

## 9. Out of Scope (v5.0)

- Mobile app
- Web dashboard (Phase 7+)
- Custom theme builder UI
- Fiat payments (crypto-only)
- On-premise deployment
- White-label branding

---

## 10. Hardening Requirements (Post-Audit)

> Source: arrakis-v5-code-review.md (December 2025 External Code Review)

Following external security review of v5.0.0 implementation, these hardening requirements are **mandatory before production deployment**.

### 10.1 Critical Priority (P0) - Before Production

#### HR-5.10.1: Audit Log Persistence

**Problem**: In-memory audit logs in `KillSwitchProtocol.ts` are lost after 1000 entries or process restart.

```typescript
// Current (KillSwitchProtocol.ts:676-679) - INSECURE
if (this.auditLogs.length > 1000) {
  this.auditLogs.splice(0, this.auditLogs.length - 1000);
}
```

**Acceptance Criteria**:
- [ ] Audit logs persisted to PostgreSQL `audit_logs` table
- [ ] Row-Level Security applied to audit logs
- [ ] Retention policy: 7 years minimum for compliance
- [ ] No in-memory limit on audit entries
- [ ] Async persistence with write-ahead buffer

#### HR-5.10.2: RLS Migration Validation

**Problem**: PostgreSQL RLS policies exist but require penetration testing validation.

**Acceptance Criteria**:
- [ ] Penetration test validates all RLS policies
- [ ] Cross-tenant access tests return empty results
- [ ] TenantContext bypass attempts logged and blocked
- [ ] RLS regression test coverage >95%
- [ ] Security audit sign-off documented

#### HR-5.10.3: API Key Rotation Mechanism

**Problem**: API keys have no rotation mechanism, creating long-lived credential risk.

**Acceptance Criteria**:
- [ ] API key rotation via admin endpoint
- [ ] Grace period for old keys (24 hours)
- [ ] Automatic notification of impending expiration
- [ ] Key usage audit trail
- [ ] Emergency immediate revocation capability

### 10.2 High Priority (P1) - Within 30 Days

#### HR-5.10.4: Circuit Breaker Observability

**Problem**: No metrics or alerting for circuit breaker state changes in ScoreServiceAdapter.

**Acceptance Criteria**:
- [ ] Prometheus metrics for circuit breaker state
- [ ] Alert on circuit open (>5 minutes)
- [ ] Dashboard visibility of degraded mode duration
- [ ] Historical tracking of circuit state changes
- [ ] SLA reporting for Score Service availability

#### HR-5.10.5: Session Hijacking Prevention

**Problem**: Wizard sessions lack IP binding or device fingerprinting.

**Acceptance Criteria**:
- [ ] Session bound to originating IP address
- [ ] Device fingerprint stored with session
- [ ] Mismatch triggers re-authentication
- [ ] Rate limiting on session creation per IP
- [ ] Suspicious session activity alerting

#### HR-5.10.6: Error Response Standardization

**Problem**: Inconsistent error response formats across API endpoints.

**Acceptance Criteria**:
- [ ] Unified `ApiError` response schema
- [ ] Error codes documented in API spec
- [ ] Internal details sanitized from responses
- [ ] Stack traces removed in production
- [ ] Error correlation IDs for debugging

### 10.3 Medium Priority (P2) - Within 90 Days

#### HR-5.10.7: Code Quality Standardization

**Problem**: Mixed naming conventions (camelCase vs PascalCase for services).

**Acceptance Criteria**:
- [ ] ESLint rule for consistent file naming
- [ ] All services use PascalCase (e.g., `TierService.ts`)
- [ ] All utilities use camelCase (e.g., `helpers.ts`)
- [ ] CI gate enforces naming convention

#### HR-5.10.8: Dead Code Removal

**Problem**: Commented-out code blocks and unused exports.

**Acceptance Criteria**:
- [ ] Remove all commented-out code blocks
- [ ] Remove unused exports identified by TypeScript
- [ ] Remove deprecated functions with no callers
- [ ] CI gate for unused export detection

#### HR-5.10.9: OpenAPI Documentation

**Problem**: API documentation is minimal, no OpenAPI/Swagger spec.

**Acceptance Criteria**:
- [ ] OpenAPI 3.0 specification generated
- [ ] All public endpoints documented
- [ ] Request/response schemas defined
- [ ] Swagger UI deployed for API exploration
- [ ] API versioning strategy documented

### 10.4 Hardening Validation Checklist

Before marking hardening complete:

| Requirement | Verified By | Date |
|-------------|-------------|------|
| Audit log persistence | Security Auditor | - |
| RLS penetration test | External Pentester | - |
| API key rotation works | DevOps | - |
| Circuit breaker metrics live | SRE | - |
| Session security enhanced | Security Auditor | - |
| Error responses sanitized | Security Auditor | - |
| Code quality gates pass | CI/CD | - |
| Dead code removed | Tech Lead | - |
| OpenAPI spec published | API Team | - |

---

## 11. Coexistence Architecture (Shadow Mode & Incumbent Migration)

> Source: ARRAKIS_COEXISTENCE_ARCHITECTURE.md (December 2025)

This section defines requirements for Arrakis to coexist alongside incumbent token-gating solutions (Collab.Land, Matrica, Guild.xyz) with a graceful migration path. Design philosophy: **"Low-friction entry, high-value destination"**.

### 11.1 Design Principles

1. **Zero-Risk Installation** - Arrakis never touches incumbent-managed roles in shadow mode
2. **Progressive Trust Building** - Shadow mode proves accuracy before admin commits
3. **Feature Differentiation First** - Lead with capabilities incumbents can't offer (conviction scoring, BGT-specific logic)
4. **Graceful Degradation** - Rollback is always one click away

### 11.2 Operating Modes

| Mode | Role Management | Channel Management | Social Layer | Incumbent Status |
|------|-----------------|-------------------|--------------|------------------|
| **Shadow** | None - observe only | None | Glimpse only | Active, untouched |
| **Parallel** | `@arrakis-*` roles | Optional parallel channels | Glimpse only | Active, untouched |
| **Primary** | `@arrakis-*` roles (authoritative) | Full channel management | Full features | Optional backup |
| **Exclusive** | Takes over incumbent roles | Full channel management | Full features | Removed |

### 11.3 Phase 7: Shadow Mode

#### FR-5.11.1: Incumbent Detection

**Description**: Auto-detect existing token-gating bots on installation.

**Acceptance Criteria**:
- [ ] Detect Collab.Land, Matrica, Guild.xyz by bot ID patterns
- [ ] Detect verification channels (`#collabland-join`, `#matrica-verify`)
- [ ] Identify token-gated roles by naming patterns and membership
- [ ] Confidence score (0-1) for detection accuracy
- [ ] Manual override for `other` incumbents

#### FR-5.11.2: Shadow Ledger

**Description**: Track "what Arrakis would do" without executing any Discord changes.

**Acceptance Criteria**:
- [ ] `shadow_member_state` table with incumbent roles, Arrakis eligibility, conviction score
- [ ] `shadow_divergences` table tracking differences between incumbent and Arrakis
- [ ] `shadow_predictions` table for accuracy tracking
- [ ] RLS policies scoped by `guild_id`
- [ ] No Discord role mutations in shadow mode

**Schema**:
```typescript
shadow_member_state: {
  guild_id: string;
  discord_id: string;
  incumbent_roles: string[];
  arrakis_wallet: string | null;
  arrakis_eligibility: 'none' | 'naib' | 'fedaykin' | ...;
  arrakis_conviction: number;  // 0-100
  arrakis_would_assign: string[];
  arrakis_would_revoke: string[];
  divergence_status: 'match' | 'arrakis_higher' | 'arrakis_lower' | 'unknown';
}
```

#### FR-5.11.3: Shadow Sync Job

**Description**: Periodic comparison of incumbent state vs Arrakis calculations.

**Acceptance Criteria**:
- [ ] Runs every 6 hours (matching typical incumbent balance check interval)
- [ ] Snapshots current Discord role state
- [ ] Calculates Arrakis eligibility for verified wallets
- [ ] Detects and records divergences
- [ ] Validates previous predictions
- [ ] Admin digest notification (opt-in)
- [ ] **CRITICAL**: Zero Discord mutations in shadow mode

### 11.4 Phase 7: Verification Tiers

#### FR-5.12.1: Tiered Feature Access

**Description**: Gate features based on verification status.

**Acceptance Criteria**:
- [ ] Tier 1 (`incumbent_only`): Shadow tracking, public leaderboard (wallet hidden)
- [ ] Tier 2 (`arrakis_basic`): Tier 1 + profile view, conviction score preview
- [ ] Tier 3 (`arrakis_full`): Full badges, tier progression, all social features
- [ ] Tier migration on wallet connection
- [ ] Feature gating enforced at service layer

#### FR-5.12.2: Verification Flow UX

**Description**: Encourage wallet connection without requiring it.

**Acceptance Criteria**:
- [ ] Detect existing incumbent verification
- [ ] Offer "Quick Start" (incumbent tier) vs "Full Experience" (wallet connect)
- [ ] Preview conviction score and tier after wallet connection
- [ ] Clear messaging about locked features
- [ ] Call-to-action for admin migration

### 11.5 Phase 8: Parallel Mode

#### FR-5.13.1: Namespaced Role Management

**Description**: Create Arrakis roles that coexist with incumbent roles.

**Acceptance Criteria**:
- [ ] All Arrakis roles prefixed with `@arrakis-*`
- [ ] Roles positioned below incumbent roles in hierarchy
- [ ] Role sync independent of incumbent
- [ ] No permissions granted to namespaced roles (security)
- [ ] Admin can customize role names while preserving namespace

#### FR-5.13.2: Parallel Channel Strategy

**Description**: Admin-configurable channel creation strategy.

**Acceptance Criteria**:
- [ ] Strategy options: `none`, `additive_only`, `parallel_mirror`, `custom`
- [ ] `additive_only` creates conviction-gated channels (incumbents can't offer)
- [ ] Default additive channels: `#conviction-lounge` (80+), `#diamond-hands` (95+)
- [ ] `parallel_mirror` creates Arrakis versions of incumbent channels
- [ ] Channel permissions tied to Arrakis roles

### 11.6 Phase 8: Glimpse Mode (Social Layer Preview)

#### FR-5.14.1: Blurred Preview System

**Description**: Show social features exist without full access.

**Acceptance Criteria**:
- [ ] Leaderboard visible, others' conviction scores hidden
- [ ] Profile directory shows blurred profile cards
- [ ] Badge showcase shows locked badge icons
- [ ] "Your Preview Profile" shows own stats
- [ ] Unlock messaging: "🔐 Full profiles unlock when your community completes migration"

#### FR-5.14.2: Upgrade Call-to-Action

**Description**: Create FOMO for full features.

**Acceptance Criteria**:
- [ ] "Tell Admin to Migrate" button on glimpse views
- [ ] Badge count "ready to claim" displayed
- [ ] Conviction rank position shown (e.g., "Top 15%")
- [ ] Visual differentiation (blur, lock icons)
- [ ] No harassment or manipulation - informational only

### 11.7 Phase 9: Migration Engine

#### FR-5.15.1: Migration Strategy Selection

**Description**: Admin chooses migration approach.

**Acceptance Criteria**:
- [ ] Strategies: `instant`, `gradual`, `parallel_forever`, `arrakis_primary`
- [ ] Readiness checks: min shadow days (14), min accuracy (95%)
- [ ] `gradual` migrates new members immediately, existing over N days
- [ ] `parallel_forever` keeps both systems indefinitely
- [ ] Strategy selection via admin dashboard

#### FR-5.15.2: Rollback System

**Description**: Emergency revert capability.

**Acceptance Criteria**:
- [ ] One-click rollback to previous mode
- [ ] Auto-trigger on: >5% access loss in 1 hour, error rate >10% in 15 min
- [ ] Preserve incumbent roles during rollback
- [ ] Admin notification on auto-rollback
- [ ] Audit log of all rollback events

#### FR-5.15.3: Role Takeover (Exclusive Mode)

**Description**: Admin-triggered transition to exclusive Arrakis management.

**Acceptance Criteria**:
- [ ] Manual command only (`/arrakis takeover`)
- [ ] Three-step confirmation (community name, acknowledge, rollback plan)
- [ ] Rename namespaced roles to final names
- [ ] Remove incumbent roles from members (optional)
- [ ] Update channel permissions
- [ ] **INCENTIVE**: 20% pricing discount for first year

### 11.8 Phase 9: Incumbent Health Monitoring

#### FR-5.16.1: Health Check System

**Description**: Monitor incumbent bot health.

**Acceptance Criteria**:
- [ ] Check: Role update freshness (alert: 48h, critical: 72h)
- [ ] Check: Bot online presence (alert: 1h)
- [ ] Check: Verification channel activity (alert: 168h)
- [ ] Health report per guild
- [ ] Historical health data for trends

#### FR-5.16.2: Admin Alert System

**Description**: Notify admin of incumbent issues.

**Acceptance Criteria**:
- [ ] Alert channels: admin DM, audit channel
- [ ] Throttle: 4 hours between alerts
- [ ] Alert content: issue summary, Arrakis status, action buttons
- [ ] "Activate Arrakis as Backup" button (non-automatic)
- [ ] "Dismiss Alert" option

#### FR-5.16.3: Emergency Backup Activation

**Description**: Admin-triggered backup when incumbent fails.

**Acceptance Criteria**:
- [ ] Requires explicit confirmation
- [ ] Transitions from shadow to parallel mode
- [ ] Immediately syncs Arrakis roles
- [ ] Does NOT remove incumbent roles
- [ ] Does NOT remove incumbent bot
- [ ] Audit log entry with health report metadata
- [ ] Admin notification on completion

### 11.9 Coexistence Sprint Roadmap

| Sprint | Focus | Key Deliverables |
|--------|-------|------------------|
| 56 | Shadow Foundation | Incumbent detection, shadow ledger, basic sync |
| 57 | Shadow Analytics | Divergence tracking, prediction engine, admin dashboard |
| 58 | Parallel Roles | Namespaced role management, parallel role sync |
| 59 | Parallel Channels | Additive channel creation, conviction-gated access |
| 60 | Verification Tiers | Trust incumbent, tiered feature access, preview mode |
| 61 | Glimpse Mode | Blurred profiles, locked badges, upgrade CTAs |
| 62 | Migration Engine | Strategy selection, gradual migration, rollback system |
| 63 | Incumbent Monitoring | Health checks, alerting, backup activation |
| 64 | Full Social Layer | Post-migration profile unlock, badge system, directory |
| 65 | Polish & Incentives | Pricing integration, takeover incentives, docs |

### 11.10 Coexistence Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Shadow mode accuracy | >95% agreement with incumbent | Divergence rate |
| Parallel adoption | >50% members connect wallet | Verification tier tracking |
| Migration completion rate | >80% of parallel communities | Mode transitions |
| Rollback rate | <5% of migrations | Rollback event count |
| Incumbent failure response time | <1 hour to backup activation | Alert-to-action tracking |
| User satisfaction (NPS) | >50 post-migration | Survey |

### 11.11 Coexistence Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Incumbent legal action | Low | Medium | Namespaced roles, no role touching in shadow mode |
| User confusion (two systems) | Medium | Medium | Clear messaging, visual differentiation, glimpse mode |
| Admin abandons migration | Medium | Low | Parallel mode works indefinitely; no pressure |
| Arrakis miscalculates eligibility | Low | High | Shadow mode proves accuracy before action |
| Rollback needed post-migration | Medium | Medium | Incumbent roles preserved, one-click restore |
| Incumbent recovers mid-backup | Low | Low | Admin decides; both can coexist |

---

## 12. Appendices

### Appendix A: Package Structure

```
packages/
├── core/
│   ├── domain/         # Pure entities
│   ├── ports/          # Interface definitions
│   └── services/       # Business logic
├── adapters/
│   ├── chain/          # TwoTierChainProvider
│   ├── storage/        # Drizzle + Hybrid State
│   ├── platform/       # Discord + Rate Limiting
│   └── themes/         # Basic + Sietch
├── wizard/             # 8-step onboarding
└── synthesis/          # BullMQ + Token Bucket
```

### Appendix B: Environment Variables

```bash
# Score Service (replaces BERACHAIN_RPC_URL, DUNE_API_KEY)
SCORE_API_URL=https://score.honeyjar.xyz/api
SCORE_API_KEY=sk_...

# PostgreSQL (replaces SQLite)
DATABASE_URL=postgresql://...

# Redis (sessions + token bucket)
REDIS_URL=redis://...

# Vault (cryptographic operations)
VAULT_ADDR=https://vault.honeyjar.xyz
VAULT_TOKEN=...
```

### Appendix C: Reference Documents

| Document | Location |
|----------|----------|
| Architecture Specification | `loa-grimoire/context/new-context/arrakis-saas-architecture.md` |
| Implementation Prompt | `loa-grimoire/context/new-context/arrakis-implementation-prompt.md` |
| Coexistence Architecture | `loa-grimoire/context/ARRAKIS_COEXISTENCE_ARCHITECTURE.md` |
| v4.1 PRD | `loa-grimoire/prd-v4.0-completed.md` |
| v4.1 SDD | `loa-grimoire/sdd-v4.0-completed.md` |

---

**Document Status**: APPROVED - Coexistence Architecture Added

**Revision History**:
| Version | Date | Changes |
|---------|------|---------|
| 5.0 | Dec 28, 2025 | Initial v5.0 PRD |
| 5.1 | Dec 29, 2025 | Added Section 10: Hardening Requirements from external code review |
| 5.2 | Dec 30, 2025 | Added Section 11: Coexistence Architecture (Shadow Mode & Incumbent Migration) |

**Next Steps**:
1. Continue implementing hardening requirements (Section 10) before production
2. Proceed with Coexistence Architecture sprints (56-65) after hardening complete
