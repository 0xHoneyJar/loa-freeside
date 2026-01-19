# Sprint GW-4 State Audit Report

## TASK-4.1: In-Memory State Audit

**Date**: 2026-01-15
**Auditor**: Implementing Engineer

---

## Summary

Found **5 in-memory state usages** in Discord command handlers that require Redis migration:

| Location | Type | Strategy |
|----------|------|----------|
| `admin-takeover.ts:41` | Session | Redis with 10min TTL |
| `directory.ts:52` | Session | Redis with 5min TTL |
| `onboarding.ts:71` | Session | Redis with 15min TTL |
| `activity.ts:25` | Cooldown | Redis with 5min TTL |
| `activity.ts:29` | Cooldown | Redis with 5min TTL |

---

## Detailed Findings

### 1. Admin Takeover Confirmation States

**File**: `themes/sietch/src/discord/commands/admin-takeover.ts:41`

```typescript
const confirmationStates = new Map<string, TakeoverConfirmationState>();
```

**Purpose**: Three-step confirmation flow for admin takeover (community name -> acknowledge risks -> confirm rollback plan)

**Key Pattern**: `${guildId}-${userId}`

**Data Structure**:
- `communityId`: string
- `adminDiscordId`: string
- `expiresAt`: Date
- Step completion flags

**TTL**: 10 minutes (hardcoded in `createTakeoverConfirmation`)

**Migration Strategy**:
- Use `StateManager.setSession()` with 10-minute TTL
- Key: `takeover:${guildId}:${userId}`

---

### 2. Directory Session Filters

**File**: `themes/sietch/src/discord/commands/directory.ts:52`

```typescript
const sessionFilters = new Map<string, DirectoryFilters>();
```

**Purpose**: Store pagination and filter state for interactive directory browsing

**Key Pattern**: Discord user ID

**Data Structure**:
- `page`: number
- `pageSize`: number
- `sortBy`: 'nym' | 'tenure' | 'badgeCount'
- `sortDir`: 'asc' | 'desc'
- `tier?`: 'naib' | 'fedaykin'

**TTL**: 5 minutes (via setTimeout cleanup)

**Migration Strategy**:
- Use `StateManager.setSession()` with 5-minute TTL
- Key: `dir:${userId}`

---

### 3. Onboarding Sessions

**File**: `themes/sietch/src/services/onboarding.ts:71`

```typescript
private sessions: Map<string, OnboardingState> = new Map();
```

**Purpose**: Multi-step DM-based onboarding wizard

**Key Pattern**: Discord user ID

**Data Structure**:
- `discordUserId`: string
- `currentStep`: number
- `nym`: string | null
- `bio`: string | null
- `pfpUrl`: string | null
- `pfpType`: 'none' | 'custom' | 'generated'
- `startedAt`: Date
- `lastInteractionAt`: Date

**TTL**: 15 minutes (SESSION_TIMEOUT_MS constant)

**Migration Strategy**:
- Use `StateManager.setSession()` with 15-minute TTL
- Key: `onboard:${userId}`
- Complex state - serialize to JSON

---

### 4. Activity Rate Limiting - Messages

**File**: `themes/sietch/src/services/activity.ts:25`

```typescript
const lastMessageTime = new Map<string, number>();
```

**Purpose**: Rate limit message activity tracking (1 message per minute counted)

**Key Pattern**: Discord user ID

**Data Structure**: Single timestamp (number)

**TTL**: 5 minutes (cleaned up by `cleanupRateLimitCache`)

**Migration Strategy**:
- Use `StateManager.setCooldown()` with 1-minute TTL
- Key: `cd:activity:msg:${userId}`

---

### 5. Activity Rate Limiting - Reactions

**File**: `themes/sietch/src/services/activity.ts:29`

```typescript
const lastReactionTime = new Map<string, number>();
```

**Purpose**: Rate limit reaction activity tracking (1 reaction per 5 seconds counted)

**Key Pattern**: Discord user ID

**Data Structure**: Single timestamp (number)

**TTL**: 5 minutes (cleaned up by `cleanupRateLimitCache`)

**Migration Strategy**:
- Use `StateManager.setCooldown()` with 5-second TTL
- Key: `cd:activity:react:${userId}`

---

## Non-Blocking State (No Migration Needed)

The following uses of Map/Set do **not require Redis migration** because they are:
- Local to a function scope (temporary computation)
- Static configuration
- Result types (not cross-request state)

| Location | Reason |
|----------|--------|
| `config.ts:62` | Static config parsing |
| `config.ts:106` | Static config parsing |
| `db/queries/*.ts` | Local function results |
| `utils/metrics.ts` | Metrics aggregation (can restart) |
| `utils/cache.ts` | Generic cache utility class |
| `services/chain.ts:78` | RPC health tracking (transient) |
| Various embed builders | Local grouping operations |

---

## Migration Implementation Plan

### StateManager Keys

```
takeover:{guildId}:{userId}  -> TakeoverConfirmationState (JSON)
dir:{userId}                 -> DirectoryFilters (JSON)
onboard:{userId}             -> OnboardingState (JSON)
cd:activity:msg:{userId}     -> "1" (simple existence)
cd:activity:react:{userId}   -> "1" (simple existence)
```

### API Additions to StateManager

Current StateManager already supports:
- `setSession(key, data, ttlMs)` ✅
- `getSession(key)` ✅
- `deleteSession(key)` ✅
- `setCooldown(key, durationMs)` ✅
- `getCooldown(key)` ✅

**No new methods required.**

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Session loss on Redis failure | LOW | Graceful degradation - user restarts flow |
| Increased latency | LOW | Redis is fast (<1ms), already used |
| TTL drift | LOW | Use same TTL values as current setTimeout |

---

## Verdict

**No blocking issues found.** All identified state patterns map cleanly to existing StateManager methods.

Proceed with TASK-4.2 (Low-Complexity Commands Migration).
