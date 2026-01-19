# Sprint Plan: Arrakis Genesis

**Version:** 2.0
**Date:** 2026-01-16
**Status:** DRAFT - Pending Approval
**PRD Reference:** grimoires/loa/prd.md (v2.0 "Arrakis Genesis")
**SDD Reference:** grimoires/loa/sdd.md (v2.0 "Arrakis Genesis")

---

## Sprint Overview

### Initiative Summary

Transform Arrakis from single-community to **multi-tenant SaaS platform** supporting **10,000+ Discord servers** through:

**Part I: Infrastructure (Existing)**
- Rust Gateway (Twilight) - IMPLEMENTED
- NATS JetStream - IMPLEMENTED
- Hybrid Data Layer (PostgreSQL + ScyllaDB) - IMPLEMENTED
- Auto-scaling Kubernetes deployment - IMPLEMENTED

**Part II: SaaS Platform (NEW)**
- Two-Tier Chain Provider (Native + Score Service)
- Themes System (BasicTheme + SietchTheme)
- WizardEngine (Hybrid Web + Discord)
- Synthesis Engine with Global Token Bucket
- HashiCorp Vault Transit Integration

**Part III: Coexistence (NEW)**
- Shadow Mode (Zero-mutation proving)
- Parallel Mode (Namespaced coexistence)
- Migration Engine (Strategy-based transition)

### Timeline

| Part | Phases | Duration | Sprints | Focus |
|------|--------|----------|---------|-------|
| **Part I** | 1-4 | 28 weeks | S-1 to S-14 | Infrastructure (IMPLEMENTED) |
| **Part II** | 5-10 | 16 weeks | S-15 to S-22 | SaaS Platform |
| **Part III** | 11-13 | 10 weeks | S-23 to S-27 | Coexistence & Migration |
| **Total** | 1-13 | **54 weeks** | **27 sprints** | Complete Arrakis Genesis |

### Sprint Cadence

- **Sprint Duration:** 2 weeks
- **Team Size:** Claude Code assisted (1 developer + AI)
- **Velocity:** ~5-7 tasks per sprint

---

## Part I: Infrastructure (Phases 1-4) - IMPLEMENTED

> Part I infrastructure sprints (S-1 through S-14) have been implemented.
> See sprint.md v1.0 for historical task details.
> Security remediation sprints (SEC-1 through SEC-4) are tracked separately.

### Implementation Status

| Phase | Status | Key Deliverables |
|-------|--------|------------------|
| Phase 1 | COMPLETE | PostgreSQL + PgBouncer, RPC Pool, ScyllaDB |
| Phase 2 | COMPLETE | Twilight Gateway, NATS JetStream, Workers |
| Phase 3 | COMPLETE | Blue-Green Deployment, Rate Limiting |
| Phase 4 | COMPLETE | Auto-Scaling, Multi-Layer Cache, Tracing |

### Exit Criteria (All Met)
- [x] Gateway memory <40MB per 1k guilds
- [x] NATS message latency <50ms p99
- [x] 10k server capacity validated
- [x] >90% cache hit rate

---

## Part II: SaaS Platform (Phases 5-10)

### Phase 5: Two-Tier Chain Provider (Weeks 29-30)

#### Sprint S-15: Native Blockchain Reader & Interface

**Goal:** Establish foundation for chain-agnostic eligibility with resilient two-tier architecture.

**Duration:** Weeks 29-30

#### Tasks

| ID | Task | Description | Acceptance Criteria | Effort |
|----|------|-------------|---------------------|--------|
| S-15.1 | IChainProvider Interface | Define port interface in `packages/core/ports/` | Interface with hasBalance, ownsNFT, getBalance methods | S |
| S-15.2 | NativeBlockchainReader | Implement Tier 1 viem-based reader | Binary checks working with <100ms response | L |
| S-15.3 | Multi-Chain Support | Add chain configuration for EVM chains | Berachain, Ethereum, Polygon configured | M |
| S-15.4 | Balance Caching | Cache layer for RPC results | 5-minute TTL, >80% cache hit rate | M |
| S-15.5 | NFT Ownership Check | Implement ERC721 ownership verification | ownerOf and balanceOf checks working | M |
| S-15.6 | Native Reader Tests | Unit and integration tests | >90% coverage, mocked RPC tests | M |

**Sprint Definition of Done:**
- [x] Native Reader handles token balance and NFT ownership checks
- [x] Response time <100ms with caching
- [x] Tests pass with mocked providers

**Dependencies:** S-14 (Infrastructure complete)

---

#### Sprint S-16: Score Service & Two-Tier Orchestration

**Goal:** Build Score Service client and orchestrate two-tier failover.

**Duration:** Weeks 31-32

#### Tasks

| ID | Task | Description | Acceptance Criteria | Effort |
|----|------|-------------|---------------------|--------|
| S-16.1 | Score Service Proto | Define gRPC protocol for Score Service | Proto file with all 4 RPC methods | M |
| S-16.2 | Score Service Client | TypeScript gRPC client with circuit breaker | Circuit breaker trips at 50% error rate | L |
| S-16.3 | TwoTierChainProvider | Orchestrator class per SDD §6.1.5 | checkBasicEligibility and checkAdvancedEligibility working | L |
| S-16.4 | Degradation Logic | Implement fallback behavior matrix | Degraded mode returns `source: 'native_degraded'` | M |
| S-16.5 | Circuit Breaker Metrics | Prometheus metrics for Score Service circuit | Circuit state changes logged and graphed | S |
| S-16.6 | Two-Tier Integration Tests | E2E tests for eligibility flow | All eligibility scenarios tested | M |

**Sprint Definition of Done:**
- [x] Two-tier orchestration handles Score Service failures
- [x] Graceful degradation returns correct source indicator
- [x] Circuit breaker metrics visible in Grafana

**Dependencies:** S-15 (Native Reader)

---

### Phase 6: Themes System (Weeks 33-34)

#### Sprint S-17: Theme Interface & BasicTheme

**Goal:** Establish configurable theme system with free BasicTheme.

**Duration:** Weeks 33-34

#### Tasks

| ID | Task | Description | Acceptance Criteria | Effort |
|----|------|-------------|---------------------|--------|
| S-17.1 | IThemeProvider Interface | Define port interface per SDD §6.2.2 | Interface with getTierConfig, getBadgeConfig, evaluateTier | M |
| S-17.2 | TierConfig Model | Tier configuration domain model | Supports minRank, maxRank, roleColor, permissions | S |
| S-17.3 | BadgeConfig Model | Badge configuration with evaluators | 5 evaluator types: join_order, tenure, tier_reached, recent_activity, manual_grant | M |
| S-17.4 | BasicTheme Implementation | 3-tier, 5-badge free theme | Gold/Silver/Bronze tiers, generic naming | L |
| S-17.5 | Badge Evaluators | Implement badge evaluation logic | All 5 evaluator types working | M |
| S-17.6 | Theme Unit Tests | Tests for tier and badge evaluation | >95% coverage on BasicTheme | M |

**Sprint Definition of Done:**
- [x] BasicTheme evaluates tiers correctly based on rank
- [x] Badge evaluators return correct earned status
- [x] All tests pass

**Dependencies:** S-16 (Two-Tier Provider for score data)

---

#### Sprint S-18: SietchTheme & Theme Registry

**Goal:** Implement premium SietchTheme and centralized registry.

**Duration:** Weeks 35-36

#### Tasks

| ID | Task | Description | Acceptance Criteria | Effort |
|----|------|-------------|---------------------|--------|
| S-18.1 | SietchTheme Implementation | 9-tier Dune-themed premium theme | Naib → Outsider tiers with v4.1 parity | L |
| S-18.2 | Sietch Badges | 10+ Dune-themed badges per SDD §6.2.4 | All badge evaluators working | L |
| S-18.3 | ThemeRegistry | Centralized theme registration and lookup | get(), getAvailableThemes(), registerTheme() working | M |
| S-18.4 | Subscription Tier Enforcement | Filter themes by subscription level | Free sees BasicTheme only, Pro sees both | S |
| S-18.5 | Custom Theme Loader | Enterprise custom theme support | loadCustomTheme() with validation | M |
| S-18.6 | Theme Regression Tests | CRITICAL: v4.1 parity test suite | SietchTheme produces identical results to v4.1 | L |
| S-18.7 | Theme Hot-Reload | Config changes without restart | Changes reflected within 30s | M |

**Sprint Definition of Done:**
- [x] SietchTheme produces identical tier/badge results to v4.1
- [x] ThemeRegistry filters by subscription correctly
- [x] Regression test suite passes

**Dependencies:** S-17 (BasicTheme and interface)

---

### Phase 7: PostgreSQL Multi-Tenant (Weeks 37-38)

#### Sprint S-19: Enhanced RLS & Drizzle Adapter

**Goal:** Full multi-tenant isolation with RLS and type-safe queries.

**Duration:** Weeks 37-38

#### Tasks

| ID | Task | Description | Acceptance Criteria | Effort |
|----|------|-------------|---------------------|--------|
| S-19.1 | Communities Table | Add community configuration table | Stores tenant settings, theme, subscription tier | M |
| S-19.2 | Enhanced RLS Policies | RLS on all tenant tables | Policy: `community_id = current_setting('app.current_tenant')` | L |
| S-19.3 | RLS Bypass Role | Service account with BYPASSRLS | `arrakis_service` role configured | S |
| S-19.4 | Drizzle Storage Adapter | Type-safe adapter per SDD §6.3 | Implements IStorageProvider with tenant context | L |
| S-19.5 | Tenant Context Middleware | Set tenant context per request | community_id propagated through request lifecycle | M |
| S-19.6 | RLS Penetration Test | SECURITY: Test cross-tenant access | Cross-tenant access returns empty result | L |
| S-19.7 | RLS Regression Tests | Automated RLS validation | >95% coverage on all tenant tables | M |

**Sprint Definition of Done:**
- [ ] All tenant tables protected by RLS
- [ ] Cross-tenant queries return empty results (security)
- [ ] Drizzle adapter passes all tests

**Dependencies:** S-18 (Themes need storage)

---

### Phase 8: Redis + Hybrid State (Weeks 39-40)

#### Sprint S-20: Wizard Session Store & State Model

**Goal:** Redis-backed session management for WizardEngine.

**Duration:** Weeks 39-40

#### Tasks

| ID | Task | Description | Acceptance Criteria | Effort |
|----|------|-------------|---------------------|--------|
| S-20.1 | WizardSession Model | Domain model for wizard state | 8 states from INIT to DEPLOY | M |
| S-20.2 | WizardSessionStore | Redis-backed store per SDD §6.3.3 | 15-minute TTL, create/get/update working | L |
| S-20.3 | State Machine Validation | Valid state transition checks | Invalid transitions throw error | M |
| S-20.4 | Session IP Binding | SECURITY: Bind session to IP | IP mismatch rejects session | S |
| S-20.5 | Guild Session Index | Lookup session by guild ID | getByGuild() returns active session | S |
| S-20.6 | S3 Shadow State | Manifest history backup | Git-style versioning to S3 | M |
| S-20.7 | Drift Detection | Compare desired/shadow/actual | 3-state comparison working | M |
| S-20.8 | Session Store Tests | Unit tests for session lifecycle | >90% coverage | M |

**Sprint Definition of Done:**
- [x] Wizard sessions persist across container restarts
- [x] IP binding prevents session hijacking
- [x] Shadow state enables drift detection

**Dependencies:** S-19 (Tenant context for sessions)

---

### Phase 9: BullMQ + Global Token Bucket (Weeks 41-42)

#### Sprint S-21: Synthesis Engine & Rate Limiting

**Goal:** Async Discord operations with platform-wide rate limiting.

**Duration:** Weeks 41-42

#### Tasks

| ID | Task | Description | Acceptance Criteria | Effort |
|----|------|-------------|---------------------|--------|
| S-21.1 | BullMQ Queue Setup | `discord-synthesis` queue | 3 retries, exponential backoff, DLQ configured | M |
| S-21.2 | Synthesis Worker | Process Discord operations | 5 concurrent, 10 jobs/sec limiter | L |
| S-21.3 | Global Token Bucket | Redis Lua script per SDD §6.3.5 | 50 tokens/sec, `acquireWithWait()` blocking | L |
| S-21.4 | Idempotency Keys | Prevent duplicate operations | Same key processed only once (24h TTL) | M |
| S-21.5 | Synthesis Job Types | create_role, assign_role, create_channel, etc. | All 7 job types implemented | M |
| S-21.6 | Token Bucket Metrics | Prometheus for bucket exhaustion | `token_bucket_exhausted`, `token_bucket_waits` | S |
| S-21.7 | Synthesis Integration Tests | E2E tests for role/channel creation | All synthesis operations tested | L |
| S-21.8 | Discord 429 Monitoring | CRITICAL: Zero global ban validation | Metrics confirm 0 global 429 errors | M |

**Sprint Definition of Done:**
- [ ] Synthesis operations rate-limited to 50/sec globally
- [ ] Zero Discord global 429 errors in testing
- [ ] Idempotent operations prevent duplicates

**Dependencies:** S-20 (Wizard triggers synthesis)

---

### Phase 10: Vault Transit + Security + Wizard (Weeks 43-46)

#### Sprint S-22: Vault Integration & Kill Switch

**Goal:** HSM-backed cryptography and emergency controls.

**Duration:** Weeks 43-44

#### Tasks

| ID | Task | Description | Acceptance Criteria | Effort |
|----|------|-------------|---------------------|--------|
| S-22.1 | Vault Terraform Module | Deploy HashiCorp Vault HA cluster | Transit and KV v2 engines enabled | L |
| S-22.2 | VaultClient Implementation | TypeScript client per SDD §6.4.2 | sign, verify, encrypt, decrypt working | L |
| S-22.3 | AppRole Authentication | Production auth via roleId/secretId | Auto-renewing tokens | M |
| S-22.4 | OAuth Token Encryption | Encrypt Discord OAuth tokens | No plaintext tokens in database | M |
| S-22.5 | Wallet Verification Signing | Sign wallet verification challenges | HSM-backed signatures | M |
| S-22.6 | Key Rotation | Implement key rotation capability | rotateKey() working | S |
| S-22.7 | Kill Switch Implementation | MFA-protected emergency shutdown | Revokes permissions, pauses synthesis | L |
| S-22.8 | Kill Switch Testing | Quarterly kill switch test | Full activation/deactivation cycle | M |
| S-22.9 | Vault Metrics | Prometheus for Vault operations | Latency and error metrics | S |

**Sprint Definition of Done:**
- [ ] No PRIVATE_KEY in environment variables
- [ ] All signing via Vault Transit
- [ ] Kill switch tested and documented

**Dependencies:** S-21 (Kill switch pauses synthesis)

---

#### Sprint S-23: WizardEngine Implementation

**Goal:** 8-step self-service onboarding flow.

**Duration:** Weeks 45-46

#### Tasks

| ID | Task | Description | Acceptance Criteria | Effort |
|----|------|-------------|---------------------|--------|
| S-23.1 | /setup Command | Discord slash command to start wizard | Creates session, returns initial state | M |
| S-23.2 | /resume Command | Continue interrupted session | Retrieves session by ID or guild | S |
| S-23.3 | INIT Step Handler | Welcome and community name | Validates name, transitions to CHAIN_SELECT | M |
| S-23.4 | CHAIN_SELECT Step | Blockchain selection | Multi-select EVM chains | M |
| S-23.5 | ASSET_CONFIG Step | Contract address entry | Validates contract, fetches metadata | M |
| S-23.6 | ELIGIBILITY_RULES Step | Configure thresholds | Rule builder with preview | L |
| S-23.7 | ROLE_MAPPING Step | Define tier → role mapping | Theme-aware role names | M |
| S-23.8 | CHANNEL_STRUCTURE Step | Select template or customize | additive_only, parallel_mirror, custom | M |
| S-23.9 | REVIEW Step | Preview manifest | Full manifest preview with edit option | M |
| S-23.10 | DEPLOY Step | Execute synthesis | Triggers SynthesisEngine, tracks progress | L |
| S-23.11 | Wizard Analytics | Funnel completion tracking | >80% completion rate target | S |
| S-23.12 | Wizard Integration Tests | E2E wizard flow | Full 8-step flow tested | L |

**Sprint Definition of Done:**
- [x] Complete 8-step wizard flow working
- [x] Sessions persist across Discord timeout (3s)
- [x] Analytics track funnel completion

**Status:** REVIEW_APPROVED (2026-01-16)

**Dependencies:** S-22 (Vault for secure operations), S-21 (Synthesis for deploy)

---

## Part III: Coexistence (Phases 11-13)

### Phase 11: Shadow Mode (Weeks 47-50)

#### Sprint S-24: Incumbent Detection & Shadow Ledger

**Goal:** Auto-detect incumbents and track shadow state.

**Duration:** Weeks 47-48

#### Tasks

| ID | Task | Description | Acceptance Criteria | Effort |
|----|------|-------------|---------------------|--------|
| S-24.1 | IncumbentDetector Class | Auto-detect Collab.Land, Matrica, Guild.xyz | Detection by bot ID, channel patterns, role patterns | L |
| S-24.2 | Confidence Scoring | Calculate detection confidence | 0-1 score based on evidence aggregation | M |
| S-24.3 | Shadow Ledger Schema | ScyllaDB tables per SDD §7.1.3 | shadow_member_state, shadow_divergences, shadow_predictions | M |
| S-24.4 | Shadow Member State | Track incumbent vs Arrakis eligibility | incumbent_roles, arrakis_eligible, divergence_flag | M |
| S-24.5 | Divergence Recording | Track false_positive and false_negative | Timestamped divergence history | M |
| S-24.6 | Prediction Tracking | Record predictions for validation | predicted_at, verified_at, correct fields | M |
| S-24.7 | Detection Tests | Test incumbent detection accuracy | >90% accuracy on known patterns | M |

**Sprint Definition of Done:**
- [ ] Incumbent detection identifies Collab.Land, Matrica, Guild.xyz
- [ ] Shadow ledger stores comparison state
- [ ] Zero Discord mutations in shadow mode

**Dependencies:** S-23 (Wizard completed)

---

#### Sprint S-25: Shadow Sync Job & Verification Tiers

**Goal:** Periodic shadow comparison and tiered feature access.

**Duration:** Weeks 49-50

#### Tasks

| ID | Task | Description | Acceptance Criteria | Effort |
|----|------|-------------|---------------------|--------|
| S-25.1 | ShadowSyncJob | 6-hour periodic comparison per SDD §7.1.4 | Snapshots, calculates, compares, records | L |
| S-25.2 | Cursor-Based Member Fetch | Paginated member retrieval | No OOM on large communities | M |
| S-25.3 | Accuracy Calculation | Track prediction accuracy | Reports % correct predictions | M |
| S-25.4 | Shadow Digest Notification | Opt-in admin notifications | Summary of divergences and accuracy | M |
| S-25.5 | Verification Tier 1 | `incumbent_only` feature set | Shadow tracking, public leaderboard (hidden wallets) | M |
| S-25.6 | Verification Tier 2 | `arrakis_basic` feature set | Tier 1 + profile view, conviction preview | M |
| S-25.7 | Verification Tier 3 | `arrakis_full` feature set | Full badges, tier progression, social features | M |
| S-25.8 | Feature Gate Middleware | Enforce tier-based access | Service layer rejects unauthorized features | M |
| S-25.9 | Shadow Mode Integration Tests | E2E shadow sync | Full sync cycle tested, 0 mutations | L |

**Sprint Definition of Done:**
- [x] Shadow sync runs every 6 hours without Discord mutations
- [x] Accuracy calculation validates predictions
- [x] Feature gates enforce verification tiers

**Dependencies:** S-24 (Shadow Ledger)

---

### Phase 12: Parallel Mode (Weeks 51-54)

#### Sprint S-26: Namespaced Roles & Parallel Channels

**Goal:** Arrakis operates alongside incumbents with isolation.

**Duration:** Weeks 51-52

#### Tasks

| ID | Task | Description | Acceptance Criteria | Effort |
|----|------|-------------|---------------------|--------|
| S-26.1 | NamespacedRoleManager | Create `@arrakis-*` prefixed roles | All Arrakis roles namespaced | L |
| S-26.2 | Role Position Strategy | Position below incumbent roles | Arrakis roles don't interfere with incumbent | M |
| S-26.3 | Permission Mode Config | none, view_only, inherit options | Default: no permissions (security) | S |
| S-26.4 | Namespaced Role Sync | Assign/remove Arrakis roles only | Never touch incumbent roles | L |
| S-26.5 | Channel Strategy: none | No Arrakis channels option | Configuration option working | S |
| S-26.6 | Channel Strategy: additive_only | Conviction-gated channels | #conviction-lounge (80+), #diamond-hands (95+) | M |
| S-26.7 | Channel Strategy: parallel_mirror | Arrakis versions of incumbent channels | Configurable mirroring | M |
| S-26.8 | Parallel Mode Tests | E2E parallel operation | Arrakis and incumbent coexist without conflict | L |

**Sprint Definition of Done:**
- [ ] Arrakis roles clearly namespaced
- [ ] Channel strategies configurable
- [ ] Parallel operation verified

**Dependencies:** S-25 (Shadow mode validated)

---

#### Sprint S-27: Glimpse Mode & Migration Readiness

**Goal:** Social feature previews and migration preparation.

**Duration:** Weeks 53-54

#### Tasks

| ID | Task | Description | Acceptance Criteria | Effort |
|----|------|-------------|---------------------|--------|
| S-27.1 | Glimpse Mode: Leaderboard | Visible board, hidden others' scores | Shows position, hides competitor details | M |
| S-27.2 | Glimpse Mode: Profile Directory | Blurred profile cards | Visual indicator of locked content | M |
| S-27.3 | Glimpse Mode: Badge Showcase | Locked badge icons | Shows badges exist, unlock CTA | M |
| S-27.4 | Preview Profile | "Your Preview Profile" view | User sees own stats in full | M |
| S-27.5 | Unlock Messaging | Migration CTA | "Full profiles unlock when your community migrates" | S |
| S-27.6 | Readiness Checks | Min shadow days, min accuracy | 14 days shadow, 95% accuracy required | M |
| S-27.7 | Glimpse Mode Tests | UI/UX tests for glimpse features | All glimpse components working | M |

**Sprint Definition of Done:**
- [ ] Glimpse mode shows features exist without full access
- [ ] Readiness checks validate migration prerequisites
- [ ] Clear unlock messaging drives migration

**Dependencies:** S-26 (Parallel mode operational)

---

### Phase 13: Migration Engine (Weeks 55-56)

#### Sprint S-28: Migration Strategies & Rollback

**Goal:** Graceful transition from shadow/parallel to primary.

**Duration:** Weeks 55-56

#### Tasks

| ID | Task | Description | Acceptance Criteria | Effort |
|----|------|-------------|---------------------|--------|
| S-28.1 | Migration Strategy Selection | Admin chooses migration approach | instant, gradual, parallel_forever, arrakis_primary | M |
| S-28.2 | Strategy: instant | Immediate cutover | All members migrate at once | L |
| S-28.3 | Strategy: gradual | New members immediate, existing over N days | Configurable transition period | L |
| S-28.4 | Strategy: parallel_forever | Both systems indefinitely | No incumbent role removal | M |
| S-28.5 | Strategy: arrakis_primary | Arrakis primary, incumbent backup | Arrakis roles gain permissions | M |
| S-28.6 | Rollback System | One-click emergency revert | Preserves incumbent roles, reverts mode | L |
| S-28.7 | Auto-Rollback Triggers | Automatic safety triggers | >5% access loss in 1h, >10% error rate in 15min | M |
| S-28.8 | Incumbent Health Monitor | Track incumbent bot health | Role freshness (48h alert, 72h critical), bot presence | M |
| S-28.9 | Backup Activation | "Activate Arrakis as Backup" button | Non-automatic admin action | M |
| S-28.10 | Migration Audit Trail | Log all migration events | Full audit of rollback and transitions | M |
| S-28.11 | Migration E2E Tests | Test all 4 strategies | Full migration flow tested per strategy | L |

**Sprint Definition of Done:**
- [ ] All 4 migration strategies working
- [ ] Rollback tested and documented
- [ ] Auto-triggers prevent user access loss

**Dependencies:** S-27 (Readiness checks passed)

---

## Security Remediation Sprints (SEC Series) - PRESERVED

> Security sprints SEC-1 through SEC-4 remain active from v1.0.
> See original sprint.md for full SEC sprint details.

| Sprint | Status | Focus | Production Blocker |
|--------|--------|-------|-------------------|
| SEC-1 | COMPLETE | H-1, H-2 (Dependencies, Authorization) | YES (resolved) |
| SEC-2 | IN PROGRESS | M-2, M-3, M-5 (Input Validation, Logs) | NO |
| SEC-3 | PENDING | M-1, M-4 (Credentials, Rate Limiting) | NO |
| SEC-4 | PENDING | L-1, L-2, L-3 (Infrastructure) | NO |

---

### Sprint 89 (S-89): Security Audit Hardening

**Goal:** Address observations from the 2026-01-17 full codebase security audit.

**Audit Reference:** `grimoires/loa/a2a/full-codebase-security-audit-2026-01-17.md`

**Duration:** 1 week (focused sprint)

#### Tasks

| ID | Task | Description | Acceptance Criteria | Effort | Priority |
|----|------|-------------|---------------------|--------|----------|
| S-89.1 | Application Rate Limiting | Add rate limiting middleware for Discord commands | Per-user limits (10 cmd/min), per-guild limits (100 cmd/min), 429 response with retry-after | M | LOW |
| S-89.2 | CI Dependency Auditing | Add automated dependency vulnerability scanning to CI | `npm audit --audit-level=high` in CI, fail on high/critical | S | LOW |
| S-89.3 | Vault Key Rotation Schedule | Document and configure automated key rotation | Rotation schedule: oauth-tokens (quarterly), wallet-challenges (annually), runbook documented | S | INFO |
| S-89.4 | Log Sanitization Middleware | Add middleware to redact sensitive data from logs | Regex-based redaction of tokens/keys/secrets, applied to all log outputs | M | INFO |
| S-89.5 | Rate Limit Metrics | Prometheus metrics for rate limiting | `rate_limit_hits`, `rate_limit_blocked` counters with guild/user labels | S | LOW |
| S-89.6 | Security Hardening Tests | Unit tests for new security controls | >90% coverage on rate limiter and log sanitizer | M | - |

**Sprint Definition of Done:**
- [x] Rate limiting prevents command spam (per-user and per-guild) - PRE-EXISTING (SEC-3)
- [x] CI fails on high/critical dependency vulnerabilities - IMPLEMENTED
- [x] Key rotation schedule documented in runbook - IMPLEMENTED
- [x] No sensitive data in logs (verified by grep) - PRE-EXISTING (SEC-2)
- [x] All tests pass - PRE-EXISTING (77 tests)

**Dependencies:** None (can run in parallel with other sprints)

**Observation Mapping:**

| Observation | Priority | Task |
|-------------|----------|------|
| 1: Rate Limiting | LOW | S-89.1, S-89.5 |
| 2: Dependency Auditing | LOW | S-89.2 |
| 3: Secrets Rotation | INFO | S-89.3 |
| 4: Logging Sensitive Data | INFO | S-89.4 |

---

### Sprint 90 (S-90): CLI Rename (bd → gaib)

**Goal:** Rename the Arrakis CLI command from `bd` to `gaib` to avoid confusion with the Beads task tracking CLI.

**Duration:** 2-4 hours (focused sprint)

**Rationale:** The `bd` command conflicts with the Beads CLI (`bd`) used for task tracking in the Loa workflow framework.

#### Naming: `gaib`

The name `gaib` is derived from the Fremen term **"Lisan al-Gaib"** (لسان الغيب) from Frank Herbert's *Dune* universe, meaning "Voice from the Outer World" or "Tongue of the Unseen."

**Etymology:**
- Arabic: الغيب (*al-ghayb*) meaning "the unseen" or "the hidden"
- In Sufi mysticism, الغيب connotes "unseen dimensions of Reality"
- The Fremen used "Lisan al-Gaib" to refer to their prophesied off-world messiah

**Why `gaib`:**
1. **Thematic fit**: Arrakis (the project) draws its name from Dune's desert planet; `gaib` continues this naming universe
2. **4 letters**: Short, memorable, easy to type
3. **Contains "ai"**: Subtle nod to the AI-assisted development workflow
4. **Available**: No conflicts on npm or with existing CLI tools
5. **Meaning**: "The unseen/hidden" reflects the CLI's role in managing sandboxed (isolated/hidden) Discord servers

**References:**
- [Lisan al-Gaib - Dune Wiki](https://dune.fandom.com/wiki/Lisan_al-Gaib)
- [Arabic and Islamic themes in Dune](https://baheyeldin.com/literature/arabic-and-islamic-themes-in-frank-herberts-dune.html)

#### Tasks

| ID | Task | Description | Acceptance Criteria | Effort |
|----|------|-------------|---------------------|--------|
| S-90.1 | Rename Entry Point | Rename `src/bin/bd.ts` → `src/bin/gaib.ts` | File renamed, JSDoc updated, `.name('gaib')` set | S |
| S-90.2 | Update Package Config | Update package.json bin, dev script, description | `"bin": { "gaib": "./dist/bin/gaib.js" }` | S |
| S-90.3 | Update Command Group | Update sandbox/index.ts help text and examples | All 12 examples show `gaib sandbox` prefix | S |
| S-90.4 | Update Subcommands | Update JSDoc and examples in 7 command files | create, destroy, connect, list, status, register, unregister updated | M |
| S-90.5 | Update Documentation | Update docs/sandbox-runbook.md | 15 command examples updated to `gaib` | S |
| S-90.6 | Verify Tests | Review and update test files if needed | All tests pass with new CLI name | S |
| S-90.7 | Build and Verify | Build CLI and test all commands | `gaib --help` and all subcommands work correctly | S |

**Files Affected:**

| Category | Files | Changes |
|----------|-------|---------|
| Entry Point | `src/bin/bd.ts` → `src/bin/gaib.ts` | File rename + content updates |
| Config | `package.json` | bin, dev script, description |
| Commands | `src/commands/sandbox/*.ts` (8 files) | JSDoc, examples, error messages |
| Documentation | `docs/sandbox-runbook.md` | 15 CLI examples |
| Tests | `src/commands/sandbox/__tests__/*.ts` | Review for bd references |

**Sprint Definition of Done:**
- [ ] Entry point renamed from `bd.ts` to `gaib.ts`
- [ ] Package.json updated with new bin entry
- [ ] All command files updated (JSDoc + examples)
- [ ] Documentation updated
- [ ] `npm run build` succeeds
- [ ] All tests pass
- [ ] `gaib sandbox --help` displays correctly
- [ ] No references to `bd` command remain (verified via grep)

**Dependencies:** None (independent of other sprints)

**Total References to Update:** ~50 instances across 11 source files + 1 doc file

---

## Risk Assessment

### Technical Risks

| Risk | Probability | Impact | Mitigation | Sprint |
|------|-------------|--------|------------|--------|
| Score Service complexity | Medium | High | Start with mock service, iterate | S-16 |
| SietchTheme regression | High | High | Comprehensive v4.1 parity tests | S-18 |
| RLS bypass vulnerability | Low | Critical | Penetration testing, automated regression | S-19 |
| Discord global 429 | Medium | Critical | Token bucket with conservative limits | S-21 |
| Vault learning curve | Medium | Medium | Start with dev mode, document thoroughly | S-22 |
| Wizard timeout (3s) | High | Medium | Redis sessions, /resume command | S-23 |
| Shadow mode accuracy | Medium | High | Extensive validation before parallel | S-25 |
| Incumbent legal concerns | Low | Medium | Namespaced roles, no role touching | S-26 |
| Migration data loss | Low | Critical | Auto-rollback triggers, audit trail | S-28 |

### Schedule Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Score Service takes longer | Medium | High | Can deploy Two-Tier without Score initially |
| Theme regression testing | Medium | Medium | Automated test suite, not manual |
| Vault ops complexity | Medium | Medium | Use managed Vault service if needed |
| Shadow mode proves issues | Low | Medium | Extends timeline, doesn't block |

---

## Success Criteria Summary

### Part II Exit Criteria (SaaS Platform)
- [ ] Two-tier chain provider with graceful degradation
- [ ] BasicTheme + SietchTheme with v4.1 parity
- [ ] Multi-tenant RLS with >95% coverage
- [ ] WizardEngine with >80% completion rate
- [ ] Zero Discord global 429 errors
- [ ] Vault Transit with no env var secrets

### Part III Exit Criteria (Coexistence)
- [ ] Shadow mode proves >95% accuracy
- [ ] Parallel mode operates without incumbent conflict
- [ ] All 4 migration strategies working
- [ ] Auto-rollback triggers tested
- [ ] Glimpse mode drives migration interest

### Final Genesis Exit Criteria
- [ ] 10,000+ Discord server capacity
- [ ] Multi-tenant isolation verified
- [ ] Self-service onboarding complete
- [ ] Coexistence with major incumbents
- [ ] Migration engine production-ready

---

## Task Tracking

### Task Status Legend

| Status | Meaning |
|--------|---------|
| `[ ]` | Not started |
| `[~]` | In progress |
| `[x]` | Completed |
| `[!]` | Blocked |

### Current Sprint

**Part I Complete**: S-1 through S-14 implemented
**SEC Sprints**: SEC-1 complete, SEC-2 in progress
**Next Sprint**: S-15 (Two-Tier Chain Provider)

---

## Appendix

### Effort Estimates

| Size | Hours | Description |
|------|-------|-------------|
| S | 2-4 | Small, well-defined task |
| M | 4-8 | Medium complexity, some unknowns |
| L | 8-16 | Large, significant implementation |
| XL | 16+ | Very large, consider breaking down |

### Sprint Naming Convention

- `sprint-s-N` for scaling/Genesis sprints (S-1 through S-28)
- `sprint-sec-N` for security remediation sprints
- `sprint-gw-N` for legacy Gateway Proxy sprints (historical)

### Reference Documents

| Document | Path |
|----------|------|
| PRD v2.0 | `grimoires/loa/prd.md` |
| SDD v2.0 | `grimoires/loa/sdd.md` |
| Original Sprint Plan | `grimoires/loa/archive/sprint-v1.0.md` |
| Security Audit (2026-01-17) | `grimoires/loa/a2a/full-codebase-security-audit-2026-01-17.md` |
| NOTES.md | `grimoires/loa/NOTES.md` |

### Phase → Sprint Mapping

| Phase | Sprints | Duration | Focus |
|-------|---------|----------|-------|
| 1-4 | S-1 to S-14 | 28 weeks | Infrastructure (COMPLETE) |
| 5 | S-15, S-16 | 4 weeks | Two-Tier Chain Provider |
| 6 | S-17, S-18 | 4 weeks | Themes System |
| 7 | S-19 | 2 weeks | PostgreSQL Multi-Tenant |
| 8 | S-20 | 2 weeks | Redis + Hybrid State |
| 9 | S-21 | 2 weeks | BullMQ + Token Bucket |
| 10 | S-22, S-23 | 4 weeks | Vault + Wizard |
| 11 | S-24, S-25 | 4 weeks | Shadow Mode |
| 12 | S-26, S-27 | 4 weeks | Parallel Mode |
| 13 | S-28 | 2 weeks | Migration Engine |

---

**Document Status:** DRAFT - Pending Approval

**Revision History:**

| Version | Date | Changes |
|---------|------|---------|
| 2.3 | Jan 18, 2026 | Updated Sprint 90 (S-90) CLI name from `arks` to `gaib` (from Dune's "Lisan al-Gaib"). Added comprehensive naming rationale and etymology documentation. |
| 2.2 | Jan 18, 2026 | Added Sprint 90 (S-90) for CLI rename from `bd` to `arks`. 7 tasks covering entry point, config, commands, docs, and verification. |
| 2.1 | Jan 17, 2026 | Added Sprint 89 (S-89) from full codebase security audit observations. 6 tasks addressing rate limiting, dependency auditing, key rotation, and log sanitization. |
| 2.0 | Jan 16, 2026 | Extended sprint plan for Arrakis Genesis (Phases 5-13). Added Part II (SaaS Platform) and Part III (Coexistence) sprints. Total 28 sprints covering 54 weeks. |
| 1.0 | Jan 15, 2026 | Initial sprint plan for infrastructure scaling (Phases 1-4). 14 sprints plus SEC-1 through SEC-4. |

**Next Steps:**
1. Review and approve sprint plan
2. Begin implementation: `/implement sprint-s-15`
