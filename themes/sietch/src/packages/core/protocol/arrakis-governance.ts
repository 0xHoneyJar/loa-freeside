/**
 * Arrakis Governance — Conservation Laws & Mutation Authorization (cycle-043)
 *
 * Canonical conservation law instances, actor identity resolution,
 * and credit mutation authorization wrapping hounfour's evaluateGovernanceMutation().
 *
 * SDD ref: §3.3 (GovernedCredits & Conservation Laws)
 * Sprint: 360, Task 3.1 (FR-5)
 */

import { randomUUID } from 'node:crypto';
import {
  createBalanceConservation,
  createNonNegativeConservation,
  evaluateGovernanceMutation,
  type GovernanceMutationEvalResult,
} from '@0xhoneyjar/loa-hounfour/commons';

// ─── Conservation Law Instances ──────────────────────────────────────────────

/**
 * LOT_CONSERVATION: balance + reserved + consumed = original_allocation
 *
 * Ensures credit lot accounting integrity — the sum of all partitions
 * equals the original allocation at all times. Strict enforcement.
 */
export const LOT_CONSERVATION = createBalanceConservation(
  ['balance', 'reserved', 'consumed'],
  'original_allocation',
  'strict',
);

/**
 * ACCOUNT_NON_NEGATIVE: balance >= 0 AND reserved >= 0
 *
 * Prevents overdraft on credit accounts. Strict enforcement.
 */
export const ACCOUNT_NON_NEGATIVE = createNonNegativeConservation(
  ['balance', 'reserved'],
  'strict',
);

// ─── Actor Identity Resolution ───────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class GovernanceMutationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(`GovernanceMutation[${code}]: ${message}`);
    this.name = 'GovernanceMutationError';
  }
}

/**
 * Resolve actor identity from request context.
 *
 * Priority:
 *   1. JWT sub claim (validated as UUID)
 *   2. mTLS service identity (prefixed with `service:`)
 *   3. Throws GovernanceMutationError — NEVER returns empty string
 *
 * SDD ref: §3.3 actor_id resolution
 */
export function resolveActorId(
  jwtSub?: string,
  serviceIdentity?: string,
): string {
  // Priority 1: JWT sub — validated as UUID
  if (jwtSub && jwtSub.trim().length > 0) {
    const trimmed = jwtSub.trim();
    if (!UUID_RE.test(trimmed)) {
      throw new GovernanceMutationError(
        'INVALID_ACTOR_ID',
        `JWT sub must be a valid UUID, got: ${trimmed.slice(0, 36)}`,
      );
    }
    return trimmed;
  }

  // Priority 2: mTLS service identity
  if (serviceIdentity && serviceIdentity.trim().length > 0) {
    return `service:${serviceIdentity.trim()}`;
  }

  // Priority 3: No identity — fail-closed
  throw new GovernanceMutationError(
    'NO_ACTOR_ID',
    'No authenticated identity available. JWT sub and service identity are both empty.',
  );
}

// ─── Credit Mutation Authorization ───────────────────────────────────────────

export interface CreditMutationContext {
  actorId: string;
  mutationId: string;
  timestamp: string;
  expectedVersion: number;
  accessPolicy?: {
    required_reputation_state?: string;
    required_role?: string;
    min_reputation_score?: number;
  };
  reputationState?: string;
  reputationScore?: number;
  role?: string;
}

/**
 * Create a new CreditMutationContext with stable identifiers.
 *
 * The mutationId and timestamp are generated once and remain stable
 * across retries for idempotency.
 */
export function createMutationContext(
  actorId: string,
  expectedVersion: number,
  options?: Partial<Omit<CreditMutationContext, 'actorId' | 'expectedVersion'>>,
): CreditMutationContext {
  return {
    actorId,
    mutationId: options?.mutationId ?? randomUUID(),
    timestamp: options?.timestamp ?? new Date().toISOString(),
    expectedVersion,
    accessPolicy: options?.accessPolicy,
    reputationState: options?.reputationState,
    reputationScore: options?.reputationScore,
    role: options?.role,
  };
}

/**
 * Authorize a credit mutation via hounfour's evaluateGovernanceMutation().
 *
 * Delegates entirely to the canonical implementation — zero local
 * governance reimplementations.
 */
export function authorizeCreditMutation(
  ctx: CreditMutationContext,
): GovernanceMutationEvalResult {
  return evaluateGovernanceMutation(
    {
      mutation_id: ctx.mutationId,
      actor_id: ctx.actorId,
      timestamp: ctx.timestamp,
      mutation_type: 'credit_mutation',
      expected_version: ctx.expectedVersion,
    },
    ctx.accessPolicy
      ? {
          required_reputation_state: ctx.accessPolicy.required_reputation_state,
          required_role: ctx.accessPolicy.required_role,
          min_reputation_score: ctx.accessPolicy.min_reputation_score,
        }
      : undefined,
    {
      role: ctx.role,
      reputation_state: ctx.reputationState,
      reputation_score: ctx.reputationScore,
    },
  );
}
