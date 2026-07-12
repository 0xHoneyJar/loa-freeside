/**
 * Typed refusal (SDD §11, IMP-006). The audit REFUSES — with a stable code and
 * HTTP status — rather than approximating when it hits an out-of-scope or
 * unsafe request. "Never silently wrong."
 */

import { z } from 'zod';

export const RefusalCodeSchema = z.enum([
  'unsupported-gating', // gating beyond single-contract NFT balance (AC-3)
  'unindexed-contract', // sonar does not index this contract
  'external-mode', // external community — v1 cannot serve (ModeResolver, SKP-002)
  'reconstruction-failed', // Transfer-replay validation failed (AC-8 / SKP-003)
  'cohort-too-small', // k-anonymity cannot safely serve even a bucket (AC-7)
  'upstream-exhausted', // sonar pagination / score call caps exceeded (IMP-009)
  'rate-limited', // per-IP rate limit (AC-6)
]);
export type RefusalCode = z.infer<typeof RefusalCodeSchema>;

export const RefusalSchema = z
  .object({
    code: RefusalCodeSchema,
    reason: z.string().min(1),
    retryable: z.boolean(),
  })
  .strict();
export type Refusal = z.infer<typeof RefusalSchema>;

/**
 * Stable HTTP status per refusal code (SDD §11). The gateway (S1-T7) maps a
 * Refusal to its response status via this table — one source of truth, so the
 * wire contract can't drift from the typed code.
 */
export const REFUSAL_HTTP_STATUS: Record<RefusalCode, number> = {
  'unsupported-gating': 422,
  'unindexed-contract': 404,
  'external-mode': 422,
  'reconstruction-failed': 422,
  'cohort-too-small': 422,
  'upstream-exhausted': 503,
  'rate-limited': 429,
};
