/**
 * AmendmentService — Unit tests (Task 4.1)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AmendmentService } from '../../packages/adapters/storage/amendment-service.js';
import type { ProposeAmendmentInput, VoteInput } from '../../packages/adapters/storage/amendment-service.js';

// ─── Mock helpers ────────────────────────────────────────────────────────────

function createMockClient(paramRows: any[] = [], amendmentRows: any[] = [], voteRows: any[] = []) {
  return {
    query: vi.fn().mockImplementation((sql: string, params?: any[]) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [] };
      }
      if (sql.includes('governance_parameters') && sql.includes('SELECT')) {
        return { rows: paramRows };
      }
      if (sql.includes('governance_amendments') && sql.includes('SELECT') && sql.includes('FOR UPDATE')) {
        return { rows: amendmentRows };
      }
      if (sql.includes('governance_amendment_votes') && sql.includes('SELECT')) {
        return { rows: voteRows };
      }
      if (sql.includes('INSERT') || sql.includes('UPDATE')) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
}

function createMockPool(client: any) {
  return {
    connect: vi.fn().mockResolvedValue(client),
    query: vi.fn().mockResolvedValue({ rows: [] }),
  };
}

function createMockLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('AmendmentService', () => {
  describe('proposeAmendment', () => {
    it('should create amendment with status proposed', async () => {
      const client = createMockClient([{ current_value: '"old_value"', version: 1 }]);
      const pool = createMockPool(client);
      const auditAppend = vi.fn();
      const service = new AmendmentService(pool as any, createMockLogger(), auditAppend);

      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const input: ProposeAmendmentInput = {
        amendment_type: 'threshold',
        proposed_by: 'actor-1',
        effective_at: futureDate,
        description: 'Raise quality threshold',
        parameter_key: 'quality_threshold',
        proposed_value: 0.9,
        approval_threshold: 20,
      };

      const result = await service.proposeAmendment(input);

      expect(result.status).toBe('proposed');
      expect(result.amendment_type).toBe('threshold');
      expect(result.proposed_by).toBe('actor-1');
      expect(result.votes).toEqual([]);
      expect(result.parameter_version).toBe(1);
      expect(auditAppend).toHaveBeenCalledOnce();
      expect(auditAppend.mock.calls[0][0].event_type).toBe('governance_amendment_proposed');
    });

    it('should reject past effective_at', async () => {
      const client = createMockClient();
      const pool = createMockPool(client);
      const service = new AmendmentService(pool as any, createMockLogger());

      const pastDate = new Date(Date.now() - 86400000).toISOString();
      const input: ProposeAmendmentInput = {
        amendment_type: 'threshold',
        proposed_by: 'actor-1',
        effective_at: pastDate,
        description: 'test',
        parameter_key: 'key',
        proposed_value: 1,
        approval_threshold: 10,
      };

      await expect(service.proposeAmendment(input)).rejects.toThrow('effective_at must be in the future');
    });

    it('should reject non-positive approval_threshold', async () => {
      const client = createMockClient();
      const pool = createMockPool(client);
      const service = new AmendmentService(pool as any, createMockLogger());

      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const input: ProposeAmendmentInput = {
        amendment_type: 'threshold',
        proposed_by: 'actor-1',
        effective_at: futureDate,
        description: 'test',
        parameter_key: 'key',
        proposed_value: 1,
        approval_threshold: 0,
      };

      await expect(service.proposeAmendment(input)).rejects.toThrow('approval_threshold must be positive');
    });

    it('should snapshot current_value as null when parameter does not exist', async () => {
      const client = createMockClient([]); // No param rows
      const pool = createMockPool(client);
      const service = new AmendmentService(pool as any, createMockLogger());

      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const result = await service.proposeAmendment({
        amendment_type: 'conservation_law',
        proposed_by: 'actor-1',
        effective_at: futureDate,
        description: 'New law',
        parameter_key: 'new_param',
        proposed_value: { rule: 'new' },
        approval_threshold: 10,
      });

      expect(result.current_value).toBeNull();
      expect(result.parameter_version).toBe(0);
    });
  });

  describe('voteOnAmendment', () => {
    it('should accept approve vote and record audit event', async () => {
      const amendment = {
        amendment_id: 'amend-1',
        status: 'proposed',
        approval_threshold: 20,
        parameter_key: 'key',
        parameter_version: 1,
        current_value: null,
        proposed_value: null,
      };
      const client = createMockClient([], [amendment], []);
      const pool = createMockPool(client);
      const auditAppend = vi.fn();
      const service = new AmendmentService(pool as any, createMockLogger(), auditAppend);

      const input: VoteInput = {
        amendment_id: 'amend-1',
        voter_id: 'voter-1',
        decision: 'approve',
        rationale: 'Looks good',
        governance_tier: 'member',
        conviction_weight: 5,
      };

      const result = await service.voteOnAmendment(input);

      expect(result.votes).toHaveLength(1);
      expect(result.votes[0].decision).toBe('approve');
      expect(auditAppend).toHaveBeenCalledOnce();
    });

    it('should reject duplicate vote from same voter', async () => {
      const amendment = {
        amendment_id: 'amend-1',
        status: 'proposed',
        approval_threshold: 20,
      };
      const existingVotes = [
        { voter_id: 'voter-1', decision: 'approve', conviction_weight: 5 },
      ];
      const client = createMockClient([], [amendment], existingVotes);
      const pool = createMockPool(client);
      const service = new AmendmentService(pool as any, createMockLogger());

      await expect(service.voteOnAmendment({
        amendment_id: 'amend-1',
        voter_id: 'voter-1',
        decision: 'reject',
        rationale: 'Changed mind',
      })).rejects.toThrow('already voted');
    });

    it('should transition to approved when conviction threshold met', async () => {
      const amendment = {
        amendment_id: 'amend-1',
        status: 'proposed',
        approval_threshold: 20,
      };
      const existingVotes = [
        { voter_id: 'v1', decision: 'approve', conviction_weight: 15, governance_tier: 'steward' },
      ];
      const client = createMockClient([], [amendment], existingVotes);
      const pool = createMockPool(client);
      const service = new AmendmentService(pool as any, createMockLogger());

      const result = await service.voteOnAmendment({
        amendment_id: 'amend-1',
        voter_id: 'v2',
        decision: 'approve',
        rationale: 'Agreed',
        governance_tier: 'member',
        conviction_weight: 5,
      });

      // 15 + 5 = 20 >= threshold 20
      expect(result.status).toBe('approved');
    });

    it('should transition to rejected on sovereign veto', async () => {
      const amendment = {
        amendment_id: 'amend-1',
        status: 'proposed',
        approval_threshold: 20,
      };
      const client = createMockClient([], [amendment], []);
      const pool = createMockPool(client);
      const service = new AmendmentService(pool as any, createMockLogger());

      const result = await service.voteOnAmendment({
        amendment_id: 'amend-1',
        voter_id: 'sovereign-1',
        decision: 'reject',
        rationale: 'Constitutional violation',
        governance_tier: 'sovereign',
        conviction_weight: 25,
      });

      expect(result.status).toBe('rejected');
    });

    it('should reject vote on non-proposed amendment', async () => {
      const amendment = {
        amendment_id: 'amend-1',
        status: 'enacted',
        approval_threshold: 20,
      };
      const client = createMockClient([], [amendment], []);
      const pool = createMockPool(client);
      const service = new AmendmentService(pool as any, createMockLogger());

      await expect(service.voteOnAmendment({
        amendment_id: 'amend-1',
        voter_id: 'v1',
        decision: 'approve',
        rationale: 'test',
      })).rejects.toThrow('Cannot vote on amendment in enacted state');
    });
  });

  describe('enactAmendment', () => {
    it('should update governance_parameters when version matches', async () => {
      const amendment = {
        amendment_id: 'amend-1',
        status: 'approved',
        effective_at: new Date(Date.now() - 1000).toISOString(), // Already effective
        parameter_key: 'quality_threshold',
        parameter_version: 1,
        proposed_value: '"0.9"',
        current_value: '"0.7"',
        approval_threshold: 20,
      };
      const client = createMockClient(
        [{ version: 1 }], // governance_parameters version matches
        [amendment],
        [],
      );
      const pool = createMockPool(client);
      const auditAppend = vi.fn();
      const service = new AmendmentService(pool as any, createMockLogger(), auditAppend);

      const result = await service.enactAmendment('amend-1', 'enactor-1');

      expect(result.status).toBe('enacted');
      expect(auditAppend).toHaveBeenCalledOnce();
      expect(auditAppend.mock.calls[0][0].event_type).toBe('governance_amendment_enacted');
    });

    it('should fail on version drift (optimistic concurrency)', async () => {
      const amendment = {
        amendment_id: 'amend-1',
        status: 'approved',
        effective_at: new Date(Date.now() - 1000).toISOString(),
        parameter_key: 'quality_threshold',
        parameter_version: 1,
        proposed_value: '"0.9"',
        current_value: '"0.7"',
        approval_threshold: 20,
      };
      const client = createMockClient(
        [{ version: 2 }], // Version has drifted!
        [amendment],
        [],
      );
      const pool = createMockPool(client);
      const service = new AmendmentService(pool as any, createMockLogger());

      await expect(service.enactAmendment('amend-1', 'enactor-1')).rejects.toThrow('has drifted');
    });

    it('should reject enactment of non-approved amendment', async () => {
      const amendment = {
        amendment_id: 'amend-1',
        status: 'proposed',
        approval_threshold: 20,
      };
      const client = createMockClient([], [amendment], []);
      const pool = createMockPool(client);
      const service = new AmendmentService(pool as any, createMockLogger());

      await expect(service.enactAmendment('amend-1', 'actor')).rejects.toThrow('must be approved');
    });

    it('should reject enactment before effective_at', async () => {
      const amendment = {
        amendment_id: 'amend-1',
        status: 'approved',
        effective_at: new Date(Date.now() + 86400000).toISOString(), // Future
        parameter_key: 'key',
        parameter_version: 1,
        approval_threshold: 20,
      };
      const client = createMockClient([{ version: 1 }], [amendment], []);
      const pool = createMockPool(client);
      const service = new AmendmentService(pool as any, createMockLogger());

      await expect(service.enactAmendment('amend-1', 'actor')).rejects.toThrow('not yet effective');
    });
  });

  describe('expireStaleAmendments', () => {
    it('should expire proposals older than 30 days', async () => {
      const mockPool = {
        connect: vi.fn(),
        query: vi.fn().mockResolvedValue({
          rows: [{ amendment_id: 'amend-old-1' }, { amendment_id: 'amend-old-2' }],
        }),
      };
      const auditAppend = vi.fn();
      const service = new AmendmentService(mockPool as any, createMockLogger(), auditAppend);

      const count = await service.expireStaleAmendments();

      expect(count).toBe(2);
      expect(auditAppend).toHaveBeenCalledOnce();
      expect(auditAppend.mock.calls[0][0].event_type).toBe('governance_amendments_expired');
    });

    it('should not audit when no amendments expired', async () => {
      const mockPool = {
        connect: vi.fn(),
        query: vi.fn().mockResolvedValue({ rows: [] }),
      };
      const auditAppend = vi.fn();
      const service = new AmendmentService(mockPool as any, createMockLogger(), auditAppend);

      const count = await service.expireStaleAmendments();

      expect(count).toBe(0);
      expect(auditAppend).not.toHaveBeenCalled();
    });
  });
});
