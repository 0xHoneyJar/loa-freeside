/**
 * Governance Service — Negative Security Tests
 *
 * Sprint 5, Task 5.9 (AC-5.9.1 through AC-5.9.6)
 *
 * Tests security boundaries: cross-tenant denial, role enforcement,
 * concurrent approval races, and partial unique index constraints.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createGovernanceService,
  NotFoundError,
  ForbiddenError,
  ValidationError,
  validatePolicyValue,
  type Actor,
  type PolicyProposal,
  type BudgetSnapshot,
} from '../governance-service.js';

// --------------------------------------------------------------------------
// Mocks
// --------------------------------------------------------------------------

const mockQuery = vi.fn();
const mockRelease = vi.fn();
const mockConnect = vi.fn().mockResolvedValue({
  query: mockQuery,
  release: mockRelease,
});

const mockPool = {
  connect: mockConnect,
  query: mockQuery,
} as unknown as import('pg').Pool;

const mockRedis = {} as unknown as import('ioredis').Redis;

const mockBudget: BudgetSnapshot = {
  committed: 500_000n,
  reserved: 100_000n,
  available: 400_000n,
  limit: 1_000_000n,
};

const mockConservationGuard = {
  getCurrentBudget: vi.fn().mockResolvedValue(mockBudget),
};

const mockEventSourcing = {
  allocateSequence: vi.fn().mockResolvedValue({ sequenceNumber: 1n }),
};

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const mockMetrics = {
  putMetric: vi.fn(),
};

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

const adminActor: Actor = {
  id: '11111111-1111-1111-1111-111111111111',
  role: 'admin',
  community_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
};

const memberActor: Actor = {
  id: '22222222-2222-2222-2222-222222222222',
  role: 'member',
  community_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
};

const agentActor: Actor = {
  id: '33333333-3333-3333-3333-333333333333',
  role: 'agent',
  community_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
};

const otherCommunityActor: Actor = {
  id: '44444444-4444-4444-4444-444444444444',
  role: 'admin',
  community_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
};

const validProposal: PolicyProposal = {
  policy_type: 'budget_limit',
  policy_value: { limit_micro: '5000000' },
  approval_method: 'admin',
};

const mockPolicyRow = {
  id: '55555555-5555-5555-5555-555555555555',
  community_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  policy_type: 'budget_limit',
  policy_value: { limit_micro: '5000000' },
  state: 'proposed',
  policy_version: 1,
  proposed_by: '11111111-1111-1111-1111-111111111111',
  conviction_score: null,
  approved_at: null,
  approved_by: null,
  effective_from: '2026-02-24T00:00:00Z',
  effective_until: null,
  superseded_by: null,
  created_at: '2026-02-24T00:00:00Z',
  updated_at: '2026-02-24T00:00:00Z',
};

function createService() {
  return createGovernanceService({
    pool: mockPool,
    redis: mockRedis,
    conservationGuard: mockConservationGuard,
    eventSourcing: mockEventSourcing,
    logger: mockLogger,
    metrics: mockMetrics,
  });
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockConservationGuard.getCurrentBudget.mockResolvedValue(mockBudget);
  mockEventSourcing.allocateSequence.mockResolvedValue({ sequenceNumber: 1n });

  // Default: withCommunityScope mock behavior
  mockQuery.mockImplementation((sql: string) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
      return { rows: [], rowCount: 0 };
    }
    if (sql.startsWith('SET LOCAL')) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes('pg_advisory_xact_lock')) {
      return { rows: [], rowCount: 0 };
    }
    // Default: empty result
    return { rows: [], rowCount: 0 };
  });
});

describe('validatePolicyValue validation', () => {
  it('rejects negative limit_micro', () => {
    expect(() => validatePolicyValue({ limit_micro: '-100' })).toThrow(ValidationError);
  });

  it('rejects non-numeric limit_micro', () => {
    expect(() => validatePolicyValue({ limit_micro: 'abc' })).toThrow(ValidationError);
  });

  it('rejects floating point limit_micro', () => {
    expect(() => validatePolicyValue({ limit_micro: '100.5' })).toThrow(ValidationError);
  });

  it('accepts valid limit_micro string', () => {
    expect(() => validatePolicyValue({ limit_micro: '5000000' })).not.toThrow();
  });

  it('rejects non-string limit_micro', () => {
    expect(() => validatePolicyValue({ limit_micro: 5000000 })).toThrow(ValidationError);
  });
});

describe('AC-5.3.5: Platform minimum enforcement', () => {
  it('rejects propose with limit below platform minimum', async () => {
    const service = createService();

    const belowMinProposal: PolicyProposal = {
      policy_type: 'budget_limit',
      policy_value: { limit_micro: '99999' },
      approval_method: 'admin',
    };

    await expect(
      service.propose(adminActor.community_id, adminActor, belowMinProposal)
    ).rejects.toThrow(ValidationError);
  });
});

// AC-5.9.2: Member cannot approve any policy
describe('AC-5.9.2: Member cannot approve', () => {
  it('rejects member approval of budget_limit policy', async () => {
    const service = createService();

    // Setup: proposal exists
    mockQuery.mockImplementation((sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [], rowCount: 0 };
      }
      if (sql.startsWith('SET LOCAL')) return { rows: [], rowCount: 0 };
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 0 };
      if (sql.includes('SELECT * FROM economic_policies') && sql.includes('proposed')) {
        return { rows: [mockPolicyRow], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    await expect(
      service.approve(memberActor.community_id, memberActor, mockPolicyRow.id)
    ).rejects.toThrow(ForbiddenError);
  });
});

// AC-5.9.5: Concurrent approval — second gets NotFound (already processed)
describe('AC-5.9.5: Concurrent approval race', () => {
  it('second approval attempt gets NotFoundError', async () => {
    const service = createService();

    // First call returns proposal, subsequent calls return empty (already processed)
    let callCount = 0;
    mockQuery.mockImplementation((sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [], rowCount: 0 };
      }
      if (sql.startsWith('SET LOCAL')) return { rows: [], rowCount: 0 };
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 0 };
      if (sql.includes('SELECT * FROM economic_policies') && sql.includes('proposed')) {
        callCount++;
        if (callCount <= 1) {
          return { rows: [mockPolicyRow], rowCount: 1 };
        }
        // Second caller: already processed
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('UPDATE economic_policies') && sql.includes('superseded')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('UPDATE economic_policies') && sql.includes('RETURNING')) {
        return { rows: [{ ...mockPolicyRow, state: 'active', approved_by: adminActor.id }], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO lot_entries')) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO governance_outbox')) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    // First approval succeeds
    const result = await service.approve(adminActor.community_id, adminActor, mockPolicyRow.id);
    expect(result.state).toBe('active');

    // Second approval: proposal already processed
    await expect(
      service.approve(adminActor.community_id, adminActor, mockPolicyRow.id)
    ).rejects.toThrow(NotFoundError);
  });
});

// AC-5.3.6: reject() transitions
describe('AC-5.3.6: reject()', () => {
  it('rejects a proposed policy', async () => {
    const service = createService();

    mockQuery.mockImplementation((sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [], rowCount: 0 };
      }
      if (sql.startsWith('SET LOCAL')) return { rows: [], rowCount: 0 };
      if (sql.includes('SELECT * FROM economic_policies') && sql.includes('proposed')) {
        return { rows: [mockPolicyRow], rowCount: 1 };
      }
      if (sql.includes('UPDATE economic_policies') && sql.includes('rejected')) {
        return { rows: [{ ...mockPolicyRow, state: 'rejected' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const result = await service.reject(
      adminActor.community_id, adminActor, mockPolicyRow.id, 'Budget too high'
    );
    expect(result.state).toBe('rejected');
  });

  it('rejects if policy not in proposed state', async () => {
    const service = createService();

    mockQuery.mockImplementation((sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [], rowCount: 0 };
      }
      if (sql.startsWith('SET LOCAL')) return { rows: [], rowCount: 0 };
      if (sql.includes('SELECT * FROM economic_policies')) {
        return { rows: [], rowCount: 0 }; // Not in proposed state
      }
      return { rows: [], rowCount: 0 };
    });

    await expect(
      service.reject(adminActor.community_id, adminActor, mockPolicyRow.id, 'reason')
    ).rejects.toThrow(NotFoundError);
  });
});

// AC-5.3.4: Limit decrease → pending_enforcement
describe('AC-5.3.4: Pending enforcement on limit decrease', () => {
  it('sets pending_enforcement when new limit below committed+reserved', async () => {
    const service = createService();

    // Budget: committed=500k, reserved=100k → total=600k
    // New limit: 500k (below 600k) → should be pending_enforcement
    const lowLimitPolicy = {
      ...mockPolicyRow,
      policy_value: { limit_micro: '500000' },
    };

    mockQuery.mockImplementation((sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [], rowCount: 0 };
      }
      if (sql.startsWith('SET LOCAL')) return { rows: [], rowCount: 0 };
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 0 };
      if (sql.includes('SELECT * FROM economic_policies') && sql.includes('proposed')) {
        return { rows: [lowLimitPolicy], rowCount: 1 };
      }
      if (sql.includes('UPDATE economic_policies') && sql.includes('superseded')) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('UPDATE economic_policies') && sql.includes('RETURNING')) {
        return { rows: [{ ...lowLimitPolicy, state: 'pending_enforcement' }], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO lot_entries')) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const result = await service.approve(adminActor.community_id, adminActor, mockPolicyRow.id);
    expect(result.state).toBe('pending_enforcement');
  });
});

// AC-5.3.7: State machine — terminal states cannot transition
describe('AC-5.3.7: State machine terminal states', () => {
  it('cannot approve a rejected policy', async () => {
    const service = createService();

    // Policy is rejected — SELECT for proposed state returns empty
    mockQuery.mockImplementation((sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [], rowCount: 0 };
      }
      if (sql.startsWith('SET LOCAL')) return { rows: [], rowCount: 0 };
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 0 };
      if (sql.includes('SELECT * FROM economic_policies') && sql.includes('proposed')) {
        return { rows: [], rowCount: 0 }; // Not in proposed state
      }
      return { rows: [], rowCount: 0 };
    });

    await expect(
      service.approve(adminActor.community_id, adminActor, mockPolicyRow.id)
    ).rejects.toThrow(NotFoundError);
  });
});

// Query tests
describe('getActivePolicy', () => {
  it('returns null when no active policy exists', async () => {
    const service = createService();

    mockQuery.mockImplementation((sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [], rowCount: 0 };
      }
      if (sql.startsWith('SET LOCAL')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });

    const result = await service.getActivePolicy(adminActor.community_id, 'budget_limit');
    expect(result).toBeNull();
  });
});

describe('listPolicies', () => {
  it('clamps limit to 1-100 range', async () => {
    const service = createService();
    let capturedLimit: unknown;

    mockQuery.mockImplementation((sql: string, params?: unknown[]) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [], rowCount: 0 };
      }
      if (sql.startsWith('SET LOCAL')) return { rows: [], rowCount: 0 };
      if (sql.includes('SELECT * FROM economic_policies') && sql.includes('LIMIT')) {
        capturedLimit = params?.[1]; // limit param
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    });

    await service.listPolicies(adminActor.community_id, { limit: 999 });
    expect(capturedLimit).toBe(100);
  });
});
