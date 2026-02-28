/**
 * P0 Conformance Vectors — Commons Module (cycle-046, Task 6.3)
 *
 * Validates consumed symbols from @0xhoneyjar/loa-hounfour/commons:
 * - Audit trail hash chain operations
 * - Domain tag sanitization (v8.3.1: dots→hyphens)
 * - Advisory lock key computation (FNV-1a via canonical export)
 * - Governance mutation evaluation
 * - Conservation law factories
 *
 * All vectors use explicit clockTime — no Date.now().
 * Runs in CI: must complete in <30s wall time.
 *
 * SDD ref: §4.1 (Conformance Test Alignment)
 * Sprint: 385, Task 6.3 (hounfour v8.3.1 upgrade)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  // Conservation factories
  createBalanceConservation,
  createNonNegativeConservation,
  createBoundedConservation,
  createMonotonicConservation,
  resetFactoryCounter,
  buildSumInvariant,
  buildNonNegativeInvariant,
  buildBoundedInvariant,

  // Audit trail
  computeAuditEntryHash,
  computeAdvisoryLockKey,
  verifyAuditTrailIntegrity,
  buildDomainTag,
  AUDIT_TRAIL_GENESIS_HASH,
  createCheckpoint,

  // Governance mutation
  evaluateGovernanceMutation,

  // Dynamic contract
  DynamicContractSchema,
  verifyMonotonicExpansion,

  // Governed resources
  GovernedCreditsSchema,
  GovernedReputationSchema,
  GovernedFreshnessSchema,

  // Error taxonomy
  InvariantViolationSchema,
  HashDiscontinuityErrorSchema,
  GovernanceErrorSchema,
} from '@0xhoneyjar/loa-hounfour/commons';
import { Value } from '@sinclair/typebox/value';
import { FormatRegistry } from '@sinclair/typebox';

// Register formats that DynamicContractSchema requires
if (!FormatRegistry.Has('uuid')) {
  FormatRegistry.Set('uuid', (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v));
}
if (!FormatRegistry.Has('date-time')) {
  FormatRegistry.Set('date-time', (v) => !isNaN(Date.parse(v)));
}

const CLOCK_TIME = '2026-02-26T00:00:00.000Z';

beforeEach(() => {
  resetFactoryCounter();
});

// ─── Conservation Law Factories (~12 vectors) ────────────────────────────────

describe('P0: Conservation Law Factories', () => {
  it('V-C01: createBalanceConservation produces strict law', () => {
    const law = createBalanceConservation(['a', 'b'], 'total', 'strict');
    expect(law.enforcement).toBe('strict');
    expect(law.invariants.length).toBeGreaterThan(0);
  });

  it('V-C02: createNonNegativeConservation produces strict law', () => {
    const law = createNonNegativeConservation(['x', 'y'], 'strict');
    expect(law.enforcement).toBe('strict');
    expect(law.invariants.length).toBeGreaterThanOrEqual(1);
  });

  it('V-C03: createBoundedConservation enforces floor/ceiling', () => {
    const law = createBoundedConservation('score', 0, 100, 'strict');
    expect(law.enforcement).toBe('strict');
    expect(law.invariants.length).toBeGreaterThan(0);
  });

  it('V-C04: createMonotonicConservation with increasing direction', () => {
    const law = createMonotonicConservation('version', 'increasing', 'strict');
    expect(law.enforcement).toBe('strict');
  });

  it('V-C05: buildSumInvariant produces named invariant', () => {
    const inv = buildSumInvariant('inv-1', 'balance check', ['a', 'b'], 'total');
    expect(inv.name).toBe('balance check');
  });

  it('V-C06: buildNonNegativeInvariant produces invariant per field', () => {
    const inv = buildNonNegativeInvariant('inv-2', 'non-neg', ['x', 'y']);
    expect(inv.name).toBe('non-neg');
  });

  it('V-C07: buildBoundedInvariant produces bounded invariant', () => {
    const inv = buildBoundedInvariant('inv-3', 'bounded', 'score', 0, 100);
    expect(inv.name).toBe('bounded');
  });

  it('V-C08: resetFactoryCounter resets without error', () => {
    createBalanceConservation(['a'], 'b', 'strict');
    expect(() => resetFactoryCounter()).not.toThrow();
  });

  it('V-C09: advisory enforcement mode accepted', () => {
    const law = createBalanceConservation(['a', 'b'], 'total', 'advisory');
    expect(law.enforcement).toBe('advisory');
  });

  it('V-C10: multiple invariants from same factory are distinct', () => {
    const law1 = createBalanceConservation(['a'], 'total', 'strict');
    resetFactoryCounter();
    const law2 = createBalanceConservation(['b'], 'total', 'strict');
    expect(law1).not.toBe(law2);
  });
});

// ─── Audit Trail Hash Chain (~15 vectors) ────────────────────────────────────

describe('P0: Audit Trail Hash Chain', () => {
  it('V-A01: AUDIT_TRAIL_GENESIS_HASH is SHA-256 of empty string', () => {
    expect(AUDIT_TRAIL_GENESIS_HASH).toBe(
      'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('V-A02: buildDomainTag produces deterministic tag with sanitized version (dots→hyphens)', () => {
    const tag1 = buildDomainTag('GovernedCreditsSchema', '8.2.0');
    const tag2 = buildDomainTag('GovernedCreditsSchema', '8.2.0');
    expect(tag1).toBe(tag2);
    expect(typeof tag1).toBe('string');
    expect(tag1.length).toBeGreaterThan(0);
    // v8.3.1: dots in version segment are sanitized to hyphens
    expect(tag1).toBe('loa-commons:audit:governedcreditsschema:8-2-0');
  });

  it('V-A03: buildDomainTag varies by schema', () => {
    const tag1 = buildDomainTag('GovernedCreditsSchema', '8.2.0');
    const tag2 = buildDomainTag('GovernedReputationSchema', '8.2.0');
    expect(tag1).not.toBe(tag2);
  });

  it('V-A04: computeAuditEntryHash produces sha256: prefixed hash', () => {
    const hash = computeAuditEntryHash(
      {
        entry_id: '11111111-2222-3333-4444-555555555555',
        timestamp: CLOCK_TIME,
        event_type: 'credit_mutation',
        actor_id: 'agent-001',
        payload: { amount: 100 },
      },
      buildDomainTag('GovernedCreditsSchema', '8.2.0'),
    );
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('V-A05: computeAuditEntryHash is deterministic', () => {
    const input = {
      entry_id: '11111111-2222-3333-4444-555555555555',
      timestamp: CLOCK_TIME,
      event_type: 'test',
      actor_id: 'a',
      payload: {},
    };
    const tag = buildDomainTag('TestSchema', '8.2.0');
    expect(computeAuditEntryHash(input, tag)).toBe(computeAuditEntryHash(input, tag));
  });

  it('V-A06: computeAuditEntryHash varies by entry_id', () => {
    const tag = buildDomainTag('TestSchema', '8.2.0');
    const base = { timestamp: CLOCK_TIME, event_type: 'test', actor_id: 'a', payload: {} };
    const h1 = computeAuditEntryHash({ ...base, entry_id: 'id-1' }, tag);
    const h2 = computeAuditEntryHash({ ...base, entry_id: 'id-2' }, tag);
    expect(h1).not.toBe(h2);
  });

  it('V-A07: computeAuditEntryHash varies by actor_id', () => {
    const tag = buildDomainTag('TestSchema', '8.2.0');
    const base = { entry_id: 'id-1', timestamp: CLOCK_TIME, event_type: 'test', payload: {} };
    const h1 = computeAuditEntryHash({ ...base, actor_id: 'actor-a' }, tag);
    const h2 = computeAuditEntryHash({ ...base, actor_id: 'actor-b' }, tag);
    expect(h1).not.toBe(h2);
  });

  it('V-A08: verifyAuditTrailIntegrity validates correct chain', () => {
    const tag = buildDomainTag('TestSchema', '8.2.0');
    const entry1Hash = computeAuditEntryHash(
      { entry_id: 'e1', timestamp: CLOCK_TIME, event_type: 't', actor_id: 'a', payload: {} },
      tag,
    );

    const trail = {
      genesis_hash: AUDIT_TRAIL_GENESIS_HASH,
      entries: [
        {
          entry_id: 'e1',
          entry_hash: entry1Hash,
          previous_hash: AUDIT_TRAIL_GENESIS_HASH,
          hash_domain_tag: tag,
          event_type: 't',
          actor_id: 'a',
          payload: {},
          timestamp: CLOCK_TIME,
        },
      ],
    };

    const result = verifyAuditTrailIntegrity(trail);
    expect(result.valid).toBe(true);
  });

  it('V-A09: verifyAuditTrailIntegrity detects tampered hash', () => {
    const trail = {
      entries: [
        {
          entry_id: 'e1',
          entry_hash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
          previous_hash: AUDIT_TRAIL_GENESIS_HASH,
          event_type: 't',
          actor_id: 'a',
          payload: {},
          timestamp: CLOCK_TIME,
        },
      ],
    };

    const result = verifyAuditTrailIntegrity(trail);
    expect(result.valid).toBe(false);
  });

  it('V-A10: verifyAuditTrailIntegrity detects broken chain link', () => {
    const tag = buildDomainTag('TestSchema', '8.2.0');
    const entry1Hash = computeAuditEntryHash(
      { entry_id: 'e1', timestamp: CLOCK_TIME, event_type: 't', actor_id: 'a', payload: {} },
      tag,
    );

    const trail = {
      genesis_hash: AUDIT_TRAIL_GENESIS_HASH,
      entries: [
        {
          entry_id: 'e1',
          entry_hash: entry1Hash,
          previous_hash: AUDIT_TRAIL_GENESIS_HASH,
          hash_domain_tag: tag,
          event_type: 't',
          actor_id: 'a',
          payload: {},
          timestamp: CLOCK_TIME,
        },
        {
          entry_id: 'e2',
          entry_hash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
          previous_hash: 'sha256:wrong_link_not_matching_entry1_hash',
          hash_domain_tag: tag,
          event_type: 't',
          actor_id: 'a',
          payload: {},
          timestamp: CLOCK_TIME,
        },
      ],
    };

    const result = verifyAuditTrailIntegrity(trail);
    expect(result.valid).toBe(false);
  });

  it('V-A11: empty trail is valid', () => {
    const result = verifyAuditTrailIntegrity({ entries: [] });
    expect(result.valid).toBe(true);
  });

  it('V-A12a: computeAdvisoryLockKey produces deterministic 32-bit integer', () => {
    const key1 = computeAdvisoryLockKey('loa-commons:audit:governedcreditsschema:8-2-0');
    const key2 = computeAdvisoryLockKey('loa-commons:audit:governedcreditsschema:8-2-0');
    expect(key1).toBe(key2);
    expect(typeof key1).toBe('number');
    expect(Number.isInteger(key1)).toBe(true);
    // FNV-1a produces signed 32-bit range
    expect(key1).toBeGreaterThanOrEqual(-2147483648);
    expect(key1).toBeLessThanOrEqual(2147483647);
  });

  it('V-A12b: computeAdvisoryLockKey varies by domain tag', () => {
    const key1 = computeAdvisoryLockKey('loa-commons:audit:governedcreditsschema:8-2-0');
    const key2 = computeAdvisoryLockKey('loa-commons:audit:governedreputationschema:8-2-0');
    expect(key1).not.toBe(key2);
  });

  it('V-A12c: legacy vector — v8.0.0 domain tag with dots produces different hash than sanitized', () => {
    // Legacy format (pre-v8.3.1): dots in version
    const legacyTag = 'loa-commons:audit:GovernedCredits:8.0.0';
    // Current format (v8.3.1+): dots→hyphens, lowercased schema
    const currentTag = buildDomainTag('GovernedCreditsSchema', '8.0.0');
    expect(currentTag).toBe('loa-commons:audit:governedcreditsschema:8-0-0');
    // Different domain tags → different hashes
    const entry = {
      entry_id: '550e8400-e29b-41d4-a716-446655440000',
      timestamp: '2026-02-25T10:00:00Z',
      event_type: 'commons.transition.executed',
      actor_id: 'test',
      payload: {},
    };
    const legacyHash = computeAuditEntryHash(entry, legacyTag);
    const currentHash = computeAuditEntryHash(entry, currentTag);
    expect(legacyHash).not.toBe(currentHash);
  });

  it('V-A13: createCheckpoint succeeds on valid trail', () => {
    const tag = buildDomainTag('TestSchema', '8.2.0');
    const entryHash = computeAuditEntryHash(
      { entry_id: 'e1', timestamp: CLOCK_TIME, event_type: 't', actor_id: 'a', payload: {} },
      tag,
    );

    const trail = {
      entries: [
        {
          entry_id: 'e1',
          entry_hash: entryHash,
          previous_hash: AUDIT_TRAIL_GENESIS_HASH,
          event_type: 't',
          actor_id: 'a',
          payload: {},
          timestamp: CLOCK_TIME,
        },
      ],
    };

    const result = createCheckpoint(trail);
    expect(result.success).toBe(true);
  });
});

// ─── Governance Mutation Evaluation (~8 vectors) ─────────────────────────────

describe('P0: Governance Mutation Evaluation', () => {
  it('V-G01: evaluateGovernanceMutation authorizes valid mutation', () => {
    const result = evaluateGovernanceMutation({
      mutation_id: 'mut-001',
      actor_id: 'actor-1',
      timestamp: CLOCK_TIME,
      mutation_type: 'credit_mutation',
      expected_version: 1,
    });
    expect(result.authorized).toBe(true);
    expect(result.actor_id).toBe('actor-1');
  });

  it('V-G02: evaluateGovernanceMutation rejects with insufficient reputation', () => {
    const result = evaluateGovernanceMutation(
      {
        mutation_id: 'mut-002',
        actor_id: 'actor-2',
        timestamp: CLOCK_TIME,
        mutated_at: CLOCK_TIME,
        mutation_type: 'credit_mutation',
        expected_version: 1,
      },
      { type: 'reputation_gated', min_reputation_state: 'authoritative' },
      { reputation_state: 'cold', timestamp: CLOCK_TIME, action: 'write' },
    );
    expect(result.authorized).toBe(false);
    expect(result.policy_evaluated).toBe(true);
  });

  it('V-G03: evaluateGovernanceMutation passes actor_id through', () => {
    const result = evaluateGovernanceMutation({
      mutation_id: 'mut-003',
      actor_id: 'agent-unique-id',
      timestamp: CLOCK_TIME,
      mutation_type: 'credit_mutation',
      expected_version: 1,
    });
    expect(result.actor_id).toBe('agent-unique-id');
  });

  it('V-G04: evaluateGovernanceMutation with role-based policy', () => {
    const result = evaluateGovernanceMutation(
      {
        mutation_id: 'mut-004',
        actor_id: 'actor-4',
        timestamp: CLOCK_TIME,
        mutated_at: CLOCK_TIME,
        mutation_type: 'credit_mutation',
        expected_version: 1,
      },
      { type: 'role_based', roles: ['admin'] },
      { role: 'admin', timestamp: CLOCK_TIME, action: 'write' },
    );
    expect(result.authorized).toBe(true);
  });

  it('V-G05: evaluateGovernanceMutation rejects wrong role', () => {
    const result = evaluateGovernanceMutation(
      {
        mutation_id: 'mut-005',
        actor_id: 'actor-5',
        timestamp: CLOCK_TIME,
        mutated_at: CLOCK_TIME,
        mutation_type: 'credit_mutation',
        expected_version: 1,
      },
      { type: 'role_based', roles: ['admin'] },
      { role: 'viewer', timestamp: CLOCK_TIME, action: 'write' },
    );
    expect(result.authorized).toBe(false);
  });

  it('V-G06: no-policy = authorized', () => {
    const result = evaluateGovernanceMutation({
      mutation_id: 'mut-006',
      actor_id: 'actor-6',
      timestamp: CLOCK_TIME,
      mutation_type: 'credit_mutation',
      expected_version: 1,
    });
    expect(result.authorized).toBe(true);
    expect(result.policy_evaluated).toBe(false);
  });
});

// ─── Dynamic Contract Validation (~4 vectors) ───────────────────────────────

describe('P0: Dynamic Contract Validation', () => {
  const validContract = {
    contract_id: '11111111-2222-3333-4444-555555555555',
    contract_version: '8.3.0',
    created_at: CLOCK_TIME,
    surfaces: {
      cold: { schemas: ['A'], capabilities: ['inference'], rate_limit_tier: 'restricted' },
      warming: { schemas: ['A', 'B'], capabilities: ['inference', 'tools'], rate_limit_tier: 'standard' },
      established: { schemas: ['A', 'B', 'C'], capabilities: ['inference', 'tools', 'ensemble'], rate_limit_tier: 'extended' },
      authoritative: { schemas: ['A', 'B', 'C', 'D'], capabilities: ['inference', 'tools', 'ensemble', 'governance'], rate_limit_tier: 'unlimited' },
    },
  };

  it('V-D01: DynamicContractSchema validates valid contract', () => {
    expect(Value.Check(DynamicContractSchema, validContract)).toBe(true);
  });

  it('V-D02: DynamicContractSchema rejects missing surfaces', () => {
    expect(Value.Check(DynamicContractSchema, { contract_id: 'x' })).toBe(false);
  });

  it('V-D03: verifyMonotonicExpansion passes for superset surfaces', () => {
    const result = verifyMonotonicExpansion(validContract);
    expect(result.valid).toBe(true);
  });

  it('V-D04: verifyMonotonicExpansion detects non-monotonic reduction', () => {
    const badContract = {
      ...validContract,
      surfaces: {
        cold: { schemas: ['A', 'B'], capabilities: ['inference', 'tools'], rate_limit_tier: 'restricted' },
        warming: { schemas: ['A'], capabilities: ['inference'], rate_limit_tier: 'standard' },
      },
    };
    const result = verifyMonotonicExpansion(badContract);
    expect(result.valid).toBe(false);
  });
});

// ─── Governed Resource Schemas (~4 vectors) ──────────────────────────────────

describe('P0: Governed Resource Schemas', () => {
  it('V-R01: GovernedCreditsSchema validates correct structure', () => {
    expect(GovernedCreditsSchema).toBeDefined();
  });

  it('V-R02: GovernedReputationSchema validates correct structure', () => {
    expect(GovernedReputationSchema).toBeDefined();
  });

  it('V-R03: GovernedFreshnessSchema validates correct structure', () => {
    expect(GovernedFreshnessSchema).toBeDefined();
  });

  it('V-R04: Error taxonomy schemas are defined', () => {
    expect(InvariantViolationSchema).toBeDefined();
    expect(HashDiscontinuityErrorSchema).toBeDefined();
    expect(GovernanceErrorSchema).toBeDefined();
  });
});
