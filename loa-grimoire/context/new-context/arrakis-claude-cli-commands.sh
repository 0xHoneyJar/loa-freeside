#!/bin/bash
# Arrakis SaaS Implementation - Claude CLI Commands
# 
# Usage: Copy the relevant command to start implementation
# Requires: claude-cli installed, Loa repo cloned

# ═══════════════════════════════════════════════════════════════════════════
# OPTION 1: Full Implementation Session (Interactive)
# ═══════════════════════════════════════════════════════════════════════════

# Start an interactive session with full context
claude chat --context docs/arrakis-saas-architecture.md --context CLAUDE.md

# ═══════════════════════════════════════════════════════════════════════════
# OPTION 2: Phase-by-Phase Implementation (Recommended)
# ═══════════════════════════════════════════════════════════════════════════

# --- PHASE 0: Two-Tier Chain Provider ---
claude -p "
You are implementing the Arrakis SaaS Architecture v5.5.1.

CURRENT PHASE: Phase 0 - Two-Tier Chain Provider

CONTEXT:
- Full architecture: docs/arrakis-saas-architecture.md
- Framework patterns: https://github.com/0xHoneyJar/loa

TASK: Create the Two-Tier Chain Provider with:

1. packages/core/ports/IChainProvider.ts
   - INativeReader interface (binary checks: hasBalance, ownsNFT)
   - IScoreService interface (complex: ranking, history)

2. packages/adapters/chain/NativeBlockchainReader.ts
   - Direct viem RPC calls
   - No external dependencies
   - ALWAYS available

3. packages/adapters/chain/ScoreServiceAdapter.ts
   - Calls Score Service API
   - Uses opossum Circuit Breaker
   - Cached fallback on failure

4. packages/adapters/chain/TwoTierChainProvider.ts
   - Orchestrates Tier 1 (Native) and Tier 2 (Score)
   - checkBasicEligibility() - uses Native Reader
   - checkAdvancedEligibility() - uses Score with degradation

5. Tests validating:
   - Basic eligibility works without Score Service
   - Circuit breaker triggers after 50% error rate
   - Cached fallback returns stale data during outage

DELETE src/services/chain.ts after tests pass.

Reference the architecture doc Section 3.7 for full TwoTierChainProvider spec.
"

# --- PHASE 1: Themes System ---
claude -p "
CURRENT PHASE: Phase 1 - Themes System

TASK: Create injectable tier/badge configuration:

1. packages/core/ports/IThemeProvider.ts
   - getTierConfig(): TierDefinition[]
   - getBadgeConfig(): BadgeDefinition[]
   - evaluateTier(rank: number): TierResult
   - evaluateBadges(member: MemberContext): EarnedBadge[]

2. packages/adapters/themes/BasicTheme.ts
   - 3 tiers: Gold (1-10), Silver (11-50), Bronze (51-100)
   - 5 badges: Early Adopter, Veteran, Top Tier, Active, Contributor
   - Generic naming

3. packages/adapters/themes/SietchTheme.ts
   - 9 tiers: Naib, Fedaykin Elite, Fedaykin, Fremen, Wanderer, Initiate, Aspirant, Observer, Outsider
   - 10+ badges including Water Sharer lineage
   - Dune-inspired naming

4. packages/core/services/TierEvaluator.ts
   - Pure function: rank → tier using injected IThemeProvider
   - NO hardcoded tier logic

5. Tests validating:
   - SietchTheme produces IDENTICAL results to v3.0 hardcoded logic
   - BasicTheme works for non-Sietch communities
   - Theme can be selected per community

Reference architecture doc Section 4 for full Themes spec.
"

# --- PHASE 2: PostgreSQL Migration ---
claude -p "
CURRENT PHASE: Phase 2 - PostgreSQL + RLS

TASK: Replace SQLite with multi-tenant PostgreSQL:

1. packages/adapters/storage/schema.ts (Drizzle)
   - communities table with themeId
   - profiles table with community_id FK
   - badges table with lineage support
   - RLS policies on all tables

2. packages/adapters/storage/DrizzleStorageAdapter.ts
   - Implements IStorageProvider
   - Sets tenant context before every query
   - Uses RLS for automatic isolation

3. packages/adapters/storage/TenantIsolationGuard.ts
   - Automated RLS regression testing
   - assertNoTenantLeakage() throws on cross-tenant data

4. Migration scripts:
   - Create PostgreSQL schema
   - Enable RLS on all tables
   - Migrate data from profiles.db with community_id backfill

5. Tests validating:
   - All 141 existing tests pass
   - Tenant A cannot see Tenant B data
   - Badge lineage recursive queries work

DELETE profiles.db after migration validated.

Reference architecture doc Section 9.1 for RLS spec.
"

# --- PHASE 3: Redis + Hybrid State ---
claude -p "
CURRENT PHASE: Phase 3 - Redis WizardEngine + Hybrid State

TASK: Session persistence and manifest versioning:

1. packages/wizard/WizardSessionStore.ts
   - Redis-backed session storage
   - 15-minute TTL
   - Survives container restarts

2. packages/wizard/WizardEngine.ts
   - 8-step onboarding flow
   - Saves checkpoint after each step
   - /resume command for interrupted sessions

3. packages/adapters/storage/HybridManifestRepository.ts
   - PostgreSQL for runtime (fast reads)
   - S3 shadow for version history (audit trail)
   - Disaster recovery from shadow

4. Tests validating:
   - Wizard survives Discord 3s timeout
   - Session resumable after container restart
   - Manifest history recoverable from S3

Reference architecture doc Section 5 (WizardEngine) and Section 6 (Hybrid State).
"

# --- PHASE 4: BullMQ + Global Token Bucket ---
claude -p "
CURRENT PHASE: Phase 4 - Synthesis Queue + Global Rate Limiting

TASK: Async Discord operations with platform-level throttling:

1. packages/synthesis/SynthesisQueue.ts
   - BullMQ distributed queue
   - 3 retries with exponential backoff
   - Reconciliation controller pattern

2. packages/synthesis/GlobalTokenBucket.ts
   - Redis-based distributed token bucket
   - 50 tokens/second (Discord limit)
   - Shared across ALL workers/tenants
   - Atomic Lua script for acquisition

3. packages/synthesis/GlobalRateLimitedSynthesisWorker.ts
   - Acquires from global bucket before every Discord API call
   - Ensures platform-wide compliance

4. packages/synthesis/ReconciliationController.ts
   - Kubernetes-style reconciliation loop
   - Three-state comparison: desired, shadow, actual
   - Drift detection and correction

5. Tests validating:
   - 100 concurrent tenants don't exceed 50 req/sec globally
   - Synthesis can be resumed after interruption
   - No Discord 429 errors

Reference architecture doc Section 5.2 for Global Token Bucket spec.
"

# --- PHASE 5: Vault Transit + Kill Switch ---
claude -p "
CURRENT PHASE: Phase 5 - Security Hardening

TASK: Cryptographic operations and emergency protocols:

1. packages/adapters/vault/VaultSigningAdapter.ts
   - HCP Vault Transit for all signing
   - Private keys NEVER in memory
   - Audit log of all operations

2. packages/security/KillSwitchProtocol.ts
   - Revoke all sessions for compromised user
   - Revoke Vault policies (cryptographic lockout)
   - Suspend synthesis for affected communities
   - Freeze community until manual review

3. packages/security/NaibSecurityGuard.ts
   - MFA required for destructive operations
   - DELETE_CHANNEL, DELETE_ROLE require extra verification
   - Kill switch triggered by auditing-security agent

4. Tests validating:
   - No PRIVATE_KEY in .env files
   - All signing goes through Vault
   - Kill switch revokes access within 5 seconds

Reference architecture doc Section 9.1.1 for Kill Switch spec.
"

# --- PHASE 6: OPA Pre-Gate + HITL ---
claude -p "
CURRENT PHASE: Phase 6 - Policy-as-Code + Human Approval

TASK: Safe Terraform automation:

1. packages/infrastructure/PolicyAsCodePreGate.ts
   - OPA policy evaluation
   - Infracost budget check
   - Risk scoring (0-100)

2. policies/arrakis-terraform.rego
   - Hard blocks: delete PV, delete DB, disable RLS
   - Warnings: large-scale changes
   - Human CANNOT override hard blocks

3. packages/infrastructure/EnhancedHITLApprovalGate.ts
   - Three-stage validation BEFORE human sees plan
   - Risk context in Slack approval message
   - Auto-reject >$5k/mo cost increase

4. Tests validating:
   - Delete PV plan auto-rejected (human cannot approve)
   - High-risk plans flagged with context
   - Audit trail in Slack

Reference architecture doc Phase 6 for OPA spec.
"

# ═══════════════════════════════════════════════════════════════════════════
# OPTION 3: Single Command with All Context
# ═══════════════════════════════════════════════════════════════════════════

claude -p "
Implement the Arrakis SaaS Architecture v5.5.1 following the specification in docs/arrakis-saas-architecture.md.

Start with Phase 0 (Two-Tier Chain Provider) and proceed through all 6 phases.

Key architectural decisions:
1. Two-Tier Chain Provider: Native Reader (binary) + Score Service (complex) with Circuit Breaker
2. Themes System: IThemeProvider with BasicTheme and SietchTheme
3. PostgreSQL with RLS-ONLY (no schema-per-tenant)
4. Redis for WizardEngine sessions + Hybrid State for manifests
5. BullMQ with Global Distributed Token Bucket
6. Vault Transit + Kill Switch + OPA Pre-Gate

Use Loa framework patterns from https://github.com/0xHoneyJar/loa

Validate each phase before proceeding. All 141 existing tests must pass.
"

# ═══════════════════════════════════════════════════════════════════════════
# SETUP: Place context files in repository
# ═══════════════════════════════════════════════════════════════════════════

echo "Setup instructions:"
echo "1. Copy CLAUDE.md to repository root"
echo "2. Copy arrakis-saas-architecture.md to docs/"
echo "3. Copy arrakis-implementation-prompt.md to docs/"
echo "4. Run: claude chat --context CLAUDE.md"
