/**
 * Admin Billing Contract Tests (Sprint 242, Task 4.4)
 *
 * Validates Zod schemas in admin-billing.ts: valid inputs pass,
 * invalid inputs reject with correct error messages.
 */

import { describe, it, expect } from 'vitest';

import {
  batchGrantSchema,
  adminMintSchema,
  proposeRuleSchema,
  rejectRuleSchema,
  overrideCooldownSchema,
  type BatchGrantRequest,
  type AdminMintRequest,
  type CreateRuleRequest,
  type RejectRuleRequest,
  type EmergencyActivateRequest,
} from '../../../src/packages/core/contracts/admin-billing.js';

// =============================================================================
// batchGrantSchema
// =============================================================================

describe('batchGrantSchema', () => {
  it('accepts valid batch grant', () => {
    const input = {
      grants: [
        { accountId: 'acct-001', amountMicro: '5000000' },
        { accountId: 'acct-002', amountMicro: '10000000', formulaInput: { tier: 'gold' } },
      ],
    };
    const result = batchGrantSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      const data: BatchGrantRequest = result.data;
      expect(data.grants).toHaveLength(2);
    }
  });

  it('rejects empty grants array', () => {
    const result = batchGrantSchema.safeParse({ grants: [] });
    expect(result.success).toBe(false);
  });

  it('rejects non-numeric amountMicro', () => {
    const result = batchGrantSchema.safeParse({
      grants: [{ accountId: 'acct-001', amountMicro: 'abc' }],
    });
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// adminMintSchema
// =============================================================================

describe('adminMintSchema', () => {
  it('accepts valid mint with defaults', () => {
    const result = adminMintSchema.safeParse({ amountMicro: '1000000' });
    expect(result.success).toBe(true);
    if (result.success) {
      const data: AdminMintRequest = result.data;
      expect(data.sourceType).toBe('grant');
      expect(data.poolId).toBe('general');
    }
  });

  it('accepts mint with all fields', () => {
    const result = adminMintSchema.safeParse({
      amountMicro: '5000000',
      sourceType: 'deposit',
      description: 'Manual top-up',
      poolId: 'campaign:abc',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid sourceType', () => {
    const result = adminMintSchema.safeParse({
      amountMicro: '1000000',
      sourceType: 'refund',
    });
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// proposeRuleSchema
// =============================================================================

describe('proposeRuleSchema', () => {
  it('accepts valid rule with BPS summing to 10000', () => {
    const result = proposeRuleSchema.safeParse({
      name: 'Standard Split',
      commonsBps: 500,
      communityBps: 7000,
      foundationBps: 2500,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const data: CreateRuleRequest = result.data;
      expect(data.commonsBps + data.communityBps + data.foundationBps).toBe(10000);
    }
  });

  it('rejects BPS not summing to 10000', () => {
    const result = proposeRuleSchema.safeParse({
      name: 'Bad Split',
      commonsBps: 500,
      communityBps: 7000,
      foundationBps: 3000, // sum = 10500
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('10000');
    }
  });

  it('rejects missing name', () => {
    const result = proposeRuleSchema.safeParse({
      commonsBps: 500,
      communityBps: 7000,
      foundationBps: 2500,
    });
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// rejectRuleSchema & overrideCooldownSchema
// =============================================================================

describe('rejectRuleSchema', () => {
  it('accepts valid reason', () => {
    const result = rejectRuleSchema.safeParse({ reason: 'BPS split not approved by council' });
    expect(result.success).toBe(true);
    if (result.success) {
      const data: RejectRuleRequest = result.data;
      expect(data.reason).toBeTruthy();
    }
  });

  it('rejects empty reason', () => {
    const result = rejectRuleSchema.safeParse({ reason: '' });
    expect(result.success).toBe(false);
  });
});

describe('overrideCooldownSchema', () => {
  it('accepts valid emergency reason', () => {
    const result = overrideCooldownSchema.safeParse({ reason: 'Critical pricing update needed' });
    expect(result.success).toBe(true);
    if (result.success) {
      const data: EmergencyActivateRequest = result.data;
      expect(data.reason).toBeTruthy();
    }
  });

  it('rejects reason exceeding 1000 chars', () => {
    const result = overrideCooldownSchema.safeParse({ reason: 'x'.repeat(1001) });
    expect(result.success).toBe(false);
  });
});

// =============================================================================
// Type compatibility (compile-time verification)
// =============================================================================

describe('type compatibility', () => {
  it('exported types match schema inference', () => {
    // These are compile-time checks — if the types are wrong,
    // TypeScript compilation would fail
    const batch: BatchGrantRequest = {
      grants: [{ accountId: 'a', amountMicro: '100' }],
    };
    const mint: AdminMintRequest = {
      amountMicro: '100',
      sourceType: 'grant',
      poolId: 'general',
    };
    const rule: CreateRuleRequest = {
      name: 'Test',
      commonsBps: 0,
      communityBps: 10000,
      foundationBps: 0,
    };
    const reject: RejectRuleRequest = { reason: 'no' };
    const emergency: EmergencyActivateRequest = { reason: 'yes' };

    // Runtime checks that types are structurally correct
    expect(batch.grants).toBeDefined();
    expect(mint.amountMicro).toBeDefined();
    expect(rule.name).toBeDefined();
    expect(reject.reason).toBeDefined();
    expect(emergency.reason).toBeDefined();
  });
});
