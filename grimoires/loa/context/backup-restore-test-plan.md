# Plan: Test Backup/Restore Process via Teardown

## Status: Ready for Implementation

## User Request

Test the backup and restore process by destroying the testing Discord server, ensuring that when the `teardown` command is issued in Gaib CLI, a backup is made first.

---

## Discovery Summary

### What Already Exists

**Teardown command already creates checkpoints before destruction** (Sprint 149: Checkpoint Hooks)

| Component | Location | Purpose |
|-----------|----------|---------|
| Teardown Command | `packages/cli/src/commands/server/teardown.ts` | Destroys Discord server resources |
| CheckpointService | `packages/cli/src/services/checkpoint.ts` | Creates/restores checkpoints via API |
| ImpactAnalyzer | `themes/sietch/src/services/restore/ImpactAnalyzer.ts` | Analyzes restore impact |
| Restore API | `themes/sietch/src/api/routes/dashboard/restore.routes.ts` | REST endpoints for restore |

**Current Teardown Safety Flow:**
```
gaib server teardown --guild {id} --confirm-teardown
        │
        ▼
    Creates checkpoint (BLOCKS if fails)
        │
        ▼
    4-stage confirmation:
    1. Type server name exactly
    2. Enter random 6-digit code
    3. Type "TEARDOWN"
        │
        ▼
    Deletes: channels → categories → roles
        │
        ▼
    Returns checkpoint ID for restore
```

**Checkpoint can be restored via:**
```bash
gaib restore exec {checkpointId}
```

---

## Critical Finding

**The checkpoint system captures APPLICATION CONFIGURATION, not Discord server structure:**

| What IS Backed Up | What May NOT Be Backed Up |
|-------------------|---------------------------|
| Tier thresholds (BGT, engagement, tenure) | Discord channels |
| Feature gates per tier | Discord roles (structure) |
| Role mappings (Discord role → tier) | Channel permissions |
| Active theme configuration | Server settings |

The checkpoint saves `fullStateJson` containing:
- `thresholds` - tier configuration
- `featureGates` - feature access
- `roleMappings` - role-to-tier mappings
- `activeThemeId` - theme state

This means after teardown + restore, you'd get back the **Sietch configuration** but not necessarily the **Discord server structure** (channels, roles, categories).

---

## Selected Approach: Full Discord + Config Backup

Complete server recovery requires a **2-step backup** before teardown:

1. **Export Discord Structure** → `server-backup.yaml`
2. **Teardown** (auto-creates Sietch config checkpoint)

---

## Implementation Plan

### Phase 1: Pre-Teardown Backup (Manual Steps)

```bash
# Step 1: Export Discord server structure to YAML
gaib server export --guild {GUILD_ID} -o testing-server-backup.yaml

# Step 2: Verify export contains expected data
cat testing-server-backup.yaml | head -50

# Step 3: Preview what teardown will delete
gaib server teardown --guild {GUILD_ID} --confirm-teardown --dry-run
```

### Phase 2: Execute Teardown

```bash
# Step 4: Execute teardown (creates checkpoint automatically)
gaib server teardown --guild {GUILD_ID} --confirm-teardown

# Output will include:
# - Checkpoint ID (save this!)
# - List of deleted resources
# - Summary of changes
```

### Phase 3: Verify Server is Destroyed

- Check Discord - all channels/roles should be gone
- Only @everyone role and system channels remain

### Phase 4: Restore Discord Structure

```bash
# Step 5: Recreate Discord structure from export
gaib apply testing-server-backup.yaml --guild {GUILD_ID}

# This recreates:
# - Roles (with correct permissions)
# - Categories
# - Channels (with permission overwrites)
```

### Phase 5: Restore Sietch Configuration

```bash
# Step 6: List available checkpoints
gaib restore list --guild {GUILD_ID}

# Step 7: Preview restore impact
gaib restore preview --checkpoint {CHECKPOINT_ID}

# Step 8: Execute restore
gaib restore exec --checkpoint {CHECKPOINT_ID}

# This restores:
# - Tier thresholds
# - Feature gates
# - Role mappings
# - Theme configuration
```

### Phase 6: Verify Full Restoration

- [ ] All channels restored
- [ ] All roles restored
- [ ] Role permissions correct
- [ ] Tier role assignments working
- [ ] Bot commands responding
- [ ] Feature gates active

---

## Required Information

Before executing, you'll need:

| Item | How to Get |
|------|------------|
| Guild ID | Discord Developer Mode → Right-click server → Copy ID |
| Discord Bot Token | Environment variable `DISCORD_TOKEN` |
| Gaib API URL | Environment variable `GAIB_API_URL` (default: `http://localhost:3000`) |

---

## Current Commands Available

```bash
# Preview teardown (no changes)
gaib server teardown --guild {GUILD_ID} --confirm-teardown --dry-run

# Execute teardown (creates checkpoint, then destroys)
gaib server teardown --guild {GUILD_ID} --confirm-teardown

# List checkpoints
gaib restore list --guild {GUILD_ID}

# Preview restore impact
gaib restore preview --checkpoint {CHECKPOINT_ID}

# Execute restore
gaib restore exec --checkpoint {CHECKPOINT_ID}

# Export server structure
gaib server export --guild {GUILD_ID} -o server-backup.yaml

# Recreate server structure from export
gaib apply server-backup.yaml
```

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Export fails | Verify export file before proceeding |
| Checkpoint creation fails | Teardown is blocked (fail-safe) |
| Restore fails mid-way | Export file remains available for re-apply |
| Role ID mismatch after restore | Apply recreates roles with new IDs; role mappings update |

---

## Rollback Plan

If anything goes wrong:
1. Export file (`testing-server-backup.yaml`) can be re-applied
2. Checkpoint remains available for 30 days
3. Can manually recreate server structure from scratch using Gaib manifests

---

## Files Involved (Read-Only Reference)

| Purpose | Path |
|---------|------|
| Teardown Command | `packages/cli/src/commands/server/teardown.ts` |
| Export Command | `packages/cli/src/commands/server/export.ts` |
| Apply Command | `packages/cli/src/commands/apply.ts` |
| CheckpointService | `packages/cli/src/services/checkpoint.ts` |
| Restore Routes | `themes/sietch/src/api/routes/dashboard/restore.routes.ts` |
