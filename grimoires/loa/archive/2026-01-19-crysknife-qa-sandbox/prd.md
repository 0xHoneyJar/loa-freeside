# Product Requirements Document: QA Sandbox Testing System

**Version**: 1.0
**Date**: January 19, 2026
**Status**: DRAFT - Pending Approval
**Feature Branch**: `feature/qa-sandbox-server`
**Base Branch**: `staging`
**Codename**: Crysknife

---

## Document Traceability

| Section | Primary Source | Secondary Sources |
|---------|---------------|-------------------|
| Sandbox Architecture | packages/sandbox/src/services/sandbox-manager.ts | docs/sandbox-runbook.md |
| Theme System | themes/sietch/src/packages/adapters/themes/SietchTheme.ts | IThemeProvider.ts |
| Tier Evaluation | themes/sietch/src/packages/core/services/TierEvaluator.ts | roleManager.ts |
| Configuration | themes/sietch/src/config.ts | .env.example |
| Progressive Gate | themes/sietch/src/services/discord/progressive-gate/ProgressiveGate.ts | STAGES, BLUR_LEVELS |

**Related Documents**:
- `grimoires/loa/archive/2026-01/features/discord-server-sandboxes-prd.md` (Foundation)
- `themes/sietch/src/packages/core/ports/IThemeProvider.ts` (Theme Interface)

---

## 1. Executive Summary

### 1.1 Product Overview

**QA Sandbox Testing System** extends the existing sandbox infrastructure to enable interactive testing and simulation of theme-based permission systems. It provides a unified interface for both human QA testers and automated agents/skills to:
- Assume any role within a theme's tier hierarchy
- Configure thresholds and variables dynamically
- Verify permission grants against configured state
- Simulate user journeys through tier transitions

**Key Value Proposition**: Eliminate manual permission testing complexity by providing a self-service simulation environment that mirrors production permission logic without affecting real users.

### 1.2 Problem Statement

**Current State:**
- QA must manually verify permission behavior for each tier/role combination
- Theme developers cannot easily test threshold configurations before deployment
- Automated testing lacks ability to simulate "what if" scenarios for user state
- No way to verify permission grants match expected behavior given specific BGT/rank values
- Agent-based workflows cannot programmatically validate permission logic

**Target State:**
- Single interface for role assumption and state configuration
- Deterministic permission evaluation against any hypothetical state
- Support for both human (Discord slash commands) and programmatic (API) access
- Integration with existing sandbox isolation for safe testing
- Theme-agnostic design supporting current and future themes

**Why Now:**
- Sandworm Sense onboarding system (Sprints 102-105) adds complex mode selection logic
- Progressive Gate engagement system introduces new permission evaluation paths
- Theme customization becoming more complex with 9-tier SietchTheme
- Agent-based QA workflows require programmatic access

### 1.3 Vision

QA Sandbox becomes the **unified testing harness** for all permission-related logic:

- **Phase 1 (Now)**: Permission simulation and verification for QA
- **Phase 2 (Near-term)**: Theme development preview/testing environment
- **Phase 3 (Future)**: Customer self-service permission debugging

### 1.4 Success Metrics

| Category | Metric | Target | Measurement |
|----------|--------|--------|-------------|
| **Coverage** | Tier/permission combinations testable | 100% | Feature parity audit |
| **Speed** | Time to verify single permission | <100ms | API response time |
| **Adoption** | QA tests using simulation | >80% | Test tag analysis |
| **Accuracy** | Permission evaluation matches production | 100% | Integration tests |
| **Usability** | Commands to test a scenario | <=3 | User journey analysis |

---

## 2. User & Stakeholder Context

### 2.1 Primary Users

| User Type | Description | Primary Need |
|-----------|-------------|--------------|
| **QA Engineers (Human)** | Non-technical testers verifying permission behavior | Simple Discord interface to test "does user X see channel Y" |
| **Theme Developers** | Engineers building/modifying themes | Validate threshold configurations before deployment |
| **Agents/Skills** | Automated workflows testing permission logic | Programmatic API for deterministic permission checks |
| **DevOps** | Deployment verification | Smoke tests for permission system health |

### 2.2 User Stories

**QA Engineer (Human)**:
```
As a QA engineer,
I want to assume the "Fedaykin" role in a sandbox
So that I can verify which channels and features are visible to that tier.
```

```
As a QA engineer,
I want to set a user's BGT balance to 500
So that I can verify they receive the correct "Sihaya" tier permissions.
```

**Theme Developer**:
```
As a theme developer,
I want to modify the ENGAGED_MIN threshold from 50 to 75
So that I can test how the change affects user progression.
```

**Agent/Skill**:
```
As an automated test agent,
I want to programmatically check if a user with rank=42 can access "war-room"
So that I can include permission verification in CI/CD pipelines.
```

---

## 3. Functional Requirements

### 3.1 Core Features (MVP)

#### FR-1: Role Assumption

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1.1 | CLI/Discord command `assume role <tier>` sets simulated role for session | P0 |
| FR-1.2 | API endpoint `POST /sandbox/:id/assume` accepts tier ID | P0 |
| FR-1.3 | Support all 9 SietchTheme tiers (naib, fedaykin, usul, sayyadina, mushtamal, sihaya, qanat, ichwan, hajra) | P0 |
| FR-1.4 | Reset to default state with `assume role reset` | P1 |
| FR-1.5 | Display current assumed role with `whoami` command | P1 |

#### FR-2: State Configuration

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-2.1 | Configure simulated BGT balance: `set bgt <amount>` | P0 |
| FR-2.2 | Configure simulated rank: `set rank <number>` | P0 |
| FR-2.3 | Configure engagement stage: `set stage <free\|engaged\|verified>` | P0 |
| FR-2.4 | Configure activity score: `set activity <number>` | P1 |
| FR-2.5 | Configure tenure days: `set tenure <days>` | P1 |
| FR-2.6 | Configure conviction score: `set conviction <number>` | P1 |
| FR-2.7 | Batch state configuration via JSON: `set state <json>` | P1 |
| FR-2.8 | Get current state: `get state` returns JSON of all configured values | P0 |

#### FR-3: Permission Verification

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-3.1 | Check channel access: `check access #channel-name` | P0 |
| FR-3.2 | Check feature access: `check feature <feature-id>` | P0 |
| FR-3.3 | Check tier qualification: `check tier` returns computed tier | P0 |
| FR-3.4 | Check badge eligibility: `check badges` returns eligible badges | P1 |
| FR-3.5 | Bulk permission check: `check all` returns matrix of permissions | P1 |
| FR-3.6 | API endpoint `POST /sandbox/:id/check` for programmatic verification | P0 |

#### FR-4: Threshold Configuration

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-4.1 | Override tier thresholds: `config tier <id> minRank=<n>` | P1 |
| FR-4.2 | Override BGT thresholds: `config bgt <tier>=<amount>` | P1 |
| FR-4.3 | Override engagement thresholds: `config stage <stage> minPoints=<n>` | P1 |
| FR-4.4 | Reset thresholds to defaults: `config reset` | P1 |
| FR-4.5 | Show current thresholds: `config show` | P1 |
| FR-4.6 | Load threshold presets: `config load <preset-name>` | P2 |

#### FR-5: Scenario Testing

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-5.1 | Define test scenario as YAML/JSON file | P1 |
| FR-5.2 | Run scenario: `run scenario <file>` executes assertions | P1 |
| FR-5.3 | Report scenario results with pass/fail per assertion | P1 |
| FR-5.4 | Support "given/when/then" style assertions | P2 |

### 3.2 Integration Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-6.1 | Inherit sandbox isolation from existing infrastructure | P0 |
| FR-6.2 | Work within existing sandbox TTL and lifecycle | P0 |
| FR-6.3 | No production Discord mutations - all checks are local | P0 |
| FR-6.4 | Support theme switching within sandbox: `use theme <theme-id>` | P2 |

---

## 4. Technical Architecture

### 4.1 Component Overview

```
+-----------------------------------------------------------------+
|                    QA Sandbox Testing Layer                      |
|  +----------------+  +----------------+  +----------------+      |
|  | Discord Slash  |  |   REST API     |  |  Agent SDK     |      |
|  | Commands       |  |   Endpoints    |  |  Interface     |      |
|  +-------+--------+  +-------+--------+  +-------+--------+      |
|          |                   |                   |               |
|          +-------------------+-------------------+               |
|                              v                                   |
|  +-------------------------------------------------------------+ |
|  |                  SimulationContext                          | |
|  |  - assumedRole: string | null                               | |
|  |  - simulatedState: MemberContext                            | |
|  |  - thresholdOverrides: ThresholdConfig                      | |
|  |  - themeId: string                                          | |
|  +------------------------------+------------------------------+ |
|                                 |                                |
|          +----------------------+----------------------+         |
|          v                      v                      v         |
|  +----------------+  +----------------+  +----------------+      |
|  | TierEvaluator  |  | ProgressiveGate|  | BadgeEvaluator |      |
|  | (existing)     |  | (existing)     |  | (existing)     |      |
|  +----------------+  +----------------+  +----------------+      |
+-----------------------------------------------------------------+
                               |
                               v
+-----------------------------------------------------------------+
|                    Existing Sandbox Infrastructure               |
|  - Schema isolation (PostgreSQL)                                |
|  - Redis namespace isolation                                    |
|  - NATS subject isolation                                       |
|  - Guild mapping                                                |
+-----------------------------------------------------------------+
```

### 4.2 SimulationContext

The core data structure for maintaining simulated state:

```typescript
interface SimulationContext {
  sandboxId: string;

  // Role assumption
  assumedRole: {
    tierId: string;
    tierName: string;
    permissions: string[];
  } | null;

  // Simulated member state
  simulatedState: {
    // Core attributes
    address: string;        // Simulated wallet address
    rank: number;           // Simulated leaderboard position
    bgtBalance: number;     // Simulated BGT holdings

    // Engagement system
    engagementStage: 'free' | 'engaged' | 'verified';
    engagementPoints: number;

    // Activity/tenure
    activityScore: number;
    convictionScore: number;
    tenureDays: number;

    // Timestamps
    firstClaimAt: Date | null;
    lastActivityAt: Date | null;
  };

  // Threshold overrides
  thresholdOverrides: {
    tiers: Map<string, Partial<TierDefinition>>;
    bgt: Map<string, number>;      // tier -> BGT threshold
    engagement: {
      engagedMin?: number;         // default: 50
      rateLimit?: number;          // default: 10 points/hour
    };
  };

  // Theme selection
  themeId: string;                 // default: 'sietch'

  // Session metadata
  createdAt: Date;
  lastAccessedAt: Date;
}
```

### 4.3 Permission Check Flow

```
User Request: "check access #war-room"
           |
           v
+---------------------------------------------+
| 1. Resolve SimulationContext                |
|    - Get sandbox ID from session            |
|    - Load or create SimulationContext       |
+----------------------+----------------------+
                       |
                       v
+---------------------------------------------+
| 2. Determine Effective Tier                 |
|    IF assumedRole:                          |
|      use assumedRole.tierId                 |
|    ELSE:                                    |
|      compute from simulatedState + overrides|
|      using TierEvaluator                    |
+----------------------+----------------------+
                       |
                       v
+---------------------------------------------+
| 3. Load Channel Definition                  |
|    - Get theme's ChannelTemplate            |
|    - Find channel by name                   |
|    - Get tierRestriction                    |
+----------------------+----------------------+
                       |
                       v
+---------------------------------------------+
| 4. Evaluate Access                          |
|    - Compare effective tier vs required     |
|    - Check additional permissions           |
|    - Return AccessCheckResult               |
+----------------------+----------------------+
                       |
                       v
+---------------------------------------------+
| 5. Format Response                          |
|    {                                        |
|      allowed: true/false,                   |
|      reason: "...",                         |
|      effectiveTier: "fedaykin",             |
|      requiredTier: "fedaykin",              |
|      blurLevel: 0.3                         |
|    }                                        |
+---------------------------------------------+
```

### 4.4 State Storage

SimulationContext is stored in Redis with sandbox namespace:

```
sandbox:{sandboxId}:simulation = {JSON serialized SimulationContext}
```

TTL matches sandbox TTL for automatic cleanup.

### 4.5 API Endpoints

```
# Role Assumption
POST   /sandbox/:id/simulation/assume
       Body: { tierId: "fedaykin" }

DELETE /sandbox/:id/simulation/assume
       (resets to computed tier)

# State Configuration
PATCH  /sandbox/:id/simulation/state
       Body: { bgtBalance: 500, rank: 42, ... }

GET    /sandbox/:id/simulation/state

# Permission Checks
POST   /sandbox/:id/simulation/check
       Body: { type: "channel", target: "war-room" }
       Body: { type: "feature", target: "council_access" }
       Body: { type: "tier" }
       Body: { type: "badges" }
       Body: { type: "all" }

# Threshold Configuration
PATCH  /sandbox/:id/simulation/thresholds
       Body: { tiers: {...}, bgt: {...}, engagement: {...} }

GET    /sandbox/:id/simulation/thresholds

DELETE /sandbox/:id/simulation/thresholds
       (resets to defaults)

# Scenario Execution
POST   /sandbox/:id/simulation/scenario
       Body: { scenario: YAML/JSON content }
```

---

## 5. User Interface

### 5.1 Discord Slash Commands

```
/simulation assume <tier>
  - tier: dropdown with all tier options + "reset"

/simulation set <attribute> <value>
  - attribute: bgt | rank | stage | activity | tenure | conviction
  - value: number or enum (for stage)

/simulation check <type> [target]
  - type: access | feature | tier | badges | all
  - target: channel name or feature ID (optional for tier/badges/all)

/simulation config <action> [args]
  - action: show | reset | set
  - args: threshold configurations

/simulation whoami
  - Shows current assumed role and simulated state

/simulation scenario <file-url>
  - Runs scenario from attached/linked file
```

### 5.2 Response Formatting

**Permission Check Response (Discord Embed)**:
```
+------------------------------------------+
| ACCESS GRANTED: #war-room                |
+------------------------------------------+
| Effective Tier: Fedaykin (rank 42)       |
| Required Tier: Fedaykin (rank 8-69)      |
| Blur Level: 0%                           |
|                                          |
| Current State:                           |
| - BGT Balance: 150                       |
| - Rank: 42                               |
| - Engagement: ENGAGED (65 pts)           |
| - Tenure: 45 days                        |
+------------------------------------------+
```

**Denied Response**:
```
+------------------------------------------+
| ACCESS DENIED: #council-chamber          |
+------------------------------------------+
| Effective Tier: Fedaykin (rank 42)       |
| Required Tier: Naib (rank 1-7)           |
| Blur Level: 100%                         |
|                                          |
| To access this channel:                  |
| - Reach Naib tier (Top 7 rank required)  |
| - Current rank: 42, need: <=7            |
+------------------------------------------+
```

---

## 6. Non-Functional Requirements

### 6.1 Performance

| Requirement | Target |
|-------------|--------|
| Permission check latency | <100ms p95 |
| State update latency | <50ms p95 |
| Scenario execution | <5s for 100 assertions |
| Concurrent simulations per sandbox | 10 |

### 6.2 Security

| Requirement | Implementation |
|-------------|----------------|
| No production data access | Sandbox isolation inherited |
| No Discord mutations | Read-only against theme configs |
| Audit trail | Log all state changes |
| Rate limiting | 100 requests/minute per sandbox |

### 6.3 Reliability

| Requirement | Target |
|-------------|--------|
| Check accuracy vs production | 100% |
| State persistence within TTL | 100% |
| Graceful degradation | Return error, not crash |

---

## 7. Scope Definition

### 7.1 In Scope (MVP)

| Feature | Description |
|---------|-------------|
| Role assumption | Assume any tier role |
| State configuration | Set BGT, rank, engagement, activity, tenure |
| Permission checks | Channel access, feature access, tier computation |
| Discord commands | Full slash command interface |
| REST API | Programmatic access for agents |
| Sandbox integration | Inherit isolation and lifecycle |

### 7.2 Out of Scope (MVP)

| Feature | Reason | Future Phase |
|---------|--------|--------------|
| Theme switching | Single theme sufficient for MVP | Phase 2 |
| Badge simulation | Lower priority than permissions | Phase 2 |
| Scenario files | Nice-to-have, not critical | Phase 2 |
| Visual permission matrix | Requires frontend | Phase 3 |
| Time-based simulation | Complexity | Phase 3 |
| Real Discord channel testing | Safety concerns | Never |

### 7.3 Assumptions

1. Sandbox infrastructure is operational and stable
2. TierEvaluator and ProgressiveGate logic is correct
3. SietchTheme is the primary theme for testing
4. QA testers have sandbox access configured

### 7.4 Constraints

1. Must not modify production Discord servers
2. Must not persist state beyond sandbox TTL
3. Must support existing theme interface without modification
4. Rate limits apply per-sandbox

---

## 8. Implementation Phases

### Phase 1: Core Simulation (MVP)

**Goal**: Basic role assumption and permission checking

| Sprint | Deliverable |
|--------|-------------|
| S-QA-1 | SimulationContext data model, Redis storage |
| S-QA-2 | Role assumption commands (Discord + API) |
| S-QA-3 | State configuration commands |
| S-QA-4 | Permission check implementation |

### Phase 2: Enhanced Testing

**Goal**: Threshold configuration and scenarios

| Sprint | Deliverable |
|--------|-------------|
| S-QA-5 | Threshold override system |
| S-QA-6 | Badge eligibility simulation |
| S-QA-7 | Scenario file format and runner |

### Phase 3: Developer Experience

**Goal**: Advanced tooling

| Sprint | Deliverable |
|--------|-------------|
| S-QA-8 | Permission matrix visualization |
| S-QA-9 | Theme switching support |
| S-QA-10 | CI/CD integration helpers |

---

## 9. Acceptance Criteria

### 9.1 MVP Acceptance

```gherkin
Feature: Role Assumption

Scenario: QA assumes Fedaykin role
  Given I have a sandbox with ID "test-sandbox"
  When I run "/simulation assume fedaykin"
  Then my effective tier is "fedaykin"
  And I have permissions ["view_all", "vote", "elite_access", "water_share"]

Scenario: QA checks channel access with assumed role
  Given I have assumed the "fedaykin" role
  When I run "/simulation check access war-room"
  Then I receive "Access Granted"
  And the response shows required tier "fedaykin"

Feature: State Configuration

Scenario: QA sets BGT balance for tier computation
  Given I have a sandbox with default state
  When I run "/simulation set bgt 500"
  And I run "/simulation check tier"
  Then my computed tier is "sihaya"
  And the response shows BGT threshold "420"

Scenario: QA sets rank for tier computation
  Given I have a sandbox with default state
  When I run "/simulation set rank 5"
  And I run "/simulation check tier"
  Then my computed tier is "naib"
  And the response shows rank boundary "1-7"

Feature: Permission Verification

Scenario: Denied access shows reason
  Given I have assumed the "hajra" role
  When I run "/simulation check access council-chamber"
  Then I receive "Access Denied"
  And the response shows required tier "naib"
  And the response includes suggestion to reach Top 7

Feature: API Access

Scenario: Agent checks permission via API
  Given I have sandbox ID "test-sandbox"
  When I POST to /sandbox/test-sandbox/simulation/check
  With body { "type": "channel", "target": "war-room" }
  Then I receive 200 OK
  And the response contains { "allowed": true, "effectiveTier": "fedaykin" }
```

---

## 10. Open Questions

| # | Question | Owner | Status |
|---|----------|-------|--------|
| 1 | Should threshold overrides persist across sandbox restarts? | Engineering | Open |
| 2 | Do we need rate limiting per-user or per-sandbox? | Engineering | Open |
| 3 | Should we support custom theme loading from file? | Product | Deferred to Phase 2 |
| 4 | Integration with Beads for test scenario tracking? | Engineering | Open |

---

## 11. Appendix

### A. SietchTheme Tier Reference

| Tier | Rank Range | BGT Threshold | Permissions |
|------|------------|---------------|-------------|
| naib | 1-7 | N/A (rank-based) | view_all, council_access, vote, govern, naib_ceremony |
| fedaykin | 8-69 | N/A (rank-based) | view_all, vote, elite_access, water_share |
| usul | 70-100 | 1111+ | view_premium, vote, inner_circle |
| sayyadina | 101-150 | 888+ | view_premium, vote, ceremony_access |
| mushtamal | 151-200 | 690+ | view_premium, vote, garden_access |
| sihaya | 201-300 | 420+ | view_standard, vote |
| qanat | 301-500 | 222+ | view_standard, limited_vote |
| ichwan | 501-1000 | 69+ | view_basic |
| hajra | 1001+ | 6.9+ | view_general |

### B. Channel Template Reference

| Category | Channels | Tier Restriction |
|----------|----------|------------------|
| SIETCH SCROLLS | the-door, desert-laws, census, announcements | None (public) |
| NAIB COUNCIL | council-chamber, naib-voice | naib |
| FEDAYKIN QUARTERS | war-room, fedaykin-voice | fedaykin |
| THE OASIS | oasis-lounge | Water Sharer badge |
| COMMON GROUNDS | sietch-lounge, introductions, spice-market, desert-voice | None |
| CAVE ENTRANCE | taqwa-waiting | None |
| THE STILLSUIT | bot-commands, leaderboard | None |

### C. Progressive Gate Stages

| Stage | Points Required | Blur Level | Features |
|-------|-----------------|------------|----------|
| FREE | 0 | 80% | Glimpse mode |
| ENGAGED | 50 | 30% | Partial features, trust inheritance |
| VERIFIED | Wallet verified | 0% | Full features |

### D. Activity Point Values

| Activity | Points |
|----------|--------|
| leaderboard_view | 5 |
| profile_view | 3 |
| badge_preview | 2 |
| cta_click | 10 |
| command_use | 5 |
| return_visit | 8 |

**Rate Limit**: 10 points/hour max

---

**Document Status**: DRAFT - Pending Approval
**Next Steps**: Review by engineering team, then proceed to SDD creation
