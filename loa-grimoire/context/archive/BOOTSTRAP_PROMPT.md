# Loa Framework Bootstrap Prompt v2.9.0
## Sietch Unified - Tier 1 Enterprise Complete

---

## PRIMARY PROMPT (claude-cli / Loa)

```
Act as a Lead Software Architect. Use the **Loa framework** to build a cross-platform 
(Discord & Telegram) community tool based on the **Arrakis (Sietch) v2.0** design.

## Enterprise-Grade Requirements

### 1. Three-Zone Model (AWS Standard)
Implement strict separation between:
- **System Zone** (`system/`, `.claude/`): Immutable scaffolding - protected by SHA-256 checksums, overwritten only during formal updates. INCLUDES immutable billing protocols.
- **State Zone** (`state/`, `loa-grimoire/`): Project memory - PRD, SDD, grimoire.yaml, subscription entitlements preserved across updates  
- **App Zone** (`app/`, `src/`): Business logic - developer-owned, custom pricing logic, feature toggles

**Enforcement:** Generate checksums for System Zone. CI must fail on integrity violations.

### 2. Unified Identity (Microsoft Standard)
Use **Collab.Land AccountKit** as the central identity provider:
- Bridge Discord UID ↔ Telegram UID ↔ Ethereum/Solana wallet
- Single "Source of Truth" for cross-platform identity
- Cryptographic wallet verification via signature flow
- **AccountKit `account/me` endpoint for entitlement checks**

### 3. Modern SDKs (Microsoft Standard)
Build with supported, modern tooling:
- **Hono** for ultrafast, lightweight HTTP backend (replacing Express)
- **discord.js v14** for Discord integration
- **grammY** for Telegram bot + Mini App
- **Prisma** for type-safe database access
- **Stripe SDK** for subscription billing
- Avoid legacy Microsoft Bot Framework SDK (archived December 2025)

**SDK Status Note:** This project uses discord.js and grammY (not Microsoft Bot Framework).
These are the correct, modern SDKs for Discord and Telegram respectively. The Microsoft
365 Agents SDK is specifically for Microsoft Teams integration, which is not in scope.

### 4. Complex Logic (Role Composition)
Implement **Collab.Land Role Composition** for multi-factor conviction:
- AND/OR logic for tier eligibility
- Composite scoring: BGT holdings (40%) + governance (30%) + engagement (30%)
- Configurable thresholds via YAML (not hardcoded)
- **Gate Role Composition behind Premium tier check**

### 5. Demurrage Engine
Implement **10% activity decay every 6 hours**:
- Rewards consistent engagement over static wealth
- Scheduled job via trigger.dev or Cloud Scheduler
- Decay logged for audit trail

### 6. Security Gates (Quality Gates)
**No deployment without dual approval:**
- Gate 1: Tech Lead Code Review → "APPROVED" status required
- Gate 2: Security Auditor Agent → "APPROVED" status required
- Secret scanning: TruffleHog + Gitleaks
- No secrets in code (1Password vaults + GCP Secret Manager)

### 7. Infrastructure (Google Standard)
Design for **GCP Cloud Run** deployment:
- Serverless auto-scaling (0→N instances)
- VPC connector for private database access
- Secret Manager for API key protection (including Stripe keys)
- Regional deployment for GDPR compliance (us/eu/asia)
- **24-hour grace period** during RPC outages AND payment failures

### 7.5 Data Sovereignty & GDPR Compliance (EU Standard)

#### 7.5.1 Regional Data Residency
**CRITICAL:** Member data must never leave the server owner's chosen region.

```
┌─────────────────────────────────────────────────────────────────┐
│                 DATA RESIDENCY ARCHITECTURE                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────┐   ┌────────────────┐   ┌────────────────┐   │
│  │      US        │   │       EU       │   │      ASIA      │   │
│  │  us-central1   │   │ europe-west1   │   │asia-southeast1 │   │
│  ├────────────────┤   ├────────────────┤   ├────────────────┤   │
│  │ Cloud SQL      │   │ Cloud SQL      │   │ Cloud SQL      │   │
│  │ Memorystore    │   │ Memorystore    │   │ Memorystore    │   │
│  │ Cloud Run      │   │ Cloud Run      │   │ Cloud Run      │   │
│  │ Backups        │   │ Backups        │   │ Backups        │   │
│  └────────────────┘   └────────────────┘   └────────────────┘   │
│                                                                  │
│  Server owners select region during onboarding.                  │
│  ALL personal data stays within selected region.                 │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

#### 7.5.2 GDPR Data Classification

| Data Type | Classification | Retention | Cross-Border |
|-----------|---------------|-----------|--------------|
| Wallet addresses | Pseudonymous PII | Indefinite | Allowed |
| Discord/Telegram UIDs | PII | Until deletion | Regional only |
| Nyms (pseudonyms) | User-controlled | Until deletion | Regional only |
| Conviction scores | Derived data | 90 days history | Allowed |
| Activity logs | Behavioral | 30 days | Regional only |
| Payment data | Sensitive PII | Stripe-managed | Stripe regions |
| IP addresses | PII | 7 days max | Never stored |

#### 7.5.3 Data Subject Rights (GDPR Articles 15-22)

```typescript
// Required endpoints for GDPR compliance
interface GDPRController {
  // Article 15: Right of Access
  exportUserData(userId: string): Promise<DataExport>;
  
  // Article 17: Right to Erasure ("Right to be Forgotten")
  deleteUserData(userId: string): Promise<DeletionConfirmation>;
  
  // Article 20: Right to Data Portability
  getPortableData(userId: string): Promise<PortableDataPackage>;
  
  // Article 21: Right to Object
  optOutProcessing(userId: string, scope: ProcessingScope): Promise<void>;
}
```

#### 7.5.4 Terraform Regional Configuration

```hcl
# infrastructure/terraform/variables.tf
variable "data_region" {
  description = "GDPR data residency region"
  type        = string
  
  validation {
    condition     = contains(["us", "eu", "asia"], var.data_region)
    error_message = "Data region must be us, eu, or asia for GDPR compliance."
  }
}

# Automatic region mapping
locals {
  region_mapping = {
    us   = "us-central1"      # Americas
    eu   = "europe-west1"     # Belgium (GDPR jurisdiction)
    asia = "asia-southeast1"  # Singapore
  }
}
```

#### 7.5.5 Required Privacy Infrastructure

1. **Data Processing Agreement (DPA)**: Required for communities in EU/UK
2. **Privacy Policy Generator**: Template in `docs/legal/PRIVACY_TEMPLATE.md`
3. **Cookie Consent**: Not required (no browser cookies used)
4. **Audit Logging**: All data access logged with `audit_logs` table
5. **Encryption at Rest**: Cloud SQL encryption (AES-256) enabled by default
6. **Encryption in Transit**: TLS 1.3 enforced on all endpoints

#### 7.5.6 Onboarding Data Residency Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                 COMMUNITY ONBOARDING FLOW                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Admin creates community                                      │
│     │                                                            │
│     ▼                                                            │
│  2. [SELECT DATA REGION]                                         │
│     ┌─────────────────────────────────────────────┐             │
│     │  Where are most of your members located?    │             │
│     │                                             │             │
│     │  ○ Americas (US)                            │             │
│     │  ○ Europe (EU) - GDPR compliant             │             │
│     │  ○ Asia Pacific (APAC)                      │             │
│     │                                             │             │
│     │  ⚠️  This cannot be changed later.          │             │
│     │     All member data will be stored in       │             │
│     │     this region permanently.                │             │
│     └─────────────────────────────────────────────┘             │
│     │                                                            │
│     ▼                                                            │
│  3. Provision regional infrastructure                            │
│     │                                                            │
│     ▼                                                            │
│  4. Community operational                                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

#### 7.5.7 Implementation Checklist

- [ ] Regional Terraform modules for us/eu/asia
- [ ] `data_region` column on `communities` table
- [ ] Regional database connection routing
- [ ] GDPR endpoints: `/api/gdpr/export`, `/api/gdpr/delete`
- [ ] Audit log for all PII access
- [ ] 30-day data retention job for activity logs
- [ ] Privacy policy acceptance tracking
- [ ] DPA template for enterprise customers

### 8. Subscription Billing Architecture (NEW)

#### 8.1 Billing Gateway (Stripe/Lemon Squeezy)
- **BuildShip triggers** for payment workflow automation
- Idempotent webhook listener in App Zone
- Handle events: `invoice.paid`, `invoice.payment_failed`, `subscription.deleted`, `customer.subscription.updated`
- Webhook signature verification (HMAC-SHA256)

#### 8.2 Tier Alignment (Collab.Land Plans)
```
┌─────────────┬──────────────┬─────────────────────────────────────────┐
│ Tier        │ Price        │ Features Unlocked                       │
├─────────────┼──────────────┼─────────────────────────────────────────┤
│ Starter     │ Free         │ 25 verified members, basic TGRs         │
│ Basic       │ $15/mo       │ 500 members, background checks          │
│ Premium     │ $35/mo       │ 1000 members, PRO miniapps, Role Comp   │
│ Exclusive   │ $149/mo      │ 2500 members, admin balance checks      │
│ Elite       │ $449/mo      │ 7500 members, AI Quiz Agent             │
│ Enterprise  │ Contact      │ Unlimited, white-label, dedicated       │
└─────────────┴──────────────┴─────────────────────────────────────────┘
```

#### 8.3 Gatekeeper Service
```typescript
// Check entitlements before granting access
interface GatekeeperService {
  checkAccess(userId: string, feature: Feature): Promise<AccessResult>;
  getSubscriptionTier(communityId: string): Promise<Tier>;
  isFeatureEnabled(communityId: string, feature: string): boolean;
  getRemainingGracePeriod(subscriptionId: string): number;
}
```

#### 8.4 Entitlement State Management
- PostgreSQL: Subscription records, payment history, tier mapping
- Redis: Real-time entitlement cache (5-minute TTL)
- Grace Period: 24 hours for failed payments before role revocation

#### 8.5 Self-Service Portal
- Stripe Customer Portal integration
- Telegram Mini App billing management
- Subscription upgrade/downgrade flows
- Invoice history and receipt downloads

#### 8.6 Fee Waiver System (Owner-Granted Complimentary Access)
Platform owners can grant communities full access without payment:

```typescript
// Grant waiver via API
POST /admin/waivers
{
  "communityId": "community_123",
  "tier": "enterprise",           // Optional, defaults to enterprise
  "reason": "Beta partner",       // Required - audit trail
  "expiresAt": "2025-12-31",     // Optional - null = permanent
  "internalNotes": "Strategic partner - annual review"
}

// List all waivers
GET /admin/waivers

// Revoke waiver
DELETE /admin/waivers/:communityId
{ "reason": "Partnership ended" }
```

**Waiver Priority:** Fee waiver > Stripe subscription > Free tier

**Use Cases:**
- Beta testers
- Strategic partners
- Internal/demo communities
- Competition winners

#### 8.7 Sietch Score Badge (User-Visible Conviction Display)
Users can display their conviction score as a badge in Discord/Telegram chats.

```
┌─────────────────────────────────────────────────────────────────┐
│                 BADGE ACCESS MODEL                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Community Tier        │ Badge Access                           │
│  ──────────────────────┼────────────────────────────────────    │
│  Enterprise            │ ✅ Included free                        │
│  Elite                 │ ✅ Included free                        │
│  Exclusive             │ ✅ Included free                        │
│  Premium               │ ✅ Included free                        │
│  Basic                 │ ❌ Individual purchase ($4.99)          │
│  Starter               │ ❌ Individual purchase ($4.99)          │
│  Fee Waiver            │ ✅ Included free                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Badge Styles:**
```
default:  ⚡ 847 | Fedaykin
minimal:  ⚡847
detailed: Sietch Score: 847 | Rank: Fedaykin
```

**API Endpoints:**
```typescript
// Check badge entitlement
GET /api/badge/entitlement
Headers: x-identity-id, x-community-id

// Purchase badge (lower tiers only)
POST /api/badge/purchase
{ "successUrl": "...", "cancelUrl": "..." }

// Get badge display (for bots)
GET /api/badge/display/:platform/:platformId

// Update display settings
PUT /api/badge/settings
{ "displayOnDiscord": true, "displayOnTelegram": false, "badgeStyle": "minimal" }

// Admin: Grant badge
POST /api/badge/grant
{ "unifiedIdentityId": "...", "reason": "Competition winner" }
```

**Bot Integration:**
- Discord: Bot checks `/api/badge/display/discord/{userId}` before messages
- Telegram: Bot checks `/api/badge/display/telegram/{userId}` for inline display
- Cache: 5-minute TTL via BadgeDisplayCache table

#### 8.8 Community Boosts (Discord-Style Collective Funding)
Members can collectively fund premium features by purchasing boosts ($2.99/month each).

```
┌─────────────────────────────────────────────────────────────────┐
│                    BOOST LEVELS                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Level │ Boosts │ Tier Unlocked │ Key Perks                     │
│  ──────┼────────┼───────────────┼───────────────────────────    │
│    0   │   0    │ Starter       │ Basic TGRs only               │
│    1   │   2    │ Basic         │ Background checks, 500 members│
│    2   │   7    │ Premium       │ Conviction Engine, Badges     │
│    3   │  14    │ Exclusive     │ Custom branding, 2500 members │
│    4   │  30    │ Elite         │ AI Quiz Agent, all features   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Tier Priority:** `Fee Waiver > Subscription > Boosts > Free`

If a community has both a subscription AND boosts, the **higher tier wins**.

**API Endpoints:**
```typescript
// Get boost levels and pricing
GET /api/boost/levels

// Get community boost status
GET /api/boost/status/:communityId
// Returns: totalBoosts, currentLevel, nextLevel, boostsNeeded, topBoosters

// Get user's boost info
GET /api/boost/user
Headers: x-community-id, x-identity-id

// Purchase boosts
POST /api/boost/purchase
{
  "communityId": "...",
  "boostCount": 2,  // Buy multiple at once
  "successUrl": "...",
  "cancelUrl": "..."
}

// Manage boost subscription
GET /api/boost/portal?returnUrl=...

// List all boosters
GET /api/boost/boosters/:communityId

// Admin: Grant free boosts
POST /api/boost/grant
{
  "communityId": "...",
  "unifiedIdentityId": "...",
  "boostCount": 5,
  "reason": "Community contest winner"
}
```

**Booster Perks:**
- 🚀 "Booster" badge visible in chat
- Priority listing in member directory
- Special role in Discord/Telegram
- Recognition in community announcements

### 9. Enterprise Abstraction Layers (v2.4.0)

#### 9.1 Theme Engine (White-Label Support)
Remove all hardcoded branding. Read UI text, tier names, and styling from `config/community-theme.yaml`:

```yaml
active_theme: "sietch"  # Options: sietch, corporate, dao, minimal

themes:
  sietch:
    tiers:
      none: { name: "Outsider", emoji: "🏜️" }
      low: { name: "Naib", emoji: "⭐" }
      high: { name: "Fedaykin", emoji: "🏆" }
    features:
      conviction_score: "Spice Conviction"
      badge: "Sietch Score Badge"
    messages:
      welcome: "Welcome to the Sietch, {username}."
      badge_display: "⚡ {score} | {tier}"
  
  corporate:
    tiers:
      none: { name: "Guest", emoji: "👤" }
      low: { name: "Member", emoji: "✓" }
      high: { name: "VIP", emoji: "⭐" }
```

**Usage:** `theme.getTierName('high')` → Returns themed name based on active theme.

#### 9.2 Rules Engine (Multi-Chain Token Gating)
Abstract conviction logic to support any of Collab.Land's 50+ blockchains:

```yaml
rule_sets:
  default:
    mode: "weighted"  # all, any, or weighted
    conditions:
      - id: token_balance
        dataSource: token_balance
        chain: ethereum
        contractAddress: "0x..."
        operator: gte
        value: 1000
        multiplier: 0.35
      - id: governance
        dataSource: governance_votes
        operator: gte
        value: 0
        multiplier: 0.25
    thresholds:
      none: { maxScore: 99 }
      low: { minScore: 100, maxScore: 499 }
      high: { minScore: 500 }
```

**Usage:** `rulesEngine.evaluate('default', { walletAddress: '0x...' })`

#### 9.3 Observability (OpenTelemetry / Google SRE)
Enterprise-grade monitoring with structured logging and distributed tracing:

```typescript
// Tracing
await obs.withSpan('conviction.calculate', async (span) => {
  span.setAttribute('wallet', walletAddress);
  const score = await calculateScore(wallet);
  return score;
});

// Metrics
obs.counter('webhook_events_processed', 1, { type: eventType });
obs.histogram('api_request_duration_ms', durationMs, { path });

// Structured Logging
obs.info('verification.completed', {
  userId: identity.id,
  platform: 'discord',
  traceId: obs.getCurrentTraceId(),
});
```

#### 9.4 Data Lifecycle Management (GDPR Auto-Purge)
Automated PII retention enforcement:

| Data Type | Retention | Legal Basis |
|-----------|-----------|-------------|
| Verification Sessions | 7 days | Contract performance |
| Activity Events | 30 days | Legitimate interest |
| Audit Logs | 365 days | Legal obligation |
| Badge Cache | 1 day | Performance optimization |

```bash
# Run purge jobs
npm run data:purge           # Execute purge
npm run data:purge -- --dry  # Dry run (preview)
npm run data:report          # Retention report
```

#### 9.5 Deployment Gate (Quality Gate Enforcement)
**BLOCKS DEPLOYMENT** when:
1. System Zone integrity violation (SHA-256 mismatch)
2. TruffleHog detects secrets in codebase
3. Tech Lead approval missing
4. Security Auditor approval missing

```bash
# Check deployment readiness
npm run gate:check

# Record approvals
npm run gate:approve -- --tech-lead --by=alice
npm run gate:approve -- --security --by=bob

# Reset for new release
npm run gate:reset
```

**Report Output:**
```
╔═══════════════════════════════════════════════════════════════════════════╗
║                      DEPLOYMENT GATE REPORT                               ║
╠═══════════════════════════════════════════════════════════════════════════╣
║  Can Deploy: ❌ NO                                                        ║
╠═══════════════════════════════════════════════════════════════════════════╣
║  CHECKS:                                                                  ║
║  ✅ [REQ] System Zone Integrity   42 files verified, no violations        ║
║  ✅ [REQ] Secrets Scan            TruffleHog Clean - No secrets detected  ║
║  ❌ [REQ] Tech Lead Approval      Awaiting Tech Lead approval             ║
║  ⏳ [REQ] Security Auditor        Awaiting Security Auditor approval      ║
╚═══════════════════════════════════════════════════════════════════════════╝
```

#### 9.6 Idempotent Webhook Handler
Enterprise-grade webhook processing with deduplication:

```typescript
// Prevents duplicate processing
const result = await webhookService.processEvent(stripeEvent);
// result.status: 'new' | 'duplicate' | 'locked' | 'failed'

// Features:
// - Redis-based idempotency (24h deduplication window)
// - Distributed locking (prevents concurrent processing)
// - Dead letter queue for failed events
// - Automatic retry with exponential backoff
```

#### 9.7 Event-Driven Architecture (GCP Cloud Tasks Ready)
Configuration for transitioning from polling to real-time:

```yaml
# config/event-driven.yaml
event_bus:
  provider: "gcp_cloud_tasks"
  queues:
    conviction_updates:
      rate_limits:
        max_dispatches_per_second: 100
      retry_config:
        max_attempts: 5
        min_backoff: "1s"

fault_tolerance:
  rpc_outage_grace:
    enabled: true
    grace_period_hours: 24
    behavior_during_outage:
      - skip_conviction_decay
      - preserve_current_roles
```

#### 9.8 Fault Tolerance (RPC Outage Handling)
24-hour grace period for blockchain node outages:
- Skip conviction decay during outage
- Preserve current role assignments
- Queue pending syncs for recovery
- Circuit breaker for external services (Collab.Land, Stripe, Dune)

## Deliverables

1. **Project Structure** following Three-Zone Model
2. **Configuration Schema** (`conviction-metrics.yaml`) for server owners
3. **Integrity System** with checksum generation/verification
4. **API Specification** for identity, conviction, profile, directory endpoints
5. **Platform Bots** with slash commands and inline menus
6. **Terraform Configuration** for GCP deployment
7. **CI/CD Pipeline** with Quality Gates enforcement
8. **Billing Integration** with Stripe webhooks and entitlement checks
9. **Gatekeeper Service** for feature access control
10. **GDPR Compliance** with data residency, export/delete endpoints, DPA template
11. **Theme Engine** for white-label branding (NEW v2.4)
12. **Rules Engine** for configurable token-gating (NEW v2.4)
13. **Observability Layer** with OpenTelemetry integration (NEW v2.4)
14. **Data Lifecycle Service** with auto-purge jobs (NEW v2.4)
15. **Deployment Gate** with TruffleHog + integrity checks (NEW v2.4)

## Reference Artifacts

The following documents define the complete specification:
- ARCHITECTURE_REPORT.md - File tree and component overview
- state/PRD.md - Product requirements and user personas
- state/SDD.md - Technical architecture and API specs
- loa.yaml - Framework manifest
- config/conviction-metrics.yaml - Conviction engine configuration
- config/subscription-tiers.yaml - Billing tier configuration
- config/community-theme.yaml - White-label branding configuration (NEW v2.4)
- config/event-driven.yaml - Event-driven architecture config (NEW v2.4)
- config/data-residency.yaml - GDPR and data sovereignty configuration
- docs/legal/DPA_TEMPLATE.md - Data Processing Agreement template

Generate the initial project structure and validate against these artifacts.
```

---

## EXTENDED PROMPT (Full Context)

For implementations requiring complete specification:

```
You are an enterprise software architect operating within the Loa managed scaffolding 
framework. Implement "Sietch Unified" - a cross-platform community management system.

## ARCHITECTURAL PRINCIPLES

### Three-Zone Model (Mandatory)

┌─────────────────────────────────────────────────────────────────┐
│                    ZONE ARCHITECTURE                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  SYSTEM ZONE (Immutable)          STATE ZONE (Preserved)        │
│  ─────────────────────────        ──────────────────────        │
│  system/                          state/                         │
│  ├── core/                        ├── PRD.md                     │
│  │   ├── integrity.ts             ├── SDD.md                     │
│  │   └── framework.ts             ├── grimoire.yaml              │
│  └── .claude/                     └── checksums.json             │
│                                                                  │
│  • SHA-256 protected              • Backed up before updates     │
│  • Overwritten on updates         • Never modified by framework  │
│  • CI fails on tampering          • Contains project memory      │
│                                                                  │
│  APP ZONE (Developer-Owned)                                      │
│  ─────────────────────────                                       │
│  app/                                                            │
│  packages/*/src/custom/                                          │
│                                                                  │
│  • Your business logic                                           │
│  • Never touched by Loa                                          │
│  • Full developer control                                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

### Identity Architecture (AccountKit)

┌─────────────────────────────────────────────────────────────────┐
│                    UNIFIED IDENTITY                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│         ┌─────────────┐                                          │
│         │   Wallet    │  ← Source of Truth                       │
│         │ 0xABC...123 │                                          │
│         └──────┬──────┘                                          │
│                │                                                 │
│    ┌───────────┼───────────┐                                     │
│    │           │           │                                     │
│    ▼           ▼           ▼                                     │
│ ┌──────┐  ┌──────────┐  ┌──────┐                                │
│ │Discord│  │ Telegram │  │ More │                                │
│ │UID:   │  │ UID:     │  │ ...  │                                │
│ │123456 │  │ 789012   │  │      │                                │
│ └──────┘  └──────────┘  └──────┘                                │
│                                                                  │
│  Collab.Land AccountKit bridges all platform identities          │
│  to a single cryptographically-verified wallet address.          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

### Quality Gates (Mandatory)

┌─────────────────────────────────────────────────────────────────┐
│                    DEPLOYMENT GATES                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  PR Created                                                      │
│      │                                                           │
│      ▼                                                           │
│  ┌─────────────────────────────────────────────┐                │
│  │  GATE 1: Automated Checks                   │                │
│  │  • Integrity verification (checksums)       │                │
│  │  • Type checking (tsc --noEmit)             │                │
│  │  • Linting (ESLint)                         │                │
│  │  • Unit tests                               │                │
│  │  • Secret scanning (TruffleHog + Gitleaks)  │                │
│  └─────────────────────────────────────────────┘                │
│      │                                                           │
│      ▼ All pass                                                  │
│  ┌─────────────────────────────────────────────┐                │
│  │  GATE 2: Tech Lead Review                   │                │
│  │  • Architecture validation                  │                │
│  │  • Code quality assessment                  │                │
│  │  • Performance review                       │                │
│  │  → Requires "APPROVED" status               │                │
│  └─────────────────────────────────────────────┘                │
│      │                                                           │
│      ▼ Approved                                                  │
│  ┌─────────────────────────────────────────────┐                │
│  │  GATE 3: Security Auditor                   │                │
│  │  • Security-sensitive file review           │                │
│  │  • Dependency audit                         │                │
│  │  • OWASP compliance check                   │                │
│  │  → Requires "APPROVED" status               │                │
│  └─────────────────────────────────────────────┘                │
│      │                                                           │
│      ▼ Approved                                                  │
│  ┌─────────────────────────────────────────────┐                │
│  │  ✅ DEPLOY TO PRODUCTION                    │                │
│  └─────────────────────────────────────────────┘                │
│                                                                  │
│  ⚠️  NO DEPLOYMENT WITHOUT DUAL APPROVAL                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

### Subscription Billing Architecture (NEW)

┌─────────────────────────────────────────────────────────────────┐
│                    BILLING FLOW                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   User Action                 Stripe                    Backend  │
│   ───────────                 ──────                    ───────  │
│        │                         │                         │     │
│        │  Subscribe              │                         │     │
│        │────────────────────────►│                         │     │
│        │                         │                         │     │
│        │                         │  checkout.completed     │     │
│        │                         │────────────────────────►│     │
│        │                         │                         │     │
│        │                         │                    ┌────┴────┐│
│        │                         │                    │ Verify  ││
│        │                         │                    │ HMAC    ││
│        │                         │                    │ Sig     ││
│        │                         │                    └────┬────┘│
│        │                         │                         │     │
│        │                         │                    ┌────┴────┐│
│        │                         │                    │ Update  ││
│        │                         │                    │ Entitle ││
│        │                         │                    │ -ments  ││
│        │                         │                    └────┬────┘│
│        │                         │                         │     │
│        │◄──────────────────────────────────────────────────│     │
│        │  Roles Granted                                    │     │
│                                                                  │
│   ─────────────────────────────────────────────────────────────  │
│                                                                  │
│   Payment Failed Flow (with Grace Period)                        │
│                                                                  │
│        │                         │  invoice.payment_failed │     │
│        │                         │────────────────────────►│     │
│        │                         │                         │     │
│        │                         │                    ┌────┴────┐│
│        │                         │                    │ Start   ││
│        │                         │                    │ 24hr    ││
│        │                         │                    │ Grace   ││
│        │                         │                    └────┬────┘│
│        │                         │                         │     │
│        │◄──────────────────────────────────────────────────│     │
│        │  Warning: Payment failed, 24hr to resolve         │     │
│        │                                                   │     │
│        │  [After 24hr + no payment]                        │     │
│        │                         │  subscription.deleted   │     │
│        │                         │────────────────────────►│     │
│        │                         │                         │     │
│        │                         │                    ┌────┴────┐│
│        │                         │                    │ Revoke  ││
│        │                         │                    │ Access  ││
│        │                         │                    │ (Soft)  ││
│        │                         │                    └────┬────┘│
│        │                         │                         │     │
│        │◄──────────────────────────────────────────────────│     │
│        │  Access revoked, settings preserved               │     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

### Gatekeeper Service Architecture

┌─────────────────────────────────────────────────────────────────┐
│                    GATEKEEPER SERVICE                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Request for Protected Feature                                  │
│        │                                                         │
│        ▼                                                         │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  1. AccountKit Check                                     │   │
│   │     GET /account/me                                      │   │
│   │     → Verify wallet, get linked accounts                 │   │
│   └─────────────────────────────────────────────────────────┘   │
│        │                                                         │
│        ▼                                                         │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  2. Redis Cache Check                                    │   │
│   │     Key: entitlement:{communityId}                       │   │
│   │     → Fast path if cached (TTL: 5 min)                   │   │
│   └─────────────────────────────────────────────────────────┘   │
│        │                                                         │
│        ▼ Cache miss                                              │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  3. PostgreSQL Lookup                                    │   │
│   │     SELECT tier, grace_until, features                   │   │
│   │     FROM subscriptions WHERE community_id = ?            │   │
│   └─────────────────────────────────────────────────────────┘   │
│        │                                                         │
│        ▼                                                         │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  4. Feature Gate Decision                                │   │
│   │                                                          │   │
│   │     if (tier >= requiredTier) → ALLOW                    │   │
│   │     else if (inGracePeriod)   → ALLOW + WARN             │   │
│   │     else                      → DENY + UPGRADE_PROMPT    │   │
│   │                                                          │   │
│   └─────────────────────────────────────────────────────────┘   │
│        │                                                         │
│        ▼                                                         │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  5. Update Cache & Return                                │   │
│   │     SET entitlement:{communityId} = result               │   │
│   │     EXPIRE 300                                           │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

### Feature Gating Matrix

┌────────────────────┬────────┬───────┬─────────┬───────────┬───────┬────────────┐
│ Feature            │ Starter│ Basic │ Premium │ Exclusive │ Elite │ Enterprise │
├────────────────────┼────────┼───────┼─────────┼───────────┼───────┼────────────┤
│ Verified Members   │ 25     │ 500   │ 1,000   │ 2,500     │ 7,500 │ Unlimited  │
├────────────────────┼────────┼───────┼─────────┼───────────┼───────┼────────────┤
│ Basic TGRs         │ ✅      │ ✅     │ ✅       │ ✅         │ ✅     │ ✅          │
│ Background Checks  │ ❌      │ ✅     │ ✅       │ ✅         │ ✅     │ ✅          │
│ Role Composition   │ ❌      │ ❌     │ ✅       │ ✅         │ ✅     │ ✅          │
│ Conviction Engine  │ ❌      │ ❌     │ ✅       │ ✅         │ ✅     │ ✅          │
│ Member Directory   │ ❌      │ ❌     │ ✅       │ ✅         │ ✅     │ ✅          │
│ Admin Balance Check│ ❌      │ ❌     │ ❌       │ 5/mo      │ 20/mo │ Unlimited  │
│ AI Quiz Agent      │ ❌      │ ❌     │ ❌       │ ❌         │ ✅     │ ✅          │
│ White-label        │ ❌      │ ❌     │ ❌       │ ❌         │ ❌     │ ✅          │
│ Dedicated Support  │ ❌      │ ❌     │ ❌       │ ✅         │ ✅     │ ✅ (Slack)  │
└────────────────────┴────────┴───────┴─────────┴───────────┴───────┴────────────┘

## TECHNICAL STACK

| Layer | Technology | Rationale |
|-------|------------|-----------|
| HTTP Framework | **Hono** | Ultrafast, lightweight, Edge-ready |
| Discord SDK | **discord.js v14** | Modern, maintained, full API coverage |
| Telegram SDK | **grammY** | TypeScript-first, Mini App support |
| Database ORM | **Prisma** | Type-safe, migrations, multi-DB |
| Task Queue | **trigger.dev** | Serverless background jobs |
| Infrastructure | **Terraform** | IaC for GCP |
| Runtime | **Node.js 20+** | LTS, modern features |
| Package Manager | **pnpm** | Fast, efficient, monorepo support |
| **Billing** | **Stripe SDK** | Payment processing, subscriptions |
| **Webhooks** | **BuildShip** | Visual webhook automation |
| **Identity** | **AccountKit** | Collab.Land unified identity |

## IMPLEMENTATION PHASES

### Phase 1: Foundation
```bash
# Initialize monorepo
pnpm init
pnpm add -D turbo typescript @types/node

# Create Three-Zone structure
mkdir -p system/core state app config
mkdir -p packages/{server,discord-bot,telegram-bot,telegram-miniapp,shared}

# Implement integrity system
touch system/core/integrity.ts   # SHA-256 checksum verification
touch system/core/framework.ts   # Loa framework core
touch state/grimoire.yaml        # Project memory
```

### Phase 2: Backend Services
```typescript
// packages/server/src/index.ts - Hono backend
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'

const app = new Hono()

app.use('*', cors())
app.use('*', logger())

// Identity endpoints
app.post('/api/identity/session', IdentityController.createSession)
app.post('/api/identity/session/:id/complete', IdentityController.completeSession)

// Conviction endpoints  
app.get('/api/conviction/:wallet', ConvictionController.evaluate)

// Profile endpoints
app.get('/api/profile/discord/:id', ProfileController.getByDiscord)
app.get('/api/profile/telegram/:id', ProfileController.getByTelegram)
app.put('/api/profile/nym', ProfileController.updateNym)

// Directory endpoint
app.get('/api/directory', DirectoryController.browse)

// Admin endpoints (API key required)
app.post('/admin/refresh-rankings', AdminController.refreshRankings)
app.get('/admin/stats', AdminController.getStats)

export default app
```

### Phase 3: Platform Integration
```typescript
// Discord bot with slash commands
const commands = [
  { name: 'verify', description: 'Verify your wallet' },
  { name: 'profile', description: 'View your profile' },
  { name: 'rank', description: 'Check your conviction rank' },
  { name: 'leaderboard', description: 'View top members' },
  { name: 'directory', description: 'Browse member directory' },
]

// Telegram bot with grammY
bot.command('start', ctx => ctx.reply('Welcome to Sietch!'))
bot.command('verify', ctx => launchMiniApp(ctx))
bot.command('profile', ctx => showProfile(ctx))
bot.command('rank', ctx => showRank(ctx))
```

### Phase 4: Enterprise Hardening
```hcl
# infrastructure/terraform/main.tf
resource "google_cloud_run_service" "api" {
  name     = "sietch-api"
  location = var.region
  
  template {
    spec {
      containers {
        image = var.api_image
        
        env {
          name = "DATABASE_URL"
          value_from {
            secret_key_ref {
              name = google_secret_manager_secret.database.secret_id
              key  = "latest"
            }
          }
        }
      }
    }
    
    metadata {
      annotations = {
        "run.googleapis.com/vpc-access-connector" = google_vpc_access_connector.connector.id
      }
    }
  }
}
```

## VALIDATION CHECKLIST

Before considering implementation complete:

- [ ] `pnpm install` - Dependencies install without errors
- [ ] `pnpm build` - All packages build successfully
- [ ] `pnpm integrity:verify` - System zone checksums valid
- [ ] `pnpm typecheck` - No TypeScript errors
- [ ] `pnpm lint` - No linting errors
- [ ] `pnpm test` - All tests pass
- [ ] `terraform validate` - Infrastructure config valid
- [ ] Quality Gates workflow functional
- [ ] CODEOWNERS enforces review requirements
- [ ] No secrets in codebase (TruffleHog clean)

## REFERENCE ARTIFACTS

Analyze these files from sietch-unified.zip:

| File | Purpose |
|------|---------|
| `ARCHITECTURE_REPORT.md` | Complete file tree, component diagrams |
| `state/PRD.md` | Product requirements, user personas |
| `state/SDD.md` | Technical architecture, API specs |
| `loa.yaml` | Framework manifest, zone definitions |
| `config/conviction-metrics.yaml` | Conviction engine configuration |
| `infrastructure/terraform/*.tf` | GCP deployment configuration |
| `.github/workflows/quality-gates.yml` | CI/CD with dual approval |

Generate implementation matching these specifications.
```

---

## CONDENSED PROMPT (Single Message)

For quick bootstrapping:

```
Loa: Build Sietch Unified (Discord + Telegram community tool) with:

ARCHITECTURE (AWS):
• Three-Zone: system/ (immutable, checksums) | state/ (PRD/SDD) | app/ (your code)
• Integrity enforcement via SHA-256, CI fails on tampering

IDENTITY (Microsoft):  
• Collab.Land AccountKit = Global Identity Provider
• Discord UID ↔ Telegram UID ↔ Wallet (single source of truth)

STACK (Modern):
• Hono (HTTP) + discord.js v14 + grammY + Prisma + Stripe SDK
• Node 20 + pnpm + Turborepo

LOGIC:
• Conviction: BGT (40%) + Governance (30%) + Engagement (30%)
• Tiers: Naib (1-7), Fedaykin (8-69), None (70+)
• Demurrage: 10% decay / 6 hours

BILLING (Stripe):
• Tier alignment: Starter → Basic → Premium → Exclusive → Elite → Enterprise
• Gatekeeper service: Redis-cached entitlements (5min TTL)
• Grace period: 24-72hr for failed payments
• Webhook handlers: Idempotent processing with Redis deduplication
• Self-service: Stripe Customer Portal + Telegram Mini App
• Fee waivers: Owner-granted complimentary access (bypasses Stripe)
• Sietch Score Badge: Display conviction in chats (Premium+ free, lower tiers $4.99)
• Community Boosts: Discord-style collective funding ($2.99/mo per boost)
  - Level 1 (2 boosts) = Basic, Level 2 (7) = Premium, Level 3 (14) = Exclusive, Level 4 (30) = Elite

ENTERPRISE ABSTRACTION (v2.4.0):
• Theme Engine: White-label via config/community-theme.yaml
• Rules Engine: Multi-chain token gating via config/conviction-metrics.yaml
• Observability: OpenTelemetry tracing, structured logging, SLI/SLO metrics
• Data Lifecycle: 30-day PII auto-purge, 7-day session expiry
• Deployment Gate: Integrity + TruffleHog + dual approval required
• Event-Driven: GCP Cloud Tasks config ready (config/event-driven.yaml)
• Fault Tolerance: 24hr RPC outage grace, circuit breaker for external services

ENTERPRISE RESILIENCE (v2.5.0):
• Cloud Tasks: Real-time role sync on Stripe/CollabLand events (not polling)
• Circuit Breaker: Netflix-style pattern for CollabLand, Stripe, Dune, RPC
• Dead Letter Queue: Webhook retry with 5-stage exponential backoff
• Regional Databases: Multi-region PostgreSQL (US/EU/Asia) for GDPR sovereignty
• AccountKit Provider: Rules Engine pulls from 50+ chains via unified API
• Grace Period: Members keep roles during 24hr outages (no accidental stripping)

FRAMEWORK HARDENING (v2.6.0):
• Overrides Protocol: Customize framework via overrides/ without touching System Zone
• Hard Blocks: Critical violations (integrity, secrets) immediately halt CI/CD
• Severity-Based Gates: Violations categorized as Critical/High/Warning/Info
• Protected Paths: .claude/, system/core/, loa.yaml cannot be modified
• SDK Clarification: Using discord.js + grammY (not legacy Bot Framework)

COMPLIANCE & RESILIENCE MATURITY (v2.7.0):
• Lint-on-Synthesis: Blocks App Zone code from importing System Zone internals
• PII Audit Log: GDPR Article 15-22 "Data Passport" trail for all PII access
• Stale-Cache-Optimistic: Circuit breaker grace period uses cached verification
• 8 Deployment Checks: Integrity, secrets, protected paths, lint, deps, branch, approvals

PRODUCTION READY (v2.8.0):
• Data Passport API: GET /api/gdpr/data-passport for automated compliance
• Boost Sustain Period: 7-day grace period when community boost level drops
• Region Map Config: config/region-map.yaml for GCP location provisioning
• Country Mappings: ISO 3166-1 alpha-2 codes to data regions (EU/US/Asia)
• Failover Config: Regional database failover rules and timeouts

ENTERPRISE COMPLETE (v2.9.0):
• All Previous Limitations Resolved: See ARCHITECTURE_SPEC Section 15
• Event-Driven Architecture: 100% reactive, no polling-based updates
• Regional Database Clusters: Isolated PostgreSQL + Redis per jurisdiction
• Circuit Breaker Coverage: 4 external services protected with grace periods
• Security Gate Coverage: 8 deployment checks with hard blocks
• SDK Status: Modern stack (discord.js v14, grammY, Hono, Prisma)

SECURITY:
• Quality Gates: Tech Lead + Security Auditor (both must APPROVE)
• Secret scanning: TruffleHog + Gitleaks
• 1Password + GCP Secret Manager (Stripe keys included)

INFRA (Google):
• Cloud Run (serverless) + Cloud SQL + Memorystore
• Regional deployment (GDPR) + 24hr grace period

GDPR (EU Standard):
• Regional data residency: us/eu/asia (cannot change after setup)
• Data subject rights: /api/gdpr/export, /api/gdpr/delete, /api/gdpr/opt-out
• Retention: Activity 30d, Sessions 7d, History 90d, Audit 365d
• DPA template for enterprise/EU communities
• Audit logging for all PII access

Generate: Project structure + conviction-metrics.yaml + subscription-tiers.yaml + Gatekeeper service.
```

---

## USAGE MATRIX

| Context | Prompt Version | Artifacts Needed |
|---------|----------------|------------------|
| **claude-cli** | Primary Prompt | loa.yaml + conviction-metrics.yaml |
| **Claude.ai** | Extended Prompt | Full zip contents |
| **Quick Start** | Condensed Prompt | None (self-contained) |
| **Code Review** | Validation Checklist | Existing implementation |

---

## EXPECTED OUTPUT

When executed correctly, Loa should produce:

```
sietch-unified/
├── system/                     # IMMUTABLE (checksums enforced)
│   ├── core/
│   │   ├── integrity.ts        # SHA-256 verification
│   │   └── framework.ts        # Loa core
│   └── .claude/                # Framework config
│
├── state/                      # PRESERVED (backed up)
│   ├── PRD.md                  # Product requirements
│   ├── SDD.md                  # Technical design
│   ├── grimoire.yaml           # Project memory
│   └── checksums.json          # Integrity manifest
│
├── app/                        # DEVELOPER-OWNED
│   └── (custom extensions)
│
├── packages/
│   ├── server/                 # Hono API
│   ├── discord-bot/            # discord.js v14
│   ├── telegram-bot/           # grammY
│   ├── telegram-miniapp/       # React + TWA
│   └── shared/                 # Types + utils
│
├── infrastructure/
│   └── terraform/              # GCP IaC
│
├── .github/
│   ├── workflows/
│   │   ├── ci-cd.yml           # Build + deploy
│   │   └── quality-gates.yml   # Dual approval
│   └── CODEOWNERS              # Review enforcement
│
├── config/
│   └── conviction-metrics.yaml # Configurable scoring
│
└── loa.yaml                    # Framework manifest
```

---

## VERIFICATION COMMANDS

```bash
# Full validation sequence
pnpm install
pnpm db:generate
pnpm build
pnpm integrity:verify
pnpm typecheck
pnpm lint
pnpm test
cd infrastructure/terraform && terraform init && terraform validate
pnpm loa:status
```

---

*Prompt version: 2.9.0*  
*Enterprise status: TIER 1 COMPLETE - All major enterprise features implemented*  
*Enterprise standards: AWS + Microsoft + Google + EU GDPR aligned*  
*Quality gates: Tech Lead + Security Auditor (dual approval with TruffleHog)*  
*Hard Block: Critical violations (integrity, secrets) immediately halt build*  
*Lint-on-Synthesis: Blocks App Zone from importing System Zone internals*  
*PII Audit Log: GDPR Article 15-22 "Data Passport" trail for all access*  
*Data Passport API: Automated /api/gdpr/data-passport endpoint*  
*Stale-Cache-Optimistic: 24hr grace period uses cached verification data*  
*Sustain Period: 7-day buffer when community boost levels drop*  
*Region Map: GCP location mapping for regional database provisioning*  
*Overrides Protocol: Safe framework customization via overrides/ directory*  
*Subscription billing: Stripe integration with Collab.Land tier alignment*  
*Fee waivers: Owner-granted complimentary access for partners/beta testers*  
*Score badges: User-visible conviction display in Discord/Telegram chats*  
*Community boosts: Discord-style collective funding with sustain period*  
*Theme Engine: White-label branding without code changes*  
*Rules Engine: Configurable token-gating across 50+ chains via AccountKit*  
*Observability: OpenTelemetry tracing, structured logging, SLI/SLO metrics*  
*Data Lifecycle: 30-day PII auto-purge, 7-day session expiry*  
*Deployment Gate: 8 checks with severity-based violations and hard blocks*  
*Event-Driven: GCP Cloud Tasks for real-time role sync (no polling)*  
*Circuit Breaker: 24hr grace period with stale-cache fallback*  
*Regional Databases: Multi-region PostgreSQL for GDPR data sovereignty*  
*Dead Letter Queue: Webhook retry with 5-stage exponential backoff*  
*SDK Status: Modern SDKs (discord.js v14, grammY) - not legacy Bot Framework*  
*GDPR compliance: Regional data residency, data subject rights, DPA template*  
*All previous limitations resolved: See ARCHITECTURE_SPEC Section 15*  
*Generated: December 26, 2024*
