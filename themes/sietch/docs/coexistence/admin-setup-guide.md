# Coexistence Mode Admin Setup Guide

This guide explains how to set up and manage Arrakis coexistence mode alongside an existing token-gating bot (e.g., Collab.Land, Guild.xyz).

## Overview

Coexistence mode allows communities to gradually migrate from an incumbent token-gating bot to Arrakis without disrupting member access. The migration follows a phased approach:

1. **Shadow Mode**: Arrakis runs silently, tracking what the incumbent does
2. **Parallel Mode**: Both bots manage separate roles, users choose which to use
3. **Primary Mode**: Arrakis becomes the main bot, incumbent as backup
4. **Exclusive Mode**: Arrakis takes over completely (one-way transition)

## Prerequisites

- Discord server with Administrator permissions
- Arrakis bot installed and configured
- Incumbent bot still operational
- API access to run coexistence endpoints

## Setup Steps

### Step 1: Configure Incumbent Detection

First, Arrakis needs to know which bot is the incumbent and what roles it manages.

1. Identify the incumbent bot's Discord user ID
2. List all roles the incumbent bot currently manages
3. Note any role prefixes the incumbent uses (e.g., `[Holder]`)

### Step 2: Initialize Coexistence

Use the Discord command or API to initialize coexistence mode:

**Discord Command:**
```
/arrakis coexistence init
```

**API Endpoint:**
```bash
POST /api/v1/coexistence/:guildId/init
{
  "incumbentBotId": "123456789012345678",
  "incumbentBotName": "Collab.Land",
  "managedRoleIds": ["role1", "role2", "role3"],
  "rolePrefix": "[Holder]"
}
```

### Step 3: Enter Shadow Mode

Shadow mode begins automatically after initialization. During this phase:

- Arrakis monitors incumbent role assignments
- A shadow ledger records all changes
- Divergences between Arrakis calculations and incumbent actions are tracked
- **No user-facing changes occur**

**Monitor shadow progress:**
```bash
GET /api/v1/coexistence/:guildId/status
```

Response includes:
- `currentMode`: Should be "shadow"
- `shadowDays`: Days in shadow mode
- `accuracyPercent`: How well Arrakis matches incumbent decisions
- `divergenceCount`: Number of differences detected

**Minimum requirements before proceeding:**
- 14+ days in shadow mode
- 95%+ accuracy rate
- All major divergences resolved

### Step 4: Transition to Parallel Mode

When ready, transition to parallel mode:

**Discord Command:**
```
/arrakis coexistence mode parallel
```

**API Endpoint:**
```bash
POST /api/v1/coexistence/:guildId/mode
{
  "targetMode": "parallel",
  "strategy": "gradual"  // or "instant"
}
```

**In parallel mode:**
- Arrakis creates its own roles with `@arrakis-` prefix
- Users can opt-in to Arrakis verification
- Incumbent continues managing its existing roles
- Both systems coexist independently

### Step 5: Monitor Parallel Operation

Watch for issues during parallel mode:

```bash
GET /api/v1/coexistence/:guildId/shadow/divergences
```

Key metrics to monitor:
- Role assignment accuracy
- User migration rate
- Error rates
- Incumbent health status

### Step 6: Transition to Primary Mode

When confident Arrakis is working correctly:

**Discord Command:**
```
/arrakis coexistence mode primary
```

**API Endpoint:**
```bash
POST /api/v1/coexistence/:guildId/mode
{
  "targetMode": "primary"
}
```

**In primary mode:**
- Arrakis is the recommended verification method
- New users are directed to Arrakis
- Incumbent serves as backup
- Full social layer features unlocked

### Step 7: Execute Takeover (Optional)

If you want to completely replace the incumbent:

**Discord Command:**
```
/arrakis-takeover
```

This requires a **three-step confirmation**:
1. Type your server name
2. Type "I understand" to acknowledge risks
3. Type "confirmed" to proceed

**WARNING**: Takeover is **irreversible**. Once in exclusive mode, you cannot rollback to previous modes.

**After takeover:**
- Incumbent bot is disabled
- Roles are renamed to remove prefixes
- Arrakis becomes the only token-gating solution
- **20% first-year pricing discount** applied automatically

## Emergency Procedures

### Rollback to Previous Mode

If issues arise in parallel or primary mode:

```bash
POST /api/v1/coexistence/:guildId/rollback
{
  "targetMode": "shadow",  // or "parallel"
  "reason": "High divergence rate detected"
}
```

**Auto-rollback triggers:**
- >5% access loss in 1 hour
- >10% error rate in 15 minutes
- 3 auto-rollbacks triggers manual intervention requirement

### Emergency Backup Activation

If incumbent becomes unresponsive:

```bash
POST /api/v1/coexistence/:guildId/emergency-backup
```

This immediately:
- Activates Arrakis as backup
- Transitions from shadow to parallel mode
- Notifies admins via Discord DM

### Incumbent Health Monitoring

Arrakis monitors incumbent health automatically:
- Bot online status (hourly)
- Role update freshness (48h warning, 72h critical)
- Balance check functionality (72h threshold)

Alerts are sent to server admins via Discord DM.

## API Reference

### Get Coexistence Status
```
GET /api/v1/coexistence/:guildId/status
```

### Change Mode
```
POST /api/v1/coexistence/:guildId/mode
{
  "targetMode": "shadow" | "parallel" | "primary" | "exclusive",
  "strategy": "instant" | "gradual"
}
```

### Initiate Rollback
```
POST /api/v1/coexistence/:guildId/rollback
{
  "targetMode": "shadow" | "parallel",
  "reason": "string"
}
```

### Get Divergences
```
GET /api/v1/coexistence/:guildId/shadow/divergences?limit=50&unresolved=true
```

### Emergency Backup
```
POST /api/v1/coexistence/:guildId/emergency-backup
```

## Troubleshooting

### High Divergence Rate

If accuracy drops below 95%:
1. Check incumbent role configuration
2. Verify token contract addresses match
3. Review divergence logs for patterns
4. Consider extending shadow mode

### Members Losing Access

If members report access issues:
1. Check rollback status
2. Verify incumbent is operational
3. Review error logs
4. Consider emergency rollback

### Bot Permission Issues

If Arrakis can't manage roles:
1. Verify bot role is above managed roles
2. Check "Manage Roles" permission
3. Ensure bot isn't rate-limited

## Support

For assistance:
- Discord: Join our support server
- Email: support@thj.com
- Docs: https://docs.thj.com/arrakis
