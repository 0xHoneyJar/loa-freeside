# Discord Server Sandbox - Operations Runbook

Sprint 87: Discord Server Sandboxes - Cleanup & Polish
Sprint 90: CLI Rename (bd → gaib)

## Overview

This runbook covers operational procedures for the Discord Server Sandbox feature.

Sandboxes provide isolated testing environments for Arrakis Discord bot functionality.
Each sandbox gets:
- Dedicated PostgreSQL schema (`sandbox_{id}`)
- Redis key prefix (`sandbox:{id}:*`)
- NATS subject namespace (`sandbox.{id}.events.*`)

## Quick Reference

### CLI Commands

```bash
# List your sandboxes
gaib sandbox list

# Create a sandbox (24h TTL default)
gaib sandbox create my-sandbox

# Create with custom TTL
gaib sandbox create my-sandbox --ttl 48h

# Show detailed status
gaib sandbox status my-sandbox
gaib sandbox status my-sandbox --watch  # Live updates

# Register a Discord guild
gaib sandbox register-guild my-sandbox 123456789012345678

# Unregister a guild
gaib sandbox unregister-guild my-sandbox 123456789012345678

# Get connection details
gaib sandbox connect my-sandbox
eval $(gaib sandbox connect my-sandbox)  # Export to shell

# Destroy a sandbox
gaib sandbox destroy my-sandbox
```

### Key Metrics

| Metric | Threshold | Meaning |
|--------|-----------|---------|
| `ActiveSandboxCount` | > 100 | Too many active sandboxes |
| `CleanupFailures` | > 0 | Cleanup job failing |
| `OrphanedResourceCount` | > 5 (sustained) | Resources not being cleaned |
| `EventRoutingErrors` | > 50/5min | Routing problems |
| `SchemaCreationErrors` | > 3/5min | PostgreSQL issues |

---

## Runbook Procedures

### RB-SB-001: High Active Sandbox Count Alert

**Trigger:** `sandbox-count-high` CloudWatch alarm

**Symptoms:**
- Alert fires when active sandboxes > 100
- Potential database performance degradation

**Resolution:**

1. Check current count:
   ```bash
   gaib sandbox list --all | wc -l
   ```

2. Identify expired sandboxes not cleaned up:
   ```bash
   gaib sandbox list --status expired
   ```

3. Manually trigger cleanup if needed:
   ```bash
   # In worker container
   node dist/jobs/sandbox-cleanup.js
   ```

4. Review sandbox TTLs - consider shorter defaults

5. Escalate if count continues rising

---

### RB-SB-002: Cleanup Job Failures

**Trigger:** `sandbox-cleanup-failures` CloudWatch alarm

**Symptoms:**
- Sandboxes not being cleaned up
- Orphaned schemas accumulating

**Resolution:**

1. Check cleanup job logs:
   ```bash
   aws logs filter-log-events \
     --log-group-name /ecs/arrakis-sandbox-cleanup \
     --filter-pattern "ERROR"
   ```

2. Common issues:

   **PostgreSQL Connection:**
   ```
   Error: Connection refused
   ```
   - Check RDS status
   - Verify security group rules

   **Schema Drop Failed:**
   ```
   Error: cannot drop schema sandbox_xxx because other objects depend on it
   ```
   - Manual cleanup required
   - Connect to database and identify blocking objects

   **Redis Connection:**
   ```
   Error: Redis connection refused
   ```
   - Check ElastiCache status
   - Non-fatal - cleanup continues

3. Manually trigger cleanup with verbose logging:
   ```bash
   LOG_LEVEL=debug node dist/jobs/sandbox-cleanup.js
   ```

---

### RB-SB-003: Orphaned Resources Detected

**Trigger:** `sandbox-orphaned-resources` CloudWatch alarm

**Symptoms:**
- Schemas exist without corresponding sandbox record
- Redis keys exist for destroyed sandboxes

**Resolution:**

1. Find orphaned resources:
   ```sql
   -- Orphaned schemas
   SELECT nspname FROM pg_namespace
   WHERE nspname LIKE 'sandbox_%'
   AND nspname NOT IN (
     SELECT schema_name FROM sandboxes WHERE status != 'destroyed'
   );
   ```

2. Verify no active sandbox before cleanup:
   ```bash
   gaib sandbox list --all | grep <schema_suffix>
   ```

3. Manual schema cleanup:
   ```sql
   -- DANGER: Verify sandbox is truly orphaned first!
   DROP SCHEMA sandbox_xxx CASCADE;
   ```

4. Manual Redis cleanup:
   ```bash
   redis-cli SCAN 0 MATCH "sandbox:<orphan-id>:*" COUNT 1000
   # Then delete matching keys
   ```

---

### RB-SB-004: Event Routing Errors

**Trigger:** `sandbox-routing-errors` CloudWatch alarm

**Symptoms:**
- Events not reaching sandbox consumers
- Sandbox testing not working

**Resolution:**

1. Check EventRouter logs:
   ```bash
   aws logs filter-log-events \
     --log-group-name /ecs/arrakis-worker \
     --filter-pattern "EventRouter ERROR"
   ```

2. Verify route cache:
   ```bash
   # Check if guild is properly mapped
   redis-cli GET sandbox:route:<guildId>
   ```

3. Verify NATS stream:
   ```bash
   nats stream info SANDBOX
   nats consumer info SANDBOX sandbox-consumer
   ```

4. Common issues:

   **Cache Stale:**
   - Wait for TTL (1 minute) or invalidate manually
   ```bash
   redis-cli DEL sandbox:route:<guildId>
   ```

   **NATS Stream Missing:**
   - Restart EventRouter - it auto-creates stream

---

### RB-SB-005: Schema Creation Failures

**Trigger:** `sandbox-schema-failures` CloudWatch alarm

**Symptoms:**
- `gaib sandbox create` failing
- Users can't create new sandboxes

**Resolution:**

1. Check error details:
   ```bash
   aws logs filter-log-events \
     --log-group-name /ecs/arrakis-api \
     --filter-pattern "SchemaProvisioner ERROR"
   ```

2. Common issues:

   **Connection Limit:**
   ```
   Error: too many connections
   ```
   - Check RDS connection count
   - Review connection pooling settings

   **Disk Space:**
   ```
   Error: could not extend file
   ```
   - RDS storage full
   - Increase storage or cleanup data

   **Permissions:**
   ```
   Error: permission denied
   ```
   - Database user lacks CREATE SCHEMA privilege

3. Test database connectivity:
   ```bash
   psql $DATABASE_URL -c "SELECT 1;"
   ```

---

### RB-SB-006: Sandbox Status Command Slow/Timeout

**Symptoms:**
- `gaib sandbox status` taking > 5 seconds
- Timeouts on status checks

**Resolution:**

1. Check database query performance:
   ```sql
   EXPLAIN ANALYZE
   SELECT * FROM sandboxes WHERE name = 'xxx';
   ```

2. Verify indices exist:
   ```sql
   \d+ sandboxes
   -- Should have index on: id, name, owner, status
   ```

3. Check Redis latency:
   ```bash
   redis-cli --latency
   ```

4. If consistently slow, consider:
   - Adding database indices
   - Increasing RDS instance size
   - Checking for lock contention

---

## Emergency Procedures

### Stop All Sandbox Operations

If sandbox feature is causing production issues:

1. Disable cleanup job:
   ```bash
   # Disable EventBridge rule
   aws events disable-rule --name arrakis-sandbox-cleanup
   ```

2. Stop EventRouter:
   ```bash
   # Set EventRouter replicas to 0
   aws ecs update-service \
     --cluster arrakis \
     --service arrakis-worker \
     --desired-count 0
   ```

3. Mark all sandboxes as destroyed:
   ```sql
   UPDATE sandboxes SET status = 'destroyed' WHERE status = 'running';
   ```

### Mass Cleanup

If many sandboxes need urgent cleanup:

```bash
# Set environment variable to enable orphaned cleanup
CLEANUP_ORPHANED=true node dist/jobs/sandbox-cleanup.js
```

---

## Maintenance Windows

### Scheduled Tasks

| Task | Schedule | Description |
|------|----------|-------------|
| Cleanup Job | Every 15 min | Cleans expired sandboxes |
| Orphan Detection | Daily | Detects orphaned resources |

### Database Maintenance

Monthly:
```sql
-- Vacuum sandbox tables
VACUUM ANALYZE sandboxes;
VACUUM ANALYZE sandbox_guild_mapping;
VACUUM ANALYZE sandbox_audit_log;

-- Clean old audit logs (> 90 days)
DELETE FROM sandbox_audit_log
WHERE created_at < NOW() - INTERVAL '90 days';
```

---

## Contacts

- **On-call Engineer:** Check PagerDuty
- **Slack Channel:** #arrakis-alerts
- **Documentation:** `/docs/sandbox-*.md`
- **CLI Reference:** `/docs/cli.md`
