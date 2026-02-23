/**
 * Governance Service — Policy Lifecycle Management (F-4)
 *
 * Manages economic policy lifecycle: propose → approve/reject, with atomic
 * supersession, outbox pattern for conservation guard propagation, and
 * advisory lock protection against concurrent approval + debit races.
 *
 * State machine (SDD §1.5):
 *   proposed → active | pending_enforcement | rejected | superseded
 *   active → superseded | expired
 *   pending_enforcement → active | superseded | expired
 *
 * @see SDD §5.4 Governance Service
 * @see Sprint 5, Task 5.3 (AC-5.3.1 through AC-5.3.7)
 * @module packages/services/governance-service
 */

import type { Pool, PoolClient } from 'pg';
import type { Redis } from 'ioredis';
import { withCommunityScope } from './community-scope.js';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** Policy enforcement states (mirrors DB ENUM) */
export type PolicyEnforcementState =
  | 'proposed'
  | 'active'
  | 'pending_enforcement'
  | 'superseded'
  | 'rejected'
  | 'expired';

/** Community-level actor */
export interface Actor {
  id: string;
  role: 'member' | 'operator' | 'admin' | 'agent';
  community_id: string;
}

/** Approval methods */
export type ApprovalMethod = 'admin' | 'conviction';

/** Policy types */
export type PolicyType = 'budget_limit';

/** Policy record from DB */
export interface Policy {
  id: string;
  community_id: string;
  policy_type: PolicyType;
  policy_value: { limit_micro: string };
  state: PolicyEnforcementState;
  policy_version: number;
  proposed_by: string;
  conviction_score: string | null;
  approved_at: string | null;
  approved_by: string | null;
  effective_from: string;
  effective_until: string | null;
  superseded_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Proposal input */
export interface PolicyProposal {
  policy_type: PolicyType;
  policy_value: z.infer<typeof PolicyValueSchema>;
  proposal_reason?: string;
  approval_method: ApprovalMethod;
}

/** List options */
export interface ListOptions {
  policy_type?: PolicyType;
  include_history?: boolean;
  limit?: number;
  offset?: number;
}

/** Sweep result */
export interface SweepResult {
  expired: number;
  promoted: number;
}

/** Budget snapshot from conservation guard */
export interface BudgetSnapshot {
  committed: bigint;
  reserved: bigint;
  available: bigint;
  limit: bigint;
}

/** Logger interface */
export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

/** Conservation guard interface (subset needed by governance) */
export interface ConservationGuardPort {
  getCurrentBudget(communityId: string): Promise<BudgetSnapshot>;
}

/** Event sourcing interface (subset needed by governance) */
export interface EventSourcingPort {
  allocateSequence(communityId: string): Promise<{ sequenceNumber: bigint }>;
}

/** CloudWatch metrics interface */
export interface MetricsPort {
  putMetric(name: string, value: number, unit?: string): void;
}

/** Service dependencies */
export interface GovernanceServiceDeps {
  pool: Pool;
  redis: Redis;
  conservationGuard: ConservationGuardPort;
  eventSourcing: EventSourcingPort;
  logger: Logger;
  metrics: MetricsPort;
}

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

/** Platform minimum limit (100,000 micro) — AC-5.3.5 */
const PLATFORM_MINIMUM_MICRO = 100_000n;

/** Valid state transitions (SDD state diagram) — AC-5.3.7 */
const VALID_TRANSITIONS: Record<PolicyEnforcementState, PolicyEnforcementState[]> = {
  proposed: ['active', 'pending_enforcement', 'rejected', 'superseded'],
  active: ['superseded', 'expired'],
  pending_enforcement: ['active', 'superseded', 'expired'],
  superseded: [],
  rejected: [],
  expired: [],
};

// --------------------------------------------------------------------------
// Validation — AC-5.3.1
// --------------------------------------------------------------------------

const LIMIT_MICRO_REGEX = /^\d+$/;

/** Validate policy value: limit_micro MUST be a non-negative integer string (SDD §5.4) */
export function validatePolicyValue(value: { limit_micro?: unknown }): asserts value is { limit_micro: string } {
  if (typeof value?.limit_micro !== 'string') {
    throw new ValidationError('limit_micro must be a string');
  }
  if (!LIMIT_MICRO_REGEX.test(value.limit_micro)) {
    throw new ValidationError('limit_micro must be a non-negative integer string');
  }
  try {
    const n = BigInt(value.limit_micro);
    if (n < 0n) throw new ValidationError('limit_micro must be non-negative');
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    throw new ValidationError('limit_micro must be a valid BigInt string');
  }
}

// --------------------------------------------------------------------------
// Errors
// --------------------------------------------------------------------------

export class NotFoundError extends Error {
  readonly code = 'NOT_FOUND';
  constructor(message: string) { super(message); this.name = 'NotFoundError'; }
}

export class ForbiddenError extends Error {
  readonly code = 'FORBIDDEN';
  constructor(message: string) { super(message); this.name = 'ForbiddenError'; }
}

export class ValidationError extends Error {
  readonly code = 'VALIDATION_ERROR';
  constructor(message: string) { super(message); this.name = 'ValidationError'; }
}

export class StaleVersionError extends Error {
  readonly code = 'STALE_VERSION';
  constructor(message: string) { super(message); this.name = 'StaleVersionError'; }
}

export class InvalidTransitionError extends Error {
  readonly code = 'INVALID_TRANSITION';
  constructor(from: PolicyEnforcementState, to: PolicyEnforcementState) {
    super(`Invalid state transition: ${from} → ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

// --------------------------------------------------------------------------
// Helper: advisory lock hash
// --------------------------------------------------------------------------

/**
 * Deterministic hash of community_id for pg_advisory_xact_lock.
 * Uses the first 8 bytes of the UUID parsed as two 32-bit integers.
 */
function communityLockKey(communityId: string): [number, number] {
  const hex = communityId.replace(/-/g, '');
  const high = parseInt(hex.substring(0, 8), 16);
  const low = parseInt(hex.substring(8, 16), 16);
  return [high, low];
}

// --------------------------------------------------------------------------
// Factory
// --------------------------------------------------------------------------

export function createGovernanceService(deps: GovernanceServiceDeps) {
  const { pool, conservationGuard, eventSourcing, logger, metrics } = deps;

  /**
   * Validate a state transition against the state diagram.
   */
  function assertValidTransition(from: PolicyEnforcementState, to: PolicyEnforcementState): void {
    if (!VALID_TRANSITIONS[from]?.includes(to)) {
      throw new InvalidTransitionError(from, to);
    }
  }

  // -----------------------------------------------------------------------
  // AC-5.3.1: propose() — creates policy in 'proposed' state
  // -----------------------------------------------------------------------

  async function propose(
    communityId: string,
    actor: Actor,
    proposal: PolicyProposal,
  ): Promise<Policy> {
    // Validate policy value with Zod (limit_micro as string)
    validatePolicyValue(proposal.policy_value);

    // Platform minimum check
    const limitMicro = BigInt(proposal.policy_value.limit_micro);
    if (limitMicro < PLATFORM_MINIMUM_MICRO) {
      throw new ValidationError(
        `Limit cannot be below platform minimum (${PLATFORM_MINIMUM_MICRO} micro)`
      );
    }

    return withCommunityScope(communityId, pool, async (client: PoolClient) => {
      const result = await client.query<Policy>(
        `INSERT INTO economic_policies
         (community_id, policy_type, policy_value, state, proposed_by)
         VALUES ($1, $2, $3, 'proposed', $4)
         RETURNING *`,
        [communityId, proposal.policy_type, JSON.stringify(proposal.policy_value), actor.id]
      );

      logger.info('Policy proposed', {
        policyId: result.rows[0].id,
        communityId,
        policyType: proposal.policy_type,
        proposedBy: actor.id,
      });

      metrics.putMetric('governance_policy_proposed', 1);
      return result.rows[0];
    });
  }

  // -----------------------------------------------------------------------
  // AC-5.3.2: approve() — outbox pattern with advisory lock
  // AC-5.3.3: Atomic supersession in same transaction
  // AC-5.3.4: Limit decrease below committed+reserved → pending_enforcement
  // AC-5.3.5: Platform minimum enforced
  // -----------------------------------------------------------------------

  async function approve(
    communityId: string,
    actor: Actor,
    policyId: string,
  ): Promise<Policy> {
    return withCommunityScope(communityId, pool, async (client: PoolClient) => {
      // AC-5.3.2: Advisory lock prevents concurrent approval + debit race
      const [lockHigh, lockLow] = communityLockKey(communityId);
      await client.query('SELECT pg_advisory_xact_lock($1, $2)', [lockHigh, lockLow]);

      // 1. Load proposal with FOR UPDATE
      const proposalResult = await client.query<Policy>(
        `SELECT * FROM economic_policies WHERE id = $1 AND state = 'proposed' FOR UPDATE`,
        [policyId]
      );
      if (!proposalResult.rows[0]) {
        throw new NotFoundError('Proposal not found or already processed');
      }

      const policy = proposalResult.rows[0];

      // 2. Authorization check
      if (policy.policy_type === 'budget_limit' && actor.role !== 'admin') {
        throw new ForbiddenError('Only admin can approve budget_limit policies');
      }

      // 3. Determine new state
      let newState: PolicyEnforcementState = 'active';
      if (policy.policy_type === 'budget_limit') {
        const currentBudget = await conservationGuard.getCurrentBudget(communityId);
        const newLimit = BigInt(policy.policy_value.limit_micro);

        // AC-5.3.5: Platform minimum
        if (newLimit < PLATFORM_MINIMUM_MICRO) {
          throw new ValidationError(
            `Limit cannot be below platform minimum (${PLATFORM_MINIMUM_MICRO} micro)`
          );
        }

        // AC-5.3.4: Limit decrease below committed+reserved → pending_enforcement
        if (newLimit < currentBudget.committed + currentBudget.reserved) {
          newState = 'pending_enforcement';
        }
      }

      assertValidTransition('proposed', newState);

      // AC-5.3.3: Atomically supersede current active/pending policy
      await client.query(
        `UPDATE economic_policies
         SET state = 'superseded', superseded_by = $1, updated_at = NOW()
         WHERE community_id = $2 AND policy_type = $3
           AND state IN ('active', 'pending_enforcement')
           AND id != $1`,
        [policyId, communityId, policy.policy_type]
      );

      // 5. Activate new policy
      const result = await client.query<Policy>(
        `UPDATE economic_policies
         SET state = $1, approved_at = NOW(), approved_by = $2, updated_at = NOW()
         WHERE id = $3
         RETURNING *`,
        [newState, actor.id, policyId]
      );

      // 6. Emit governance event in lot_entries (F-3 integration)
      const seq = await eventSourcing.allocateSequence(communityId);
      await client.query(
        `INSERT INTO lot_entries
         (community_id, lot_id, entry_type, amount_micro, purpose,
          correlation_id, sequence_number, created_at)
         VALUES ($1, NULL, 'governance', 0, 'governance',
          gen_random_uuid(), $2, NOW())`,
        [communityId, seq.sequenceNumber.toString()]
      );

      // AC-5.3.2: Outbox pattern — write conservation guard update intent
      if (newState === 'active' && policy.policy_type === 'budget_limit') {
        await client.query(
          `INSERT INTO governance_outbox
           (community_id, policy_id, policy_version, action, payload, created_at)
           VALUES ($1, $2, $3, 'update_limit', $4, NOW())`,
          [
            communityId,
            policyId,
            policy.policy_version,
            JSON.stringify({ limit_micro: policy.policy_value.limit_micro }),
          ]
        );
      }

      logger.info('Policy approved', {
        policyId,
        communityId,
        newState,
        approvedBy: actor.id,
      });

      metrics.putMetric('governance_policy_approved', 1);
      return result.rows[0];
    });
  }

  // -----------------------------------------------------------------------
  // AC-5.3.6: reject() — transitions from proposed to rejected
  // -----------------------------------------------------------------------

  async function reject(
    communityId: string,
    actor: Actor,
    policyId: string,
    reason: string,
  ): Promise<Policy> {
    return withCommunityScope(communityId, pool, async (client: PoolClient) => {
      const proposalResult = await client.query<Policy>(
        `SELECT * FROM economic_policies WHERE id = $1 AND state = 'proposed' FOR UPDATE`,
        [policyId]
      );
      if (!proposalResult.rows[0]) {
        throw new NotFoundError('Proposal not found or already processed');
      }

      assertValidTransition('proposed', 'rejected');

      const result = await client.query<Policy>(
        `UPDATE economic_policies
         SET state = 'rejected', updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [policyId]
      );

      logger.info('Policy rejected', { policyId, communityId, rejectedBy: actor.id, reason });
      metrics.putMetric('governance_policy_rejected', 1);
      return result.rows[0];
    });
  }

  // -----------------------------------------------------------------------
  // AC-5.3.4a: updateLimit — compare-and-set with policy_version
  // -----------------------------------------------------------------------

  async function updateLimit(
    communityId: string,
    policyId: string,
    expectedVersion: number,
    newLimitMicro: string,
  ): Promise<Policy> {
    validatePolicyValue({ limit_micro: newLimitMicro });

    const newLimit = BigInt(newLimitMicro);
    if (newLimit < PLATFORM_MINIMUM_MICRO) {
      throw new ValidationError(
        `Limit cannot be below platform minimum (${PLATFORM_MINIMUM_MICRO} micro)`
      );
    }

    return withCommunityScope(communityId, pool, async (client: PoolClient) => {
      const [lockHigh, lockLow] = communityLockKey(communityId);
      await client.query('SELECT pg_advisory_xact_lock($1, $2)', [lockHigh, lockLow]);

      // Compare-and-set: reject stale updates
      const current = await client.query<Policy>(
        `SELECT * FROM economic_policies
         WHERE id = $1 AND state IN ('active', 'pending_enforcement') FOR UPDATE`,
        [policyId]
      );
      if (!current.rows[0]) {
        throw new NotFoundError('Active policy not found');
      }
      if (current.rows[0].policy_version !== expectedVersion) {
        throw new StaleVersionError(
          `Expected version ${expectedVersion}, found ${current.rows[0].policy_version}`
        );
      }

      // Create new policy version (supersede old, insert new)
      const oldPolicy = current.rows[0];

      // Supersede current
      await client.query(
        `UPDATE economic_policies
         SET state = 'superseded', updated_at = NOW()
         WHERE id = $1`,
        [policyId]
      );

      // Insert new version
      const currentBudget = await conservationGuard.getCurrentBudget(communityId);
      let newState: PolicyEnforcementState = 'active';
      if (newLimit < currentBudget.committed + currentBudget.reserved) {
        newState = 'pending_enforcement';
      }

      const result = await client.query<Policy>(
        `INSERT INTO economic_policies
         (community_id, policy_type, policy_value, state, policy_version,
          proposed_by, approved_at, approved_by, superseded_by, effective_from)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), $6, NULL, NOW())
         RETURNING *`,
        [
          communityId,
          oldPolicy.policy_type,
          JSON.stringify({ limit_micro: newLimitMicro }),
          newState,
          expectedVersion + 1,
          oldPolicy.proposed_by,
        ]
      );

      // Update superseded_by on old policy
      await client.query(
        `UPDATE economic_policies SET superseded_by = $1 WHERE id = $2`,
        [result.rows[0].id, policyId]
      );

      // Outbox for conservation guard
      if (newState === 'active') {
        await client.query(
          `INSERT INTO governance_outbox
           (community_id, policy_id, policy_version, action, payload, created_at)
           VALUES ($1, $2, $3, 'update_limit', $4, NOW())`,
          [
            communityId,
            result.rows[0].id,
            expectedVersion + 1,
            JSON.stringify({ limit_micro: newLimitMicro }),
          ]
        );
      }

      logger.info('Policy limit updated', {
        oldPolicyId: policyId,
        newPolicyId: result.rows[0].id,
        communityId,
        newState,
        version: expectedVersion + 1,
      });

      metrics.putMetric('governance_limit_updated', 1);
      return result.rows[0];
    });
  }

  // -----------------------------------------------------------------------
  // Query methods
  // -----------------------------------------------------------------------

  async function getActivePolicy(
    communityId: string,
    policyType: PolicyType,
  ): Promise<Policy | null> {
    return withCommunityScope(communityId, pool, async (client: PoolClient) => {
      const result = await client.query<Policy>(
        `SELECT * FROM economic_policies
         WHERE community_id = $1 AND policy_type = $2
           AND state = 'active'
           AND superseded_by IS NULL
           AND (effective_until IS NULL OR effective_until > NOW())
         LIMIT 1`,
        [communityId, policyType]
      );
      return result.rows[0] ?? null;
    });
  }

  async function listPolicies(
    communityId: string,
    options: ListOptions = {},
  ): Promise<Policy[]> {
    return withCommunityScope(communityId, pool, async (client: PoolClient) => {
      const conditions: string[] = ['community_id = $1'];
      const params: unknown[] = [communityId];
      let paramIdx = 2;

      if (options.policy_type) {
        conditions.push(`policy_type = $${paramIdx}`);
        params.push(options.policy_type);
        paramIdx++;
      }

      if (!options.include_history) {
        conditions.push(`state IN ('proposed', 'active', 'pending_enforcement')`);
      }

      const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
      const offset = Math.max(options.offset ?? 0, 0);

      const result = await client.query<Policy>(
        `SELECT * FROM economic_policies
         WHERE ${conditions.join(' AND ')}
         ORDER BY created_at DESC
         LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, limit, offset]
      );
      return result.rows;
    });
  }

  // -----------------------------------------------------------------------
  // AC-5.3.7: sweepExpiredAndPending — full state machine transitions
  // -----------------------------------------------------------------------

  async function sweepExpiredAndPending(): Promise<SweepResult> {
    let expired = 0;
    let promoted = 0;

    // Get all communities with active/pending policies
    const client = await pool.connect();
    try {
      const communities = await client.query<{ community_id: string }>(
        `SELECT DISTINCT community_id FROM economic_policies
         WHERE state IN ('active', 'pending_enforcement')
           AND (effective_until IS NOT NULL OR state = 'pending_enforcement')`
      );

      for (const row of communities.rows) {
        const communityId = row.community_id;

        await withCommunityScope(communityId, pool, async (scopedClient: PoolClient) => {
          // Expire policies past effective_until
          const expiredResult = await scopedClient.query(
            `UPDATE economic_policies
             SET state = 'expired', updated_at = NOW()
             WHERE community_id = $1
               AND state IN ('active', 'pending_enforcement')
               AND effective_until IS NOT NULL
               AND effective_until <= NOW()
             RETURNING id`,
            [communityId]
          );
          expired += expiredResult.rowCount ?? 0;

          // Promote pending_enforcement → active if usage dropped below limit
          const pendingPolicies = await scopedClient.query<Policy>(
            `SELECT * FROM economic_policies
             WHERE community_id = $1 AND state = 'pending_enforcement'
             FOR UPDATE`,
            [communityId]
          );

          for (const policy of pendingPolicies.rows) {
            const budget = await conservationGuard.getCurrentBudget(communityId);
            const policyLimit = BigInt(policy.policy_value.limit_micro);

            if (policyLimit >= budget.committed + budget.reserved) {
              assertValidTransition('pending_enforcement', 'active');

              await scopedClient.query(
                `UPDATE economic_policies
                 SET state = 'active', updated_at = NOW()
                 WHERE id = $1`,
                [policy.id]
              );

              // Outbox for limit propagation
              await scopedClient.query(
                `INSERT INTO governance_outbox
                 (community_id, policy_id, policy_version, action, payload, created_at)
                 VALUES ($1, $2, $3, 'update_limit', $4, NOW())
                 ON CONFLICT (policy_id, policy_version) DO NOTHING`,
                [
                  communityId,
                  policy.id,
                  policy.policy_version,
                  JSON.stringify({ limit_micro: policy.policy_value.limit_micro }),
                ]
              );

              promoted++;
            }
          }
        });
      }
    } finally {
      client.release();
    }

    logger.info('Governance sweep completed', { expired, promoted });
    metrics.putMetric('governance_sweep_expired', expired);
    metrics.putMetric('governance_sweep_promoted', promoted);

    return { expired, promoted };
  }

  return {
    propose,
    approve,
    reject,
    updateLimit,
    getActivePolicy,
    listPolicies,
    sweepExpiredAndPending,
  };
}
