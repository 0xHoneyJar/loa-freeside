# Software Design Document: Sietch

**Version**: 1.0
**Date**: December 17, 2025
**Status**: Draft
**PRD Reference**: `docs/prd.md`

---

## 1. Executive Summary

Sietch is a token-gated Discord community service that manages access for the top 69 BGT holders who have never redeemed their tokens. The system consists of:

1. **Sietch Service** - A TypeScript/Node.js application that queries Dune Analytics for eligibility data, caches results in SQLite, exposes a REST API for Collab.Land, and manages Discord notifications via a built-in bot.

2. **Collab.Land Integration** - Token gating that queries the Sietch Service API to assign Discord roles (Naib, Fedaykin) based on wallet verification.

3. **Discord Server** - The community platform with role-based channel access.

The architecture prioritizes simplicity, minimal maintenance, and reliability with graceful degradation during upstream outages.

---

## 2. System Architecture

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Sietch Service                                 │
│                        (TypeScript/Node.js)                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │  Scheduler  │  │  REST API   │  │ Discord Bot │  │   SQLite    │    │
│  │  (node-cron)│  │  (Express)  │  │ (discord.js)│  │   Cache     │    │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘    │
│         │                │                │                │            │
└─────────┼────────────────┼────────────────┼────────────────┼────────────┘
          │                │                │                │
          ▼                │                ▼                │
┌─────────────────┐        │        ┌─────────────────┐      │
│   Dune API      │        │        │  Discord API    │      │
│  (Query Source) │        │        │  (Notifications)│      │
└─────────────────┘        │        └─────────────────┘      │
                           │                                  │
                           ▼                                  │
                   ┌─────────────────┐                       │
                   │   Collab.Land   │◀──────────────────────┘
                   │  (Role Gating)  │   (reads eligibility)
                   └────────┬────────┘
                            │
                            ▼
                   ┌─────────────────┐
                   │  Discord Server │
                   │    (Sietch)     │
                   └─────────────────┘
```

### 2.2 Component Interactions

```
┌──────────────────────────────────────────────────────────────────┐
│                        Every 6 Hours                              │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Scheduler ──▶ Dune API ──▶ Parse Results ──▶ SQLite Cache       │
│                                    │                              │
│                                    ▼                              │
│                          Diff with Previous                       │
│                                    │                              │
│                    ┌───────────────┼───────────────┐              │
│                    ▼               ▼               ▼              │
│              New Members     Removed Members   Role Changes       │
│                    │               │               │              │
│                    ▼               ▼               ▼              │
│              Post to         DM Member +      Update Role         │
│              #the-door       Post to          Post to             │
│                              #the-door        #the-door           │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│                    Collab.Land Verification                       │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  User connects wallet ──▶ Collab.Land ──▶ GET /eligibility       │
│                                                ▼                  │
│                                          Check address            │
│                                                │                  │
│                          ┌─────────────────────┼─────────────────┐│
│                          ▼                     ▼                 ▼│
│                     In top_7            In top_69           Not in│
│                          │                     │              list│
│                          ▼                     ▼                 ▼│
│                    Assign Naib         Assign Fedaykin      Deny  │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

---

## 3. Technology Stack

| Layer | Technology | Justification |
|-------|------------|---------------|
| **Runtime** | Node.js 20 LTS | Stable, async-native, large ecosystem |
| **Language** | TypeScript 5.x | Type safety, better maintainability |
| **Web Framework** | Express.js | Simple, well-documented, minimal overhead |
| **Database** | SQLite (better-sqlite3) | Zero config, file-based, supports queries |
| **Discord Library** | discord.js v14 | Official library, full API coverage |
| **Scheduler** | node-cron | Simple cron syntax, reliable |
| **HTTP Client** | axios | Promise-based, interceptors for retry |
| **Process Manager** | PM2 | Auto-restart, log management, monitoring |
| **Reverse Proxy** | nginx | SSL termination, rate limiting |

### 3.1 Project Structure

```
sietch-service/
├── src/
│   ├── index.ts              # Application entry point
│   ├── config.ts             # Environment configuration
│   ├── api/
│   │   ├── routes.ts         # Express route definitions
│   │   ├── middleware.ts     # Auth, rate limiting, error handling
│   │   └── handlers/
│   │       ├── eligibility.ts
│   │       ├── health.ts
│   │       └── admin.ts
│   ├── services/
│   │   ├── dune.ts           # Dune API client
│   │   ├── eligibility.ts    # Core eligibility logic
│   │   ├── scheduler.ts      # Cron job management
│   │   └── discord.ts        # Discord bot & notifications
│   ├── db/
│   │   ├── schema.ts         # SQLite schema definitions
│   │   ├── migrations/       # Schema migrations
│   │   └── queries.ts        # Database access layer
│   ├── types/
│   │   └── index.ts          # TypeScript type definitions
│   └── utils/
│       ├── logger.ts         # Structured logging
│       └── errors.ts         # Custom error classes
├── tests/
│   ├── unit/
│   └── integration/
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

---

## 4. Component Design

### 4.1 Scheduler Service

**Purpose**: Execute Dune queries on a 6-hour cadence and trigger eligibility updates.

```typescript
// src/services/scheduler.ts

interface SchedulerConfig {
  cronExpression: string;  // "0 */6 * * *" (every 6 hours)
  onTick: () => Promise<void>;
  onError: (error: Error) => void;
}

class SchedulerService {
  private job: CronJob;
  private isRunning: boolean = false;

  async runEligibilityUpdate(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Skipping update - previous run still in progress');
      return;
    }

    this.isRunning = true;
    try {
      // 1. Fetch from Dune
      const duneResult = await duneService.executeQuery();

      // 2. Get previous state
      const previousState = await db.getLatestEligibilitySnapshot();

      // 3. Compute diff
      const diff = computeEligibilityDiff(previousState, duneResult);

      // 4. Store new state
      await db.saveEligibilitySnapshot(duneResult);

      // 5. Process changes
      await discordService.processEligibilityChanges(diff);

      // 6. Update health status
      await db.updateHealthStatus({ lastSuccessfulQuery: new Date() });

    } catch (error) {
      await this.handleUpdateError(error);
    } finally {
      this.isRunning = false;
    }
  }

  private async handleUpdateError(error: Error): Promise<void> {
    logger.error('Eligibility update failed', { error });

    // Check if we should enter grace period
    const lastSuccess = await db.getLastSuccessfulQuery();
    const hoursSinceSuccess = getHoursSince(lastSuccess);

    if (hoursSinceSuccess >= 24) {
      logger.warn('Grace period exceeded - manual intervention required');
      // Alert admin but don't revoke access
    }
  }
}
```

### 4.2 Dune Service

**Purpose**: Interface with Dune Analytics API to fetch eligibility data.

```typescript
// src/services/dune.ts

interface DuneConfig {
  apiKey: string;
  queryId: string;        // Pre-saved query ID on Dune
  maxRetries: number;
  retryDelayMs: number;
}

interface DuneResult {
  rows: Array<{
    recipient: string;    // Wallet address
    bgt_held: number;     // BGT balance
  }>;
  executedAt: Date;
}

class DuneService {
  private client: AxiosInstance;

  constructor(config: DuneConfig) {
    this.client = axios.create({
      baseURL: 'https://api.dune.com/api/v1',
      headers: { 'X-Dune-API-Key': config.apiKey },
      timeout: 60000,  // Dune queries can be slow
    });
  }

  async executeQuery(): Promise<DuneResult> {
    // Execute fresh query (Plus tier allows this)
    const execution = await this.client.post(
      `/query/${this.config.queryId}/execute`
    );

    // Poll for results
    return await this.pollForResults(execution.data.execution_id);
  }

  private async pollForResults(executionId: string): Promise<DuneResult> {
    const maxAttempts = 30;
    const pollInterval = 2000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const status = await this.client.get(
        `/execution/${executionId}/status`
      );

      if (status.data.state === 'QUERY_STATE_COMPLETED') {
        const results = await this.client.get(
          `/execution/${executionId}/results`
        );
        return this.parseResults(results.data);
      }

      if (status.data.state === 'QUERY_STATE_FAILED') {
        throw new DuneQueryError('Query execution failed');
      }

      await sleep(pollInterval);
    }

    throw new DuneQueryError('Query timed out');
  }
}
```

### 4.3 Discord Service

**Purpose**: Manage Discord bot for notifications and leaderboard updates.

```typescript
// src/services/discord.ts

interface DiscordConfig {
  botToken: string;
  guildId: string;          // Sietch server ID
  channels: {
    theDoor: string;        // #the-door channel ID
    census: string;         // #census channel ID
  };
  roles: {
    naib: string;           // Naib role ID
    fedaykin: string;       // Fedaykin role ID
  };
}

interface EligibilityDiff {
  added: EligibilityEntry[];
  removed: EligibilityEntry[];
  promotedToNaib: EligibilityEntry[];
  demotedFromNaib: EligibilityEntry[];
}

class DiscordService {
  private client: Client;
  private guild: Guild;

  async processEligibilityChanges(diff: EligibilityDiff): Promise<void> {
    // Handle removals (most sensitive)
    for (const entry of diff.removed) {
      await this.handleMemberRemoval(entry);
    }

    // Handle Naib demotions
    for (const entry of diff.demotedFromNaib) {
      await this.handleNaibDemotion(entry);
    }

    // Handle Naib promotions
    for (const entry of diff.promotedToNaib) {
      await this.handleNaibPromotion(entry);
    }

    // Handle new additions (informational only - Collab.Land handles actual access)
    for (const entry of diff.added) {
      await this.announceNewEligible(entry);
    }

    // Post updated leaderboard
    await this.postLeaderboard();
  }

  private async handleMemberRemoval(entry: EligibilityEntry): Promise<void> {
    const member = await this.findMemberByWallet(entry.address);

    if (member) {
      // Send DM before removal
      try {
        await member.send({
          embeds: [this.buildRemovalEmbed(entry)]
        });
      } catch (error) {
        // User may have DMs disabled - log but continue
        logger.warn('Could not DM removed member', { address: entry.address });
      }
    }

    // Post to #the-door
    await this.postToTheDoor({
      type: 'departure',
      address: truncateAddress(entry.address),
      reason: entry.reason,  // 'rank_change' | 'redemption'
      previousRank: entry.previousRank,
    });
  }

  private async postLeaderboard(): Promise<void> {
    const eligibility = await db.getLatestEligibilitySnapshot();
    const channel = await this.guild.channels.fetch(this.config.channels.census);

    const embed = new EmbedBuilder()
      .setTitle('📊 BGT Census')
      .setDescription(`Updated: ${new Date().toISOString()}`)
      .setColor(0x00AE86);

    // Top 7 (Naib)
    const naibList = eligibility.slice(0, 7)
      .map((e, i) => `${i + 1}. \`${truncateAddress(e.address)}\` - ${formatBGT(e.bgt_held)}`)
      .join('\n');
    embed.addFields({ name: '🔥 Naib Council', value: naibList });

    // Remaining Fedaykin
    const fedaykinList = eligibility.slice(7, 69)
      .map((e, i) => `${i + 8}. \`${truncateAddress(e.address)}\` - ${formatBGT(e.bgt_held)}`)
      .join('\n');

    // Split into multiple fields if needed (Discord limit: 1024 chars per field)
    const chunks = chunkString(fedaykinList, 1024);
    chunks.forEach((chunk, idx) => {
      embed.addFields({
        name: idx === 0 ? '⚔️ Fedaykin' : '\u200b',
        value: chunk
      });
    });

    await (channel as TextChannel).send({ embeds: [embed] });
  }
}
```

### 4.4 REST API

**Purpose**: Expose eligibility data to Collab.Land and provide health/admin endpoints.

```typescript
// src/api/routes.ts

const router = express.Router();

// Public endpoint for Collab.Land
router.get('/eligibility', async (req, res) => {
  const snapshot = await db.getLatestEligibilitySnapshot();
  const health = await db.getHealthStatus();

  const top69 = snapshot.slice(0, 69).map((entry, idx) => ({
    rank: idx + 1,
    address: entry.address.toLowerCase(),
    bgt_held: entry.bgt_held,
  }));

  const top7 = top69.slice(0, 7).map(e => e.address);

  res.json({
    updated_at: health.lastSuccessfulQuery,
    grace_period: health.inGracePeriod,
    top_69: top69,
    top_7: top7,
  });
});

// Health check for monitoring
router.get('/health', async (req, res) => {
  const health = await db.getHealthStatus();
  const now = new Date();
  const nextQuery = new Date(health.lastSuccessfulQuery);
  nextQuery.setHours(nextQuery.getHours() + 6);

  res.json({
    status: health.inGracePeriod ? 'degraded' : 'healthy',
    last_successful_query: health.lastSuccessfulQuery,
    next_query: nextQuery.toISOString(),
    grace_period: health.inGracePeriod,
  });
});

// Admin endpoints (protected)
router.use('/admin', adminAuthMiddleware);

router.post('/admin/override', async (req, res) => {
  const { address, action, reason } = req.body;

  await db.createAdminOverride({
    address: address.toLowerCase(),
    action,  // 'add' | 'remove'
    reason,
    createdBy: req.admin.id,
    createdAt: new Date(),
  });

  logger.info('Admin override created', { address, action, reason, admin: req.admin.id });

  res.json({ success: true });
});

router.get('/admin/overrides', async (req, res) => {
  const overrides = await db.getAdminOverrides();
  res.json(overrides);
});

router.get('/admin/audit-log', async (req, res) => {
  const log = await db.getAuditLog({ limit: 100 });
  res.json(log);
});
```

---

## 5. Data Architecture

### 5.1 SQLite Schema

```sql
-- Eligibility snapshots (historical record)
CREATE TABLE eligibility_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  data JSON NOT NULL  -- Full eligibility list as JSON
);

-- Current eligibility (fast lookups)
CREATE TABLE current_eligibility (
  address TEXT PRIMARY KEY,
  rank INTEGER NOT NULL,
  bgt_held REAL NOT NULL,
  role TEXT NOT NULL,  -- 'naib' | 'fedaykin' | 'none'
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_current_eligibility_rank ON current_eligibility(rank);

-- Admin overrides
CREATE TABLE admin_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  address TEXT NOT NULL,
  action TEXT NOT NULL,  -- 'add' | 'remove'
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME,  -- NULL = permanent
  active INTEGER DEFAULT 1
);

CREATE INDEX idx_admin_overrides_address ON admin_overrides(address);
CREATE INDEX idx_admin_overrides_active ON admin_overrides(active);

-- Audit log
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,  -- 'eligibility_update' | 'admin_override' | 'member_removed' | etc.
  event_data JSON NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_log_type ON audit_log(event_type);
CREATE INDEX idx_audit_log_created ON audit_log(created_at);

-- Health status
CREATE TABLE health_status (
  id INTEGER PRIMARY KEY CHECK (id = 1),  -- Single row
  last_successful_query DATETIME,
  last_query_attempt DATETIME,
  consecutive_failures INTEGER DEFAULT 0,
  in_grace_period INTEGER DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Discord wallet mappings (populated by Collab.Land events)
CREATE TABLE wallet_mappings (
  discord_user_id TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  verified_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_wallet_mappings_address ON wallet_mappings(wallet_address);
```

### 5.2 Data Flow

```
┌─────────────┐
│  Dune API   │
└──────┬──────┘
       │ Raw query results
       ▼
┌─────────────────────────────────────────────────────────────┐
│                    Eligibility Processing                    │
├─────────────────────────────────────────────────────────────┤
│  1. Parse Dune results into EligibilityEntry[]              │
│  2. Apply admin overrides (add/remove entries)               │
│  3. Sort by bgt_held descending                              │
│  4. Assign ranks (1-69 or unranked)                         │
│  5. Assign roles (naib: 1-7, fedaykin: 8-69, none: >69)     │
│  6. Compute diff against previous snapshot                   │
└──────┬──────────────────────────────────────────────────────┘
       │
       ├──▶ eligibility_snapshots (historical)
       ├──▶ current_eligibility (fast lookups)
       ├──▶ audit_log (event record)
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│                    REST API Response                         │
├─────────────────────────────────────────────────────────────┤
│  GET /eligibility returns:                                   │
│  - top_69: ranked list with addresses and BGT amounts        │
│  - top_7: just addresses for quick Naib check                │
│  - updated_at: timestamp for cache validation                │
│  - grace_period: boolean for degraded state                  │
└─────────────────────────────────────────────────────────────┘
```

---

## 6. API Design

### 6.1 Public Endpoints

#### GET /eligibility

Returns the current eligibility list for Collab.Land integration.

**Request**:
```
GET /eligibility
Host: sietch-api.example.com
```

**Response** (200 OK):
```json
{
  "updated_at": "2025-12-17T12:00:00.000Z",
  "grace_period": false,
  "top_69": [
    {"rank": 1, "address": "0x1234...abcd", "bgt_held": 50000.123},
    {"rank": 2, "address": "0x5678...efgh", "bgt_held": 45000.456},
    ...
  ],
  "top_7": [
    "0x1234...abcd",
    "0x5678...efgh",
    ...
  ]
}
```

#### GET /health

Health check endpoint for monitoring.

**Response** (200 OK):
```json
{
  "status": "healthy",
  "last_successful_query": "2025-12-17T12:00:00.000Z",
  "next_query": "2025-12-17T18:00:00.000Z",
  "grace_period": false
}
```

**Response** (200 OK, degraded):
```json
{
  "status": "degraded",
  "last_successful_query": "2025-12-16T12:00:00.000Z",
  "next_query": "2025-12-17T18:00:00.000Z",
  "grace_period": true
}
```

### 6.2 Admin Endpoints

All admin endpoints require authentication via API key.

#### POST /admin/override

Create an admin override to add or remove a wallet from eligibility.

**Request**:
```json
{
  "address": "0x1234567890abcdef...",
  "action": "add",
  "reason": "Manual addition for testing"
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "override_id": 123
}
```

#### GET /admin/overrides

List all active admin overrides.

**Response**:
```json
{
  "overrides": [
    {
      "id": 123,
      "address": "0x1234...",
      "action": "add",
      "reason": "Manual addition for testing",
      "created_by": "admin_1",
      "created_at": "2025-12-17T10:00:00.000Z",
      "active": true
    }
  ]
}
```

#### DELETE /admin/override/:id

Deactivate an admin override.

#### GET /admin/audit-log

Retrieve audit log entries.

**Query Parameters**:
- `limit` (optional, default: 100)
- `event_type` (optional, filter by type)
- `since` (optional, ISO timestamp)

---

## 7. Security Architecture

### 7.1 Authentication & Authorization

| Endpoint | Authentication | Authorization |
|----------|----------------|---------------|
| `/eligibility` | None (public) | Read-only, rate limited |
| `/health` | None (public) | Read-only |
| `/admin/*` | API Key | Admin role required |

### 7.2 API Key Management

```typescript
// Admin API keys stored in environment
// Format: ADMIN_API_KEYS=key1:name1,key2:name2

const adminAuthMiddleware = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({ error: 'API key required' });
  }

  const admin = validateApiKey(apiKey);
  if (!admin) {
    return res.status(403).json({ error: 'Invalid API key' });
  }

  req.admin = admin;
  next();
};
```

### 7.3 Rate Limiting

```typescript
// Public endpoints: 100 requests per minute per IP
const publicRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

// Admin endpoints: 30 requests per minute per API key
const adminRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => req.headers['x-api-key'],
});
```

### 7.4 Security Measures

| Concern | Mitigation |
|---------|------------|
| **HTTPS** | nginx terminates SSL with Let's Encrypt cert |
| **Input Validation** | Zod schemas for all request bodies |
| **SQL Injection** | Parameterized queries via better-sqlite3 |
| **Secret Management** | Environment variables, not in code |
| **Logging** | No PII or wallet balances in logs |
| **Error Handling** | Generic errors to clients, detailed internal logs |

### 7.5 Threat Model

| Threat | Likelihood | Impact | Mitigation |
|--------|------------|--------|------------|
| API abuse | Medium | Low | Rate limiting |
| Data manipulation | Low | High | Read-only public API, admin audit log |
| Dune data poisoning | Low | High | Cannot control, trust upstream |
| DDoS | Low | Medium | nginx rate limiting, CDN if needed |
| Discord bot token leak | Low | High | Environment variables, minimal permissions |

---

## 8. Integration Points

### 8.1 Dune Analytics

**API**: Dune API v1
**Authentication**: API key in header
**Query**: Pre-saved query (query ID stored in config)

```typescript
// src/config.ts
export const config = {
  dune: {
    apiKey: process.env.DUNE_API_KEY,
    queryId: process.env.DUNE_QUERY_ID,  // Pre-saved query on Dune
    timeout: 120000,  // 2 minutes for query execution
  },
};
```

### 8.2 Collab.Land

**Integration Type**: Custom API Token Gating
**Documentation**: [Collab.Land Custom API Docs](https://docs.collab.land/)

Collab.Land will be configured to:
1. Query `GET /eligibility` endpoint
2. Check if user's verified wallet is in `top_7` → assign Naib role
3. Check if user's verified wallet is in `top_69` → assign Fedaykin role
4. Otherwise → deny access

**Note**: Exact Collab.Land configuration depends on their subscription tier. Design allows flexibility:
- If Custom API available: Direct integration
- If not: May need to explore alternative verification flows

### 8.3 Discord

**Library**: discord.js v14
**Permissions Required**:
- `SEND_MESSAGES` - Post to #the-door, #census
- `EMBED_LINKS` - Rich embeds for leaderboard
- `MANAGE_MESSAGES` - Edit/delete bot messages if needed
- `VIEW_CHANNEL` - Access configured channels

**Bot Intents**:
- `Guilds` - Access guild information
- `GuildMembers` - Look up members by ID (for DMs)

---

## 9. Scalability & Performance

### 9.1 Performance Characteristics

| Metric | Target | Approach |
|--------|--------|----------|
| API Response Time | < 100ms | SQLite cached data, minimal processing |
| Eligibility Update | < 5 min | Dune query + processing (async) |
| Memory Usage | < 256MB | Small dataset (69 entries max) |
| Database Size | < 100MB | Historical snapshots pruned after 30 days |

### 9.2 Caching Strategy

```
┌─────────────────────────────────────────────────────────────┐
│                     Caching Layers                           │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Layer 1: SQLite (persistent)                               │
│  - current_eligibility table for fast lookups               │
│  - Survives restarts                                        │
│                                                              │
│  Layer 2: In-memory (optional)                              │
│  - Cache /eligibility response in memory                    │
│  - TTL: 60 seconds                                          │
│  - Reduces DB reads under load                              │
│                                                              │
│  Layer 3: HTTP Cache Headers                                │
│  - Cache-Control: public, max-age=300                       │
│  - ETag based on updated_at                                 │
│  - Allows CDN/proxy caching                                 │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 9.3 Graceful Degradation

```typescript
// Grace period logic
const GRACE_PERIOD_HOURS = 24;

async function checkGracePeriod(): Promise<boolean> {
  const health = await db.getHealthStatus();
  const hoursSinceSuccess = getHoursSince(health.lastSuccessfulQuery);

  if (hoursSinceSuccess > GRACE_PERIOD_HOURS) {
    // Still serve cached data, but mark as degraded
    return true;
  }

  return false;
}
```

During grace period:
- API continues serving cached data
- No access revocations occur
- Health endpoint reports `status: degraded`
- Alerts sent to admin

---

## 10. Deployment Architecture

### 10.1 Infrastructure

```
┌─────────────────────────────────────────────────────────────┐
│                      OVH VPS                                 │
│                   (Existing Infrastructure)                  │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    nginx                             │   │
│  │  - SSL termination (Let's Encrypt)                  │   │
│  │  - Rate limiting                                     │   │
│  │  - Reverse proxy to Node.js                         │   │
│  └─────────────────────┬───────────────────────────────┘   │
│                        │                                     │
│                        ▼                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    PM2                               │   │
│  │  - Process management                               │   │
│  │  - Auto-restart on crash                            │   │
│  │  - Log rotation                                      │   │
│  └─────────────────────┬───────────────────────────────┘   │
│                        │                                     │
│                        ▼                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Sietch Service                          │   │
│  │  - Node.js process                                   │   │
│  │  - Express API + Discord bot                        │   │
│  │  - SQLite database file                             │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
│  Files:                                                      │
│  /opt/sietch/                                               │
│  ├── current/          # Deployed application               │
│  ├── releases/         # Previous releases (rollback)       │
│  ├── data/             # SQLite database                    │
│  └── logs/             # Application logs                   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 10.2 Deployment Process

```bash
#!/bin/bash
# deploy.sh

set -e

DEPLOY_DIR="/opt/sietch"
RELEASE_DIR="$DEPLOY_DIR/releases/$(date +%Y%m%d%H%M%S)"

# Clone and build
git clone --depth 1 git@github.com:0xHoneyJar/arrakis.git "$RELEASE_DIR"
cd "$RELEASE_DIR/sietch-service"
npm ci --production
npm run build

# Update symlink
ln -sfn "$RELEASE_DIR" "$DEPLOY_DIR/current"

# Restart service
pm2 restart sietch

# Cleanup old releases (keep last 5)
ls -dt "$DEPLOY_DIR/releases"/* | tail -n +6 | xargs rm -rf

echo "Deployed successfully"
```

### 10.3 Environment Configuration

```bash
# /opt/sietch/.env

# Dune Analytics
DUNE_API_KEY=your_dune_api_key
DUNE_QUERY_ID=12345

# Discord
DISCORD_BOT_TOKEN=your_discord_bot_token
DISCORD_GUILD_ID=your_guild_id
DISCORD_CHANNEL_THE_DOOR=channel_id
DISCORD_CHANNEL_CENSUS=channel_id
DISCORD_ROLE_NAIB=role_id
DISCORD_ROLE_FEDAYKIN=role_id

# API
API_PORT=3000
API_HOST=127.0.0.1
ADMIN_API_KEYS=key1:admin1,key2:admin2

# Database
DATABASE_PATH=/opt/sietch/data/sietch.db

# Logging
LOG_LEVEL=info
```

### 10.4 nginx Configuration

```nginx
# /etc/nginx/sites-available/sietch

server {
    listen 443 ssl http2;
    server_name sietch-api.example.com;

    ssl_certificate /etc/letsencrypt/live/sietch-api.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/sietch-api.example.com/privkey.pem;

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=sietch_api:10m rate=10r/s;
    limit_req zone=sietch_api burst=20 nodelay;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name sietch-api.example.com;
    return 301 https://$server_name$request_uri;
}
```

### 10.5 PM2 Configuration

```javascript
// ecosystem.config.js

module.exports = {
  apps: [{
    name: 'sietch',
    script: './dist/index.js',
    cwd: '/opt/sietch/current/sietch-service',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '256M',
    env: {
      NODE_ENV: 'production',
    },
    env_file: '/opt/sietch/.env',
    error_file: '/opt/sietch/logs/error.log',
    out_file: '/opt/sietch/logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
  }],
};
```

---

## 11. Development Workflow

### 11.1 Local Development

```bash
# Clone repository
git clone git@github.com:0xHoneyJar/arrakis.git
cd arrakis/sietch-service

# Install dependencies
npm install

# Copy environment template
cp .env.example .env.local

# Start development server
npm run dev

# Run tests
npm test

# Build for production
npm run build
```

### 11.2 Git Workflow

```
main (protected)
  │
  └── feature/xxx
        │
        └── PR → Review → Merge
```

- Direct commits to `main` blocked
- All changes via Pull Request
- Require 1 approval for merge
- Automated tests must pass

### 11.3 Testing Strategy

| Type | Coverage | Tools |
|------|----------|-------|
| Unit Tests | Core logic, eligibility processing | Jest |
| Integration Tests | API endpoints, database | Jest + Supertest |
| E2E Tests | Full flow with mocked externals | Manual + Scripts |

```typescript
// Example unit test
describe('EligibilityService', () => {
  describe('computeEligibilityDiff', () => {
    it('detects new members', () => {
      const previous = [{ address: '0x1', rank: 1 }];
      const current = [
        { address: '0x1', rank: 1 },
        { address: '0x2', rank: 2 },
      ];

      const diff = computeEligibilityDiff(previous, current);

      expect(diff.added).toHaveLength(1);
      expect(diff.added[0].address).toBe('0x2');
    });

    it('detects removed members', () => {
      // ...
    });

    it('detects Naib promotions', () => {
      // ...
    });
  });
});
```

---

## 12. Monitoring & Alerting

### 12.1 Health Checks

| Check | Frequency | Alert Threshold |
|-------|-----------|-----------------|
| API responsiveness | 1 min | 3 consecutive failures |
| Dune query success | 6 hours | 2 consecutive failures |
| Database accessible | 1 min | 1 failure |
| Discord bot connected | 1 min | Disconnection > 5 min |

### 12.2 Logging

```typescript
// Structured logging with pino
const logger = pino({
  level: config.logLevel,
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

// Usage
logger.info({ event: 'eligibility_update', count: 69 }, 'Eligibility updated');
logger.error({ error, query_id: config.dune.queryId }, 'Dune query failed');
```

### 12.3 Metrics (Optional Future)

If needed, expose Prometheus metrics:

```typescript
// /metrics endpoint
const metrics = {
  eligibility_update_duration_seconds: new Histogram(...),
  eligibility_update_total: new Counter(...),
  api_requests_total: new Counter(...),
  current_eligible_count: new Gauge(...),
};
```

---

## 13. Technical Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Dune API changes | Low | High | Pin to API v1, monitor deprecations |
| Collab.Land API changes | Low | High | Flexible design, document integration |
| Discord API rate limits | Low | Medium | Batch operations, respect limits |
| SQLite corruption | Very Low | High | Daily backups, WAL mode |
| VPS failure | Low | High | Documented recovery process |

### 13.1 Backup Strategy

```bash
# Daily backup cron (crontab)
0 3 * * * /opt/sietch/scripts/backup.sh

# backup.sh
#!/bin/bash
BACKUP_DIR="/opt/sietch/backups"
DATE=$(date +%Y%m%d)

# SQLite backup (online, safe)
sqlite3 /opt/sietch/data/sietch.db ".backup '$BACKUP_DIR/sietch-$DATE.db'"

# Keep last 7 days
find "$BACKUP_DIR" -name "sietch-*.db" -mtime +7 -delete
```

---

## 14. Future Considerations

### 14.1 Potential Enhancements

| Enhancement | Complexity | Value | Notes |
|-------------|------------|-------|-------|
| Webhook notifications | Low | Medium | Notify external services on changes |
| Historical analytics | Medium | Low | Track eligibility trends over time |
| Multi-server support | High | Low | Out of scope per PRD |
| Alternative data sources | Medium | High | Backup if Dune fails |

### 14.2 Technical Debt Awareness

- **Collab.Land dependency**: If their API changes or subscription requirements change, may need to implement direct Discord role management
- **Single-instance design**: Current design assumes single VPS; would need refactoring for multi-instance deployment
- **SQLite limitations**: Works well for current scale; would need migration to PostgreSQL if data grows significantly

---

## 15. Appendix

### 15.1 API Response Examples

**Eligibility Response (Full)**:
```json
{
  "updated_at": "2025-12-17T12:00:00.000Z",
  "grace_period": false,
  "top_69": [
    {"rank": 1, "address": "0x742d35cc6634c0532925a3b844bc9e7595f8b2c1", "bgt_held": 52341.234},
    {"rank": 2, "address": "0x8ba1f109551bd432803012645ac136ddd64dba72", "bgt_held": 48123.567},
    {"rank": 3, "address": "0x2932b7a2355d6fecc4b5c0b6bd44cc31df247a2e", "bgt_held": 45678.901},
    {"rank": 4, "address": "0x1234567890abcdef1234567890abcdef12345678", "bgt_held": 43210.123},
    {"rank": 5, "address": "0xabcdef1234567890abcdef1234567890abcdef12", "bgt_held": 41000.456},
    {"rank": 6, "address": "0x9876543210fedcba9876543210fedcba98765432", "bgt_held": 39500.789},
    {"rank": 7, "address": "0xfedcba9876543210fedcba9876543210fedcba98", "bgt_held": 38200.012}
  ],
  "top_7": [
    "0x742d35cc6634c0532925a3b844bc9e7595f8b2c1",
    "0x8ba1f109551bd432803012645ac136ddd64dba72",
    "0x2932b7a2355d6fecc4b5c0b6bd44cc31df247a2e",
    "0x1234567890abcdef1234567890abcdef12345678",
    "0xabcdef1234567890abcdef1234567890abcdef12",
    "0x9876543210fedcba9876543210fedcba98765432",
    "0xfedcba9876543210fedcba9876543210fedcba98"
  ]
}
```

### 15.2 Discord Embed Examples

**Removal DM**:
```
🚪 Sietch Access Update

Your access to Sietch has been revoked.

Reason: You have fallen below rank 69 in BGT holdings.
Previous Rank: 65
Current Rank: 72

If you believe this is an error, please contact support.
```

**#the-door Announcement**:
```
📤 Departure

Wallet: 0x1234...abcd
Reason: Rank change (now #72)
Previous Role: Fedaykin
```

**#census Leaderboard**:
```
📊 BGT Census
Updated: 2025-12-17T12:00:00Z

🔥 Naib Council
1. 0x742d...f8b2 - 52,341.23 BGT
2. 0x8ba1...dba7 - 48,123.57 BGT
3. 0x2932...a2e - 45,678.90 BGT
4. 0x1234...5678 - 43,210.12 BGT
5. 0xabcd...ef12 - 41,000.46 BGT
6. 0x9876...5432 - 39,500.79 BGT
7. 0xfedc...ba98 - 38,200.01 BGT

⚔️ Fedaykin
8. 0x...  - 37,500.00 BGT
9. 0x...  - 36,800.00 BGT
...
69. 0x... - 12,345.67 BGT
```

---

*Document generated by Architecture Designer*
