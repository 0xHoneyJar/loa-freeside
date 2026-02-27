/**
 * Stub type declaration for purpose-service.
 *
 * The actual implementation lives at packages/services/purpose-service.ts
 * in the repository root, but route files under themes/sietch reference
 * it via a broken relative path (../../../../packages/services/).
 * This stub allows TypeScript compilation to succeed.
 */

import type { Pool } from 'pg';

export interface PurposeBreakdownRow {
  purpose: string;
  day: string;
  totalMicro: bigint;
  entryCount: number;
}

export interface UnclassifiedRateResult {
  totalEntries: number;
  unclassifiedEntries: number;
  rate: number;
}

/**
 * Retrieve purpose breakdown data for a community.
 */
export declare function getPurposeBreakdown(
  pool: Pool,
  communityId: string,
  from?: string,
  to?: string,
): Promise<PurposeBreakdownRow[]>;

/**
 * Get the unclassified rate for a community within a time window.
 */
export declare function getUnclassifiedRate(
  pool: Pool,
  communityId: string,
  windowHours: number,
): Promise<UnclassifiedRateResult>;
