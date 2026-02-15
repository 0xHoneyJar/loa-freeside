/**
 * S2S Billing Contract Types
 *
 * Shared TypeScript types for the loa-finn → arrakis S2S finalize contract.
 * These types define the wire format for inter-service billing calls.
 *
 * Migration note: These types are candidates for migration to loa-hounfour
 * as a shared package. See https://github.com/0xHoneyJar/arrakis/issues/62.
 *
 * SDD refs: §5.7 Auth Model
 * Sprint refs: Task 9.2
 *
 * @module packages/core/contracts/s2s-billing
 */

import { z } from 'zod';
import type { UsageRecord } from '../protocol/index.js';

// =============================================================================
// Request / Response Types
// =============================================================================

/**
 * S2S finalize request from loa-finn to arrakis.
 * Wire format aligned with protocol UsageRecord — serialized as strings for JSON safety.
 */
export interface S2SFinalizeRequest {
  /** The reservation ID to finalize */
  reservationId: string;
  /** Actual cost in micro-USD as a string (for BigInt safety over JSON) */
  actualCostMicro: string;
  /** Optional account ID for confused-deputy prevention (removed in Sprint 5 — derived from reservation) */
  accountId?: string;
  /** Optional identity anchor for agent verification (Sprint 5) */
  identity_anchor?: string;
}

/** S2S finalize success response */
export interface S2SFinalizeResponse {
  reservationId: string;
  accountId: string;
  finalizedMicro: string;
  releasedMicro: string;
  overrunMicro: string;
  billingMode: string;
  finalizedAt: string;
}

/** S2S finalize error response */
export interface S2SFinalizeError {
  error: string;
  message?: string;
}

// =============================================================================
// Zod Schemas (Runtime Validation)
// =============================================================================

/** Zod schema for S2S finalize request body */
export const s2sFinalizeRequestSchema = z.object({
  reservationId: z.string().min(1),
  actualCostMicro: z.string().regex(/^\d+$/, 'Must be a positive integer string'),
  accountId: z.string().min(1).optional(),
  /** Identity anchor for agent verification (Sprint 243, Task 5.3) */
  identity_anchor: z.string().min(1).optional(),
});

/** Zod schema for ledger history query params */
export const historyQuerySchema = z.object({
  poolId: z.string().optional(),
  entryType: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
