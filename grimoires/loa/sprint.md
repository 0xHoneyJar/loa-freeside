# Sprint Plan: Gaib Discord IaC - Full Sietch Theme + Backup System

**Version**: 2.0.0
**Status**: Active
**Created**: 2026-01-29
**Updated**: 2026-01-29
**Cycle**: cycle-007
**PRD Reference**: grimoires/loa/prd.md (v2.0)
**SDD Reference**: grimoires/loa/sdd.md (v2.0)

---

## Overview

This sprint plan covers two phases:
- **Phase 1** (Complete): Sietch v3.0 Theme + CLI Validation
- **Phase 2** (New): Backup & Snapshot System

| Sprint | Goal | Global ID | Status |
|--------|------|-----------|--------|
| Sprint 1 | Complete Sietch v3.0 Theme | 164 | ✅ Complete |
| Sprint 2 | CLI Validation & E2E Testing | 165 | ✅ Complete |
| Sprint 3 | Backup Foundation | 166 | ✅ Complete |
| Sprint 4 | Restore Engine | 167 | ✅ Complete |
| Sprint 5 | Snapshots | 168 | ✅ Complete |
| Sprint 6 | Theme Registry | 169 | ✅ Complete |
| Sprint 7 | Service Tiers | 170 | ✅ Complete |
| Sprint 8 | Polish & Notifications | 171 | ✅ Complete |
| Sprint 9 | Wallet Verification Integration | 172 | ✅ Complete |
| Sprint 10 | Comprehensive Tier Testing Suite | 173 | ✅ Complete |
| Sprint 11 | Backup/Restore E2E Validation | 174 | ✅ Complete |

**Total Estimated Effort**: ~2,500 LOC (new backup system)

---

## Sprint 1: Complete Sietch v3.0 Theme (Global ID: 164)

**Goal**: Expand the Sietch theme from 6 roles to the full v3.0 specification with 15 roles, 9 categories, and 22 channels.

**Dependencies**: None

### Tasks

#### Task 1.1: Update Theme Manifest

**File**: `themes/sietch/theme.yaml`

**Description**: Update the theme manifest with full v3.0 metadata and variable definitions.

**Acceptance Criteria**:
- [ ] Version updated to 3.0.0
- [ ] All 15 color variables defined (9 tiers + 5 special + 1 bot)
- [ ] Feature flags added: `enable_voice`, `enable_badge_channels`
- [ ] Tags reflect BGT token-gated nature

**Estimated LOC**: ~80

---

#### Task 1.2: Expand Role Definitions

**File**: `themes/sietch/roles.yaml`

**Description**: Replace the current 6-role structure with the full 15-role hierarchy matching PRD specification.

**Acceptance Criteria**:
- [ ] 9 BGT tier roles: Naib, Fedaykin, Usul, Sayyadina, Mushtamal, Sihaya, Qanat, Ichwan, Hajra
- [ ] 5 special roles: Former Naib, Taqwa, Water Sharer, Engaged, Veteran
- [ ] 1 bot role: Shai-Hulud (position 99)
- [ ] All roles use variable references: `${color_naib}`, etc.
- [ ] Position hierarchy correct (100 → 35)
- [ ] Permissions match PRD (Naib = ADMINISTRATOR, etc.)
- [ ] Hoist settings match PRD (tier roles hoisted, special roles not)

**Estimated LOC**: ~150

---

#### Task 1.3: Implement Full Channel Structure

**File**: `themes/sietch/channels.yaml`

**Description**: Replace current channel structure with full v3.0 specification including 9 categories and 22 channels.

**Acceptance Criteria**:
- [ ] 9 categories with correct emoji prefixes:
  - 📜 STILLSUIT
  - 🚪 CAVE ENTRANCE
  - 🕳️ THE DEPTHS
  - ⚡ INNER SANCTUM
  - ⚔️ FEDAYKIN COMMONS
  - 🏛️ NAIB COUNCIL
  - 🏛️ NAIB ARCHIVES
  - 💧 BADGE CHANNELS
  - 🛠️ SUPPORT
- [ ] Category permissions match SDD permission matrix
- [ ] 22 channels in correct categories:
  - STILLSUIT: water-discipline, announcements
  - CAVE ENTRANCE: cave-entrance, cave-voices
  - THE DEPTHS: the-depths, depth-voices
  - INNER SANCTUM: inner-sanctum, sanctum-voices
  - FEDAYKIN COMMONS: general, spice, water-shares, introductions, census, the-door, fedaykin-voices
  - NAIB COUNCIL: council-rock, council-chamber
  - NAIB ARCHIVES: naib-archives
  - BADGE CHANNELS: the-oasis, deep-desert, stillsuit-lounge
  - SUPPORT: support, bot-commands
- [ ] Channel-level permission overwrites for special cases (census read-only, etc.)
- [ ] Voice channels have correct bitrate and user limits
- [ ] Slowmode set on introductions channel

**Estimated LOC**: ~400

---

#### Task 1.4: Create Theme Documentation

**File**: `themes/sietch/README.md`

**Description**: Create documentation for the Sietch theme.

**Acceptance Criteria**:
- [ ] Theme overview and description
- [ ] Variable reference table with all defaults
- [ ] Usage instructions for `gaib server init --theme sietch`
- [ ] Permission matrix overview
- [ ] Customization examples

**Estimated LOC**: ~100

---

### Sprint 1 Deliverables

| File | Status |
|------|--------|
| `themes/sietch/theme.yaml` | Updated |
| `themes/sietch/roles.yaml` | Rewritten |
| `themes/sietch/channels.yaml` | Rewritten |
| `themes/sietch/README.md` | Created |

---

## Sprint 2: CLI Validation & E2E Testing (Global ID: 165)

**Goal**: Validate Gaib CLI works end-to-end with the Sietch theme on a test Discord server.

**Dependencies**: Sprint 1 complete, Test Discord server available, Bot token configured

### Tasks

#### Task 2.1: Validate Theme Loading

**Description**: Test that `gaib server theme ls` and `gaib server theme info sietch` work correctly.

**Acceptance Criteria**:
- [ ] `gaib server theme ls` shows sietch theme
- [ ] `gaib server theme info sietch` displays:
  - Theme name, version, description
  - Variable count
  - Role count (15)
  - Channel count (22)
  - Category count (9)

**Test Commands**:
```bash
gaib server theme ls
gaib server theme info sietch
```

---

#### Task 2.2: Validate Init Command

**Description**: Test `gaib server init --theme sietch` creates valid configuration.

**Acceptance Criteria**:
- [ ] Creates `discord-server.yaml` with merged theme content
- [ ] All variable interpolations resolved (`${color_naib}` → `#FFD700`)
- [ ] Config passes validation (no schema errors)
- [ ] Workspace directory created (`.gaib/workspaces/default/`)

**Test Commands**:
```bash
gaib server init --theme sietch --guild $TEST_GUILD_ID
cat discord-server.yaml
```

---

#### Task 2.3: Validate Plan Command

**Description**: Test `gaib server plan` shows accurate preview of changes.

**Acceptance Criteria**:
- [ ] Shows 15 roles to create
- [ ] Shows 9 categories to create
- [ ] Shows 22 channels to create
- [ ] Permission changes listed
- [ ] Summary correct (total: 46 resources)

**Test Commands**:
```bash
gaib server plan
gaib server plan --json
```

---

#### Task 2.4: Validate Apply Command

**Description**: Apply Sietch theme to test Discord server.

**Acceptance Criteria**:
- [ ] All 15 roles created with correct:
  - Names
  - Colors
  - Positions (hierarchy preserved)
  - Permissions
- [ ] All 9 categories created with correct:
  - Names (including emoji prefixes)
  - Positions
  - Permission overwrites
- [ ] All 22 channels created with correct:
  - Names
  - Types (text, voice, announcement)
  - Parent categories
  - Topics
  - Permission overwrites
  - Slowmode settings
  - Voice settings (bitrate, user limit)
- [ ] State file created with all resource mappings
- [ ] No errors in output

**Test Commands**:
```bash
gaib server apply --auto-approve
gaib server state ls
```

---

#### Task 2.5: Validate Diff Accuracy

**Description**: Test diff shows correct changes after apply.

**Acceptance Criteria**:
- [ ] `gaib server diff` shows "No changes" after clean apply
- [ ] Manual change in Discord detected by diff
- [ ] Config change detected by diff

**Test Commands**:
```bash
gaib server diff
# Manually change a role color in Discord
gaib server diff  # Should show drift
```

---

#### Task 2.6: Validate State Persistence

**Description**: Test state management works correctly.

**Acceptance Criteria**:
- [ ] `gaib server state ls` shows all 46 resources
- [ ] `gaib server state show role.naib` shows correct details
- [ ] State survives CLI restart
- [ ] Serial increments on apply

**Test Commands**:
```bash
gaib server state ls
gaib server state show role.naib
gaib server state show channel.general
```

---

#### Task 2.7: Validate Destroy Command

**Description**: Test cleanup removes all managed resources.

**Acceptance Criteria**:
- [ ] All 22 channels deleted
- [ ] All 9 categories deleted
- [ ] All 15 roles deleted (except @everyone and bot-managed)
- [ ] State cleared
- [ ] Discord server clean (only unmanaged resources remain)

**Test Commands**:
```bash
gaib server destroy --auto-approve
gaib server state ls  # Should be empty
```

---

#### Task 2.8: Document Known Issues

**File**: `grimoires/loa/NOTES.md`

**Description**: Document any bugs or issues discovered during testing.

**Acceptance Criteria**:
- [ ] Any bugs documented in Discovered Technical Debt section
- [ ] Workarounds noted if applicable
- [ ] Severity assessed

---

### Sprint 2 Deliverables

| Deliverable | Status |
|-------------|--------|
| Theme loading validated | ◻️ |
| Init command validated | ◻️ |
| Plan command validated | ◻️ |
| Apply command validated | ◻️ |
| Diff accuracy validated | ◻️ |
| State persistence validated | ◻️ |
| Destroy command validated | ◻️ |
| Issues documented | ◻️ |

---

## Success Criteria

### Theme Completeness

| Metric | Target | Sprint |
|--------|--------|--------|
| Role count | 15 | 1 |
| Category count | 9 | 1 |
| Channel count | 22 | 1 |
| Variable count | 17 | 1 |
| Documentation | Complete | 1 |

### CLI Validation

| Metric | Target | Sprint |
|--------|--------|--------|
| theme ls | Working | 2 |
| theme info | Working | 2 |
| init | Working | 2 |
| plan | Working | 2 |
| apply | Working | 2 |
| diff | Accurate | 2 |
| state ls | Working | 2 |
| destroy | Working | 2 |

---

## Risk Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Discord rate limits during apply | Medium | Medium | RateLimiter already implemented |
| Permission hierarchy conflicts | Medium | High | Test on clean sandbox server |
| Variable interpolation edge cases | Low | Medium | Test all variables before apply |
| State corruption | Low | High | Backup state before testing |

---

## Prerequisites

### Before Sprint 1
- [ ] Access to `themes/sietch/` directory
- [ ] PRD and SDD reviewed

### Before Sprint 2
- [ ] Test Discord server created
- [ ] Bot application created with required permissions
- [ ] Bot invited to test server
- [ ] `DISCORD_BOT_TOKEN` environment variable set
- [ ] `DISCORD_GUILD_ID` environment variable set

---

## Execution Order

```bash
# Sprint 1 - Theme Implementation
/implement sprint-1

# Sprint 2 - CLI Validation (requires Discord setup)
/implement sprint-2
```

---

## Appendix: File Summary

| File | Sprint | Action | LOC |
|------|--------|--------|-----|
| `themes/sietch/theme.yaml` | 1 | Update | ~80 |
| `themes/sietch/roles.yaml` | 1 | Rewrite | ~150 |
| `themes/sietch/channels.yaml` | 1 | Rewrite | ~400 |
| `themes/sietch/README.md` | 1 | Create | ~100 |
| **Total Sprint 1** | | | **~730** |
| Manual testing | 2 | Execute | - |
| `grimoires/loa/NOTES.md` | 2 | Update | ~50 |
| **Total Sprint 2** | | | **~50** |

---

---

# PHASE 2: Backup & Snapshot System (Sprints 3-8)

---

## Sprint 3: Backup Foundation (Global ID: 166)

**Goal**: Implement core backup infrastructure - S3 storage, DynamoDB metadata, and basic backup create/list commands.

**Dependencies**: Sprint 2 complete (CLI validation), AWS credentials configured

### Tasks

#### Task 3.1: Create Backup Types

**File**: `packages/cli/src/commands/server/backup/types.ts`

**Description**: Define TypeScript types for backup system.

**Acceptance Criteria**:
- [ ] `BackupMetadata` interface (id, serverId, workspace, timestamp, serial, lineage, tier, checksum, etc.)
- [ ] `SnapshotManifest` interface (version, files, discord counts, theme info)
- [ ] `ThemeRegistry` and `ThemeDeployment` interfaces
- [ ] `ServerTierConfig` interface
- [ ] Backup error classes (BackupError, TierLimitError, IntegrityError)

**Estimated LOC**: ~150

---

#### Task 3.2: Implement BackupManager Core

**File**: `packages/cli/src/commands/server/backup/BackupManager.ts`

**Description**: Core backup operations - create and list backups.

**Acceptance Criteria**:
- [ ] `createBackup(options)` - compress state, upload to S3, write metadata to DynamoDB
- [ ] `listBackups(options)` - query DynamoDB for server's backups
- [ ] `getBackupMetadata(id)` - fetch single backup metadata
- [ ] S3 key format: `state/{serverId}/{workspace}/backup.{timestamp}.json.gz`
- [ ] Gzip compression with SHA-256 checksum
- [ ] SSE-KMS encryption on S3 upload
- [ ] Tag backups with `Tier=free|premium`

**Estimated LOC**: ~300

---

#### Task 3.3: Create Backup CLI Commands

**File**: `packages/cli/src/commands/server/backup/index.ts`

**Description**: Register backup create and list commands.

**Acceptance Criteria**:
- [ ] `gaib server backup create [--message "..."]` - creates backup
- [ ] `gaib server backup list [--limit N]` - lists backups
- [ ] Output shows backup ID, timestamp, serial, size
- [ ] Error handling for no state, AWS errors

**Estimated LOC**: ~100

---

#### Task 3.4: Deploy Terraform Infrastructure

**File**: `infrastructure/terraform/gaib-backups.tf`

**Description**: Deploy S3 bucket, KMS key, and DynamoDB table for backups.

**Acceptance Criteria**:
- [ ] S3 bucket `gaib-backups-{account_id}` with versioning enabled
- [ ] KMS key `gaib-backups` with rotation enabled
- [ ] DynamoDB table `gaib-backup-metadata` with PK/SK and GSI1
- [ ] S3 lifecycle rules for free (7d) and premium (90d) retention
- [ ] Public access block on S3
- [ ] TTL enabled on DynamoDB

**Estimated LOC (Terraform)**: ~150

---

#### Task 3.5: Unit Tests for BackupManager

**File**: `packages/cli/src/commands/server/backup/__tests__/BackupManager.test.ts`

**Description**: Unit tests for backup creation and listing.

**Acceptance Criteria**:
- [ ] Test createBackup compresses and uploads correctly
- [ ] Test checksum calculation
- [ ] Test DynamoDB metadata write
- [ ] Test listBackups query and pagination
- [ ] Mock S3 and DynamoDB clients

**Estimated LOC**: ~200

---

### Sprint 3 Deliverables

| File | Action | LOC |
|------|--------|-----|
| `backup/types.ts` | Create | ~150 |
| `backup/BackupManager.ts` | Create | ~300 |
| `backup/index.ts` | Create | ~100 |
| `gaib-backups.tf` | Create | ~150 |
| `BackupManager.test.ts` | Create | ~200 |
| **Total** | | **~900** |

---

## Sprint 4: Restore Engine (Global ID: 167)

**Goal**: Implement backup restore with integrity validation and lineage checks.

**Dependencies**: Sprint 3 complete (backup create/list working)

### Tasks

#### Task 4.1: Implement RestoreEngine

**File**: `packages/cli/src/commands/server/backup/RestoreEngine.ts`

**Description**: Validate and restore backups with integrity checks.

**Acceptance Criteria**:
- [ ] Download backup from S3
- [ ] Verify SHA-256 checksum
- [ ] Decompress gzip content
- [ ] Validate state lineage matches current workspace
- [ ] Dry-run mode shows what would be restored
- [ ] Write restored state to backend

**Estimated LOC**: ~200

---

#### Task 4.2: Add Restore CLI Command

**File**: `packages/cli/src/commands/server/backup/index.ts` (extend)

**Description**: Add restore and delete commands.

**Acceptance Criteria**:
- [ ] `gaib server backup restore <id> [--dry-run]` - restores backup
- [ ] `gaib server backup delete <id> [-f]` - deletes backup
- [ ] Dry-run shows state diff
- [ ] Confirmation prompt before restore (unless --dry-run)
- [ ] Error messages for checksum mismatch, lineage mismatch

**Estimated LOC**: ~80

---

#### Task 4.3: Extend BackupManager with Delete

**File**: `packages/cli/src/commands/server/backup/BackupManager.ts` (extend)

**Description**: Add restore and delete methods.

**Acceptance Criteria**:
- [ ] `restoreBackup(id, options)` - calls RestoreEngine
- [ ] `deleteBackup(id, options)` - removes from S3 and DynamoDB
- [ ] Validate backup exists before operations

**Estimated LOC**: ~100

---

#### Task 4.4: Integration Tests for Restore

**File**: `packages/cli/src/commands/server/backup/__tests__/RestoreEngine.test.ts`

**Description**: Test full backup → restore cycle.

**Acceptance Criteria**:
- [ ] Test checksum verification catches corruption
- [ ] Test lineage validation rejects wrong workspace
- [ ] Test dry-run doesn't modify state
- [ ] Test successful restore matches original state

**Estimated LOC**: ~150

---

### Sprint 4 Deliverables

| File | Action | LOC |
|------|--------|-----|
| `backup/RestoreEngine.ts` | Create | ~200 |
| `backup/index.ts` | Extend | ~80 |
| `backup/BackupManager.ts` | Extend | ~100 |
| `RestoreEngine.test.ts` | Create | ~150 |
| **Total** | | **~530** |

---

## Sprint 5: Snapshots (Global ID: 168)

**Goal**: Implement full server snapshots with manifest, state, config export, and theme registry.

**Dependencies**: Sprint 4 complete (restore working)

### Tasks

#### Task 5.1: Implement SnapshotManager

**File**: `packages/cli/src/commands/server/backup/SnapshotManager.ts`

**Description**: Create and manage full server snapshots.

**Acceptance Criteria**:
- [ ] `createSnapshot(options)` - creates manifest + 3 compressed files
- [ ] `listSnapshots()` - query DynamoDB for server's snapshots
- [ ] `getSnapshot(id)` - fetch snapshot manifest
- [ ] S3 structure: `snapshots/{serverId}/{id}/manifest.json, state.json.gz, config.yaml.gz, theme-registry.json.gz`
- [ ] Manifest includes file checksums and sizes
- [ ] Discord summary (role/channel/category counts)

**Estimated LOC**: ~350

---

#### Task 5.2: Add Snapshot Restore

**File**: `packages/cli/src/commands/server/backup/SnapshotManager.ts` (extend)

**Description**: Restore from snapshots and download locally.

**Acceptance Criteria**:
- [ ] `restoreSnapshot(id, options)` - restore all state files
- [ ] `downloadSnapshot(id, outputDir)` - download bundle locally
- [ ] Verify manifest checksum
- [ ] Verify individual file checksums
- [ ] Option to apply restored config to Discord (`--apply`)

**Estimated LOC**: ~150

---

#### Task 5.3: Add Snapshot Compare

**File**: `packages/cli/src/commands/server/backup/SnapshotManager.ts` (extend)

**Description**: Compare two snapshots to show differences.

**Acceptance Criteria**:
- [ ] `compareSnapshots(id1, id2)` - returns diff of resources
- [ ] Shows added, removed, modified roles
- [ ] Shows added, removed, modified channels
- [ ] Shows added, removed, modified categories

**Estimated LOC**: ~100

---

#### Task 5.4: Create Snapshot CLI Commands

**File**: `packages/cli/src/commands/server/snapshot/index.ts`

**Description**: Register snapshot commands.

**Acceptance Criteria**:
- [ ] `gaib server snapshot create [--message "..."]`
- [ ] `gaib server snapshot list`
- [ ] `gaib server snapshot restore <id> [--dry-run] [--apply]`
- [ ] `gaib server snapshot download <id> -o <dir>`
- [ ] `gaib server snapshot compare <id1> <id2>`

**Estimated LOC**: ~120

---

#### Task 5.5: Snapshot Unit Tests

**File**: `packages/cli/src/commands/server/backup/__tests__/SnapshotManager.test.ts`

**Description**: Unit tests for snapshot operations.

**Acceptance Criteria**:
- [ ] Test manifest generation and checksum
- [ ] Test file compression and upload
- [ ] Test compare shows correct diffs
- [ ] Test download creates correct files

**Estimated LOC**: ~180

---

### Sprint 5 Deliverables

| File | Action | LOC |
|------|--------|-----|
| `backup/SnapshotManager.ts` | Create | ~600 |
| `snapshot/index.ts` | Create | ~120 |
| `SnapshotManager.test.ts` | Create | ~180 |
| **Total** | | **~900** |

---

## Sprint 6: Theme Registry (Global ID: 169)

**Goal**: Track theme deployments with full history and rollback capability.

**Dependencies**: Sprint 5 complete (snapshots working)

### Tasks

#### Task 6.1: Implement ThemeRegistryManager

**File**: `packages/cli/src/commands/server/backup/ThemeRegistryManager.ts`

**Description**: Track theme deployments and handle rollback.

**Acceptance Criteria**:
- [ ] `recordDeployment(options)` - add deployment to registry
- [ ] `getRegistry()` - get current registry state
- [ ] `getRegistryInfo()` - current + last 5 deployments
- [ ] `getHistory(options)` - full deployment history
- [ ] S3 storage: `themes/{serverId}/registry.json`
- [ ] Audit entries: `themes/{serverId}/audit/{timestamp}.json`

**Estimated LOC**: ~250

---

#### Task 6.2: Implement Theme Rollback

**File**: `packages/cli/src/commands/server/backup/ThemeRegistryManager.ts` (extend)

**Description**: Rollback to previous theme deployments.

**Acceptance Criteria**:
- [ ] `rollback(options)` - rollback N steps or to specific deployment
- [ ] Requires target deployment to have associated snapshot
- [ ] Restores snapshot and applies to Discord
- [ ] Records rollback as new deployment entry
- [ ] Dry-run shows what would be rolled back

**Estimated LOC**: ~100

---

#### Task 6.3: Hook ApplyEngine for Registry

**File**: `packages/cli/src/commands/server/iac/ApplyEngine.ts` (extend)

**Description**: Automatically record deployments to theme registry.

**Acceptance Criteria**:
- [ ] After successful apply with theme, call `recordDeployment()`
- [ ] Record theme name, version, serial
- [ ] Optionally create snapshot on apply (`--snapshot` flag)
- [ ] Record destroy operations

**Estimated LOC**: ~50

---

#### Task 6.4: Create Theme Registry CLI Commands

**File**: `packages/cli/src/commands/server/theme/registry.ts`

**Description**: Register theme registry commands.

**Acceptance Criteria**:
- [ ] `gaib server theme registry` - show current + last 5
- [ ] `gaib server theme history [--limit N]` - full history
- [ ] `gaib server theme rollback [--steps N] [--to <id>] [--dry-run]`

**Estimated LOC**: ~80

---

#### Task 6.5: Theme Registry Unit Tests

**File**: `packages/cli/src/commands/server/backup/__tests__/ThemeRegistryManager.test.ts`

**Description**: Unit tests for theme registry operations.

**Acceptance Criteria**:
- [ ] Test recordDeployment updates registry
- [ ] Test history limit enforcement for free tier
- [ ] Test rollback finds correct target
- [ ] Test rollback fails without snapshot

**Estimated LOC**: ~150

---

### Sprint 6 Deliverables

| File | Action | LOC |
|------|--------|-----|
| `backup/ThemeRegistryManager.ts` | Create | ~350 |
| `iac/ApplyEngine.ts` | Extend | ~50 |
| `theme/registry.ts` | Create | ~80 |
| `ThemeRegistryManager.test.ts` | Create | ~150 |
| **Total** | | **~630** |

---

## Sprint 7: Service Tiers (Global ID: 170)

**Goal**: Implement tiered service levels with rate limiting, scheduled backups, and cross-region replication.

**Dependencies**: Sprint 6 complete (theme registry working)

### Tasks

#### Task 7.1: Implement TierManager

**File**: `packages/cli/src/commands/server/backup/TierManager.ts`

**Description**: Manage service tier configuration and rate limits.

**Acceptance Criteria**:
- [ ] `getTier(serverId)` - get tier (defaults to free)
- [ ] `setTier(serverId, tier)` - set tier
- [ ] `checkBackupLimit(tier)` - enforce daily limit for free
- [ ] `checkSnapshotLimit(tier)` - enforce weekly limit for free
- [ ] `recordBackup(serverId)` - track usage
- [ ] `recordSnapshot(serverId)` - track usage
- [ ] DynamoDB table: `gaib-server-tiers`

**Estimated LOC**: ~200

---

#### Task 7.2: Integrate Tier Checks

**File**: `packages/cli/src/commands/server/backup/BackupManager.ts` (extend)

**Description**: Add tier limit enforcement to backup operations.

**Acceptance Criteria**:
- [ ] Check tier limits before createBackup
- [ ] Check tier limits before createSnapshot
- [ ] Clear error messages for limit exceeded
- [ ] Premium tier has no limits

**Estimated LOC**: ~50

---

#### Task 7.3: Deploy EventBridge Rules

**File**: `infrastructure/terraform/gaib-backups.tf` (extend)

**Description**: Add scheduled backup triggers.

**Acceptance Criteria**:
- [ ] Daily rule at 03:00 UTC (free tier)
- [ ] Hourly rule (premium tier)
- [ ] Weekly snapshot rule on Sunday 04:00 UTC (premium)
- [ ] EventBridge targets ECS task (or Lambda)

**Estimated LOC (Terraform)**: ~80

---

#### Task 7.4: Deploy Cross-Region Replication (Optional)

**File**: `infrastructure/terraform/gaib-backups-replication.tf`

**Description**: S3 cross-region replication for premium tier.

**Acceptance Criteria**:
- [ ] Replica bucket in us-west-2
- [ ] Replication rule filters by `Tier=premium` tag
- [ ] Separate KMS key in replica region
- [ ] IAM role for replication
- [ ] Controlled by `enable_premium_replication` variable

**Estimated LOC (Terraform)**: ~100

---

#### Task 7.5: TierManager Unit Tests

**File**: `packages/cli/src/commands/server/backup/__tests__/TierManager.test.ts`

**Description**: Unit tests for tier management.

**Acceptance Criteria**:
- [ ] Test tier detection (defaults to free)
- [ ] Test rate limit enforcement
- [ ] Test usage tracking and reset
- [ ] Test premium bypass

**Estimated LOC**: ~120

---

### Sprint 7 Deliverables

| File | Action | LOC |
|------|--------|-----|
| `backup/TierManager.ts` | Create | ~200 |
| `backup/BackupManager.ts` | Extend | ~50 |
| `gaib-backups.tf` | Extend | ~80 |
| `gaib-backups-replication.tf` | Create | ~100 |
| `TierManager.test.ts` | Create | ~120 |
| **Total** | | **~550** |

---

## Sprint 8: Polish & Notifications (Global ID: 171)

**Goal**: Add SNS notifications, CloudWatch alarms, documentation, and final polish.

**Dependencies**: Sprint 7 complete (tiers working)

### Tasks

#### Task 8.1: Implement NotificationService

**File**: `packages/cli/src/commands/server/backup/NotificationService.ts`

**Description**: Send notifications via SNS for backup events.

**Acceptance Criteria**:
- [ ] `notifyBackupComplete(backup)` - publish success message
- [ ] `notifyBackupFailed(error)` - publish failure message
- [ ] `notifySnapshotComplete(snapshot)` - publish success message
- [ ] Message attributes for filtering (type, serverId)
- [ ] Configurable via environment variable (opt-in)

**Estimated LOC**: ~100

---

#### Task 8.2: Integrate Notifications

**File**: `packages/cli/src/commands/server/backup/BackupManager.ts` (extend)

**Description**: Call notification service on backup/snapshot completion.

**Acceptance Criteria**:
- [ ] Notify on successful backup
- [ ] Notify on successful snapshot
- [ ] Notify on failure (with error details)
- [ ] Only when `GAIB_NOTIFICATIONS_ENABLED=true`

**Estimated LOC**: ~30

---

#### Task 8.3: Deploy CloudWatch Alarms

**File**: `infrastructure/terraform/gaib-backups.tf` (extend)

**Description**: Add CloudWatch alarms for backup monitoring.

**Acceptance Criteria**:
- [ ] Alarm for backup errors (custom metric)
- [ ] Alarm for bucket size warning
- [ ] Alarm actions send to SNS topic
- [ ] Dashboard for backup metrics (optional)

**Estimated LOC (Terraform)**: ~60

---

#### Task 8.4: Create Backup Documentation

**File**: `grimoires/pub/docs/GAIB-BACKUP-GUIDE.md`

**Description**: User documentation for backup system.

**Acceptance Criteria**:
- [ ] Overview of backup system
- [ ] Command reference with examples
- [ ] Tier comparison table
- [ ] Troubleshooting guide
- [ ] Best practices

**Estimated LOC**: ~200

---

#### Task 8.5: Error Handling Improvements

**File**: `packages/cli/src/commands/server/backup/*.ts`

**Description**: Improve error handling across backup system.

**Acceptance Criteria**:
- [ ] Consistent error messages
- [ ] Retry logic for transient S3/DynamoDB errors
- [ ] Graceful handling of partial failures
- [ ] User-friendly messages for common errors

**Estimated LOC**: ~100

---

#### Task 8.6: Integration Test Suite

**File**: `packages/cli/src/commands/server/backup/__tests__/integration.test.ts`

**Description**: End-to-end integration tests.

**Acceptance Criteria**:
- [ ] Full backup → restore cycle
- [ ] Full snapshot → restore cycle
- [ ] Theme registry → rollback cycle
- [ ] Tier limit enforcement
- [ ] Uses LocalStack or mocked AWS

**Estimated LOC**: ~200

---

### Sprint 8 Deliverables

| File | Action | LOC |
|------|--------|-----|
| `backup/NotificationService.ts` | Create | ~100 |
| `backup/BackupManager.ts` | Extend | ~30 |
| `gaib-backups.tf` | Extend | ~60 |
| `GAIB-BACKUP-GUIDE.md` | Create | ~200 |
| `*.ts` | Polish | ~100 |
| `integration.test.ts` | Create | ~200 |
| **Total** | | **~690** |

---

## Phase 2 Summary

### Total Effort by Sprint

| Sprint | Goal | LOC |
|--------|------|-----|
| Sprint 3 | Backup Foundation | ~900 |
| Sprint 4 | Restore Engine | ~530 |
| Sprint 5 | Snapshots | ~900 |
| Sprint 6 | Theme Registry | ~630 |
| Sprint 7 | Service Tiers | ~550 |
| Sprint 8 | Polish & Notifications | ~690 |
| **Total** | | **~4,200** |

### New Files Created

| Directory | Files |
|-----------|-------|
| `packages/cli/src/commands/server/backup/` | types.ts, BackupManager.ts, RestoreEngine.ts, SnapshotManager.ts, ThemeRegistryManager.ts, TierManager.ts, NotificationService.ts, index.ts |
| `packages/cli/src/commands/server/snapshot/` | index.ts |
| `packages/cli/src/commands/server/theme/` | registry.ts |
| `packages/cli/src/commands/server/backup/__tests__/` | BackupManager.test.ts, RestoreEngine.test.ts, SnapshotManager.test.ts, ThemeRegistryManager.test.ts, TierManager.test.ts, integration.test.ts |
| `infrastructure/terraform/` | gaib-backups.tf, gaib-backups-replication.tf |
| `grimoires/pub/docs/` | GAIB-BACKUP-GUIDE.md |

### Files Modified

| File | Changes |
|------|---------|
| `packages/cli/src/commands/server/index.ts` | Add backup, snapshot, theme registry commands |
| `packages/cli/src/commands/server/iac/ApplyEngine.ts` | Hook theme registry |
| `infrastructure/terraform/variables.tf` | Add backup-related variables |

---

## Risk Assessment (Phase 2)

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| AWS costs exceed budget | Low | Medium | Lifecycle policies, free tier limits |
| DynamoDB throttling | Low | Medium | Pay-per-request billing, retries |
| Large state files | Low | High | Compression, warn on large backups |
| Cross-region latency | Low | Low | Async replication, local-first |
| Rate limit bypass | Medium | Low | Server-side enforcement |
| Integration test flakiness | Medium | Medium | Use LocalStack, retry logic |

---

## Execution Order (Phase 2)

```bash
# Sprint 3 - Backup Foundation
/implement sprint-3

# Sprint 4 - Restore Engine
/implement sprint-4

# Sprint 5 - Snapshots
/implement sprint-5

# Sprint 6 - Theme Registry
/implement sprint-6

# Sprint 7 - Service Tiers
/implement sprint-7

# Sprint 8 - Polish & Notifications
/implement sprint-8
```

---

## Sprint 9: Wallet Verification Integration (Global ID: 172)

**Goal**: Enable in-house EIP-191 wallet verification for testing Discord server, replacing Collab.Land URLs.

**Dependencies**: Sprint 8 complete, PostgreSQL configured, Sietch theme deployed

### Tasks

#### Task 9.1: Configure Testing Environment

**Files**: `themes/sietch/.env.example`, `themes/sietch/README.md`

**Description**: Document wallet verification configuration for testing environment.

**Acceptance Criteria**:
- [ ] Add `VERIFY_BASE_URL` to .env.example with documentation
- [ ] Add wallet verification section to README.md
- [ ] Document PostgreSQL requirements for session storage
- [ ] Document required environment variables

**Estimated LOC**: ~50

---

#### Task 9.2: Replace Telegram Collab.Land URLs

**Files**: `themes/sietch/src/services/IdentityService.ts`, `themes/sietch/src/telegram/commands/verify.ts`

**Description**: Update Telegram verification to use in-house system instead of Collab.Land.

**Acceptance Criteria**:
- [ ] Update `IdentityService.createVerificationSession()` to return in-house URL
- [ ] Update Telegram `/verify` command to use in-house verification flow
- [ ] Remove Collab.Land URL references
- [ ] Test Telegram verification flow works end-to-end

**Estimated LOC**: ~30

---

#### Task 9.3: Verify Discord Integration (Manual Testing)

**Description**: Validate Discord /verify command works in testing server.

**Acceptance Criteria**:
- [ ] `/verify start` creates session in PostgreSQL
- [ ] Verification page loads at configured URL
- [ ] Wallet linking updates `member_profiles` table
- [ ] `/verify status` shows correct wallet status

---

### Sprint 9 Deliverables

| File | Action | LOC |
|------|--------|-----|
| `themes/sietch/.env.example` | Update | ~30 |
| `themes/sietch/README.md` | Update | ~20 |
| `themes/sietch/src/services/IdentityService.ts` | Update | ~10 |
| `themes/sietch/src/telegram/commands/verify.ts` | Update | ~20 |
| **Total** | | **~80** |

---

## Sprint 10: Comprehensive Tier Testing Suite (Global ID: 173)

**Goal**: Create complete test coverage for the Sietch theme's BGT tier system including threshold crossings, role assignments, and tier transitions.

**Dependencies**: Sprint 9 complete, Vitest configured

### Tasks

#### Task 10.1: Create Test Utilities

**Files**: `themes/sietch/src/test-utils/fixtures.ts`, `themes/sietch/src/test-utils/mocks.ts`

**Description**: Create shared test fixtures and mocks for tier testing.

**Acceptance Criteria**:
- [ ] Tier threshold fixtures (all 9 boundaries with below/exact/above values)
- [ ] Member factory function with sensible defaults
- [ ] Database query mocks (tier-queries.ts)
- [ ] Discord API mocks (client interactions)
- [ ] Config mocks (role IDs)

**Estimated LOC**: ~250

---

#### Task 10.2: TierService Tests

**File**: `themes/sietch/src/services/__tests__/TierService.test.ts`

**Description**: Comprehensive tests for tier calculation logic.

**Acceptance Criteria**:
- [ ] `calculateTier()` - All 9 tier boundaries (below/exact/above)
- [ ] `calculateTier()` - Rank precedence (rank 1-7 = Naib, 8-69 = Fedaykin)
- [ ] `calculateTier()` - Edge cases (0 BGT, null rank, undefined values)
- [ ] `isPromotion()` - All tier transition combinations
- [ ] `getNextTier()` - Progression logic
- [ ] `getTierProgress()` - Progress calculation
- [ ] Test coverage >= 90%

**Estimated LOC**: ~400

---

#### Task 10.3: RoleManager Tests

**File**: `themes/sietch/src/services/__tests__/RoleManager.test.ts`

**Description**: Tests for Discord role synchronization.

**Acceptance Criteria**:
- [ ] `syncTierRole()` - Role assignment on promotion
- [ ] `syncTierRole()` - Role removal on demotion
- [ ] `syncTierRole()` - No-op when tier unchanged
- [ ] `assignTierRolesUpTo()` - Bulk role assignment
- [ ] `removeAllTierRoles()` - Full role removal
- [ ] Discord API calls mocked correctly
- [ ] Test coverage >= 85%

**Estimated LOC**: ~300

---

#### Task 10.4: Eligibility Tests

**File**: `themes/sietch/src/services/__tests__/Eligibility.test.ts`

**Description**: Tests for eligibility computation and diff logic.

**Acceptance Criteria**:
- [ ] `computeDiff()` - Identifies added members
- [ ] `computeDiff()` - Identifies removed members
- [ ] `computeDiff()` - Tracks Naib promotions (to top 7)
- [ ] `computeDiff()` - Tracks Naib demotions (from top 7)
- [ ] `assignRoles()` - Correct role assignment by rank
- [ ] `isEligible()` - Rank <= 69 check
- [ ] `isNaib()` - Rank 1-7 check
- [ ] Test coverage >= 85%

**Estimated LOC**: ~250

---

#### Task 10.5: Threshold Tests

**File**: `themes/sietch/src/services/__tests__/Threshold.test.ts`

**Description**: Tests for threshold and waitlist logic.

**Acceptance Criteria**:
- [ ] `getEntryThreshold()` - Returns position 69's BGT
- [ ] `getWaitlistPositions()` - Returns positions 70-100
- [ ] `getMemberDistances()` - Distance calculations
- [ ] `registerWaitlist()` - Position validation (70-100 range)
- [ ] `checkWaitlistEligibility()` - Detects waitlist → eligible transitions
- [ ] Test coverage >= 85%

**Estimated LOC**: ~200

---

### Sprint 10 Deliverables

| File | Action | LOC |
|------|--------|-----|
| `src/test-utils/fixtures.ts` | Create | ~150 |
| `src/test-utils/mocks.ts` | Create | ~100 |
| `src/services/__tests__/TierService.test.ts` | Create | ~400 |
| `src/services/__tests__/RoleManager.test.ts` | Create | ~300 |
| `src/services/__tests__/Eligibility.test.ts` | Create | ~250 |
| `src/services/__tests__/Threshold.test.ts` | Create | ~200 |
| **Total** | | **~1,400** |

---

## Sprint 11: Backup/Restore E2E Validation (Global ID: 174)

**Goal**: Validate the complete backup and restore process by performing a controlled teardown of the testing Discord server, then restoring it to full functionality.

**Dependencies**: Sprint 3-8 (Backup System), Sietch API running

**PRD Reference**: §6.7 Backup/Restore E2E Validation

### Background

The backup/restore system has two layers:
1. **Discord Structure**: Exported via `gaib server export` → YAML file
2. **Sietch Config**: Checkpoint created by teardown → Database

This sprint validates both layers work together for complete disaster recovery.

### Tasks

#### Task 11.1: Pre-Teardown Export

**Description**: Export the testing Discord server structure to a YAML backup file before teardown.

**Steps**:
```bash
# Export Discord server structure
gaib server export --guild {GUILD_ID} -o testing-server-backup.yaml --include-unmanaged

# Verify export contains expected data
cat testing-server-backup.yaml
```

**Acceptance Criteria**:
- [ ] Export command succeeds
- [ ] YAML contains all roles (excluding bot-managed and @everyone)
- [ ] YAML contains all categories
- [ ] YAML contains all channels with permissions
- [ ] File saved to `testing-server-backup.yaml`

---

#### Task 11.2: Preview Teardown (Dry Run)

**Description**: Preview what the teardown will delete without making changes.

**Steps**:
```bash
gaib server teardown --guild {GUILD_ID} --confirm-teardown --dry-run
```

**Acceptance Criteria**:
- [ ] Dry run shows list of roles to be deleted
- [ ] Dry run shows list of categories to be deleted
- [ ] Dry run shows list of channels to be deleted
- [ ] No actual changes made

---

#### Task 11.3: Execute Teardown

**Description**: Execute the teardown command, which automatically creates a Sietch checkpoint before destruction.

**Steps**:
```bash
# Execute teardown (creates checkpoint automatically)
gaib server teardown --guild {GUILD_ID} --confirm-teardown

# Record the checkpoint ID from output
```

**Acceptance Criteria**:
- [ ] Checkpoint created before destruction (see output)
- [ ] Checkpoint ID displayed in output
- [ ] 4-stage confirmation completes successfully
- [ ] All channels deleted
- [ ] All custom roles deleted
- [ ] All categories deleted
- [ ] Only @everyone role remains

---

#### Task 11.4: Verify Destruction

**Description**: Verify the Discord server is properly destroyed.

**Steps**:
1. Open Discord and navigate to the test server
2. Verify no custom channels exist
3. Verify no custom roles exist (only @everyone)
4. Verify no categories exist

**Acceptance Criteria**:
- [ ] Visual confirmation: server is empty
- [ ] Only @everyone role visible
- [ ] No text channels (except Discord system channels if any)
- [ ] No voice channels
- [ ] No categories

---

#### Task 11.5: Restore Discord Structure

**Description**: Restore the Discord server structure from the YAML export.

**Steps**:
```bash
gaib apply testing-server-backup.yaml --guild {GUILD_ID}
```

**Acceptance Criteria**:
- [ ] Apply command succeeds
- [ ] All roles recreated with correct colors
- [ ] All roles recreated with correct permissions
- [ ] All categories recreated with correct names
- [ ] All channels recreated in correct categories
- [ ] Channel permissions match original

---

#### Task 11.6: Restore Sietch Configuration

**Description**: Restore the Sietch application configuration from the checkpoint.

**Steps**:
```bash
# List available checkpoints
gaib restore list --guild {GUILD_ID}

# Preview restore impact
gaib restore preview --checkpoint {CHECKPOINT_ID}

# Execute restore
gaib restore exec --checkpoint {CHECKPOINT_ID}
```

**Acceptance Criteria**:
- [ ] Checkpoint appears in list
- [ ] Preview shows config to be restored
- [ ] Restore command succeeds
- [ ] Tier thresholds restored
- [ ] Feature gates restored
- [ ] Role mappings restored (may need re-mapping to new role IDs)

---

#### Task 11.7: Verify Full Restoration

**Description**: Verify the server is fully functional after restoration.

**Verification Checklist**:
- [ ] All channels visible and accessible
- [ ] All roles visible in server settings
- [ ] Role colors correct
- [ ] Role permissions correct
- [ ] Bot (@Shai-Hulud) can respond to commands
- [ ] `/verify` command works
- [ ] Tier role assignments working (test with known user)
- [ ] Feature gates active (test tier-gated features)

**Manual Tests**:
1. Post in a tier-gated channel - should respect permissions
2. Run `/help` command - bot should respond
3. Check a user's roles - should match their BGT tier
4. Verify waitlist functionality if applicable

**Acceptance Criteria**:
- [ ] Server functionally identical to pre-teardown state
- [ ] No error messages in bot logs
- [ ] Users retain appropriate access

---

#### Task 11.8: Document Findings

**Description**: Document the backup/restore procedure and any issues discovered.

**Deliverables**:
- [ ] Update `themes/sietch/README.md` with disaster recovery section
- [ ] Document the two-layer backup architecture
- [ ] Note any role ID remapping required
- [ ] Record any issues encountered and resolutions

**Acceptance Criteria**:
- [ ] README updated with backup/restore procedure
- [ ] Known limitations documented
- [ ] Recovery time recorded

---

### Sprint 11 Deliverables

| Deliverable | Type | Description |
|-------------|------|-------------|
| `testing-server-backup.yaml` | Export | Discord structure backup |
| Checkpoint record | Database | Sietch config backup |
| E2E test results | Documentation | Pass/fail for each task |
| README update | Documentation | Disaster recovery procedure |

### Success Criteria

| Metric | Target | Actual |
|--------|--------|--------|
| Export captures all structure | 100% | TBD |
| Checkpoint captures all config | 100% | TBD |
| Restore matches original | Functionally identical | TBD |
| Bot functionality restored | All commands work | TBD |
| Total recovery time | <15 minutes | TBD |

### Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Export fails | Verify file before teardown |
| Checkpoint creation fails | Teardown is blocked (fail-safe) |
| Role ID mismatch | Apply recreates roles; checkpoint uses role names for mapping |
| Partial restore | Export file remains for re-apply |

### Rollback Plan

If restoration fails:
1. Re-apply export: `gaib apply testing-server-backup.yaml --guild {GUILD_ID}`
2. Checkpoint remains available for 30 days
3. Can manually recreate from theme: `gaib server apply --theme sietch`

---

**Document Owner**: Sietch Infrastructure Team
**Review Cadence**: On sprint completion
