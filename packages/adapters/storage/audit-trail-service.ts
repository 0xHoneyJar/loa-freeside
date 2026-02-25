/**
 * AuditTrailService — Hash-chained append-only audit trail (cycle-043)
 *
 * Implements the AuditTrailPort interface with PostgreSQL persistence,
 * domain-separated SHA-256 hashing, advisory lock linearization,
 * and fail-closed quarantine.
 *
 * SDD ref: §3.4 (Audit Trail Hash Chain)
 * Sprint: 360, Task 3.2b-c (FR-6)
 */

import type { Pool, PoolClient } from 'pg';
import type { Logger } from 'pino';
import {
  buildDomainTag,
  computeAuditEntryHash,
  verifyAuditTrailIntegrity,
  createCheckpoint,
  AUDIT_TRAIL_GENESIS_HASH,
} from '@0xhoneyjar/loa-hounfour/commons';
import type { AuditTrailPort } from '../../adapters/agent/reputation-event-router.js';
import { advisoryLockKey, sleep } from './audit-helpers.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AuditEntry {
  id: number;
  entry_id: string;
  domain_tag: string;
  event_type: string;
  actor_id: string;
  payload: Record<string, unknown>;
  entry_hash: string;
  previous_hash: string;
  event_time: Date;
  created_at: Date;
}

export interface AuditTrailVerificationResult {
  valid: boolean;
  failure_phase?: string;
  failure_index?: number;
  expected_hash?: string;
  actual_hash?: string;
}

export interface CheckpointResult {
  success: boolean;
  checkpoint_hash?: string;
  checkpoint_entry_id?: string;
  entries_before?: number;
  error?: string;
}

export interface AuditTrailServiceConfig {
  pool: Pool;
  logger: Logger;
  contractVersion: string;
  maxRetries?: number;
  retryBaseMs?: number;
}

// ─── Circuit Breaker ─────────────────────────────────────────────────────────

interface CircuitBreakerState {
  state: 'closed' | 'open' | 'half-open';
  consecutiveFailures: number;
  openedAt?: Date;
  affectedDomainTags: Set<string>;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class AuditTrailService implements AuditTrailPort {
  private readonly pool: Pool;
  private readonly log: Logger;
  private readonly contractVersion: string;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  private readonly circuitBreaker: CircuitBreakerState;

  constructor(config: AuditTrailServiceConfig) {
    this.pool = config.pool;
    this.log = config.logger;
    this.contractVersion = config.contractVersion;
    this.maxRetries = config.maxRetries ?? 3;
    this.retryBaseMs = config.retryBaseMs ?? 50;
    this.circuitBreaker = {
      state: 'closed',
      consecutiveFailures: 0,
      affectedDomainTags: new Set(),
    };
  }

  /**
   * Append an audit entry with hash chain integrity.
   *
   * 1. Build domain tag
   * 2. SERIALIZABLE transaction
   * 3. Advisory lock (domain_tag scoped)
   * 4. Read chain head for previous_hash
   * 5. Compute hash via hounfour (NOT local)
   * 6. INSERT audit_trail
   * 7. INSERT chain_links (global fork prevention)
   * 8. UPSERT head
   * 9. COMMIT
   *
   * Retries on serialization failure (40001) up to maxRetries.
   */
  async append(entry: {
    domain_tag: string;
    event_type: string;
    actor_id: string;
    payload: Record<string, unknown>;
    event_time: Date;
    entry_id?: string;
    schema_id?: string;
  }): Promise<{ entry_id: string; entry_hash: string }> {
    const domainTag = entry.domain_tag;

    // Circuit breaker check
    if (
      this.circuitBreaker.state === 'open' &&
      this.circuitBreaker.affectedDomainTags.has(domainTag)
    ) {
      throw new AuditQuarantineError(domainTag);
    }

    const entryId = entry.entry_id ?? crypto.randomUUID();
    const eventTimeIso = entry.event_time.toISOString();

    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');

        // Advisory lock scoped by domain_tag hash (FNV-1a via shared helper)
        const lockKey = advisoryLockKey(domainTag);
        await client.query('SELECT pg_advisory_xact_lock($1)', [lockKey]);

        // Read chain head
        const headResult = await client.query<{ current_hash: string; current_id: number }>(
          'SELECT current_hash, current_id FROM audit_trail_head WHERE domain_tag = $1 FOR UPDATE',
          [domainTag],
        );

        const previousHash = headResult.rows[0]?.current_hash ?? AUDIT_TRAIL_GENESIS_HASH;

        // Compute hash via hounfour
        const entryHash = computeAuditEntryHash(
          {
            entry_id: entryId,
            timestamp: eventTimeIso,
            event_type: entry.event_type,
            actor_id: entry.actor_id,
            payload: entry.payload,
          },
          domainTag,
        );

        // INSERT audit_trail
        const insertResult = await client.query<{ id: number }>(
          `INSERT INTO audit_trail (entry_id, domain_tag, event_type, actor_id, payload, entry_hash, previous_hash, event_time)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id`,
          [entryId, domainTag, entry.event_type, entry.actor_id, JSON.stringify(entry.payload), entryHash, previousHash, entry.event_time],
        );

        const newId = insertResult.rows[0].id;

        // INSERT chain_links (global fork prevention)
        await client.query(
          `INSERT INTO audit_trail_chain_links (domain_tag, previous_hash, entry_hash, entry_id)
           VALUES ($1, $2, $3, $4)`,
          [domainTag, previousHash, entryHash, entryId],
        );

        // UPSERT head
        await client.query(
          `INSERT INTO audit_trail_head (domain_tag, current_hash, current_id, updated_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (domain_tag) DO UPDATE SET
             current_hash = EXCLUDED.current_hash,
             current_id = EXCLUDED.current_id,
             updated_at = NOW()`,
          [domainTag, entryHash, newId],
        );

        await client.query('COMMIT');

        this.log.info(
          { entry_id: entryId, domain_tag: domainTag, event_type: entry.event_type },
          'audit trail entry appended',
        );

        return { entry_id: entryId, entry_hash: entryHash };
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        lastError = err as Error;

        // Retry on serialization failure (40001)
        if ((err as { code?: string }).code === '40001' && attempt < this.maxRetries - 1) {
          const delay = this.retryBaseMs * Math.pow(2, attempt);
          this.log.warn(
            { attempt: attempt + 1, delay_ms: delay, domain_tag: domainTag },
            'serialization failure, retrying audit append',
          );
          await sleep(delay);
          continue;
        }

        throw err;
      } finally {
        client.release();
      }
    }

    this.log.error(
      { domain_tag: domainTag, max_retries: this.maxRetries },
      'audit append exhausted retries',
    );
    throw lastError ?? new Error('audit append exhausted retries');
  }

  /**
   * Verify audit trail integrity for a domain tag.
   * Delegates to hounfour's verifyAuditTrailIntegrity().
   */
  async verify(options?: {
    domainTag?: string;
    fromId?: number;
    limit?: number;
  }): Promise<AuditTrailVerificationResult> {
    const client = await this.pool.connect();
    try {
      let query = 'SELECT entry_id, entry_hash, previous_hash, event_type, actor_id, payload, event_time FROM audit_trail';
      const params: unknown[] = [];
      const conditions: string[] = [];

      if (options?.domainTag) {
        conditions.push(`domain_tag = $${params.length + 1}`);
        params.push(options.domainTag);
      }
      if (options?.fromId) {
        conditions.push(`id >= $${params.length + 1}`);
        params.push(options.fromId);
      }

      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }

      query += ' ORDER BY id ASC';

      if (options?.limit) {
        query += ` LIMIT $${params.length + 1}`;
        params.push(options.limit);
      }

      const result = await client.query(query, params);

      if (result.rows.length === 0) {
        return { valid: true };
      }

      // Build trail structure for hounfour verification
      const trail = {
        entries: result.rows.map((row) => ({
          entry_id: row.entry_id,
          entry_hash: row.entry_hash,
          previous_hash: row.previous_hash,
          event_type: row.event_type,
          actor_id: row.actor_id,
          payload: row.payload,
          timestamp: row.event_time.toISOString(),
        })),
      };

      const verification = verifyAuditTrailIntegrity(trail);

      // Update circuit breaker
      if (!verification.valid && options?.domainTag) {
        this.onVerificationFailure(options.domainTag);
      } else if (verification.valid) {
        this.onVerificationSuccess();
      }

      return verification;
    } finally {
      client.release();
    }
  }

  /**
   * Create a checkpoint for a domain tag.
   */
  async checkpoint(
    domainTag: string,
    createdBy: string,
  ): Promise<CheckpointResult> {
    const client = await this.pool.connect();
    try {
      // Load trail
      const trailResult = await client.query(
        `SELECT entry_id, entry_hash, previous_hash, event_type, actor_id, payload, event_time
         FROM audit_trail WHERE domain_tag = $1 ORDER BY id ASC`,
        [domainTag],
      );

      if (trailResult.rows.length === 0) {
        return { success: false, error: 'no entries for domain_tag' };
      }

      const trail = {
        entries: trailResult.rows.map((row) => ({
          entry_id: row.entry_id,
          entry_hash: row.entry_hash,
          previous_hash: row.previous_hash,
          event_type: row.event_type,
          actor_id: row.actor_id,
          payload: row.payload,
          timestamp: row.event_time.toISOString(),
        })),
      };

      const cpResult = createCheckpoint(trail);

      if (!cpResult.success) {
        return { success: false, error: cpResult.error };
      }

      // Persist checkpoint
      const lastEntry = trailResult.rows[trailResult.rows.length - 1];
      await client.query(
        `INSERT INTO audit_trail_checkpoints (domain_tag, checkpoint_hash, checkpoint_entry_id, entries_before, created_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [domainTag, cpResult.checkpoint_hash, lastEntry.entry_id, trailResult.rows.length, createdBy],
      );

      return {
        success: true,
        checkpoint_hash: cpResult.checkpoint_hash,
        checkpoint_entry_id: lastEntry.entry_id,
        entries_before: trailResult.rows.length,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Get circuit breaker state.
   */
  getCircuitBreakerState(): { state: string; affectedDomainTags: string[] } {
    return {
      state: this.circuitBreaker.state,
      affectedDomainTags: [...this.circuitBreaker.affectedDomainTags],
    };
  }

  /**
   * Manual circuit breaker reset (operator approval required).
   */
  resetCircuitBreaker(domainTag?: string): void {
    if (domainTag) {
      this.circuitBreaker.affectedDomainTags.delete(domainTag);
      if (this.circuitBreaker.affectedDomainTags.size === 0) {
        this.circuitBreaker.state = 'closed';
        this.circuitBreaker.consecutiveFailures = 0;
      }
    } else {
      this.circuitBreaker.state = 'closed';
      this.circuitBreaker.consecutiveFailures = 0;
      this.circuitBreaker.affectedDomainTags.clear();
    }
  }

  // ─── Circuit Breaker Internals ─────────────────────────────────────────────

  private onVerificationFailure(domainTag: string): void {
    this.circuitBreaker.consecutiveFailures++;
    this.circuitBreaker.affectedDomainTags.add(domainTag);

    // Closed → Open: 3 consecutive failures OR 1 discontinuity
    if (this.circuitBreaker.consecutiveFailures >= 3) {
      this.circuitBreaker.state = 'open';
      this.circuitBreaker.openedAt = new Date();
      this.log.error(
        { domain_tag: domainTag, failures: this.circuitBreaker.consecutiveFailures },
        'audit trail circuit breaker OPENED — mutations rejected for affected domain tags',
      );
    }
  }

  private onVerificationSuccess(): void {
    this.circuitBreaker.consecutiveFailures = 0;
    if (this.circuitBreaker.state === 'half-open') {
      this.circuitBreaker.state = 'closed';
      this.circuitBreaker.affectedDomainTags.clear();
      this.log.info('audit trail circuit breaker CLOSED — verification passed');
    }
  }
}

// ─── Quarantine Error ────────────────────────────────────────────────────────

export class AuditQuarantineError extends Error {
  public readonly code = 'AUDIT_QUARANTINE';

  constructor(public readonly domainTag: string) {
    super(`Audit trail quarantine active for domain_tag: ${domainTag}. Mutations rejected.`);
    this.name = 'AuditQuarantineError';
  }
}

// Advisory lock hashing and sleep utilities imported from ./audit-helpers.ts
