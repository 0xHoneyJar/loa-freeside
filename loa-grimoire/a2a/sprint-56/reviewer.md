# Sprint 56 Implementation Report: Shadow Mode Foundation - Incumbent Detection

**Sprint ID**: sprint-56
**Date**: 2025-12-30
**Engineer**: Claude Code (Opus 4.5)

---

## Sprint Goal

Implement incumbent bot detection and shadow ledger database schema for the coexistence architecture that allows Arrakis to operate alongside existing token-gating solutions (Collab.Land, Matrica, Guild.xyz).

---

## Deliverables

### 1. Database Schema (TASK-56.1-2)

**File**: `sietch-service/src/packages/adapters/storage/schema.ts`

Added two new tables to support coexistence:

#### `incumbent_configs` Table
- Stores detected incumbent bot information per community
- Fields: provider, botId, botUsername, verificationChannelId, confidence, healthStatus
- JSON fields for detectedRoles (role array) and capabilities (feature flags)
- Unique constraint on communityId (one config per community)

#### `migration_states` Table
- Tracks coexistence mode progression per community
- Fields: currentMode, targetMode, strategy, rollbackCount
- Timestamp fields for each mode transition (shadowStartedAt, parallelEnabledAt, etc.)
- Accuracy metrics (accuracyPercent stored as integer * 100)

#### Type Exports
```typescript
export type CoexistenceMode = 'shadow' | 'parallel' | 'primary' | 'exclusive';
export type IncumbentProvider = 'collabland' | 'matrica' | 'guild.xyz' | 'other';
export type HealthStatus = 'healthy' | 'degraded' | 'offline' | 'unknown';
export type DetectedRole = { id: string; name: string; memberCount: number; likelyTokenGated: boolean; confidence: number };
export type IncumbentCapabilities = { hasBalanceCheck: boolean; hasConvictionScoring: boolean; hasTierSystem: boolean; hasSocialLayer: boolean };
```

### 2. RLS Policies (TASK-56.3)

RLS policies documented in schema comments. Policies follow existing community isolation pattern:
- SELECT/UPDATE/DELETE restricted to community owner
- INSERT allowed for authenticated users
- Foreign key cascades on community deletion

### 3. ICoexistenceStorage Port Interface (TASK-56.4)

**File**: `sietch-service/src/packages/core/ports/ICoexistenceStorage.ts`

Hexagonal architecture port defining storage contract:

```typescript
interface ICoexistenceStorage {
  // Incumbent Configuration
  getIncumbentConfig(communityId: string): Promise<StoredIncumbentConfig | null>;
  saveIncumbentConfig(input: SaveIncumbentInput): Promise<StoredIncumbentConfig>;
  updateIncumbentHealth(input: UpdateHealthInput): Promise<void>;
  hasIncumbent(communityId: string): Promise<boolean>;

  // Migration State
  getMigrationState(communityId: string): Promise<StoredMigrationState | null>;
  getCurrentMode(communityId: string): Promise<CoexistenceMode>;
  updateMode(communityId: string, mode: CoexistenceMode, reason?: string): Promise<void>;
  initializeShadowMode(communityId: string): Promise<StoredMigrationState>;
  recordRollback(communityId: string, reason: string, targetMode: CoexistenceMode): Promise<void>;

  // Query Methods
  getCommunitiesByMode(mode: CoexistenceMode): Promise<string[]>;
  getReadyCommunities(): Promise<string[]>;
  getIncumbentHealthOverview(): Promise<Map<string, HealthStatus>>;
}
```

### 4. CoexistenceStorage Adapter (TASK-56.5)

**File**: `sietch-service/src/packages/adapters/coexistence/CoexistenceStorage.ts`

PostgreSQL implementation of ICoexistenceStorage:

- **Confidence handling**: Stored as integer 0-100, converted to float 0-1 on retrieval
- **Accuracy handling**: Stored as integer (percent * 100), converted back on retrieval
- **Upsert pattern**: saveIncumbentConfig checks existence, updates or inserts
- **Default mode**: getCurrentMode returns 'shadow' if no state exists
- **Shadow days calculation**: Computes days in shadow mode from shadowStartedAt

### 5. IncumbentDetector Component (TASK-56.6-8)

**File**: `sietch-service/src/packages/adapters/coexistence/IncumbentDetector.ts`

Multi-method detection system:

#### KNOWN_INCUMBENTS Configuration
```typescript
const KNOWN_INCUMBENTS = {
  collabland: {
    botIds: ['704521096837464076'],  // Official Collab.Land bot
    channelPatterns: ['collabland-join', 'collabland-config', 'verify', 'verification'],
    rolePatterns: ['holder', 'verified', 'whale', 'member', 'nft-holder'],
    usernamePatterns: ['collab.land', 'collabland'],
    capabilities: { hasBalanceCheck: true, hasTierSystem: true, ... }
  },
  matrica: { ... },
  'guild.xyz': { ... }
};
```

#### Detection Methods (by confidence)
1. **Bot ID Match** (0.95): Direct match against known bot IDs
2. **Username Pattern** (0.85): Bot username contains provider name
3. **Channel Pattern** (0.70): Verification channel name patterns
4. **Generic Suspect** (0.40): Bots with verify/token/gate/holder in name

#### Key Methods
- `detectIncumbent(guildId, options)`: Main detection entry point
- `detectAndSave(communityId, guildId)`: Detect and persist to storage
- `buildIncumbentInfo(guild, provider, botInfo)`: Build complete info with role analysis

#### Safety Guarantee
**CRITICAL**: This service NEVER performs Discord mutations. It only reads guild information for detection purposes.

### 6. Logging Infrastructure

**File**: `sietch-service/src/packages/infrastructure/logging/index.ts`

Simple logging interface for packages:
- `ILogger` interface with debug/info/warn/error methods
- `createLogger(options)` factory function
- `nullLogger` for testing (no-op implementation)
- JSON output option for structured logging

### 7. Module Index

**File**: `sietch-service/src/packages/adapters/coexistence/index.ts`

Exports:
- `CoexistenceStorage`, `createCoexistenceStorage`
- `IncumbentDetector`, `createIncumbentDetector`
- `KNOWN_INCUMBENTS`, `CONFIDENCE`
- Types: `DetectionResult`, `DetectionOptions`

---

## Test Coverage

### IncumbentDetector.test.ts (27 tests)

**Detection Methods**:
- Bot ID detection (Collab.Land by known ID)
- Username pattern detection (collabland, matrica)
- Channel pattern detection (collabland-join, guild-join)
- Generic suspect detection (token-gate-bot)
- No detection when no incumbent present

**Detection Options**:
- skipIfExists behavior (returns cached when exists)
- forceRedetect behavior (bypasses cache)

**buildIncumbentInfo**:
- Role analysis with token-gating likelihood
- Channel identification
- Capabilities mapping

**KNOWN_INCUMBENTS Configuration**:
- Validates Collab.Land bot ID is correct
- Validates expected providers exist
- Validates required capabilities per provider

**CONFIDENCE Constants**:
- Validates correct ordering and values

### CoexistenceStorage.test.ts (22 tests)

**Incumbent Configuration**:
- getIncumbentConfig returns null when missing
- getIncumbentConfig returns mapped config (confidence conversion)
- saveIncumbentConfig creates new or updates existing
- updateIncumbentHealth updates status
- hasIncumbent returns boolean

**Migration State**:
- getMigrationState returns null when missing
- getMigrationState returns mapped state (accuracy conversion)
- getCurrentMode returns 'shadow' as default
- initializeShadowMode creates state
- updateMode updates and creates state if needed
- recordRollback increments count

**Query Methods**:
- getCommunitiesByMode returns community IDs
- getReadyCommunities returns ready communities
- getIncumbentHealthOverview returns health map

**Type Safety**:
- CoexistenceMode values
- IncumbentProvider values
- HealthStatus values

---

## Test Results

```
 ✓ tests/unit/packages/adapters/coexistence/IncumbentDetector.test.ts (27 tests) 28ms
 ✓ tests/unit/packages/adapters/coexistence/CoexistenceStorage.test.ts (22 tests) 12ms

 Test Files  2 passed (2)
      Tests  49 passed (49)
```

---

## Design Decisions

### 1. Confidence as Integer Storage
Stored as integer 0-100 rather than float to avoid floating-point precision issues in PostgreSQL. Converted to 0-1 float in application layer.

### 2. Detection Order Matters
KNOWN_INCUMBENTS is iterated in order (collabland → matrica → guild.xyz). Since some patterns overlap (e.g., "verify"), tests must use unique patterns per provider.

### 3. Bot Info vs GuildMember
`buildIncumbentInfo` accepts a simple `{ id, username, joinedAt }` object rather than Discord.js `GuildMember` to decouple from Discord types and simplify testing.

### 4. MockCollection for Testing
Discord.js `Collection` extends `Map` with methods like `find()`, `filter()`, `map()`. Created `MockCollection` class extending `Map` to simulate this in tests without full Discord.js dependency.

### 5. Shadow Mode as Default
`getCurrentMode()` returns 'shadow' when no migration state exists, ensuring new communities start in observation mode.

---

## Files Changed

| File | Type | Lines |
|------|------|-------|
| `src/packages/adapters/storage/schema.ts` | Modified | +150 |
| `src/packages/core/ports/ICoexistenceStorage.ts` | New | 175 |
| `src/packages/adapters/coexistence/CoexistenceStorage.ts` | New | 350 |
| `src/packages/adapters/coexistence/IncumbentDetector.ts` | New | 624 |
| `src/packages/adapters/coexistence/index.ts` | New | 31 |
| `src/packages/infrastructure/logging/index.ts` | New | 126 |
| `tests/unit/packages/adapters/coexistence/IncumbentDetector.test.ts` | New | 450 |
| `tests/unit/packages/adapters/coexistence/CoexistenceStorage.test.ts` | New | 563 |

---

## Technical Debt / Follow-up

1. **RLS Migration**: RLS policies need actual SQL migration file (documented in schema comments for now)
2. **Matrica/Guild.xyz Bot IDs**: Currently empty arrays - need to research actual bot IDs
3. **Role Analysis Enhancement**: Could add more sophisticated heuristics for token-gated role detection
4. **Health Check Implementation**: updateIncumbentHealth is called but no automated health checker yet (Sprint 57 scope)

---

## Acceptance Criteria Verification

| Criterion | Status |
|-----------|--------|
| incumbent_configs table with all specified fields | PASS |
| migration_states table with mode tracking | PASS |
| RLS policies documented | PASS |
| ICoexistenceStorage interface defined | PASS |
| CoexistenceStorage implements interface | PASS |
| IncumbentDetector with multi-method detection | PASS |
| KNOWN_INCUMBENTS configuration | PASS |
| CONFIDENCE constants exported | PASS |
| Unit tests for detection methods | PASS |
| 49/49 tests passing | PASS |

---

## Ready for Review

All Sprint 56 tasks completed. Implementation follows hexagonal architecture with clear port/adapter separation. Ready for senior lead review.
