/**
 * Stub type declaration for event-sourcing-service.
 *
 * The actual implementation lives at packages/services/event-sourcing-service.ts
 * in the repository root, but route files under themes/sietch reference
 * it via a broken relative path (../../../../packages/services/).
 * This stub allows TypeScript compilation to succeed.
 */

import type { Pool } from 'pg';

export interface VerifyConsistencyResult {
  lotsChecked: number;
  lotsConsistent: number;
  lotsDrifted: number;
  totalDriftMicro: bigint;
  drifts: Array<{
    lotId: string;
    replayedRemaining: bigint;
    actualRemaining: bigint;
    driftMicro: bigint;
  }>;
}

/**
 * Run consistency verification on the event sourcing log for a community.
 */
export declare function verifyConsistency(pool: Pool, communityId: string): Promise<VerifyConsistencyResult>;
