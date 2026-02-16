/**
 * Admin Billing Contract Types (Sprint 242, Tasks 4.1 + 4.3)
 *
 * Shared Zod schemas and TypeScript types for billing admin endpoints.
 * All admin route validation schemas live here — zero inline schemas
 * in billing-admin-routes.ts.
 *
 * SDD refs: §2.5, §2.7, §5.5 Admin Endpoints
 * Sprint refs: Tasks 4.1, 4.2, 4.3
 *
 * @module packages/core/contracts/admin-billing
 */

import { z } from 'zod';

// =============================================================================
// Batch Grant Schema
// =============================================================================

/** Schema for batch grant creation on a campaign */
export const batchGrantSchema = z.object({
  grants: z.array(z.object({
    accountId: z.string().min(1),
    amountMicro: z.string().regex(/^\d+$/, 'Must be a positive integer string'),
    formulaInput: z.record(z.unknown()).optional(),
  })).min(1).max(1000),
});

export type BatchGrantRequest = z.infer<typeof batchGrantSchema>;

// =============================================================================
// Admin Mint Schema
// =============================================================================

/** Schema for admin credit mint */
export const adminMintSchema = z.object({
  amountMicro: z.string().regex(/^\d+$/, 'Must be a positive integer string'),
  sourceType: z.enum(['grant', 'deposit']).default('grant'),
  description: z.string().max(500).optional(),
  poolId: z.string().default('general'),
});

export type AdminMintRequest = z.infer<typeof adminMintSchema>;

// =============================================================================
// Revenue Rules Schemas
// =============================================================================

/** Schema for proposing a new revenue rule — BPS must sum to 10000 */
export const proposeRuleSchema = z.object({
  name: z.string().min(1).max(200),
  commonsBps: z.number().int().min(0).max(10000),
  communityBps: z.number().int().min(0).max(10000),
  foundationBps: z.number().int().min(0).max(10000),
  notes: z.string().max(1000).optional(),
}).refine(
  d => d.commonsBps + d.communityBps + d.foundationBps === 10000,
  { message: 'Basis points must sum to 10000 (100%)' },
);

export type CreateRuleRequest = z.infer<typeof proposeRuleSchema>;

/** Schema for rejecting a revenue rule */
export const rejectRuleSchema = z.object({
  reason: z.string().min(1).max(1000),
});

export type RejectRuleRequest = z.infer<typeof rejectRuleSchema>;

/** Schema for emergency cooldown override */
export const overrideCooldownSchema = z.object({
  reason: z.string().min(1).max(1000),
});

export type EmergencyActivateRequest = z.infer<typeof overrideCooldownSchema>;

// =============================================================================
// Fraud Rules Schemas (Sprint 15, Task 15.4)
// =============================================================================

/** Schema for proposing a new fraud rule — weights must sum to 10000 BPS */
export const proposeFraudRuleSchema = z.object({
  name: z.string().min(1).max(200),
  ipClusterWeight: z.number().int().min(0).max(10000),
  uaFingerprintWeight: z.number().int().min(0).max(10000),
  velocityWeight: z.number().int().min(0).max(10000),
  activityWeight: z.number().int().min(0).max(10000),
  flagThreshold: z.number().int().min(1).max(10000),
  withholdThreshold: z.number().int().min(1).max(10000),
  notes: z.string().max(1000).optional(),
}).refine(
  d => d.ipClusterWeight + d.uaFingerprintWeight + d.velocityWeight + d.activityWeight === 10000,
  { message: 'Fraud weights must sum to 10000 (100%)' },
).refine(
  d => d.flagThreshold < d.withholdThreshold,
  { message: 'Flag threshold must be less than withhold threshold' },
);

export type ProposeFraudRuleRequest = z.infer<typeof proposeFraudRuleSchema>;
