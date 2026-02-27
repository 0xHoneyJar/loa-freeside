/**
 * Stub type declaration for velocity-service.
 *
 * The actual implementation lives at packages/services/velocity-service.ts
 * in the repository root, but route files under themes/sietch reference
 * it via a broken relative path (../../../../packages/services/).
 * This stub allows TypeScript compilation to succeed.
 */

import type { Pool } from 'pg';

export interface VelocitySnapshot {
  communityId: string;
  computedAt: Date;
  windowHours: number;
  velocityMicroPerHour: bigint;
  accelerationMicroPerHour2: bigint;
  availableBalanceMicro: bigint;
  estimatedExhaustionHours: number | null;
  confidence: number;
  bucketCount: number;
}

/**
 * Get the latest velocity snapshot for a community.
 */
export declare function getLatestSnapshot(pool: Pool, communityId: string): Promise<VelocitySnapshot | null>;
