/**
 * FraudCheckService — Registration & Bonus Fraud Scoring
 *
 * Queries referral_events for IP cluster, UA fingerprint, velocity signals.
 * Returns a weighted risk score (0.0-1.0) with configurable thresholds.
 *
 * Risk signals (per SDD §4.7):
 *   - IP cluster: same ip_hash used by multiple accounts
 *   - UA fingerprint: same user_agent_hash + fingerprint_hash cluster
 *   - Velocity: rapid registrations from same IP prefix
 *   - Activity: 7-day activity check for bonus claims
 *
 * Threshold routing:
 *   score < 0.3  → clear
 *   0.3 ≤ score < 0.7 → flagged (manual review)
 *   score ≥ 0.7  → withheld (auto-block)
 *
 * SDD refs: §4.7 FraudCheckService
 * Sprint refs: Task 4.1
 *
 * @module packages/adapters/billing/FraudCheckService
 */

import type Database from 'better-sqlite3';
import type { FraudRulesService, FraudWeights } from './FraudRulesService.js';
import { logger } from '../../../utils/logger.js';

// =============================================================================
// Types
// =============================================================================

export type FraudVerdict = 'clear' | 'flagged' | 'withheld';

export interface FraudScore {
  score: number;
  verdict: FraudVerdict;
  signals: FraudSignal[];
}

export interface FraudSignal {
  name: string;
  value: number;
  weight: number;
  detail: string;
}

export interface FraudThresholds {
  flagged: number;
  withheld: number;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_THRESHOLDS: FraudThresholds = {
  flagged: 0.3,
  withheld: 0.7,
};

/** Weights for each signal (must sum to 1.0) */
const SIGNAL_WEIGHTS = {
  ipCluster: 0.30,
  uaFingerprint: 0.25,
  velocity: 0.25,
  activityCheck: 0.20,
};

/** Number of accounts sharing IP before it's suspicious */
const IP_CLUSTER_THRESHOLD = 3;

/** Number of accounts sharing fingerprint before it's suspicious */
const FINGERPRINT_CLUSTER_THRESHOLD = 2;

/** Registrations from same IP prefix in 1 hour */
const VELOCITY_WINDOW_HOURS = 1;
const VELOCITY_THRESHOLD = 5;

/** Activity check window (days) */
const ACTIVITY_CHECK_DAYS = 7;

// =============================================================================
// FraudCheckService
// =============================================================================

export class FraudCheckService {
  private db: Database.Database;
  private thresholds: FraudThresholds;
  private rulesService: FraudRulesService | null;
  private cachedWeights: FraudWeights | null = null;
  private configSource: 'fraud_rule' | 'hardcoded' = 'hardcoded';

  constructor(
    db: Database.Database,
    thresholds?: Partial<FraudThresholds>,
    rulesService?: FraudRulesService,
  ) {
    this.db = db;
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
    this.rulesService = rulesService ?? null;
  }

  /** Invalidate cached weights — forces reload from fraud_rules on next scoring */
  invalidateConfig(): void {
    this.cachedWeights = null;
  }

  /** Get the source of the current config (for tests/debugging) */
  getConfigSource(): 'fraud_rule' | 'hardcoded' {
    return this.configSource;
  }

  /** Load active weights from FraudRulesService, falling back to hardcoded defaults */
  private getWeights(): { weights: typeof SIGNAL_WEIGHTS; thresholds: FraudThresholds } {
    if (this.cachedWeights) {
      return {
        weights: {
          ipCluster: this.cachedWeights.ipCluster,
          uaFingerprint: this.cachedWeights.uaFingerprint,
          velocity: this.cachedWeights.velocity,
          activityCheck: this.cachedWeights.activityCheck,
        },
        thresholds: {
          flagged: this.cachedWeights.flagThreshold,
          withheld: this.cachedWeights.withholdThreshold,
        },
      };
    }

    if (this.rulesService) {
      const active = this.rulesService.getActiveWeights();
      if (active) {
        this.cachedWeights = active;
        this.configSource = 'fraud_rule';
        return {
          weights: {
            ipCluster: active.ipCluster,
            uaFingerprint: active.uaFingerprint,
            velocity: active.velocity,
            activityCheck: active.activityCheck,
          },
          thresholds: {
            flagged: active.flagThreshold,
            withheld: active.withholdThreshold,
          },
        };
      }
    }

    this.configSource = 'hardcoded';
    return { weights: SIGNAL_WEIGHTS, thresholds: this.thresholds };
  }

  /**
   * Score a registration event for fraud risk.
   * Queries referral_events for IP/UA/fingerprint clustering.
   */
  scoreRegistration(accountId: string): FraudScore {
    const { weights, thresholds } = this.getWeights();
    const signals: FraudSignal[] = [];

    // Signal 1: IP cluster — how many accounts share this IP hash?
    const ipSignal = this.checkIpCluster(accountId, weights);
    signals.push(ipSignal);

    // Signal 2: UA/fingerprint cluster
    const fpSignal = this.checkFingerprintCluster(accountId, weights);
    signals.push(fpSignal);

    // Signal 3: Velocity — rapid registrations from same IP prefix
    const velSignal = this.checkVelocity(accountId, weights);
    signals.push(velSignal);

    // Signal 4: Activity check (placeholder for registration — always 0)
    signals.push({
      name: 'activityCheck',
      value: 0,
      weight: weights.activityCheck,
      detail: 'Not applicable for registration scoring',
    });

    return this.computeScore(signals, thresholds);
  }

  /**
   * Score a bonus claim for fraud risk.
   * Includes 7-day activity check in addition to clustering signals.
   */
  scoreBonusClaim(accountId: string, bonusCreatedAt: string): FraudScore {
    const { weights, thresholds } = this.getWeights();
    const signals: FraudSignal[] = [];

    // Signal 1: IP cluster
    const ipSignal = this.checkIpCluster(accountId, weights);
    signals.push(ipSignal);

    // Signal 2: UA/fingerprint cluster
    const fpSignal = this.checkFingerprintCluster(accountId, weights);
    signals.push(fpSignal);

    // Signal 3: Velocity
    const velSignal = this.checkVelocity(accountId, weights);
    signals.push(velSignal);

    // Signal 4: 7-day activity check
    const activitySignal = this.checkActivity(accountId, bonusCreatedAt, weights);
    signals.push(activitySignal);

    return this.computeScore(signals, thresholds);
  }

  // ---------------------------------------------------------------------------
  // Signal Queries
  // ---------------------------------------------------------------------------

  private checkIpCluster(accountId: string, weights: typeof SIGNAL_WEIGHTS): FraudSignal {
    try {
      // Get the most recent IP hash for this account
      const latestEvent = this.db.prepare(
        `SELECT ip_hash FROM referral_events
         WHERE account_id = ? AND ip_hash IS NOT NULL
         ORDER BY created_at DESC LIMIT 1`
      ).get(accountId) as { ip_hash: string } | undefined;

      if (!latestEvent) {
        return {
          name: 'ipCluster',
          value: 0,
          weight: weights.ipCluster,
          detail: 'No IP data available',
        };
      }

      // Count distinct accounts sharing this IP hash
      const cluster = this.db.prepare(
        `SELECT COUNT(DISTINCT account_id) as count FROM referral_events
         WHERE ip_hash = ? AND account_id != ?`
      ).get(latestEvent.ip_hash, accountId) as { count: number };

      const clusterSize = cluster.count;
      const value = Math.min(clusterSize / IP_CLUSTER_THRESHOLD, 1.0);

      return {
        name: 'ipCluster',
        value,
        weight: weights.ipCluster,
        detail: `${clusterSize} other account(s) share this IP`,
      };
    } catch {
      return {
        name: 'ipCluster',
        value: 0,
        weight: weights.ipCluster,
        detail: 'Query failed — defaulting to safe',
      };
    }
  }

  private checkFingerprintCluster(accountId: string, weights: typeof SIGNAL_WEIGHTS): FraudSignal {
    try {
      const latestEvent = this.db.prepare(
        `SELECT fingerprint_hash FROM referral_events
         WHERE account_id = ? AND fingerprint_hash IS NOT NULL
         ORDER BY created_at DESC LIMIT 1`
      ).get(accountId) as { fingerprint_hash: string } | undefined;

      if (!latestEvent) {
        return {
          name: 'uaFingerprint',
          value: 0,
          weight: weights.uaFingerprint,
          detail: 'No fingerprint data available',
        };
      }

      const cluster = this.db.prepare(
        `SELECT COUNT(DISTINCT account_id) as count FROM referral_events
         WHERE fingerprint_hash = ? AND account_id != ?`
      ).get(latestEvent.fingerprint_hash, accountId) as { count: number };

      const clusterSize = cluster.count;
      const value = Math.min(clusterSize / FINGERPRINT_CLUSTER_THRESHOLD, 1.0);

      return {
        name: 'uaFingerprint',
        value,
        weight: weights.uaFingerprint,
        detail: `${clusterSize} other account(s) share this fingerprint`,
      };
    } catch {
      return {
        name: 'uaFingerprint',
        value: 0,
        weight: weights.uaFingerprint,
        detail: 'Query failed — defaulting to safe',
      };
    }
  }

  private checkVelocity(accountId: string, weights: typeof SIGNAL_WEIGHTS): FraudSignal {
    try {
      const latestEvent = this.db.prepare(
        `SELECT ip_prefix FROM referral_events
         WHERE account_id = ? AND ip_prefix IS NOT NULL
         ORDER BY created_at DESC LIMIT 1`
      ).get(accountId) as { ip_prefix: string } | undefined;

      if (!latestEvent) {
        return {
          name: 'velocity',
          value: 0,
          weight: weights.velocity,
          detail: 'No IP prefix data available',
        };
      }

      // Count registrations from same IP prefix in the velocity window
      const recentCount = this.db.prepare(
        `SELECT COUNT(*) as count FROM referral_events
         WHERE ip_prefix = ? AND event_type = 'registration'
         AND created_at > datetime('now', '-${VELOCITY_WINDOW_HOURS} hours')`
      ).get(latestEvent.ip_prefix) as { count: number };

      const value = Math.min(recentCount.count / VELOCITY_THRESHOLD, 1.0);

      return {
        name: 'velocity',
        value,
        weight: weights.velocity,
        detail: `${recentCount.count} registration(s) from this IP prefix in last ${VELOCITY_WINDOW_HOURS}h`,
      };
    } catch {
      return {
        name: 'velocity',
        value: 0,
        weight: weights.velocity,
        detail: 'Query failed — defaulting to safe',
      };
    }
  }

  private checkActivity(accountId: string, bonusCreatedAt: string, weights: typeof SIGNAL_WEIGHTS): FraudSignal {
    try {
      // Check if account has had any qualifying actions in the 7 days after bonus creation
      const activityCount = this.db.prepare(
        `SELECT COUNT(*) as count FROM referral_events
         WHERE account_id = ? AND event_type = 'qualifying_action'
         AND created_at BETWEEN ? AND datetime(?, '+${ACTIVITY_CHECK_DAYS} days')`
      ).get(accountId, bonusCreatedAt, bonusCreatedAt) as { count: number };

      // No activity in 7 days = suspicious (higher score = more risky)
      const value = activityCount.count > 0 ? 0 : 0.8;

      return {
        name: 'activityCheck',
        value,
        weight: weights.activityCheck,
        detail: activityCount.count > 0
          ? `${activityCount.count} qualifying action(s) in ${ACTIVITY_CHECK_DAYS}-day window`
          : `No qualifying actions in ${ACTIVITY_CHECK_DAYS}-day window`,
      };
    } catch {
      return {
        name: 'activityCheck',
        value: 0,
        weight: weights.activityCheck,
        detail: 'Query failed — defaulting to safe',
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Score Computation
  // ---------------------------------------------------------------------------

  private computeScore(signals: FraudSignal[], thresholds: FraudThresholds): FraudScore {
    const score = signals.reduce(
      (sum, signal) => sum + signal.value * signal.weight, 0
    );

    let verdict: FraudVerdict;
    if (score >= thresholds.withheld) {
      verdict = 'withheld';
    } else if (score >= thresholds.flagged) {
      verdict = 'flagged';
    } else {
      verdict = 'clear';
    }

    logger.debug({
      event: 'fraud.score.computed',
      score,
      verdict,
      signalCount: signals.length,
    }, `Fraud score: ${score.toFixed(3)} → ${verdict}`);

    return { score, verdict, signals };
  }
}
