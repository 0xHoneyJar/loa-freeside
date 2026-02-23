/**
 * Lot Entry Repository Tests — SECURITY DEFINER Insert Path
 *
 * Unit tests for the canonical lot_entries insert function.
 *
 * @see Sprint 1, Task 1.2 (AC-1.2.8)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { insertLotEntry, type InsertLotEntryParams } from '../lot-entry-repository.js';

// =============================================================================
// Mock Database Client
// =============================================================================

const createMockClient = () => ({
  query: vi.fn(),
});

// =============================================================================
// Tests
// =============================================================================

describe('insertLotEntry', () => {
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    mockClient = createMockClient();
  });

  it('should call app.insert_lot_entry_fn with correct parameters', async () => {
    mockClient.query.mockResolvedValue({
      rows: [{ id: 'entry-uuid-123' }],
    });

    const params: InsertLotEntryParams = {
      lotId: 'lot-uuid-1',
      communityId: 'community-uuid-1',
      entryType: 'credit',
      amountMicro: 5000000n,
      referenceId: 'payment-123',
    };

    // @ts-expect-error - mock client
    const result = await insertLotEntry(mockClient, params);

    expect(result.id).toBe('entry-uuid-123');
    expect(result.inserted).toBe(true);

    // Verify SQL function call
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('app.insert_lot_entry_fn'),
      expect.arrayContaining([
        'lot-uuid-1',
        'community-uuid-1',
        'credit',
        '5000000',
      ]),
    );
  });

  it('should handle idempotent insert (already exists)', async () => {
    // Idempotent conflict: function returns NULL
    mockClient.query.mockResolvedValue({
      rows: [{ id: null }],
    });

    const params: InsertLotEntryParams = {
      lotId: 'lot-uuid-1',
      communityId: 'community-uuid-1',
      entryType: 'debit',
      amountMicro: 1000000n,
      reservationId: 'res-123',
      idempotent: true,
    };

    // @ts-expect-error - mock client
    const result = await insertLotEntry(mockClient, params);

    expect(result.id).toBeNull();
    expect(result.inserted).toBe(false);
  });

  it('should handle successful idempotent insert (new entry)', async () => {
    mockClient.query.mockResolvedValue({
      rows: [{ id: 'new-entry-uuid' }],
    });

    const params: InsertLotEntryParams = {
      lotId: 'lot-uuid-1',
      communityId: 'community-uuid-1',
      entryType: 'debit',
      amountMicro: 1000000n,
      reservationId: 'res-456',
      usageEventId: 'event-789',
      idempotent: true,
    };

    // @ts-expect-error - mock client
    const result = await insertLotEntry(mockClient, params);

    expect(result.id).toBe('new-entry-uuid');
    expect(result.inserted).toBe(true);
  });

  it('should pass optional Ostrom fields when provided', async () => {
    mockClient.query.mockResolvedValue({
      rows: [{ id: 'entry-uuid-ostrom' }],
    });

    const params: InsertLotEntryParams = {
      lotId: 'lot-uuid-1',
      communityId: 'community-uuid-1',
      entryType: 'debit',
      amountMicro: 2000000n,
      correlationId: 'corr-uuid-1',
      purpose: 'agent_inference',
      sequenceNumber: 42n,
      causationId: 'cause-uuid-1',
    };

    // @ts-expect-error - mock client
    await insertLotEntry(mockClient, params);

    const callArgs = mockClient.query.mock.calls[0][1];
    expect(callArgs[7]).toBe('corr-uuid-1');  // correlationId
    expect(callArgs[8]).toBe('agent_inference'); // purpose
    expect(callArgs[9]).toBe('42');           // sequenceNumber as string
    expect(callArgs[10]).toBe('cause-uuid-1'); // causationId
  });

  it('should default optional fields to null', async () => {
    mockClient.query.mockResolvedValue({
      rows: [{ id: 'entry-uuid-minimal' }],
    });

    const params: InsertLotEntryParams = {
      lotId: 'lot-uuid-1',
      communityId: 'community-uuid-1',
      entryType: 'credit',
      amountMicro: 1000000n,
    };

    // @ts-expect-error - mock client
    await insertLotEntry(mockClient, params);

    const callArgs = mockClient.query.mock.calls[0][1];
    expect(callArgs[4]).toBeNull();  // reservationId
    expect(callArgs[5]).toBeNull();  // usageEventId
    expect(callArgs[6]).toBeNull();  // referenceId
    expect(callArgs[7]).toBeNull();  // correlationId
    expect(callArgs[8]).toBeNull();  // purpose
    expect(callArgs[9]).toBeNull();  // sequenceNumber
    expect(callArgs[10]).toBeNull(); // causationId
    expect(callArgs[11]).toBe(false); // idempotent
  });

  it('should handle expiry entry type with idempotent mode', async () => {
    mockClient.query.mockResolvedValue({
      rows: [{ id: 'expiry-entry-uuid' }],
    });

    const params: InsertLotEntryParams = {
      lotId: 'lot-uuid-1',
      communityId: 'community-uuid-1',
      entryType: 'expiry',
      amountMicro: 3000000n,
      reservationId: 'expiry:lot-uuid-1',
      referenceId: 'lot-uuid-1',
      idempotent: true,
    };

    // @ts-expect-error - mock client
    const result = await insertLotEntry(mockClient, params);

    expect(result.inserted).toBe(true);
    const callArgs = mockClient.query.mock.calls[0][1];
    expect(callArgs[2]).toBe('expiry');
    expect(callArgs[11]).toBe(true); // idempotent
  });

  it('should handle credit_back entry type', async () => {
    mockClient.query.mockResolvedValue({
      rows: [{ id: 'creditback-uuid' }],
    });

    const params: InsertLotEntryParams = {
      lotId: 'lot-uuid-1',
      communityId: 'community-uuid-1',
      entryType: 'credit_back',
      amountMicro: 500000n,
      referenceId: 'x402:creditback:tx-hash',
    };

    // @ts-expect-error - mock client
    const result = await insertLotEntry(mockClient, params);

    expect(result.inserted).toBe(true);
    expect(result.id).toBe('creditback-uuid');
  });
});
