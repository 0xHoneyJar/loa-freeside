/**
 * GovernedMutationService — Transactional coupling of state + audit (cycle-043)
 *
 * Single entry point for ALL governed state mutations.
 * State change + audit trail append happen in the SAME SERIALIZABLE transaction.
 *
 * SDD ref: §3.4.6a (GovernedMutationService)
 * Sprint: 360, Task 3.2d (FR-6)
 */

import type { Pool, PoolClient } from 'pg';
import type { Logger } from 'pino';
import {
  buildDomainTag,
  computeAuditEntryHash,
  AUDIT_TRAIL_GENESIS_HASH,
} from '@0xhoneyjar/loa-hounfour/commons';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MutationParams<T> {
  mutationId: string;
  eventTime: string;
  actorId: string;
  eventType: string;
  schemaId: string;
  domainTag?: string;
  mutate: (tx: PoolClient) => Promise<T>;
  auditPayload: Record<string, unknown>;
}

export interface MutationResult<T> {
  result: T;
  auditEntry: {
    entry_id: string;
    entry_hash: string;
  };
}

export interface GovernedMutationServiceConfig {
  pool: Pool;
  logger: Logger;
  contractVersion: string;
  maxRetries?: number;
  retryBaseMs?: number;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class GovernedMutationService {
  private readonly pool: Pool;
  private readonly log: Logger;
  private readonly contractVersion: string;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;

  constructor(config: GovernedMutationServiceConfig) {
    this.pool = config.pool;
    this.log = config.logger;
    this.contractVersion = config.contractVersion;
    this.maxRetries = config.maxRetries ?? 3;
    this.retryBaseMs = config.retryBaseMs ?? 50;
  }

  /**
   * Execute a governed mutation — state change + audit append in SAME transaction.
   *
   * 1. Begin SERIALIZABLE
   * 2. Execute params.mutate(tx) — state mutation
   * 3. Append audit trail entry in SAME transaction
   * 4. COMMIT (both or neither)
   *
   * The mutationId provides idempotency — duplicate entry_id is safely rejected.
   */
  async executeMutation<T>(params: MutationParams<T>): Promise<MutationResult<T>> {
    const domainTag = params.domainTag ?? buildDomainTag(params.schemaId, this.contractVersion);
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');

        // 1. Execute state mutation
        const result = await params.mutate(client);

        // 2. Advisory lock for chain linearization
        const lockKey = hashCode(domainTag);
        await client.query('SELECT pg_advisory_xact_lock($1)', [lockKey]);

        // 3. Read chain head
        const headResult = await client.query<{ current_hash: string; current_id: number }>(
          'SELECT current_hash, current_id FROM audit_trail_head WHERE domain_tag = $1 FOR UPDATE',
          [domainTag],
        );

        const previousHash = headResult.rows[0]?.current_hash ?? AUDIT_TRAIL_GENESIS_HASH;

        // 4. Compute hash via hounfour
        const entryHash = computeAuditEntryHash(
          {
            entry_id: params.mutationId,
            timestamp: params.eventTime,
            event_type: params.eventType,
            actor_id: params.actorId,
            payload: params.auditPayload,
          },
          domainTag,
        );

        // 5. INSERT audit_trail
        const insertResult = await client.query<{ id: number }>(
          `INSERT INTO audit_trail (entry_id, domain_tag, event_type, actor_id, payload, entry_hash, previous_hash, event_time)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id`,
          [params.mutationId, domainTag, params.eventType, params.actorId, JSON.stringify(params.auditPayload), entryHash, previousHash, new Date(params.eventTime)],
        );

        const newId = insertResult.rows[0].id;

        // 6. INSERT chain_links
        await client.query(
          `INSERT INTO audit_trail_chain_links (domain_tag, previous_hash, entry_hash, entry_id)
           VALUES ($1, $2, $3, $4)`,
          [domainTag, previousHash, entryHash, params.mutationId],
        );

        // 7. UPSERT head
        await client.query(
          `INSERT INTO audit_trail_head (domain_tag, current_hash, current_id, updated_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (domain_tag) DO UPDATE SET
             current_hash = EXCLUDED.current_hash,
             current_id = EXCLUDED.current_id,
             updated_at = NOW()`,
          [domainTag, entryHash, newId],
        );

        // 8. COMMIT — both state mutation and audit entry, or neither
        await client.query('COMMIT');

        this.log.info(
          {
            mutation_id: params.mutationId,
            domain_tag: domainTag,
            event_type: params.eventType,
            actor_id: params.actorId,
          },
          'governed mutation committed',
        );

        return {
          result,
          auditEntry: { entry_id: params.mutationId, entry_hash: entryHash },
        };
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        lastError = err as Error;

        // Retry on serialization failure (40001)
        if ((err as { code?: string }).code === '40001' && attempt < this.maxRetries - 1) {
          const delay = this.retryBaseMs * Math.pow(2, attempt);
          this.log.warn(
            { attempt: attempt + 1, delay_ms: delay, mutation_id: params.mutationId },
            'serialization failure, retrying governed mutation',
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
      { mutation_id: params.mutationId, max_retries: this.maxRetries },
      'governed mutation exhausted retries',
    );
    throw lastError ?? new Error('governed mutation exhausted retries');
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash | 0;
  }
  return Math.abs(hash);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
