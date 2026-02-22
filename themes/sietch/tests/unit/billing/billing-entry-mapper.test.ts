/**
 * BillingEntry Mapper Tests
 *
 * Sprint 255 Task 4.3: Verify mapping from internal LedgerEntry to
 * loa-hounfour BillingEntry protocol type.
 */

import { describe, it, expect } from 'vitest';
import {
  toLohBillingEntry,
  toLohBillingEntries,
} from '../../../src/packages/adapters/billing/billing-entry-mapper.js';
import { BILLING_ENTRY_CONTRACT_VERSION } from '../../../src/packages/core/protocol/billing-entry.js';
import type { LedgerEntry } from '../../../src/packages/core/ports/ICreditLedgerService.js';

// =============================================================================
// Test Helpers
// =============================================================================

function createLedgerEntry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: 'entry-001',
    accountId: 'acct-1',
    poolId: 'general',
    lotId: 'lot-001',
    reservationId: 'res-001',
    entrySeq: 1,
    entryType: 'deposit',
    amountMicro: 5_000_000n, // $5 USD
    idempotencyKey: 'idem-001',
    description: 'Test deposit',
    metadata: '{"source": "test"}',
    preBalanceMicro: 0n,
    postBalanceMicro: 5_000_000n,
    createdAt: '2026-02-15T08:00:00.000Z',
    ...overrides,
  };
}

// =============================================================================
// toLohBillingEntry — Single Entry Mapping
// =============================================================================

describe('toLohBillingEntry', () => {
  it('maps deposit entry correctly', () => {
    const entry = createLedgerEntry({ entryType: 'deposit' });
    const result = toLohBillingEntry(entry);

    expect(result.entry_id).toBe('entry-001');
    expect(result.account_id).toBe('acct-1');
    expect(result.total_micro).toBe('5000000');
    expect(result.entry_type).toBe('deposit');
    expect(result.reference_id).toBe('lot-001'); // lotId takes priority
    expect(result.created_at).toBe('2026-02-15T08:00:00.000Z');
    expect(result.metadata).toBe('{"source": "test"}');
    expect(result.contract_version).toBe('7.0.0');
  });

  it('maps reserve entry correctly', () => {
    const entry = createLedgerEntry({
      entryType: 'reserve',
      amountMicro: 1_000_000n,
    });
    const result = toLohBillingEntry(entry);

    expect(result.entry_type).toBe('reserve');
    expect(result.total_micro).toBe('1000000');
  });

  it('maps finalize entry correctly', () => {
    const entry = createLedgerEntry({
      entryType: 'finalize',
      amountMicro: 750_000n,
    });
    const result = toLohBillingEntry(entry);

    expect(result.entry_type).toBe('finalize');
    expect(result.total_micro).toBe('750000');
  });

  it('maps release entry correctly', () => {
    const entry = createLedgerEntry({ entryType: 'release' });
    const result = toLohBillingEntry(entry);
    expect(result.entry_type).toBe('release');
  });

  it('maps refund entry correctly', () => {
    const entry = createLedgerEntry({ entryType: 'refund' });
    const result = toLohBillingEntry(entry);
    expect(result.entry_type).toBe('refund');
  });

  it('maps grant entry correctly', () => {
    const entry = createLedgerEntry({
      entryType: 'grant',
      amountMicro: 100_000_000n, // $100
    });
    const result = toLohBillingEntry(entry);

    expect(result.entry_type).toBe('grant');
    expect(result.total_micro).toBe('100000000');
  });

  it('preserves BigInt precision for large amounts', () => {
    const entry = createLedgerEntry({
      amountMicro: 999_999_999_999_999n, // ~$1B in micro-USD
    });
    const result = toLohBillingEntry(entry);

    expect(result.total_micro).toBe('999999999999999');
    // Verify roundtrip
    expect(BigInt(result.total_micro)).toBe(999_999_999_999_999n);
  });

  it('uses lotId as reference_id when present', () => {
    const entry = createLedgerEntry({
      lotId: 'lot-abc',
      reservationId: 'res-xyz',
    });
    const result = toLohBillingEntry(entry);

    expect(result.reference_id).toBe('lot-abc');
  });

  it('falls back to reservationId when lotId is null', () => {
    const entry = createLedgerEntry({
      lotId: null,
      reservationId: 'res-xyz',
    });
    const result = toLohBillingEntry(entry);

    expect(result.reference_id).toBe('res-xyz');
  });

  it('returns null reference_id when both lotId and reservationId are null', () => {
    const entry = createLedgerEntry({
      lotId: null,
      reservationId: null,
    });
    const result = toLohBillingEntry(entry);

    expect(result.reference_id).toBeNull();
  });

  it('handles null metadata', () => {
    const entry = createLedgerEntry({ metadata: null });
    const result = toLohBillingEntry(entry);

    expect(result.metadata).toBeNull();
  });

  it('contract_version is always present and correct', () => {
    const entry = createLedgerEntry();
    const result = toLohBillingEntry(entry);

    expect(result.contract_version).toBe(BILLING_ENTRY_CONTRACT_VERSION);
    expect(result.contract_version).toBe('7.0.0');
  });

  it('maps shadow_charge entry correctly', () => {
    const entry = createLedgerEntry({ entryType: 'shadow_charge' });
    const result = toLohBillingEntry(entry);
    expect(result.entry_type).toBe('shadow_charge');
  });

  it('maps commons_contribution entry correctly', () => {
    const entry = createLedgerEntry({ entryType: 'commons_contribution' });
    const result = toLohBillingEntry(entry);
    expect(result.entry_type).toBe('commons_contribution');
  });

  it('maps escrow entry correctly', () => {
    const entry = createLedgerEntry({ entryType: 'escrow' });
    const result = toLohBillingEntry(entry);
    expect(result.entry_type).toBe('escrow');
  });
});

// =============================================================================
// toLohBillingEntries — Batch Mapping
// =============================================================================

describe('toLohBillingEntries', () => {
  it('maps multiple entries preserving order', () => {
    const entries = [
      createLedgerEntry({ id: 'e-1', entryType: 'deposit', amountMicro: 100n }),
      createLedgerEntry({ id: 'e-2', entryType: 'reserve', amountMicro: 50n }),
      createLedgerEntry({ id: 'e-3', entryType: 'finalize', amountMicro: 30n }),
    ];

    const results = toLohBillingEntries(entries);

    expect(results).toHaveLength(3);
    expect(results[0].entry_id).toBe('e-1');
    expect(results[1].entry_id).toBe('e-2');
    expect(results[2].entry_id).toBe('e-3');
    expect(results[0].total_micro).toBe('100');
    expect(results[1].total_micro).toBe('50');
    expect(results[2].total_micro).toBe('30');
  });

  it('returns empty array for empty input', () => {
    const results = toLohBillingEntries([]);
    expect(results).toEqual([]);
  });
});
