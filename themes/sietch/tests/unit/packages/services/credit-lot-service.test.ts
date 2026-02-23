/**
 * Credit Lot Service — Unit Tests
 *
 * Tests the double-entry append-only ledger operations:
 * - Lot debit selection (earliest-expiry-first)
 * - Multi-lot split debit with deterministic lock ordering
 * - Idempotent credit lot minting
 * - Balance queries
 *
 * All monetary values use BigInt micro-USD (1 USD = 1,000,000 micro).
 *
 * @see SDD §4.2 Double-Entry Append-Only Ledger
 * @see Sprint 0A, Task 0A.5
 * @module tests/services/credit-lot-service
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// --------------------------------------------------------------------------
// Mock pg PoolClient
// --------------------------------------------------------------------------

interface MockQueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
}

const createMockClient = () => {
  const queryResults: MockQueryResult[] = [];
  let queryIndex = 0;

  const client = {
    query: vi.fn().mockImplementation(async () => {
      if (queryIndex < queryResults.length) {
        return queryResults[queryIndex++];
      }
      return { rows: [], rowCount: 0 };
    }),
    _pushResult: (result: MockQueryResult) => {
      queryResults.push(result);
    },
    _resetResults: () => {
      queryResults.length = 0;
      queryIndex = 0;
    },
  };

  return client;
};

// --------------------------------------------------------------------------
// Import under test (after mocks are ready)
// --------------------------------------------------------------------------

import {
  debitLots,
  mintCreditLot,
  getLotBalances,
  getTotalBalance,
} from '../../../../packages/services/credit-lot-service.js';
import type {
  MintParams,
} from '../../../../packages/services/credit-lot-service.js';

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe('Credit Lot Service', () => {
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    mockClient = createMockClient();
  });

  // =========================================================================
  // debitLots
  // =========================================================================

  describe('debitLots', () => {
    const communityId = '11111111-1111-4111-a111-111111111111';
    const reservationId = 'res-001';

    it('debits from a single lot when balance is sufficient', async () => {
      // Step 1: lot selection query returns one lot with sufficient balance
      mockClient._pushResult({
        rows: [{ lot_id: 'lot-1', remaining_micro: '5000000' }],
        rowCount: 1,
      });

      // Step 2: debit entry insert returns entry ID
      mockClient._pushResult({
        rows: [{ id: 'entry-1' }],
        rowCount: 1,
      });

      const result = await debitLots(
        mockClient as any,
        communityId,
        3000000n, // 3 USD
        reservationId,
      );

      expect(result.total_debited).toBe(3000000n);
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].lot_id).toBe('lot-1');
      expect(result.entries[0].amount_micro).toBe(3000000n);
    });

    it('splits debit across multiple lots', async () => {
      // Lot selection: two lots, first has 2 USD, second has 5 USD
      mockClient._pushResult({
        rows: [
          { lot_id: 'lot-1', remaining_micro: '2000000' },
          { lot_id: 'lot-2', remaining_micro: '5000000' },
        ],
        rowCount: 2,
      });

      // First lot debit entry
      mockClient._pushResult({
        rows: [{ id: 'entry-1' }],
        rowCount: 1,
      });

      // First lot depleted → status update
      mockClient._pushResult({
        rows: [],
        rowCount: 1,
      });

      // Second lot debit entry
      mockClient._pushResult({
        rows: [{ id: 'entry-2' }],
        rowCount: 1,
      });

      const result = await debitLots(
        mockClient as any,
        communityId,
        3000000n, // 3 USD — requires both lots
        reservationId,
      );

      expect(result.total_debited).toBe(3000000n);
      expect(result.entries).toHaveLength(2);
      expect(result.entries[0].amount_micro).toBe(2000000n); // depletes lot-1
      expect(result.entries[1].amount_micro).toBe(1000000n); // takes 1 USD from lot-2
    });

    it('marks lot as depleted when fully consumed', async () => {
      mockClient._pushResult({
        rows: [{ lot_id: 'lot-1', remaining_micro: '3000000' }],
        rowCount: 1,
      });

      // Debit entry
      mockClient._pushResult({
        rows: [{ id: 'entry-1' }],
        rowCount: 1,
      });

      // Status update to depleted
      mockClient._pushResult({
        rows: [],
        rowCount: 1,
      });

      await debitLots(
        mockClient as any,
        communityId,
        3000000n, // Exactly depletes the lot
        reservationId,
      );

      // Verify app.update_lot_status was called
      const statusCall = mockClient.query.mock.calls.find(
        (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('update_lot_status'),
      );
      expect(statusCall).toBeDefined();
      expect(statusCall![1]).toContain('lot-1');
      expect(statusCall![1]).toContain('depleted');
    });

    it('throws BUDGET_EXCEEDED when no lots available', async () => {
      mockClient._pushResult({
        rows: [],
        rowCount: 0,
      });

      await expect(
        debitLots(mockClient as any, communityId, 1000000n, reservationId),
      ).rejects.toThrow('BUDGET_EXCEEDED: No available credit lots');
    });

    it('throws BUDGET_EXCEEDED when lots have insufficient balance', async () => {
      mockClient._pushResult({
        rows: [{ lot_id: 'lot-1', remaining_micro: '1000000' }],
        rowCount: 1,
      });

      // Debit entry for the available amount
      mockClient._pushResult({
        rows: [{ id: 'entry-1' }],
        rowCount: 1,
      });

      // Status update (lot depleted)
      mockClient._pushResult({
        rows: [],
        rowCount: 1,
      });

      await expect(
        debitLots(mockClient as any, communityId, 5000000n, reservationId),
      ).rejects.toThrow('BUDGET_EXCEEDED: Insufficient lot balance');
    });

    it('handles idempotent debit (ON CONFLICT DO NOTHING)', async () => {
      mockClient._pushResult({
        rows: [{ lot_id: 'lot-1', remaining_micro: '5000000' }],
        rowCount: 1,
      });

      // ON CONFLICT returns no rows (already inserted)
      mockClient._pushResult({
        rows: [],
        rowCount: 0,
      });

      // Since the debit was already applied, remaining should still decrease
      // but no entry is returned. With only 1 lot and conflict, result has 0 entries
      // but remaining doesn't decrease → BUDGET_EXCEEDED
      await expect(
        debitLots(mockClient as any, communityId, 3000000n, reservationId),
      ).rejects.toThrow('BUDGET_EXCEEDED');
    });

    it('uses BigInt throughout — no floating-point', async () => {
      mockClient._pushResult({
        rows: [{ lot_id: 'lot-1', remaining_micro: '999999' }],
        rowCount: 1,
      });

      mockClient._pushResult({
        rows: [{ id: 'entry-1' }],
        rowCount: 1,
      });

      const result = await debitLots(
        mockClient as any,
        communityId,
        999999n,
        reservationId,
      );

      expect(typeof result.total_debited).toBe('bigint');
      expect(typeof result.entries[0].amount_micro).toBe('bigint');
      expect(result.total_debited).toBe(999999n);
    });

    it('passes usageEventId when provided', async () => {
      mockClient._pushResult({
        rows: [{ lot_id: 'lot-1', remaining_micro: '5000000' }],
        rowCount: 1,
      });

      mockClient._pushResult({
        rows: [{ id: 'entry-1' }],
        rowCount: 1,
      });

      await debitLots(
        mockClient as any,
        communityId,
        1000000n,
        reservationId,
        'usage-event-123',
      );

      // Verify usage_event_id was passed to the INSERT
      const insertCall = mockClient.query.mock.calls.find(
        (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('INSERT INTO lot_entries'),
      );
      expect(insertCall).toBeDefined();
      expect(insertCall![1]).toContain('usage-event-123');
    });
  });

  // =========================================================================
  // mintCreditLot
  // =========================================================================

  describe('mintCreditLot', () => {
    const params: MintParams = {
      community_id: '11111111-1111-4111-a111-111111111111',
      source: 'purchase',
      amount_micro: 10000000n, // 10 USD
      payment_id: 'pay-001',
    };

    it('mints a new lot and initial credit entry', async () => {
      // Lot header insert
      mockClient._pushResult({
        rows: [{ id: 'lot-new' }],
        rowCount: 1,
      });

      // Credit entry insert
      mockClient._pushResult({
        rows: [],
        rowCount: 1,
      });

      const lotId = await mintCreditLot(mockClient as any, params);

      expect(lotId).toBe('lot-new');
      expect(mockClient.query).toHaveBeenCalledTimes(2);
    });

    it('returns null for duplicate payment_id (idempotent)', async () => {
      // ON CONFLICT returns no rows
      mockClient._pushResult({
        rows: [],
        rowCount: 0,
      });

      const lotId = await mintCreditLot(mockClient as any, params);

      expect(lotId).toBeNull();
      // Only 1 query (lot insert), no credit entry
      expect(mockClient.query).toHaveBeenCalledTimes(1);
    });

    it('handles grant source without payment_id', async () => {
      const grantParams: MintParams = {
        community_id: '11111111-1111-4111-a111-111111111111',
        source: 'grant',
        amount_micro: 5000000n,
      };

      mockClient._pushResult({
        rows: [{ id: 'lot-grant' }],
        rowCount: 1,
      });

      mockClient._pushResult({
        rows: [],
        rowCount: 1,
      });

      const lotId = await mintCreditLot(mockClient as any, grantParams);

      expect(lotId).toBe('lot-grant');

      // Verify payment_id passed as null
      const lotInsert = mockClient.query.mock.calls[0];
      expect(lotInsert[1]).toContain(null); // payment_id
    });

    it('sets expires_at when provided', async () => {
      const expiry = new Date('2026-06-01T00:00:00Z');
      const expiringParams: MintParams = {
        ...params,
        expires_at: expiry,
      };

      mockClient._pushResult({
        rows: [{ id: 'lot-exp' }],
        rowCount: 1,
      });

      mockClient._pushResult({
        rows: [],
        rowCount: 1,
      });

      await mintCreditLot(mockClient as any, expiringParams);

      // Verify expires_at was passed
      const lotInsert = mockClient.query.mock.calls[0];
      expect(lotInsert[1]).toContain(expiry);
    });

    it('uses the lot ID as reference_id for credit entry', async () => {
      const noPaymentParams: MintParams = {
        community_id: '11111111-1111-4111-a111-111111111111',
        source: 'seed',
        amount_micro: 1000000n,
      };

      mockClient._pushResult({
        rows: [{ id: 'lot-seed-1' }],
        rowCount: 1,
      });

      mockClient._pushResult({
        rows: [],
        rowCount: 1,
      });

      await mintCreditLot(mockClient as any, noPaymentParams);

      // Credit entry should use lot_id as reference_id (since no payment_id)
      const creditInsert = mockClient.query.mock.calls[1];
      expect(creditInsert[1]).toContain('lot-seed-1');
    });
  });

  // =========================================================================
  // getLotBalances
  // =========================================================================

  describe('getLotBalances', () => {
    it('returns lot balance rows ordered by expiry', async () => {
      mockClient._pushResult({
        rows: [
          {
            lot_id: 'lot-1',
            community_id: 'comm-1',
            source: 'purchase',
            original_micro: 10000000n,
            status: 'active',
            expires_at: new Date('2026-03-01'),
            created_at: new Date('2026-01-01'),
            credited_micro: 10000000n,
            debited_micro: 3000000n,
            remaining_micro: 7000000n,
          },
          {
            lot_id: 'lot-2',
            community_id: 'comm-1',
            source: 'grant',
            original_micro: 5000000n,
            status: 'active',
            expires_at: null, // Never expires
            created_at: new Date('2026-01-15'),
            credited_micro: 5000000n,
            debited_micro: 0n,
            remaining_micro: 5000000n,
          },
        ],
        rowCount: 2,
      });

      const balances = await getLotBalances(mockClient as any, 'comm-1');

      expect(balances).toHaveLength(2);
      expect(balances[0].lot_id).toBe('lot-1'); // Expires sooner → first
      expect(balances[1].lot_id).toBe('lot-2'); // Never expires → last
    });

    it('returns empty array for community with no lots', async () => {
      mockClient._pushResult({
        rows: [],
        rowCount: 0,
      });

      const balances = await getLotBalances(mockClient as any, 'comm-empty');

      expect(balances).toHaveLength(0);
    });
  });

  // =========================================================================
  // getTotalBalance
  // =========================================================================

  describe('getTotalBalance', () => {
    it('returns total remaining micro for active lots', async () => {
      mockClient._pushResult({
        rows: [{ total: '12000000' }],
        rowCount: 1,
      });

      const total = await getTotalBalance(mockClient as any, 'comm-1');

      expect(total).toBe(12000000n);
      expect(typeof total).toBe('bigint');
    });

    it('returns 0n for community with no active lots', async () => {
      mockClient._pushResult({
        rows: [{ total: '0' }],
        rowCount: 1,
      });

      const total = await getTotalBalance(mockClient as any, 'comm-empty');

      expect(total).toBe(0n);
    });
  });
});
