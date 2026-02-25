/**
 * Governance Mutation Tests — Sprint 360, Task 3.1 (FR-5)
 *
 * Tests conservation law instances, resolveActorId(), authorizeCreditMutation(),
 * and CreditMutationContext creation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetFactoryCounter,
} from '@0xhoneyjar/loa-hounfour/commons';
import {
  LOT_CONSERVATION,
  ACCOUNT_NON_NEGATIVE,
  resolveActorId,
  authorizeCreditMutation,
  createMutationContext,
  GovernanceMutationError,
} from '../../themes/sietch/src/packages/core/protocol/arrakis-governance.js';

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  resetFactoryCounter();
});

// ─── Conservation Law Instances ──────────────────────────────────────────────

describe('LOT_CONSERVATION', () => {
  it('is defined and has strict enforcement', () => {
    expect(LOT_CONSERVATION).toBeDefined();
    expect(LOT_CONSERVATION.enforcement).toBe('strict');
  });

  it('has balance + reserved + consumed = original_allocation structure', () => {
    expect(LOT_CONSERVATION.invariants).toBeDefined();
    expect(LOT_CONSERVATION.invariants.length).toBeGreaterThan(0);
  });
});

describe('ACCOUNT_NON_NEGATIVE', () => {
  it('is defined and has strict enforcement', () => {
    expect(ACCOUNT_NON_NEGATIVE).toBeDefined();
    expect(ACCOUNT_NON_NEGATIVE.enforcement).toBe('strict');
  });

  it('has non-negative constraints on balance and reserved', () => {
    expect(ACCOUNT_NON_NEGATIVE.invariants).toBeDefined();
    expect(ACCOUNT_NON_NEGATIVE.invariants.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── resolveActorId ──────────────────────────────────────────────────────────

describe('resolveActorId', () => {
  const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

  it('returns JWT sub when valid UUID', () => {
    const result = resolveActorId(VALID_UUID);
    expect(result).toBe(VALID_UUID);
  });

  it('trims whitespace from JWT sub', () => {
    const result = resolveActorId(`  ${VALID_UUID}  `);
    expect(result).toBe(VALID_UUID);
  });

  it('rejects non-UUID JWT sub', () => {
    expect(() => resolveActorId('not-a-uuid')).toThrow(GovernanceMutationError);
    try {
      resolveActorId('not-a-uuid');
    } catch (e) {
      expect((e as GovernanceMutationError).code).toBe('INVALID_ACTOR_ID');
    }
  });

  it('falls back to service identity when JWT sub is empty', () => {
    const result = resolveActorId('', 'gateway-primary');
    expect(result).toBe('service:gateway-primary');
  });

  it('falls back to service identity when JWT sub is undefined', () => {
    const result = resolveActorId(undefined, 'reputation-worker');
    expect(result).toBe('service:reputation-worker');
  });

  it('trims whitespace from service identity', () => {
    const result = resolveActorId(undefined, '  scheduler  ');
    expect(result).toBe('service:scheduler');
  });

  it('prefers JWT sub over service identity', () => {
    const result = resolveActorId(VALID_UUID, 'gateway');
    expect(result).toBe(VALID_UUID);
  });

  it('throws GovernanceMutationError(NO_ACTOR_ID) when both empty', () => {
    expect(() => resolveActorId()).toThrow(GovernanceMutationError);
    try {
      resolveActorId();
    } catch (e) {
      expect((e as GovernanceMutationError).code).toBe('NO_ACTOR_ID');
    }
  });

  it('throws GovernanceMutationError(NO_ACTOR_ID) when both whitespace-only', () => {
    expect(() => resolveActorId('   ', '   ')).toThrow(GovernanceMutationError);
  });

  it('NEVER returns empty string', () => {
    // This test verifies the contract — resolveActorId always returns non-empty or throws
    const validCases = [
      resolveActorId(VALID_UUID),
      resolveActorId(undefined, 'svc'),
    ];
    for (const result of validCases) {
      expect(result.length).toBeGreaterThan(0);
    }
  });

  it('handles case-insensitive UUID', () => {
    const upper = '550E8400-E29B-41D4-A716-446655440000';
    const result = resolveActorId(upper);
    expect(result).toBe(upper);
  });
});

// ─── createMutationContext ───────────────────────────────────────────────────

describe('createMutationContext', () => {
  const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

  it('creates context with generated mutationId and timestamp', () => {
    const ctx = createMutationContext(VALID_UUID, 1);
    expect(ctx.actorId).toBe(VALID_UUID);
    expect(ctx.expectedVersion).toBe(1);
    expect(ctx.mutationId).toMatch(/^[0-9a-f]{8}-/);
    expect(ctx.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('preserves provided mutationId for idempotency', () => {
    const stableId = '11111111-2222-3333-4444-555555555555';
    const ctx = createMutationContext(VALID_UUID, 1, { mutationId: stableId });
    expect(ctx.mutationId).toBe(stableId);
  });

  it('preserves provided timestamp for idempotency', () => {
    const stableTs = '2026-02-26T00:00:00.000Z';
    const ctx = createMutationContext(VALID_UUID, 1, { timestamp: stableTs });
    expect(ctx.timestamp).toBe(stableTs);
  });

  it('includes access policy when provided', () => {
    const ctx = createMutationContext(VALID_UUID, 1, {
      accessPolicy: { required_reputation_state: 'established' },
      reputationState: 'established',
    });
    expect(ctx.accessPolicy?.required_reputation_state).toBe('established');
    expect(ctx.reputationState).toBe('established');
  });
});

// ─── authorizeCreditMutation ─────────────────────────────────────────────────

describe('authorizeCreditMutation', () => {
  const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

  it('returns authorization result from evaluateGovernanceMutation', () => {
    const ctx = createMutationContext(VALID_UUID, 1);
    const result = authorizeCreditMutation(ctx);

    expect(result).toBeDefined();
    expect(typeof result.authorized).toBe('boolean');
    expect(typeof result.reason).toBe('string');
    expect(result.actor_id).toBe(VALID_UUID);
  });

  it('passes actor_id through to evaluation', () => {
    const ctx = createMutationContext(VALID_UUID, 1);
    const result = authorizeCreditMutation(ctx);
    expect(result.actor_id).toBe(VALID_UUID);
  });

  it('evaluates with access policy when provided', () => {
    const ctx = createMutationContext(VALID_UUID, 1, {
      accessPolicy: { required_reputation_state: 'authoritative' },
      reputationState: 'cold',
    });
    const result = authorizeCreditMutation(ctx);
    expect(result.policy_evaluated).toBe(true);
  });

  it('authorizes without access policy (no-policy = authorized)', () => {
    const ctx = createMutationContext(VALID_UUID, 1);
    const result = authorizeCreditMutation(ctx);
    expect(result.authorized).toBe(true);
  });
});
