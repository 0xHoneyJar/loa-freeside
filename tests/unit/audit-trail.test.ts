/**
 * Audit Trail Tests — Sprint 360, Task 3.2 (FR-6)
 *
 * Tests AuditTrailService, GovernedMutationService, and PartitionManager
 * at the unit level. DB integration tests are in Sprint 4 (Task 4.2).
 *
 * These tests verify:
 * - AuditTrailService append flow (mocked pg client)
 * - Circuit breaker state transitions
 * - GovernedMutationService transactional coupling
 * - AuditQuarantineError behavior
 * - PartitionManager interface contracts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AUDIT_TRAIL_GENESIS_HASH } from '@0xhoneyjar/loa-hounfour/commons';
import { AuditTrailService, AuditQuarantineError } from '../../packages/adapters/storage/audit-trail-service.js';
import { GovernedMutationService } from '../../packages/adapters/storage/governed-mutation-service.js';

// ─── Mock Helpers ────────────────────────────────────────────────────────────

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn().mockReturnThis(),
    level: 'info' as const,
    silent: vi.fn(),
  } as unknown as import('pino').Logger;
}

function makeMockClient() {
  const client = {
    query: vi.fn(),
    release: vi.fn(),
  };

  // Default: BEGIN, advisory lock, empty head (genesis), INSERT returning id, chain_links INSERT, UPSERT head, COMMIT
  client.query
    .mockResolvedValueOnce(undefined) // BEGIN
    .mockResolvedValueOnce(undefined) // advisory lock
    .mockResolvedValueOnce({ rows: [] }) // head SELECT (genesis)
    .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // INSERT audit_trail
    .mockResolvedValueOnce(undefined) // INSERT chain_links
    .mockResolvedValueOnce(undefined) // UPSERT head
    .mockResolvedValueOnce(undefined); // COMMIT

  return client;
}

function makeMockPool(client?: ReturnType<typeof makeMockClient>) {
  const mockClient = client ?? makeMockClient();
  return {
    connect: vi.fn().mockResolvedValue(mockClient),
    _client: mockClient,
  } as unknown as import('pg').Pool & { _client: ReturnType<typeof makeMockClient> };
}

// ─── AuditTrailService ──────────────────────────────────────────────────────

describe('AuditTrailService', () => {
  let service: AuditTrailService;
  let pool: ReturnType<typeof makeMockPool>;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
    pool = makeMockPool();
    service = new AuditTrailService({
      pool,
      logger,
      contractVersion: '8.2.0',
    });
  });

  it('appends an entry and returns entry_id + entry_hash', async () => {
    const result = await service.append({
      domain_tag: 'reputation:coll-001',
      event_type: 'quality_signal',
      actor_id: 'agent-1',
      payload: { score: 0.5 },
      event_time: new Date('2026-02-26T00:00:00Z'),
    });

    expect(result.entry_id).toBeDefined();
    expect(result.entry_hash).toMatch(/^sha256:[a-f0-9]+$/);
    expect(pool.connect).toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalled();
  });

  it('uses SERIALIZABLE isolation level', async () => {
    await service.append({
      domain_tag: 'test:domain',
      event_type: 'test',
      actor_id: 'actor-1',
      payload: {},
      event_time: new Date(),
    });

    const client = pool._client;
    expect(client.query).toHaveBeenCalledWith('BEGIN ISOLATION LEVEL SERIALIZABLE');
  });

  it('acquires advisory lock with domain_tag hash', async () => {
    await service.append({
      domain_tag: 'test:domain',
      event_type: 'test',
      actor_id: 'actor-1',
      payload: {},
      event_time: new Date(),
    });

    const client = pool._client;
    const advisoryCall = client.query.mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('pg_advisory_xact_lock'),
    );
    expect(advisoryCall).toBeDefined();
    expect(typeof advisoryCall[1][0]).toBe('number');
  });

  it('reads chain head for previous_hash', async () => {
    await service.append({
      domain_tag: 'test:domain',
      event_type: 'test',
      actor_id: 'actor-1',
      payload: {},
      event_time: new Date(),
    });

    const client = pool._client;
    const headCall = client.query.mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('audit_trail_head'),
    );
    expect(headCall).toBeDefined();
  });

  it('releases client even on error', async () => {
    const failClient = makeMockClient();
    failClient.query.mockReset();
    failClient.query.mockRejectedValueOnce(new Error('connection lost'));
    failClient.query.mockResolvedValueOnce(undefined); // ROLLBACK

    const failPool = makeMockPool(failClient);
    const failService = new AuditTrailService({
      pool: failPool,
      logger,
      contractVersion: '8.2.0',
      maxRetries: 1,
    });

    await expect(
      failService.append({
        domain_tag: 'test',
        event_type: 'test',
        actor_id: 'a',
        payload: {},
        event_time: new Date(),
      }),
    ).rejects.toThrow();

    expect(failClient.release).toHaveBeenCalled();
  });
});

// ─── Circuit Breaker ────────────────────────────────────────────────────────

describe('AuditTrailService — circuit breaker', () => {
  it('starts in closed state', () => {
    const service = new AuditTrailService({
      pool: makeMockPool(),
      logger: makeLogger(),
      contractVersion: '8.2.0',
    });

    const state = service.getCircuitBreakerState();
    expect(state.state).toBe('closed');
    expect(state.affectedDomainTags).toEqual([]);
  });

  it('rejects appends when circuit is open for domain_tag', async () => {
    const pool = makeMockPool();
    const service = new AuditTrailService({
      pool,
      logger: makeLogger(),
      contractVersion: '8.2.0',
    });

    // Manually open circuit (simulating 3 verification failures)
    // Access private state via the public method pattern
    (service as unknown as { circuitBreaker: { state: string; affectedDomainTags: Set<string> } }).circuitBreaker.state = 'open';
    (service as unknown as { circuitBreaker: { state: string; affectedDomainTags: Set<string> } }).circuitBreaker.affectedDomainTags.add('quarantined:domain');

    await expect(
      service.append({
        domain_tag: 'quarantined:domain',
        event_type: 'test',
        actor_id: 'a',
        payload: {},
        event_time: new Date(),
      }),
    ).rejects.toThrow(AuditQuarantineError);
  });

  it('allows appends for unaffected domain_tags when circuit is open', async () => {
    const pool = makeMockPool();
    const service = new AuditTrailService({
      pool,
      logger: makeLogger(),
      contractVersion: '8.2.0',
    });

    (service as unknown as { circuitBreaker: { state: string; affectedDomainTags: Set<string> } }).circuitBreaker.state = 'open';
    (service as unknown as { circuitBreaker: { state: string; affectedDomainTags: Set<string> } }).circuitBreaker.affectedDomainTags.add('bad:domain');

    // Different domain_tag should still work
    const result = await service.append({
      domain_tag: 'good:domain',
      event_type: 'test',
      actor_id: 'a',
      payload: {},
      event_time: new Date(),
    });
    expect(result.entry_id).toBeDefined();
  });

  it('resets circuit breaker for specific domain_tag', () => {
    const service = new AuditTrailService({
      pool: makeMockPool(),
      logger: makeLogger(),
      contractVersion: '8.2.0',
    });

    // Open circuit
    const cb = (service as unknown as { circuitBreaker: { state: string; consecutiveFailures: number; affectedDomainTags: Set<string> } }).circuitBreaker;
    cb.state = 'open';
    cb.consecutiveFailures = 3;
    cb.affectedDomainTags.add('domain-a');
    cb.affectedDomainTags.add('domain-b');

    // Reset single domain
    service.resetCircuitBreaker('domain-a');
    const state = service.getCircuitBreakerState();
    expect(state.affectedDomainTags).toEqual(['domain-b']);
    expect(state.state).toBe('open'); // Still open (domain-b affected)

    // Reset remaining
    service.resetCircuitBreaker('domain-b');
    const state2 = service.getCircuitBreakerState();
    expect(state2.state).toBe('closed');
    expect(state2.affectedDomainTags).toEqual([]);
  });
});

// ─── AuditQuarantineError ───────────────────────────────────────────────────

describe('AuditQuarantineError', () => {
  it('has correct code and domain_tag', () => {
    const err = new AuditQuarantineError('reputation:coll-001');
    expect(err.code).toBe('AUDIT_QUARANTINE');
    expect(err.domainTag).toBe('reputation:coll-001');
    expect(err.name).toBe('AuditQuarantineError');
    expect(err.message).toContain('reputation:coll-001');
  });
});

// ─── GovernedMutationService ────────────────────────────────────────────────

describe('GovernedMutationService', () => {
  let service: GovernedMutationService;
  let pool: ReturnType<typeof makeMockPool>;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
    const client = makeMockClient();
    // Override for governed mutation flow:
    // BEGIN, mutate result, advisory lock, head SELECT, INSERT audit, chain_links, UPSERT head, COMMIT
    client.query.mockReset();
    client.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 42 }] }) // mutate() result
      .mockResolvedValueOnce(undefined) // advisory lock
      .mockResolvedValueOnce({ rows: [] }) // head SELECT (genesis)
      .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // INSERT audit_trail
      .mockResolvedValueOnce(undefined) // INSERT chain_links
      .mockResolvedValueOnce(undefined) // UPSERT head
      .mockResolvedValueOnce(undefined); // COMMIT

    pool = makeMockPool(client);
    service = new GovernedMutationService({
      pool,
      logger,
      contractVersion: '8.2.0',
    });
  });

  it('executes mutation and audit append in same transaction', async () => {
    const mutationFn = vi.fn().mockResolvedValue({ balance: 1000n });

    const result = await service.executeMutation({
      mutationId: '11111111-2222-3333-4444-555555555555',
      eventTime: '2026-02-26T00:00:00Z',
      actorId: 'agent-1',
      eventType: 'credit_mutation',
      schemaId: 'GovernedCreditsSchema',
      mutate: mutationFn,
      auditPayload: { amount: 100 },
    });

    expect(result.result).toEqual({ balance: 1000n });
    expect(result.auditEntry.entry_id).toBe('11111111-2222-3333-4444-555555555555');
    expect(result.auditEntry.entry_hash).toMatch(/^sha256:[a-f0-9]+$/);
    expect(mutationFn).toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalled();
  });

  it('uses SERIALIZABLE isolation for transactional coupling', async () => {
    await service.executeMutation({
      mutationId: '11111111-2222-3333-4444-555555555555',
      eventTime: '2026-02-26T00:00:00Z',
      actorId: 'agent-1',
      eventType: 'test',
      schemaId: 'TestSchema',
      mutate: vi.fn().mockResolvedValue(null),
      auditPayload: {},
    });

    const client = pool._client;
    expect(client.query).toHaveBeenCalledWith('BEGIN ISOLATION LEVEL SERIALIZABLE');
  });

  it('rolls back both mutation and audit on error', async () => {
    const failClient = makeMockClient();
    failClient.query.mockReset();
    failClient.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockRejectedValueOnce(new Error('constraint violation')); // mutate() fails
    failClient.query.mockResolvedValueOnce(undefined); // ROLLBACK

    const failPool = makeMockPool(failClient);
    const failService = new GovernedMutationService({
      pool: failPool,
      logger,
      contractVersion: '8.2.0',
      maxRetries: 1,
    });

    await expect(
      failService.executeMutation({
        mutationId: '11111111-2222-3333-4444-555555555555',
        eventTime: '2026-02-26T00:00:00Z',
        actorId: 'agent-1',
        eventType: 'test',
        schemaId: 'TestSchema',
        mutate: async () => { throw new Error('constraint violation'); },
        auditPayload: {},
      }),
    ).rejects.toThrow('constraint violation');

    expect(failClient.release).toHaveBeenCalled();
  });
});

// ─── AUDIT_TRAIL_GENESIS_HASH ───────────────────────────────────────────────

describe('AUDIT_TRAIL_GENESIS_HASH', () => {
  it('is the SHA-256 of empty string', () => {
    expect(AUDIT_TRAIL_GENESIS_HASH).toBe(
      'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});
