# Product Requirements Document: Gaib Discord IaC - Full Sietch Theme + Backup System

**Version**: 2.0.0
**Date**: January 29, 2026
**Status**: Active
**Cycle**: cycle-007
**Codename**: Sandworm Command

> **Extension**: This PRD has been extended to include the Gaib Backup & Snapshot System (Phases 3-8).

---

## 1. Executive Summary

### 1.1 Product Overview

**Gaib** is a Discord Infrastructure-as-Code (IaC) CLI that enables programmatic Discord server provisioning using a Terraform-inspired workflow. Combined with the **Sietch v3.0 theme**, Gaib provides a complete solution for deploying token-gated Discord communities.

This cycle focuses on:
1. Completing the Sietch v3.0 theme with full 9-tier BGT structure
2. Validating Gaib CLI end-to-end functionality
3. Enabling test community deployments via `gaib server apply`

### 1.2 Vision

**"Vercel for Discord"** - Developers use Gaib to access IaC tools for deploying Discord servers. Teams define their server structure in YAML, version control it, and deploy with a single command.

### 1.3 Problem Statement

**Current State**:
- Gaib CLI is ~90% implemented with Terraform-like workflow
- Sietch theme exists but only has 6 roles (needs 9 BGT tiers + special roles)
- Theme channel structure doesn't match Sietch v3.0 PRD
- No end-to-end validation of the complete workflow
- Manual Discord setup is error-prone (see `DISCORD-SETUP-GUIDE.md`)

**Desired State**:
- Complete Sietch v3.0 theme matching PRD specification
- Validated Gaib CLI that can provision a test Discord server
- Reproducible, version-controlled Discord server configuration
- Unblock teammates to work on websites while test communities deploy

### 1.4 Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Theme Completeness | 100% | All 9 tiers + special roles + channel structure |
| CLI E2E Test | Pass | `gaib server apply` creates test server successfully |
| State Management | Working | State persists across operations |
| Diff Accuracy | 100% | `gaib server diff` shows accurate changes |
| Documentation | Complete | Theme README with usage instructions |

---

## 2. Core Requirements

### 2.1 Sietch v3.0 Theme - Roles

#### 2.1.1 BGT Tier Roles (9 Tiers)

| Role | Color | Hex Code | BGT Threshold | Position |
|------|-------|----------|---------------|----------|
| `@Naib` | Gold | `#FFD700` | Top 7 by rank | 100 |
| `@Fedaykin` | Blue | `#4169E1` | Top 8-69 by rank | 95 |
| `@Usul` | Purple | `#9B59B6` | 1111+ BGT | 90 |
| `@Sayyadina` | Indigo | `#6610F2` | 888+ BGT | 85 |
| `@Mushtamal` | Teal | `#20C997` | 690+ BGT | 80 |
| `@Sihaya` | Green | `#28A745` | 420+ BGT | 75 |
| `@Qanat` | Cyan | `#17A2B8` | 222+ BGT | 70 |
| `@Ichwan` | Orange | `#FD7E14` | 69+ BGT | 65 |
| `@Hajra` | Sand | `#C2B280` | 6.9+ BGT | 60 |

#### 2.1.2 Special Roles

| Role | Color | Hex Code | Criteria | Position |
|------|-------|----------|----------|----------|
| `@Former Naib` | Silver | `#C0C0C0` | Previously held Naib seat | 55 |
| `@Taqwa` | Sand | `#C2B280` | Waitlist registration | 50 |
| `@Water Sharer` | Aqua | `#00D4FF` | Badge holder (can share) | 45 |
| `@Engaged` | Green | `#28A745` | 5+ badges earned | 40 |
| `@Veteran` | Purple | `#9B59B6` | 90+ days tenure | 35 |

#### 2.1.3 Bot Role

| Role | Color | Hex Code | Position |
|------|-------|----------|----------|
| `@Shai-Hulud` | Gold | `#FFD700` | 99 (below Naib, above all others) |

### 2.2 Sietch v3.0 Theme - Channel Structure

#### 2.2.1 Category: STILLSUIT (Public Info)

| Channel | Type | Purpose | Read | Write |
|---------|------|---------|------|-------|
| `#water-discipline` | Text | Welcome, rules | Everyone | Naib only |
| `#announcements` | Announcement | Weekly digest | Everyone | Naib, Bot |

#### 2.2.2 Category: CAVE ENTRANCE (Tier 0: 6.9+ BGT)

| Channel | Type | Purpose | Read | Write |
|---------|------|---------|------|-------|
| `#cave-entrance` | Text | Entry discussion | Hajra+ | Ichwan+ |
| `cave-voices` | Voice | Voice chat | Hajra+ (count only) | Ichwan+ |

#### 2.2.3 Category: THE DEPTHS (Tier 2: 222+ BGT)

| Channel | Type | Purpose | Read | Write |
|---------|------|---------|------|-------|
| `#the-depths` | Text | Deeper discussions | Qanat+ | Sihaya+ |
| `depth-voices` | Voice | Voice chat | Qanat+ (count only) | Mushtamal+ |

#### 2.2.4 Category: INNER SANCTUM (Tier 3: 888+ BGT)

| Channel | Type | Purpose | Read | Write |
|---------|------|---------|------|-------|
| `#inner-sanctum` | Text | Elite discussions | Sayyadina+ | Sayyadina+ |
| `sanctum-voices` | Voice | Voice chat | Sayyadina+ (listen only) | Usul+ |

#### 2.2.5 Category: FEDAYKIN COMMONS (Top 69)

| Channel | Type | Purpose | Permissions |
|---------|------|---------|-------------|
| `#general` | Text | Main discussion | Fedaykin+ full |
| `#spice` | Text | Alpha/trading | Fedaykin+ full |
| `#water-shares` | Text | Proposals | Fedaykin+ full |
| `#introductions` | Text | Member intros | Fedaykin+ full |
| `#census` | Text | Live leaderboard | Fedaykin+ read, Bot write |
| `#the-door` | Text | Join/leave notices | Fedaykin+ read, Bot write |
| `fedaykin-voices` | Voice | Main voice | Fedaykin+ full |

#### 2.2.6 Category: NAIB COUNCIL (Top 7 Only)

| Channel | Type | Purpose | Permissions |
|---------|------|---------|-------------|
| `#council-rock` | Text | Private Naib discussion | Naib only |
| `council-chamber` | Voice | Private Naib voice | Naib only |

#### 2.2.7 Category: NAIB ARCHIVES

| Channel | Type | Purpose | Permissions |
|---------|------|---------|-------------|
| `#naib-archives` | Text | Historical discussions | Naib + Former Naib |

#### 2.2.8 Category: BADGE CHANNELS

| Channel | Type | Purpose | Permissions |
|---------|------|---------|-------------|
| `#the-oasis` | Text | Water Sharer exclusive | @Water Sharer only |
| `#deep-desert` | Text | Engaged exclusive | @Engaged only |
| `#stillsuit-lounge` | Text | Veteran exclusive | @Veteran only |

#### 2.2.9 Category: SUPPORT

| Channel | Type | Purpose | Permissions |
|---------|------|---------|-------------|
| `#support` | Text | Help/troubleshooting | Fedaykin+ |
| `#bot-commands` | Text | Bot interaction | Fedaykin+ |

### 2.3 Gaib CLI Validation

#### 2.3.1 Commands to Validate

| Command | Expected Behavior |
|---------|-------------------|
| `gaib server init --theme sietch` | Creates discord-server.yaml with Sietch theme |
| `gaib server plan` | Shows planned changes without applying |
| `gaib server diff` | Shows detailed diff between config and Discord |
| `gaib server apply` | Creates roles and channels on Discord |
| `gaib server apply --auto-approve` | Applies without confirmation |
| `gaib server destroy` | Removes managed resources |
| `gaib server state ls` | Lists resources in state |
| `gaib server workspace ls` | Lists workspaces |

#### 2.3.2 State Management

- State persists between operations
- State locking prevents concurrent modifications
- Import existing resources: `gaib server import role.naib <discord-id>`

#### 2.3.3 Theme Loading

- `gaib server theme ls` - Lists available themes
- `gaib server theme info sietch` - Shows Sietch theme details
- Theme variables interpolate correctly

---

## 3. Theme Variable System

### 3.1 Sietch Theme Variables

```yaml
variables:
  community_name:
    type: string
    default: "Sietch"
    description: Name of your community

  # BGT Tier Colors
  color_naib:
    type: color
    default: "#FFD700"
  color_fedaykin:
    type: color
    default: "#4169E1"
  color_usul:
    type: color
    default: "#9B59B6"
  color_sayyadina:
    type: color
    default: "#6610F2"
  color_mushtamal:
    type: color
    default: "#20C997"
  color_sihaya:
    type: color
    default: "#28A745"
  color_qanat:
    type: color
    default: "#17A2B8"
  color_ichwan:
    type: color
    default: "#FD7E14"
  color_hajra:
    type: color
    default: "#C2B280"

  # Special Role Colors
  color_former_naib:
    type: color
    default: "#C0C0C0"
  color_taqwa:
    type: color
    default: "#C2B280"
  color_water_sharer:
    type: color
    default: "#00D4FF"
  color_engaged:
    type: color
    default: "#28A745"
  color_veteran:
    type: color
    default: "#9B59B6"

  # Feature Flags
  enable_voice:
    type: boolean
    default: true
  enable_badge_channels:
    type: boolean
    default: true
```

### 3.2 Variable Interpolation

Variables are referenced with `${variable_name}` syntax:
```yaml
roles:
  - name: Naib
    color: "${color_naib}"
```

---

## 4. File Structure

### 4.1 Theme Directory

```
themes/sietch/
├── theme.yaml           # Theme manifest
├── roles.yaml           # Role definitions (9 tiers + special)
├── channels.yaml        # Channel structure
├── server.yaml          # Server-level settings (optional)
└── README.md            # Theme documentation
```

### 4.2 Generated Config

Running `gaib server init --theme sietch` produces:

```
./discord-server.yaml    # Merged config ready for apply
./.gaib/
├── workspaces/
│   └── default/
│       └── state.json   # Terraform-like state
└── config.yaml          # Gaib configuration
```

---

## 5. Dependencies

### 5.1 External Dependencies

| Dependency | Purpose | Status |
|------------|---------|--------|
| Discord Bot Token | API authentication | Required |
| Discord Guild ID | Target server | Required |
| Node.js 18+ | Runtime | Required |
| pnpm | Package manager | Required |

### 5.2 Internal Dependencies

| Component | Path | Status |
|-----------|------|--------|
| Gaib CLI | `packages/cli/` | ~90% complete |
| ApplyEngine | `packages/cli/src/commands/server/iac/ApplyEngine.ts` | Implemented |
| DiffEngine | `packages/cli/src/commands/server/iac/DiffEngine.ts` | Implemented |
| ConfigParser | `packages/cli/src/commands/server/iac/ConfigParser.ts` | Implemented |
| ThemeLoader | `packages/cli/src/commands/server/themes/ThemeLoader.ts` | Implemented |
| StateWriter | `packages/cli/src/commands/server/iac/StateWriter.ts` | Implemented |

---

## 6. Out of Scope

- Full Sietch bot functionality (tier sync, badges, etc.)
- NOWPayments crypto integration
- Admin dashboard
- AWS deployment (handled separately)
- Marketing website

---

## 6.5 Wallet Verification Integration (Sprint 172)

### 6.5.1 Overview

Enable the in-house EIP-191 wallet verification system for user onboarding in the testing Discord server. This replaces Collab.Land with a native solution built in sprints 78-79, 81.

### 6.5.2 Problem Statement

**Current State**:
- In-house wallet verification system exists (`packages/verification/`)
- Discord `/verify` command uses in-house system ✅
- Telegram verification still routes to Collab.Land URLs ⚠️
- Environment configuration not documented for testing setup
- Onboarding flow doesn't integrate with wallet verification

**Desired State**:
- Testing server can use in-house wallet verification
- Environment properly documented for verification setup
- Telegram verification uses in-house system (not Collab.Land)
- Onboarding flow includes wallet verification step

### 6.5.3 Requirements

#### R1: Environment Configuration
- Document `VERIFY_BASE_URL` in `.env.example`
- Document PostgreSQL requirements for session storage
- Add verification section to theme README

#### R2: Replace Collab.Land URLs
- Update `IdentityService.ts` to use in-house verification URL
- Update Telegram verification commands to use in-house flow
- Remove Collab.Land dependency from verification flow

#### R3: Onboarding Integration (Optional)
- Add wallet verification status to onboarding flow
- Show verification status in profile embeds

### 6.5.4 Success Metrics

| Metric | Target |
|--------|--------|
| Discord /verify works | 100% |
| Telegram /verify works (no Collab.Land) | 100% |
| Environment documented | Complete |

---

## 6.6 Comprehensive Tier Testing Suite (Sprint 173)

### 6.6.1 Overview

Create a complete test suite for the Sietch theme's BGT tier system to ensure all threshold crossings, role assignments, and tier transitions work correctly.

### 6.6.2 Problem Statement

**Current State**:
- Only `BadgeService.test.ts` exists (1 test file)
- No tests for core tier functionality (TierService, RoleManager, EligibilityService)
- 80% coverage threshold configured but not enforced
- Critical business logic untested

**Desired State**:
- Comprehensive test coverage for all tier services
- All 9 BGT tiers tested at threshold boundaries
- Role assignment/removal fully tested with mocked Discord API
- Eligibility and waitlist logic tested
- Mocking patterns established for future tests

### 6.6.3 Test Coverage Requirements

#### Core Services to Test

| Service | File | Priority |
|---------|------|----------|
| TierService | `src/services/TierService.ts` | P0 - Critical |
| RoleManager | `src/services/roleManager.ts` | P0 - Critical |
| EligibilityService | `src/services/eligibility.ts` | P1 - High |
| ThresholdService | `src/services/threshold.ts` | P1 - High |

#### Tier Threshold Test Cases

| Tier | Threshold | Test Cases |
|------|-----------|------------|
| Hajra | 6.9 BGT | Below (6.8), Exact (6.9), Above (7.0) |
| Ichwan | 69 BGT | Below (68.9), Exact (69), Above (70) |
| Qanat | 222 BGT | Below (221.9), Exact (222), Above (223) |
| Sihaya | 420 BGT | Below (419.9), Exact (420), Above (421) |
| Mushtamal | 690 BGT | Below (689.9), Exact (690), Above (691) |
| Sayyadina | 888 BGT | Below (887.9), Exact (888), Above (889) |
| Usul | 1111 BGT | Below (1110.9), Exact (1111), Above (1112) |
| Fedaykin | Rank 8-69 | Rank 8, Rank 69, Rank 70 (ineligible) |
| Naib | Rank 1-7 | Rank 1, Rank 7, Rank 8 (demotes to Fedaykin) |

#### Scenario Test Cases

1. **Tier Promotion**: User crosses threshold upward
2. **Tier Demotion**: User crosses threshold downward (e.g., redeems BGT)
3. **Rank Override**: High-ranked user with low BGT gets rank-based tier
4. **Role Assignment**: Discord roles assigned on promotion
5. **Role Removal**: Discord roles removed on demotion
6. **Waitlist Entry**: Position 70-100 users tracking threshold
7. **Waitlist Promotion**: Waitlist user reaches position 69

### 6.6.4 Success Metrics

| Metric | Target |
|--------|--------|
| TierService test coverage | 90% |
| RoleManager test coverage | 85% |
| EligibilityService test coverage | 85% |
| All tier boundaries tested | 100% |
| CI tests passing | Required |

---

## 7. Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Discord rate limits | Medium | Medium | RateLimiter already implemented |
| Permission conflicts | Medium | High | Test on sandbox server first |
| State corruption | Low | High | State backup before operations |
| Theme variable edge cases | Low | Medium | Comprehensive test coverage |

---

## 8. Testing Strategy

### 8.1 Unit Tests

- Theme loading and variable interpolation
- Config parsing and validation
- Diff calculation accuracy

### 8.2 Integration Tests

- Create test Discord server (sandbox)
- Apply Sietch theme
- Verify all 9 roles created correctly
- Verify channel structure matches spec
- Verify permissions are correct
- Destroy and verify cleanup

### 8.3 E2E Workflow Test

```bash
# 1. Initialize
gaib server init --theme sietch --guild $TEST_GUILD_ID

# 2. Preview changes
gaib server plan

# 3. Apply
gaib server apply --auto-approve

# 4. Verify state
gaib server state ls

# 5. Make change and diff
# Edit discord-server.yaml
gaib server diff

# 6. Apply change
gaib server apply

# 7. Cleanup
gaib server destroy --auto-approve
```

---

## 9. Acceptance Criteria

### 9.1 Theme Completeness

- [ ] All 9 BGT tier roles defined in `roles.yaml`
- [ ] All 5 special roles defined in `roles.yaml`
- [ ] Bot role (Shai-Hulud) defined
- [ ] All 8 categories defined in `channels.yaml`
- [ ] All 20+ channels defined with correct permissions
- [ ] Theme variables for all colors
- [ ] Feature flags for voice and badge channels
- [ ] `theme.yaml` manifest references all files
- [ ] README.md with usage instructions

### 9.2 Gaib CLI Validation

- [ ] `gaib server init --theme sietch` works
- [ ] `gaib server plan` shows accurate preview
- [ ] `gaib server diff` shows detailed changes
- [ ] `gaib server apply` creates resources on Discord
- [ ] State persists correctly
- [ ] `gaib server destroy` cleans up resources

### 9.3 Documentation

- [ ] Theme README with setup instructions
- [ ] Variable reference table
- [ ] Permission matrix documentation

---

## 10. Timeline

| Phase | Tasks | Estimated Duration |
|-------|-------|-------------------|
| Theme Implementation | Create full roles.yaml, channels.yaml | Sprint 1 |
| CLI Validation | Test all commands end-to-end | Sprint 2 |
| Documentation | README, variable reference | Sprint 2 |
| Integration Testing | Full E2E on test server | Sprint 2 |

---

## 11. References

| Document | Path |
|----------|------|
| Discord Setup Guide | `grimoires/pub/docs/DISCORD-SETUP-GUIDE.md` |
| Original Sietch PRD | `feature/loa-mount:loa-grimoire/prd.md` |
| Gaib CLI Index | `packages/cli/src/commands/server/index.ts` |
| Current Theme | `themes/sietch/` |

---

## 12. Appendix: Role Hierarchy Diagram

```
┌─────────────────────────────────────┐
│ Server Owner                         │
├─────────────────────────────────────┤
│ @Naib (Top 7)              #FFD700  │
│ @Shai-Hulud (Bot)          #FFD700  │
│ @Fedaykin (Top 8-69)       #4169E1  │
│ @Usul (1111+ BGT)          #9B59B6  │
│ @Sayyadina (888+ BGT)      #6610F2  │
│ @Mushtamal (690+ BGT)      #20C997  │
│ @Sihaya (420+ BGT)         #28A745  │
│ @Qanat (222+ BGT)          #17A2B8  │
│ @Ichwan (69+ BGT)          #FD7E14  │
│ @Hajra (6.9+ BGT)          #C2B280  │
├─────────────────────────────────────┤
│ @Former Naib               #C0C0C0  │
│ @Taqwa (Waitlist)          #C2B280  │
│ @Water Sharer              #00D4FF  │
│ @Engaged                   #28A745  │
│ @Veteran                   #9B59B6  │
├─────────────────────────────────────┤
│ @everyone                            │
└─────────────────────────────────────┘
```

---

## 6.7 Backup/Restore E2E Validation (Sprint 174)

### 6.7.1 Overview

Validate the complete backup and restore process by performing a controlled teardown of the testing Discord server, then restoring it to full functionality.

### 6.7.2 Problem Statement

**Current State**:
- Teardown command creates checkpoints before destruction (Sprint 149) ✅
- Checkpoint system captures Sietch application configuration
- Export command captures Discord server structure
- No E2E validation that the full backup/restore cycle works

**Critical Finding**: The checkpoint system captures **application configuration** (tier thresholds, feature gates, role mappings), but NOT Discord server structure (channels, roles, categories). Complete recovery requires:
1. `gaib server export` → Discord structure backup (YAML)
2. `gaib server teardown` → Auto-creates Sietch config checkpoint
3. `gaib apply` → Restores Discord structure
4. `gaib restore exec` → Restores Sietch configuration

**Desired State**:
- E2E test confirms full server recovery from teardown
- Documentation updated with complete backup/restore procedure
- Confidence in disaster recovery capability

### 6.7.3 Two-Layer Backup Architecture

| Layer | Tool | Captures | Storage |
|-------|------|----------|---------|
| Discord Structure | `gaib server export` | Roles, channels, categories, permissions | YAML file |
| Sietch Config | Teardown checkpoint | Tier thresholds, feature gates, role mappings | Database |

### 6.7.4 Test Procedure

**Phase 1: Pre-Teardown Backup**
```bash
# Export Discord structure
gaib server export --guild {GUILD_ID} -o testing-server-backup.yaml

# Preview teardown
gaib server teardown --guild {GUILD_ID} --confirm-teardown --dry-run
```

**Phase 2: Execute Teardown**
```bash
# Teardown (auto-creates checkpoint)
gaib server teardown --guild {GUILD_ID} --confirm-teardown
# Save checkpoint ID from output
```

**Phase 3: Verify Destruction**
- Discord server should have no channels/roles except @everyone

**Phase 4: Restore Discord Structure**
```bash
gaib apply testing-server-backup.yaml --guild {GUILD_ID}
```

**Phase 5: Restore Sietch Configuration**
```bash
gaib restore list --guild {GUILD_ID}
gaib restore preview --checkpoint {CHECKPOINT_ID}
gaib restore exec --checkpoint {CHECKPOINT_ID}
```

**Phase 6: Verify Full Restoration**
- [ ] All channels restored
- [ ] All roles restored with correct permissions
- [ ] Tier role assignments working
- [ ] Bot commands responding
- [ ] Feature gates active

### 6.7.5 Success Metrics

| Metric | Target |
|--------|--------|
| Export captures all structure | 100% roles, channels, categories |
| Checkpoint captures all config | Thresholds, gates, mappings |
| Restore matches original | Functionally identical |
| Bot functionality restored | All commands work |

### 6.7.6 Requirements

| Item | Source |
|------|--------|
| Guild ID | `DISCORD_GUILD_ID` env var |
| Discord Bot Token | `DISCORD_TOKEN` env var |
| Sietch API running | For checkpoint/restore |

---

**Document Owner**: Sietch Infrastructure Team
**Review Cadence**: On theme or CLI changes

---

# PART 2: Gaib Backup & Snapshot System

## 13. Backup System Overview

### 13.1 Vision

Comprehensive backup and snapshot system for Gaib-deployed Discord servers with tiered service levels. Users can restore their Discord server configuration to any point in time, roll back theme deployments, and maintain audit history of all changes.

**"Time Machine for Discord Infrastructure"** - Every deployment is recoverable.

### 13.2 Problem Statement

**Current State**:
- Gaib CLI manages Discord server state but has no backup capability
- State files can be corrupted or lost with no recovery path
- No audit trail of theme deployments over time
- Users cannot roll back to previous server configurations
- No differentiated service levels for backup frequency/retention

**Desired State**:
- Automatic daily backups for all Gaib-managed servers (Free tier)
- Hourly backups with 90-day retention (Premium tier)
- Full snapshot capability with manifest, state, config export
- Theme registry tracking all deployments with rollback capability
- Cross-region replication for disaster recovery (Premium)

### 13.3 Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Backup Creation | <5s | Time to create state backup |
| Restore Accuracy | 100% | State matches backup exactly |
| Snapshot Size | <1MB avg | Compressed snapshot size |
| Recovery Time | <30s | Full restore from snapshot |
| Tier Coverage | 100% | All features per tier work |

---

## 14. Backup System Requirements

### 14.1 State Backup (Core)

#### Commands
```bash
gaib server backup create [--message "..."]     # Create backup
gaib server backup list [--limit 20]            # List backups
gaib server backup restore <backup-id> [--dry-run]  # Restore
gaib server backup delete <backup-id>           # Delete backup
```

#### Backup Object Structure
```typescript
interface BackupMetadata {
  id: string;                    // UUID
  serverId: string;              // Discord Guild ID
  workspace: string;             // Gaib workspace name
  timestamp: string;             // ISO 8601
  serial: number;                // State serial at backup time
  lineage: string;               // State lineage ID
  message?: string;              // User description
  tier: "free" | "premium";      // Service tier
  size: number;                  // Compressed size in bytes
  checksum: string;              // SHA-256 of compressed state
}
```

#### Backup Storage
```
s3://gaib-backups-{account_id}/
├── state/{server_id}/{workspace}/
│   └── backup.{timestamp}.json.gz
```

### 14.2 Config Export (Enhanced)

Enhance existing `gaib server export` to support backup integration:

```bash
gaib server export --backup                     # Export + create backup
gaib server export -o ./config.yaml            # Export to file
```

#### Export Storage
```
s3://gaib-backups-{account_id}/
├── exports/{server_id}/
│   ├── config.{timestamp}.yaml
│   └── config.latest.yaml                      # Symlink to latest
```

### 14.3 Full Snapshots

Complete server state bundles for point-in-time recovery:

#### Commands
```bash
gaib server snapshot create [--message "..."]   # Create snapshot
gaib server snapshot list                       # List snapshots
gaib server snapshot restore <id> [--dry-run] [--apply]
gaib server snapshot download <id> -o ./backup/
gaib server snapshot compare <id1> <id2>        # Diff two snapshots
```

#### Snapshot Bundle Structure
```
s3://gaib-backups-{account_id}/
├── snapshots/{server_id}/{snapshot_id}/
│   ├── manifest.json           # Snapshot metadata
│   ├── state.json.gz           # Compressed Gaib state
│   ├── config.yaml.gz          # Compressed config export
│   └── theme-registry.json.gz  # Theme deployment history
```

#### Manifest Schema
```typescript
interface SnapshotManifest {
  id: string;
  version: "1.0";
  serverId: string;
  workspace: string;
  timestamp: string;
  serial: number;
  lineage: string;
  message?: string;
  tier: "free" | "premium";

  files: {
    state: { path: string; checksum: string; size: number };
    config: { path: string; checksum: string; size: number };
    themeRegistry: { path: string; checksum: string; size: number };
  };

  discord: {
    roleCount: number;
    channelCount: number;
    categoryCount: number;
  };

  theme?: {
    name: string;
    version: string;
  };
}
```

### 14.4 Theme Registry

Track all theme deployments with rollback capability:

#### Commands
```bash
gaib server theme registry                      # Show current + last 5
gaib server theme history [--limit]             # Full deployment history
gaib server theme rollback [--steps 1]          # Rollback N deployments
gaib server theme rollback --to <deployment-id> # Rollback to specific
```

#### Registry Storage
```
s3://gaib-backups-{account_id}/
├── themes/{server_id}/
│   ├── registry.json           # Current theme state
│   └── audit/{timestamp}.json  # Deployment audit entries
```

#### Registry Schema
```typescript
interface ThemeRegistry {
  serverId: string;
  currentTheme: {
    name: string;
    version: string;
    deployedAt: string;
    deploymentId: string;
  } | null;

  history: ThemeDeployment[];
}

interface ThemeDeployment {
  id: string;                   // UUID
  timestamp: string;            // ISO 8601
  themeName: string;
  themeVersion: string;
  serial: number;               // State serial after deployment
  action: "apply" | "rollback" | "destroy";
  snapshotId?: string;          // Associated snapshot
  message?: string;
}
```

---

## 15. Service Tiers

### 15.1 Tier Comparison

| Feature | Free Tier | Premium Tier |
|---------|-----------|--------------|
| Backup Frequency | Daily (03:00 UTC) | Hourly |
| On-demand Backups | 1/day | Unlimited |
| Retention | 7 days | 90 days |
| Cross-Region Replication | No | Yes (us-west-2) |
| Full Snapshots | Manual only | Weekly auto |
| Theme History | Last 5 | Unlimited |
| Storage Class | S3 Standard | Standard → Glacier (30d) |
| Support | Community | Priority |

### 15.2 Tier Configuration

Initial implementation uses DynamoDB feature flag:

```typescript
interface ServerTierConfig {
  serverId: string;
  tier: "free" | "premium";
  createdAt: string;
  updatedAt: string;
  // Future: stripeCustomerId, licenseKey, etc.
}
```

Storage in DynamoDB table `gaib-server-tiers`:
- Partition Key: `SERVER#{serverId}`
- TTL: None (persistent)

### 15.3 Rate Limits

| Operation | Free Tier | Premium Tier |
|-----------|-----------|--------------|
| backup create | 1/day | Unlimited |
| backup restore | 3/day | Unlimited |
| snapshot create | 3/week | Unlimited |
| snapshot restore | 1/day | Unlimited |

---

## 16. Infrastructure Requirements

### 16.1 New AWS Resources

#### S3 Bucket: `gaib-backups-{account_id}`
```hcl
resource "aws_s3_bucket" "gaib_backups" {
  bucket = "gaib-backups-${data.aws_caller_identity.current.account_id}"

  tags = {
    Name    = "Gaib Backup Storage"
    Purpose = "Discord IaC Backups"
  }
}

resource "aws_s3_bucket_versioning" "gaib_backups" {
  bucket = aws_s3_bucket.gaib_backups.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "gaib_backups" {
  bucket = aws_s3_bucket.gaib_backups.id

  rule {
    id     = "free-tier-retention"
    status = "Enabled"

    filter {
      tag {
        key   = "Tier"
        value = "free"
      }
    }

    expiration {
      days = 7
    }
  }

  rule {
    id     = "premium-tier-glacier"
    status = "Enabled"

    filter {
      tag {
        key   = "Tier"
        value = "premium"
      }
    }

    transition {
      days          = 30
      storage_class = "GLACIER"
    }

    expiration {
      days = 90
    }
  }
}
```

#### KMS Key for Backup Encryption
```hcl
resource "aws_kms_key" "gaib_backups" {
  description             = "Gaib backup encryption key"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "Enable IAM User Permissions"
        Effect = "Allow"
        Principal = {
          AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"
        }
        Action   = "kms:*"
        Resource = "*"
      }
    ]
  })
}
```

#### DynamoDB Table: `gaib-backup-metadata`
```hcl
resource "aws_dynamodb_table" "gaib_backup_metadata" {
  name           = "gaib-backup-metadata"
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "PK"
  range_key      = "SK"

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  attribute {
    name = "GSI1PK"
    type = "S"
  }

  attribute {
    name = "GSI1SK"
    type = "S"
  }

  global_secondary_index {
    name            = "GSI1"
    hash_key        = "GSI1PK"
    range_key       = "GSI1SK"
    projection_type = "ALL"
  }

  ttl {
    attribute_name = "TTL"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = true
  }
}
```

#### EventBridge Rules for Scheduled Backups
```hcl
# Free tier: Daily at 03:00 UTC
resource "aws_cloudwatch_event_rule" "backup_daily" {
  name                = "gaib-backup-daily"
  schedule_expression = "cron(0 3 * * ? *)"
}

# Premium tier: Hourly
resource "aws_cloudwatch_event_rule" "backup_hourly" {
  name                = "gaib-backup-hourly"
  schedule_expression = "rate(1 hour)"
}
```

#### SNS Topic for Notifications
```hcl
resource "aws_sns_topic" "gaib_backup_notifications" {
  name = "gaib-backup-notifications"
}
```

### 16.2 Cross-Region Replication (Premium)

```hcl
resource "aws_s3_bucket_replication_configuration" "gaib_backups" {
  count  = var.enable_cross_region_replication ? 1 : 0
  bucket = aws_s3_bucket.gaib_backups.id
  role   = aws_iam_role.replication.arn

  rule {
    id     = "premium-replication"
    status = "Enabled"

    filter {
      tag {
        key   = "Tier"
        value = "premium"
      }
    }

    destination {
      bucket        = aws_s3_bucket.gaib_backups_replica.arn
      storage_class = "STANDARD"
    }
  }
}
```

---

## 17. CLI File Structure

### 17.1 New Files

```
packages/cli/src/commands/server/backup/
├── index.ts                    # Command registration
├── types.ts                    # Backup/snapshot types
├── BackupManager.ts            # Core backup operations
├── SnapshotManager.ts          # Full snapshot operations
├── RestoreEngine.ts            # Restore logic with validation
├── ThemeRegistryManager.ts     # Theme deployment tracking
├── TierManager.ts              # Service tier management
├── NotificationService.ts      # SNS notifications
└── __tests__/
    ├── BackupManager.test.ts
    ├── SnapshotManager.test.ts
    ├── RestoreEngine.test.ts
    └── ThemeRegistryManager.test.ts
```

### 17.2 Files to Modify

| File | Changes |
|------|---------|
| `packages/cli/src/commands/server/index.ts` | Add backup, snapshot, theme registry commands |
| `packages/cli/src/commands/server/export.ts` | Add `--backup` flag integration |
| `packages/cli/src/commands/server/iac/ApplyEngine.ts` | Hook theme registry on apply |
| `infrastructure/terraform/variables.tf` | Add backup-related variables |

---

## 18. Implementation Phases

### Phase 3: Backup Foundation (Sprint 166)
- [ ] Create `BackupManager` class
- [ ] Implement `gaib server backup create`
- [ ] Implement `gaib server backup list`
- [ ] Terraform: S3 bucket, KMS key, DynamoDB table
- [ ] Unit tests for BackupManager

### Phase 4: Restore Engine (Sprint 167)
- [ ] Create `RestoreEngine` with integrity validation
- [ ] Implement `gaib server backup restore`
- [ ] Lineage validation (prevent cross-workspace restores)
- [ ] Integration tests for full backup → restore cycle

### Phase 5: Snapshots (Sprint 168)
- [ ] Create `SnapshotManager` for full bundles
- [ ] Implement snapshot create/list/restore/download/compare
- [ ] Compression with gzip (zstd optional)
- [ ] Checksum verification on restore

### Phase 6: Theme Registry (Sprint 169)
- [ ] Create `ThemeRegistryManager`
- [ ] Hook into ApplyEngine for automatic tracking
- [ ] Implement registry/history/rollback commands
- [ ] Audit logging for all deployments

### Phase 7: Service Tiers (Sprint 170)
- [ ] Create `TierManager` with usage tracking
- [ ] Implement S3 lifecycle policies per tier
- [ ] EventBridge scheduled backups (daily/hourly)
- [ ] Cross-region replication for premium

### Phase 8: Polish & Notifications (Sprint 171)
- [ ] SNS notifications on backup success/failure
- [ ] CloudWatch alarms for backup errors
- [ ] Documentation
- [ ] Performance optimization

---

## 19. Testing Strategy (Backup System)

### 19.1 Unit Tests

- BackupManager: create, list, delete operations
- RestoreEngine: integrity checks, lineage validation
- SnapshotManager: bundle creation, compression, checksums
- ThemeRegistryManager: tracking, rollback logic
- TierManager: rate limiting, tier detection

### 19.2 Integration Tests

```bash
# Backup cycle
gaib server backup create --message "Test backup"
gaib server backup list
gaib server backup restore <id> --dry-run
gaib server backup restore <id>
gaib server backup delete <id>

# Snapshot cycle
gaib server snapshot create --message "Full snapshot"
gaib server snapshot list
gaib server snapshot download <id> -o ./test-backup/
gaib server snapshot compare <id1> <id2>
gaib server snapshot restore <id> --dry-run

# Theme registry
gaib server theme registry
gaib server theme history
gaib server theme rollback --steps 1
```

### 19.3 Verification Checklist

- [ ] Backup creates compressed file in S3
- [ ] Restore matches original state exactly
- [ ] Snapshot bundle contains all 3 files
- [ ] Theme registry tracks all apply operations
- [ ] Tier limits enforced correctly
- [ ] Lifecycle policies delete old backups
- [ ] Cross-region replication works (premium)

---

## 20. Acceptance Criteria (Backup System)

### 20.1 Backup Commands
- [ ] `gaib server backup create` creates backup in S3
- [ ] `gaib server backup list` shows backups with metadata
- [ ] `gaib server backup restore` restores state correctly
- [ ] `gaib server backup delete` removes backup from S3
- [ ] Rate limits enforced per tier

### 20.2 Snapshot Commands
- [ ] `gaib server snapshot create` creates full bundle
- [ ] `gaib server snapshot list` shows snapshots
- [ ] `gaib server snapshot restore` restores all state
- [ ] `gaib server snapshot download` exports locally
- [ ] `gaib server snapshot compare` shows diff

### 20.3 Theme Registry
- [ ] Apply operations auto-register in theme registry
- [ ] `gaib server theme registry` shows current state
- [ ] `gaib server theme history` shows deployment history
- [ ] `gaib server theme rollback` restores previous theme

### 20.4 Infrastructure
- [ ] S3 bucket with versioning and lifecycle rules
- [ ] KMS key with rotation enabled
- [ ] DynamoDB table with TTL and PITR
- [ ] EventBridge rules for scheduled backups
- [ ] SNS topic for notifications

---

## 21. Risks & Mitigations (Backup System)

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| S3 quota exceeded | Low | Medium | Monitor bucket size, lifecycle policies |
| Restore corrupts state | Medium | High | Checksum verification, dry-run mode |
| Cross-region latency | Low | Low | Async replication, local-first reads |
| DynamoDB throttling | Low | Medium | Pay-per-request billing, retries |
| Rate limit bypass | Medium | Low | Server-side enforcement, audit logs |

---

## 22. References (Backup System)

| Document | Path |
|----------|------|
| Backup System Plan | `grimoires/loa/plans/gaib-backup-system.md` |
| S3Backend Reference | `packages/cli/src/commands/server/iac/backends/S3Backend.ts` |
| StateWriter Reference | `packages/cli/src/commands/server/iac/StateWriter.ts` |
| Existing KMS Config | `infrastructure/terraform/kms.tf` |
