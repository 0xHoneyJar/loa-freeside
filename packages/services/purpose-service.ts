/**
 * Purpose Service — Economic Memory (F-1)
 *
 * Resolves pool_id → economic purpose classification and provides
 * unclassified rate monitoring for observability.
 *
 * The POOL_PURPOSE_MAP is configurable via environment variable
 * (JSON string) or can be updated at runtime via setPurposeMap().
 *
 * @see SDD §4.4 Economic Memory
 * @see Sprint 2, Task 2.2
 * @module packages/services/purpose-service
 */

import type { Pool } from 'pg';
import { withCommunityScope } from './community-scope.js';
import { isFeatureEnabled } from './feature-flags.js';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** Economic purpose classification (mirrors DB ENUM) */
export type EconomicPurpose =
  | 'agent_inference'
  | 'agent_training'
  | 'governance_action'
  | 'platform_fee'
  | 'transfer'
  | 'refund'
  | 'unclassified';

/** Pool-to-purpose mapping configuration */
export type PoolPurposeMap = Record<string, EconomicPurpose>;

/** Unclassified rate result */
export interface UnclassifiedRateResult {
  totalEntries: number;
  unclassifiedEntries: number;
  rate: number;
}

/** Purpose breakdown row */
export interface PurposeBreakdownRow {
  purpose: EconomicPurpose;
  day: string;
  totalMicro: bigint;
  entryCount: number;
}

// --------------------------------------------------------------------------
// Default Pool → Purpose Mapping
// --------------------------------------------------------------------------

const DEFAULT_POOL_PURPOSE_MAP: PoolPurposeMap = {
  cheap: 'agent_inference',
  standard: 'agent_inference',
  reasoning: 'agent_inference',
  architect: 'agent_inference',
  training: 'agent_training',
  governance: 'governance_action',
  platform: 'platform_fee',
};

// --------------------------------------------------------------------------
// Singleton State
// --------------------------------------------------------------------------

let _purposeMap: PoolPurposeMap = { ...DEFAULT_POOL_PURPOSE_MAP };

// --------------------------------------------------------------------------
// Configuration
// --------------------------------------------------------------------------

/**
 * Load pool purpose map from environment variable.
 *
 * AC-2.2.4: Config-based mapping supports runtime reload.
 *
 * @returns The loaded purpose map
 */
export function loadPurposeMap(): PoolPurposeMap {
  const envMap = process.env.POOL_PURPOSE_MAP;
  if (envMap) {
    try {
      const parsed = JSON.parse(envMap) as PoolPurposeMap;
      _purposeMap = { ...DEFAULT_POOL_PURPOSE_MAP, ...parsed };
    } catch {
      // Invalid JSON — fall back to defaults
      _purposeMap = { ...DEFAULT_POOL_PURPOSE_MAP };
    }
  } else {
    _purposeMap = { ...DEFAULT_POOL_PURPOSE_MAP };
  }
  return _purposeMap;
}

/**
 * Set pool purpose map at runtime (for testing or dynamic config).
 *
 * AC-2.2.4: Runtime reload without restart.
 */
export function setPurposeMap(map: PoolPurposeMap): void {
  _purposeMap = { ...map };
}

/**
 * Get the current pool purpose map.
 */
export function getPurposeMap(): PoolPurposeMap {
  return { ..._purposeMap };
}

// --------------------------------------------------------------------------
// Purpose Resolution
// --------------------------------------------------------------------------

/**
 * Resolve a pool_id to its economic purpose.
 *
 * AC-2.2.1: Returns correct purpose from config map.
 * AC-2.2.2: Unknown pool_id returns 'unclassified'.
 *
 * @param poolId - Agent pool identifier
 * @returns Economic purpose classification
 */
export function resolvePurpose(poolId: string): EconomicPurpose {
  if (!isFeatureEnabled('FEATURE_PURPOSE_TRACKING')) {
    return 'unclassified';
  }
  return _purposeMap[poolId] ?? 'unclassified';
}

// --------------------------------------------------------------------------
// Unclassified Rate Monitoring
// --------------------------------------------------------------------------

/**
 * Get the unclassified rate for a community over a time window.
 *
 * AC-2.2.3: Queries lot_entries for unclassified ratio.
 *
 * @param pool - PostgreSQL connection pool
 * @param communityId - Tenant community UUID
 * @param windowHours - Lookback window in hours (default: 24)
 * @returns Unclassified rate result
 */
export async function getUnclassifiedRate(
  pool: Pool,
  communityId: string,
  windowHours: number = 24,
): Promise<UnclassifiedRateResult> {
  return withCommunityScope(communityId, pool, async (client) => {
    const result = await client.query<{
      total: string;
      unclassified: string;
    }>(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE purpose = 'unclassified') AS unclassified
       FROM lot_entries
       WHERE community_id = $1
         AND entry_type IN ('debit', 'governance_debit')
         AND created_at >= NOW() - $2 * INTERVAL '1 hour'`,
      [communityId, windowHours],
    );

    const total = parseInt(result.rows[0].total, 10);
    const unclassified = parseInt(result.rows[0].unclassified, 10);

    return {
      totalEntries: total,
      unclassifiedEntries: unclassified,
      rate: total > 0 ? unclassified / total : 0,
    };
  });
}

// --------------------------------------------------------------------------
// Purpose Breakdown Query
// --------------------------------------------------------------------------

/**
 * Get purpose breakdown for a community.
 *
 * AC-2.4.1: Groups by (community_id, purpose, day) with sum and count.
 *
 * @param pool - PostgreSQL connection pool
 * @param communityId - Tenant community UUID
 * @param from - Start date (ISO string)
 * @param to - End date (ISO string)
 * @returns Purpose breakdown rows
 */
export async function getPurposeBreakdown(
  pool: Pool,
  communityId: string,
  from?: string,
  to?: string,
): Promise<PurposeBreakdownRow[]> {
  return withCommunityScope(communityId, pool, async (client) => {
    let query = `
      SELECT purpose, day::text, total_micro, entry_count
      FROM community_purpose_breakdown
      WHERE community_id = $1`;
    const params: (string | number)[] = [communityId];

    if (from) {
      params.push(from);
      query += ` AND day >= $${params.length}::date`;
    }
    if (to) {
      params.push(to);
      query += ` AND day <= $${params.length}::date`;
    }

    query += ` ORDER BY day DESC, purpose ASC`;

    const result = await client.query<{
      purpose: EconomicPurpose;
      day: string;
      total_micro: string;
      entry_count: string;
    }>(query, params);

    return result.rows.map((row) => ({
      purpose: row.purpose,
      day: row.day,
      totalMicro: BigInt(row.total_micro),
      entryCount: parseInt(row.entry_count, 10),
    }));
  });
}

// --------------------------------------------------------------------------
// Reset (testing only)
// --------------------------------------------------------------------------

/** Reset purpose map to defaults. For testing only. */
export function _resetForTesting(): void {
  _purposeMap = { ...DEFAULT_POOL_PURPOSE_MAP };
}
