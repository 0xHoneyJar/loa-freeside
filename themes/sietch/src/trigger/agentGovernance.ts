import { schedules, logger as triggerLogger } from '@trigger.dev/sdk/v3';
import { initDatabase, logAuditEvent, updateHealthStatusSuccess } from '../db/index.js';
import { AgentGovernanceService } from '../packages/adapters/billing/AgentGovernanceService.js';
import Database from 'better-sqlite3';

/**
 * Scheduled task to manage agent governance proposal lifecycle.
 *
 * Runs hourly:
 * - Activates proposals past cooldown (quorum_reached → activated)
 * - Expires stale proposals past their expires_at timestamp
 *
 * SDD refs: §4.4 AgentGovernanceService
 * Sprint refs: Sprint 290 Task 7.5
 */
export const agentGovernanceLifecycleTask = schedules.task({
  id: 'agent-governance-lifecycle',
  cron: '15 * * * *', // Every hour at :15
  run: async () => {
    triggerLogger.info('Starting agent governance lifecycle task');

    // Initialize database (idempotent)
    const db = initDatabase() as unknown as Database.Database;

    try {
      const service = new AgentGovernanceService(db);

      // Phase 1: Activate proposals past cooldown
      const activated = await service.activateExpiredCooldowns();

      // Phase 2: Expire stale proposals
      const expired = await service.expireStaleProposals();

      triggerLogger.info('Agent governance lifecycle completed', {
        activated,
        expired,
      });

      logAuditEvent('agent_governance_lifecycle', {
        activated,
        expired,
        timestamp: new Date().toISOString(),
      });

      updateHealthStatusSuccess();

      return {
        success: true,
        activated,
        expired,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      triggerLogger.error('Agent governance lifecycle failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }
  },
});
