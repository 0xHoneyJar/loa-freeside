/**
 * AmendmentService — Governance amendment lifecycle (cycle-043 Phase II)
 *
 * Manages the proposal, voting, enactment, and expiry of governance
 * amendments. All operations are recorded in the audit trail for
 * meta-governance transparency.
 *
 * Status transitions:
 *   proposed → approved  (conviction weight meets threshold)
 *   proposed → rejected  (sovereign veto or blocking weight)
 *   approved → enacted   (effective_at reached + current_value matches)
 *   proposed → expired   (30 days without resolution)
 *
 * Terminal states: enacted, rejected, expired (no transitions out)
 *
 * SDD ref: Post-convergence Comment 3, Speculation 3
 * Sprint: 365, Task 4.1
 */

import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Logger } from 'pino';
import { resolveConvictionWeight } from './amendment-voting.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export type AmendmentType = 'conservation_law' | 'capability_surface' | 'threshold';
export type AmendmentStatus = 'proposed' | 'approved' | 'enacted' | 'rejected' | 'expired';
export type VoteDecision = 'approve' | 'reject';

export interface GovernanceAmendment {
  amendment_id: string;
  amendment_type: AmendmentType;
  proposed_by: string;
  proposed_at: string;
  effective_at: string;
  description: string;
  current_value: unknown;
  proposed_value: unknown;
  approval_threshold: number;
  votes: AmendmentVote[];
  status: AmendmentStatus;
  parameter_key: string;
  parameter_version: number;
}

export interface AmendmentVote {
  voter_id: string;
  voted_at: string;
  decision: VoteDecision;
  rationale: string;
  governance_tier?: string;
  conviction_weight?: number;
}

export interface ProposeAmendmentInput {
  amendment_type: AmendmentType;
  proposed_by: string;
  effective_at: string;
  description: string;
  parameter_key: string;
  proposed_value: unknown;
  approval_threshold: number;
}

export interface VoteInput {
  amendment_id: string;
  voter_id: string;
  decision: VoteDecision;
  rationale: string;
  governance_tier?: string;
  conviction_weight?: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TERMINAL_STATES: ReadonlySet<AmendmentStatus> = new Set(['enacted', 'rejected', 'expired']);
const EXPIRY_DAYS = 30;

// ─── Service ─────────────────────────────────────────────────────────────────

export class AmendmentService {
  constructor(
    private readonly pool: Pool,
    private readonly log: Logger,
    private readonly auditAppend?: (event: Record<string, unknown>) => Promise<void>,
  ) {}

  /**
   * Propose a new governance amendment.
   * Snapshots current_value from governance_parameters at proposal time.
   */
  async proposeAmendment(input: ProposeAmendmentInput): Promise<GovernanceAmendment> {
    const now = new Date();
    const effectiveAt = new Date(input.effective_at);

    if (effectiveAt <= now) {
      throw new Error('effective_at must be in the future');
    }

    if (input.approval_threshold <= 0) {
      throw new Error('approval_threshold must be positive');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Snapshot current value from governance_parameters
      const paramResult = await client.query(
        `SELECT current_value, version FROM governance_parameters WHERE parameter_key = $1`,
        [input.parameter_key],
      );

      const currentValue = paramResult.rows.length > 0
        ? paramResult.rows[0].current_value
        : null;
      const parameterVersion = paramResult.rows.length > 0
        ? paramResult.rows[0].version
        : 0;

      const amendmentId = `amend-${randomUUID()}`;

      const amendment: GovernanceAmendment = {
        amendment_id: amendmentId,
        amendment_type: input.amendment_type,
        proposed_by: input.proposed_by,
        proposed_at: now.toISOString(),
        effective_at: input.effective_at,
        description: input.description,
        current_value: currentValue,
        proposed_value: input.proposed_value,
        approval_threshold: input.approval_threshold,
        votes: [],
        status: 'proposed',
        parameter_key: input.parameter_key,
        parameter_version: parameterVersion,
      };

      await client.query(
        `INSERT INTO governance_amendments
          (amendment_id, amendment_type, proposed_by, proposed_at, effective_at,
           description, current_value, proposed_value, approval_threshold,
           status, parameter_key, parameter_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          amendment.amendment_id, amendment.amendment_type, amendment.proposed_by,
          amendment.proposed_at, amendment.effective_at, amendment.description,
          JSON.stringify(amendment.current_value), JSON.stringify(amendment.proposed_value),
          amendment.approval_threshold, amendment.status,
          amendment.parameter_key, amendment.parameter_version,
        ],
      );

      await client.query('COMMIT');

      if (this.auditAppend) {
        await this.auditAppend({
          event_type: 'governance_amendment_proposed',
          actor_id: input.proposed_by,
          domain_tag: 'governance',
          payload: { amendment_id: amendmentId, amendment_type: input.amendment_type, parameter_key: input.parameter_key },
        });
      }

      return amendment;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Cast a vote on an amendment. Rejects duplicate votes from same voter.
   * Returns updated amendment with new status if threshold was met.
   */
  async voteOnAmendment(input: VoteInput): Promise<GovernanceAmendment> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const amendment = await this.getAmendmentForUpdate(client, input.amendment_id);

      if (amendment.status !== 'proposed') {
        throw new Error(`Cannot vote on amendment in ${amendment.status} state`);
      }

      // Check for duplicate vote
      const existingVote = amendment.votes.find((v) => v.voter_id === input.voter_id);
      if (existingVote) {
        throw new Error(`Voter ${input.voter_id} has already voted on this amendment`);
      }

      const vote: AmendmentVote = {
        voter_id: input.voter_id,
        voted_at: new Date().toISOString(),
        decision: input.decision,
        rationale: input.rationale,
        governance_tier: input.governance_tier,
        conviction_weight: input.conviction_weight ?? resolveConvictionWeight(input.governance_tier),
      };

      await client.query(
        `INSERT INTO governance_amendment_votes
          (amendment_id, voter_id, voted_at, decision, rationale, governance_tier, conviction_weight)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          input.amendment_id, vote.voter_id, vote.voted_at,
          vote.decision, vote.rationale, vote.governance_tier ?? null,
          vote.conviction_weight ?? 1,
        ],
      );

      amendment.votes.push(vote);

      // Check for sovereign veto
      if (input.decision === 'reject' && input.governance_tier === 'sovereign') {
        amendment.status = 'rejected';
        await this.updateAmendmentStatus(client, amendment.amendment_id, 'rejected');
      } else {
        // Compute conviction totals
        const approveWeight = amendment.votes
          .filter((v) => v.decision === 'approve')
          .reduce((sum, v) => sum + (v.conviction_weight ?? 1), 0);

        const rejectWeight = amendment.votes
          .filter((v) => v.decision === 'reject')
          .reduce((sum, v) => sum + (v.conviction_weight ?? 1), 0);

        if (approveWeight >= amendment.approval_threshold) {
          amendment.status = 'approved';
          await this.updateAmendmentStatus(client, amendment.amendment_id, 'approved');
        } else if (rejectWeight >= amendment.approval_threshold) {
          amendment.status = 'rejected';
          await this.updateAmendmentStatus(client, amendment.amendment_id, 'rejected');
        }
      }

      await client.query('COMMIT');

      if (this.auditAppend) {
        await this.auditAppend({
          event_type: 'governance_amendment_vote',
          actor_id: input.voter_id,
          domain_tag: 'governance',
          payload: {
            amendment_id: input.amendment_id,
            decision: input.decision,
            governance_tier: input.governance_tier,
            new_status: amendment.status,
          },
        });
      }

      return amendment;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Enact an approved amendment by updating governance_parameters.
   * Uses optimistic concurrency via version check.
   */
  async enactAmendment(amendmentId: string, actorId: string): Promise<GovernanceAmendment> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const amendment = await this.getAmendmentForUpdate(client, amendmentId);

      if (amendment.status !== 'approved') {
        throw new Error(`Cannot enact amendment in ${amendment.status} state — must be approved`);
      }

      const now = new Date();
      if (new Date(amendment.effective_at) > now) {
        throw new Error(`Amendment is not yet effective (effective_at: ${amendment.effective_at})`);
      }

      // Optimistic concurrency: verify parameter version hasn't changed
      const paramResult = await client.query(
        `SELECT version FROM governance_parameters WHERE parameter_key = $1`,
        [amendment.parameter_key],
      );

      const currentVersion = paramResult.rows.length > 0 ? paramResult.rows[0].version : 0;

      if (currentVersion !== amendment.parameter_version) {
        throw new Error(
          `Governance parameter "${amendment.parameter_key}" has drifted — ` +
          `expected version ${amendment.parameter_version}, found ${currentVersion}`,
        );
      }

      // Update governance_parameters with new value and incremented version
      if (paramResult.rows.length > 0) {
        await client.query(
          `UPDATE governance_parameters
           SET current_value = $1, version = version + 1, updated_at = NOW()
           WHERE parameter_key = $2 AND version = $3`,
          [JSON.stringify(amendment.proposed_value), amendment.parameter_key, currentVersion],
        );
      } else {
        await client.query(
          `INSERT INTO governance_parameters (parameter_key, parameter_type, current_value, version, updated_at)
           VALUES ($1, $2, $3, 1, NOW())`,
          [amendment.parameter_key, amendment.amendment_type, JSON.stringify(amendment.proposed_value)],
        );
      }

      amendment.status = 'enacted';
      await this.updateAmendmentStatus(client, amendmentId, 'enacted');

      await client.query('COMMIT');

      if (this.auditAppend) {
        await this.auditAppend({
          event_type: 'governance_amendment_enacted',
          actor_id: actorId,
          domain_tag: 'governance',
          payload: {
            amendment_id: amendmentId,
            parameter_key: amendment.parameter_key,
            new_version: currentVersion + 1,
          },
        });
      }

      return amendment;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Expire stale amendments that have been in proposed status for > 30 days.
   */
  async expireStaleAmendments(): Promise<number> {
    const cutoff = new Date(Date.now() - EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    const result = await this.pool.query(
      `UPDATE governance_amendments
       SET status = 'expired'
       WHERE status = 'proposed'
         AND proposed_at < $1
       RETURNING amendment_id`,
      [cutoff.toISOString()],
    );

    const expiredCount = result.rows.length;

    if (expiredCount > 0 && this.auditAppend) {
      await this.auditAppend({
        event_type: 'governance_amendments_expired',
        actor_id: 'system',
        domain_tag: 'governance',
        payload: {
          expired_count: expiredCount,
          amendment_ids: result.rows.map((r: any) => r.amendment_id),
        },
      });
    }

    return expiredCount;
  }

  /**
   * Get an amendment by ID.
   */
  async getAmendment(amendmentId: string): Promise<GovernanceAmendment | null> {
    const result = await this.pool.query(
      `SELECT a.*, COALESCE(json_agg(
          json_build_object(
            'voter_id', v.voter_id,
            'voted_at', v.voted_at,
            'decision', v.decision,
            'rationale', v.rationale,
            'governance_tier', v.governance_tier,
            'conviction_weight', v.conviction_weight
          )
        ) FILTER (WHERE v.voter_id IS NOT NULL), '[]') AS votes
       FROM governance_amendments a
       LEFT JOIN governance_amendment_votes v ON a.amendment_id = v.amendment_id
       WHERE a.amendment_id = $1
       GROUP BY a.amendment_id`,
      [amendmentId],
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      ...row,
      current_value: this.safeJsonParse(row.current_value),
      proposed_value: this.safeJsonParse(row.proposed_value),
      votes: Array.isArray(row.votes) ? row.votes : this.safeJsonParse(row.votes, []),
    };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async getAmendmentForUpdate(client: PoolClient, amendmentId: string): Promise<GovernanceAmendment> {
    const result = await client.query(
      `SELECT * FROM governance_amendments WHERE amendment_id = $1 FOR UPDATE`,
      [amendmentId],
    );

    if (result.rows.length === 0) {
      throw new Error(`Amendment ${amendmentId} not found`);
    }

    // Load votes
    const voteResult = await client.query(
      `SELECT * FROM governance_amendment_votes WHERE amendment_id = $1 ORDER BY voted_at ASC`,
      [amendmentId],
    );

    const row = result.rows[0];
    return {
      ...row,
      current_value: this.safeJsonParse(row.current_value),
      proposed_value: this.safeJsonParse(row.proposed_value),
      votes: voteResult.rows,
    };
  }

  private safeJsonParse(value: unknown, fallback: unknown = null): unknown {
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value);
    } catch {
      this.log.warn(`Failed to parse JSON value: ${String(value).slice(0, 100)}`);
      return fallback;
    }
  }

  private async updateAmendmentStatus(client: PoolClient, amendmentId: string, status: AmendmentStatus): Promise<void> {
    await client.query(
      `UPDATE governance_amendments SET status = $1 WHERE amendment_id = $2`,
      [status, amendmentId],
    );
  }
}
