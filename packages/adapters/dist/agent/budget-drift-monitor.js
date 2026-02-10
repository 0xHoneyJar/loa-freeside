/**
 * Budget Drift Monitoring Job
 * Sprint S12-T4: Scheduled comparison of Redis committed vs PostgreSQL agent_usage_log
 *
 * Runs every 15 minutes via BullMQ repeatable. For each active community:
 * 1. Read Redis committed counter: agent:budget:committed:{communityId}:{month}
 * 2. Query PostgreSQL SUM(cost_micro_cents) from agent_usage_log for same month
 * 3. Compare: if |redis - pg| > DRIFT_THRESHOLD_MICRO_CENTS → fire alarm
 * 4. Log drift for all communities at debug level (even within tolerance)
 *
 * @see SDD §4.5.1 Budget Drift Detection
 */
import { REAL_CLOCK } from './clock.js';
/** 500,000 micro-cents = $0.50 — threshold for BUDGET_ACCOUNTING_DRIFT alarm */
export const DRIFT_THRESHOLD_MICRO_CENTS = 500000;
/** Per-community query timeout */
const PER_COMMUNITY_TIMEOUT_MS = 10000;
// REAL_CLOCK imported from ./clock.js (S13-T2)
export class BudgetDriftMonitor {
    redis;
    communityProvider;
    usageQuery;
    logger;
    clock;
    constructor(redis, communityProvider, usageQuery, logger, clock) {
        this.redis = redis;
        this.communityProvider = communityProvider;
        this.usageQuery = usageQuery;
        this.logger = logger;
        this.clock = clock ?? REAL_CLOCK;
    }
    /**
     * Run drift check for all active communities.
     * Called by BullMQ worker on the repeatable schedule.
     */
    async process() {
        const month = this.getCurrentMonth();
        const communityIds = await this.communityProvider.getActiveCommunityIds();
        let driftDetected = 0;
        let errors = 0;
        let maxDriftMicroCents = 0;
        for (const communityId of communityIds) {
            try {
                const drift = await withTimeout(this.checkCommunity(communityId, month), PER_COMMUNITY_TIMEOUT_MS, communityId);
                const absDrift = Math.abs(drift.driftMicroCents);
                maxDriftMicroCents = Math.max(maxDriftMicroCents, absDrift);
                // Log all drift at debug level for monitoring
                this.logger.debug({
                    communityId,
                    redisMicroCents: drift.redisMicroCents,
                    pgMicroCents: drift.pgMicroCents,
                    driftMicroCents: drift.driftMicroCents,
                    driftDirection: drift.driftDirection,
                    month,
                }, 'budget-drift-monitor: community check');
                // Fire alarm if drift exceeds threshold
                if (absDrift > DRIFT_THRESHOLD_MICRO_CENTS) {
                    driftDetected++;
                    this.logger.error({
                        communityId,
                        redisMicroCents: drift.redisMicroCents,
                        pgMicroCents: drift.pgMicroCents,
                        driftMicroCents: drift.driftMicroCents,
                        driftDirection: drift.driftDirection,
                        thresholdMicroCents: DRIFT_THRESHOLD_MICRO_CENTS,
                        month,
                        alarm: 'BUDGET_ACCOUNTING_DRIFT',
                    }, 'BUDGET_ACCOUNTING_DRIFT: Redis/PG budget mismatch exceeds threshold');
                }
            }
            catch (err) {
                errors++;
                this.logger.error({ err, communityId, month }, 'budget-drift-monitor: error checking community — continuing');
            }
        }
        this.logger.info({
            communitiesChecked: communityIds.length,
            driftDetected,
            errors,
            maxDriftMicroCents,
            month,
        }, 'budget-drift-monitor: cycle complete');
        return {
            communitiesChecked: communityIds.length,
            driftDetected,
            errors,
            maxDriftMicroCents,
        };
    }
    /**
     * Check a single community for drift.
     */
    getCurrentMonth() {
        const d = new Date(this.clock.now());
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    }
    async checkCommunity(communityId, month) {
        // Read Redis committed counter (in cents, stored as integer string)
        const redisKey = `agent:budget:committed:${communityId}:${month}`;
        const redisStr = await this.redis.get(redisKey);
        // Convert cents to micro-cents for comparison (1 cent = 10,000 micro-cents)
        const redisMicroCents = safeInt(redisStr) * 10000;
        // Query PostgreSQL for sum of cost_micro_cents
        const pgMicroCents = await this.usageQuery.getCommittedMicroCents(communityId, month);
        const driftMicroCents = redisMicroCents - pgMicroCents;
        const driftDirection = driftMicroCents > 0 ? 'redis_over' : driftMicroCents < 0 ? 'pg_over' : 'none';
        return {
            communityId,
            redisMicroCents,
            pgMicroCents,
            driftMicroCents,
            driftDirection,
        };
    }
}
/** BullMQ repeatable job configuration for the drift monitor */
export const DRIFT_MONITOR_JOB_CONFIG = {
    name: 'budget-drift-monitor',
    repeat: {
        every: 15 * 60 * 1000, // every 15 minutes
    },
    removeOnComplete: { count: 10 },
    removeOnFail: { count: 50 },
};
function safeInt(v, def = 0) {
    if (v === null)
        return def;
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : def;
}
function withTimeout(promise, ms, communityId) {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`drift check timed out after ${ms}ms for ${communityId}`)), ms);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => {
        if (timeoutId)
            clearTimeout(timeoutId);
    });
}
//# sourceMappingURL=budget-drift-monitor.js.map
