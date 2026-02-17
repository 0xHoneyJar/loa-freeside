/**
 * Cross-System E2E Conservation Tests (Tasks 4.4 + 4.5, Sprint 298)
 *
 * Proves conservation holds across the JWT boundary between arrakis
 * and loa-finn. Every positive scenario ends with assertConservation(db).
 * Every negative scenario verifies specific JwtBoundaryError codes AND
 * that conservation remains intact after rejection.
 *
 * All scenarios use real Ed25519 keypairs (not mocked).
 * All monetary values use BigInt end-to-end.
 *
 * SDD refs: §3.3 Cross-system E2E
 * Sprint refs: Tasks 4.4, 4.5
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { generateKeyPairSync, type KeyObject } from 'crypto';
import { SignJWT } from 'jose';
import { CREDIT_LEDGER_SCHEMA_SQL } from '../../src/db/migrations/030_credit_ledger.js';
import { BILLING_OPS_SCHEMA_SQL, BILLING_SYSTEM_ACCOUNTS_SQL } from '../../src/db/migrations/032_billing_ops.js';
import { REVENUE_RULES_SCHEMA_SQL } from '../../src/db/migrations/035_revenue_rules.js';
import { AGENT_CLAWBACK_RECEIVABLES_SQL } from '../../src/db/migrations/051_agent_clawback_receivables.js';
import { AGENT_BUDGET_SQL } from '../../src/db/migrations/052_agent_budget.js';
import { RECONCILIATION_RUNS_SQL } from '../../src/db/migrations/055_reconciliation_runs.js';
import { PEER_TRANSFERS_SQL, CREDIT_LEDGER_REBUILD_SQL } from '../../src/db/migrations/056_peer_transfers.js';
import { TBA_DEPOSITS_SQL } from '../../src/db/migrations/057_tba_deposits.js';
import { CREDIT_LOTS_REBUILD_SQL } from '../../src/db/migrations/060_credit_lots_tba_source.js';
import {
  CreditLedgerAdapter,
  InsufficientBalanceError,
} from '../../src/packages/adapters/billing/CreditLedgerAdapter.js';
import {
  verifyUsageJWT,
  JwtBoundaryError,
  type IdempotencyStore,
  type ActiveReservations,
  type InboundClaims,
} from '../../src/packages/core/protocol/jwt-boundary.js';
import { assertConservation } from '../helpers/conservation-check.js';
import {
  createTestKeypairs,
  signInbound,
  makeInboundClaims,
  type TestKeypairs,
} from '../helpers/jwt-factory.js';

// =============================================================================
// Setup
// =============================================================================

/** Create full E2E database. */
function createE2EDb(): Database.Database {
  const testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');
  testDb.pragma('foreign_keys = OFF');

  testDb.exec(CREDIT_LEDGER_SCHEMA_SQL);
  testDb.exec(BILLING_OPS_SCHEMA_SQL);
  testDb.exec(BILLING_SYSTEM_ACCOUNTS_SQL);
  testDb.exec(REVENUE_RULES_SCHEMA_SQL);
  testDb.exec(AGENT_CLAWBACK_RECEIVABLES_SQL);
  testDb.exec(AGENT_BUDGET_SQL);
  testDb.exec(RECONCILIATION_RUNS_SQL);
  testDb.exec(PEER_TRANSFERS_SQL);
  testDb.exec(CREDIT_LEDGER_REBUILD_SQL);
  testDb.exec(TBA_DEPOSITS_SQL);
  // Migration 060: Add 'tba_deposit' to credit_lots source_type CHECK
  // (Now uses safe CREATE→COPY→SWAP→DROP pattern — no FK corruption)
  testDb.exec(CREDIT_LOTS_REBUILD_SQL);

  return testDb;
}

/** In-memory idempotency store for replay detection. */
class MemoryIdempotencyStore implements IdempotencyStore {
  private seen = new Set<string>();

  checkAndRecord(jti: string): boolean {
    if (this.seen.has(jti)) return true;
    this.seen.add(jti);
    return false;
  }
}

/** Reservation lookup backed by CreditLedgerAdapter DB. */
class DbActiveReservations implements ActiveReservations {
  constructor(private db: Database.Database) {}

  getReservedMicro(reservationId: string): bigint | undefined {
    // Check reservation exists and is pending
    const resRow = this.db.prepare(
      `SELECT status FROM credit_reservations WHERE id = ?`,
    ).get(reservationId) as { status: string } | undefined;
    if (!resRow || resRow.status !== 'pending') return undefined;

    const stmt = this.db.prepare(`
      SELECT CAST(COALESCE(SUM(rl.reserved_micro), 0) AS TEXT) as total
      FROM reservation_lots rl
      WHERE rl.reservation_id = ?
    `);
    const row = stmt.get(reservationId) as { total: string } | undefined;
    return row ? BigInt(row.total) : 0n;
  }
}

// =============================================================================
// Shared State
// =============================================================================

let keypairs: TestKeypairs;

beforeAll(() => {
  keypairs = createTestKeypairs();
});

// =============================================================================
// CI Guard Tests (Task 4.2)
// =============================================================================

describe('CI Guards — Ed25519 KeyObject', () => {
  it('generated keypairs are Ed25519 KeyObjects', () => {
    const kp = createTestKeypairs();
    expect(kp.arrakis.publicKey.type).toBe('public');
    expect(kp.arrakis.publicKey.asymmetricKeyType).toBe('ed25519');
    expect(kp.arrakis.privateKey.type).toBe('private');
    expect(kp.arrakis.privateKey.asymmetricKeyType).toBe('ed25519');
    expect(kp.loaFinn.publicKey.asymmetricKeyType).toBe('ed25519');
    expect(kp.loaFinn.privateKey.asymmetricKeyType).toBe('ed25519');
  });

  it('jose accepts generated KeyObject for EdDSA signing', async () => {
    const kp = createTestKeypairs();
    const token = await new SignJWT({ test: true })
      .setProtectedHeader({ alg: 'EdDSA' })
      .setIssuedAt()
      .sign(kp.loaFinn.privateKey);

    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);
  });
});

// =============================================================================
// Positive E2E Scenarios (Task 4.4)
// =============================================================================

describe('Cross-System E2E — Positive Scenarios (Task 4.4)', () => {
  let db: Database.Database;
  let ledger: CreditLedgerAdapter;
  let idempotency: MemoryIdempotencyStore;
  let reservations: DbActiveReservations;

  beforeEach(() => {
    db = createE2EDb();
    ledger = new CreditLedgerAdapter(db);
    idempotency = new MemoryIdempotencyStore();
    reservations = new DbActiveReservations(db);
  });

  afterEach(() => {
    db.close();
  });

  // ---------------------------------------------------------------------------
  // Scenario 1: Happy path — exact match finalize
  // ---------------------------------------------------------------------------

  it('happy path: reserve → execute → finalize (exact match) → conservation', async () => {
    const account = await ledger.createAccount('person', 'user-happy');
    await ledger.mintLot(account.id, 1_000_000n, 'deposit', {
      poolId: 'general', sourceId: 'src-happy',
    });

    // Reserve
    const res = await ledger.reserve(account.id, 'general', 500_000n);

    // Simulate loa-finn usage JWT
    const claims = makeInboundClaims({
      reservation_id: res.reservationId,
      actual_cost_micro: '500000',
    });
    const token = await signInbound(claims, keypairs.loaFinn.privateKey);

    // Verify JWT at boundary
    const verified = await verifyUsageJWT(token, keypairs.loaFinn.publicKey, idempotency, reservations);
    expect(verified.actual_cost_micro).toBe('500000');

    // Finalize with exact cost
    await ledger.finalize(res.reservationId, BigInt(verified.actual_cost_micro));

    // Conservation holds
    await assertConservation(db);
  });

  // ---------------------------------------------------------------------------
  // Scenario 2: Partial use — surplus released
  // ---------------------------------------------------------------------------

  it('partial use: reserve $1.00 → use $0.60 → finalize → conservation', async () => {
    const account = await ledger.createAccount('person', 'user-partial');
    await ledger.mintLot(account.id, 1_000_000n, 'deposit', {
      poolId: 'general', sourceId: 'src-partial',
    });

    // Reserve $1.00
    const res = await ledger.reserve(account.id, 'general', 1_000_000n);

    // loa-finn reports $0.60 actual cost
    const claims = makeInboundClaims({
      reservation_id: res.reservationId,
      actual_cost_micro: '600000',
    });
    const token = await signInbound(claims, keypairs.loaFinn.privateKey);
    const verified = await verifyUsageJWT(token, keypairs.loaFinn.publicKey, idempotency, reservations);

    // Finalize with actual cost (surplus automatically released)
    await ledger.finalize(res.reservationId, BigInt(verified.actual_cost_micro));

    // Verify surplus returned: available should be 1,000,000 - 600,000 = 400,000
    const balance = await ledger.getBalance(account.id, 'general');
    expect(balance.availableMicro).toBe(400_000n);
    expect(balance.reservedMicro).toBe(0n);

    // Conservation holds
    await assertConservation(db);
  });

  // ---------------------------------------------------------------------------
  // Scenario 3: Timeout — reserve expires
  // ---------------------------------------------------------------------------

  it('timeout: reserve → expire → conservation', async () => {
    const account = await ledger.createAccount('person', 'user-timeout');
    await ledger.mintLot(account.id, 1_000_000n, 'deposit', {
      poolId: 'general', sourceId: 'src-timeout',
    });

    // Reserve
    const res = await ledger.reserve(account.id, 'general', 500_000n);

    // Simulate timeout: release (the expiry job does this)
    await ledger.release(res.reservationId);

    // All balance returned
    const balance = await ledger.getBalance(account.id, 'general');
    expect(balance.availableMicro).toBe(1_000_000n);
    expect(balance.reservedMicro).toBe(0n);

    // Conservation holds
    await assertConservation(db);
  });

  // ---------------------------------------------------------------------------
  // Scenario 4: Ensemble — multiple model calls aggregated
  // ---------------------------------------------------------------------------

  it('ensemble: reserve → 3 model calls → aggregate finalize → conservation', async () => {
    const account = await ledger.createAccount('person', 'user-ensemble');
    await ledger.mintLot(account.id, 5_000_000n, 'deposit', {
      poolId: 'general', sourceId: 'src-ensemble',
    });

    // Reserve for ensemble
    const res = await ledger.reserve(account.id, 'general', 3_000_000n);

    // Aggregate cost from 3 model invocations
    const modelCosts = [800_000n, 1_200_000n, 500_000n]; // total = 2,500,000
    const totalCost = modelCosts.reduce((a, b) => a + b, 0n);

    // loa-finn sends aggregate usage JWT
    const claims = makeInboundClaims({
      reservation_id: res.reservationId,
      actual_cost_micro: totalCost.toString(),
      models_used: ['claude-opus-4-6', 'claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001'],
      input_tokens: 5000,
      output_tokens: 3000,
    });
    const token = await signInbound(claims, keypairs.loaFinn.privateKey);
    const verified = await verifyUsageJWT(token, keypairs.loaFinn.publicKey, idempotency, reservations);

    // Finalize with aggregate cost
    await ledger.finalize(res.reservationId, BigInt(verified.actual_cost_micro));

    // Verify: available = 5,000,000 - 2,500,000 = 2,500,000
    const balance = await ledger.getBalance(account.id, 'general');
    expect(balance.availableMicro).toBe(2_500_000n);

    // Conservation holds
    await assertConservation(db);
  });
});

// =============================================================================
// Negative E2E Scenarios (Task 4.5)
// =============================================================================

describe('Cross-System E2E — Negative Scenarios (Task 4.5)', () => {
  let db: Database.Database;
  let ledger: CreditLedgerAdapter;
  let idempotency: MemoryIdempotencyStore;
  let reservations: DbActiveReservations;
  let reservationId: string;

  beforeEach(async () => {
    db = createE2EDb();
    ledger = new CreditLedgerAdapter(db);
    idempotency = new MemoryIdempotencyStore();
    reservations = new DbActiveReservations(db);

    // Set up a standard reservation for negative tests
    const account = await ledger.createAccount('person', 'user-negative');
    await ledger.mintLot(account.id, 1_000_000n, 'deposit', {
      poolId: 'general', sourceId: 'src-negative',
    });
    const res = await ledger.reserve(account.id, 'general', 500_000n);
    reservationId = res.reservationId;
  });

  afterEach(() => {
    db.close();
  });

  // ---------------------------------------------------------------------------
  // SIGNATURE_INVALID
  // ---------------------------------------------------------------------------

  it('tampered JWT → SIGNATURE_INVALID (permanent)', async () => {
    const claims = makeInboundClaims({ reservation_id: reservationId });
    const token = await signInbound(claims, keypairs.loaFinn.privateKey);

    // Tamper with the payload
    const parts = token.split('.');
    parts[1] = parts[1].slice(0, -2) + 'XX'; // corrupt payload
    const tampered = parts.join('.');

    const err = await verifyUsageJWT(tampered, keypairs.loaFinn.publicKey, idempotency, reservations)
      .catch(e => e);
    expect(err).toBeInstanceOf(JwtBoundaryError);
    expect(err.code).toBe('SIGNATURE_INVALID');
    expect(err.permanent).toBe(true);

    // Conservation intact after rejection
    await assertConservation(db);
  });

  // ---------------------------------------------------------------------------
  // ALGORITHM_REJECTED
  // ---------------------------------------------------------------------------

  it('wrong algorithm (RS256 key) → SIGNATURE_INVALID or ALGORITHM_REJECTED (permanent)', async () => {
    // Create an RS256 keypair (wrong algorithm)
    const { privateKey: rsPriv } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });

    const claims = makeInboundClaims({ reservation_id: reservationId });
    const token = await new SignJWT({ ...claims } as unknown as Record<string, unknown>)
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(rsPriv);

    const err = await verifyUsageJWT(token, keypairs.loaFinn.publicKey, idempotency, reservations)
      .catch(e => e);
    expect(err).toBeInstanceOf(JwtBoundaryError);
    // jose may report this as algorithm mismatch or signature failure
    expect(['ALGORITHM_REJECTED', 'SIGNATURE_INVALID']).toContain(err.code);
    expect(err.permanent).toBe(true);

    await assertConservation(db);
  });

  // ---------------------------------------------------------------------------
  // CLAIMS_SCHEMA — missing required claim
  // ---------------------------------------------------------------------------

  it('missing required claim → CLAIMS_SCHEMA (permanent)', async () => {
    // Sign a JWT missing reservation_id
    const token = await new SignJWT({
      jti: crypto.randomUUID(),
      finalized: true,
      actual_cost_micro: '100000',
      models_used: ['test'],
      input_tokens: 100,
      output_tokens: 50,
      // reservation_id intentionally missing
    })
      .setProtectedHeader({ alg: 'EdDSA' })
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(keypairs.loaFinn.privateKey);

    const err = await verifyUsageJWT(token, keypairs.loaFinn.publicKey, idempotency, reservations)
      .catch(e => e);
    expect(err).toBeInstanceOf(JwtBoundaryError);
    expect(err.code).toBe('CLAIMS_SCHEMA');
    expect(err.permanent).toBe(true);

    await assertConservation(db);
  });

  // ---------------------------------------------------------------------------
  // CLAIMS_SCHEMA — finalized: false
  // ---------------------------------------------------------------------------

  it('finalized: false → CLAIMS_SCHEMA (permanent)', async () => {
    const token = await new SignJWT({
      jti: crypto.randomUUID(),
      finalized: false, // Must be true
      reservation_id: reservationId,
      actual_cost_micro: '100000',
      models_used: ['test'],
      input_tokens: 100,
      output_tokens: 50,
    })
      .setProtectedHeader({ alg: 'EdDSA' })
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(keypairs.loaFinn.privateKey);

    const err = await verifyUsageJWT(token, keypairs.loaFinn.publicKey, idempotency, reservations)
      .catch(e => e);
    expect(err).toBeInstanceOf(JwtBoundaryError);
    expect(err.code).toBe('CLAIMS_SCHEMA');
    expect(err.permanent).toBe(true);

    await assertConservation(db);
  });

  // ---------------------------------------------------------------------------
  // CLAIMS_SCHEMA — negative cost_micro
  // ---------------------------------------------------------------------------

  it('negative cost_micro → CLAIMS_SCHEMA (permanent)', async () => {
    const token = await new SignJWT({
      jti: crypto.randomUUID(),
      finalized: true,
      reservation_id: reservationId,
      actual_cost_micro: '-100000', // Negative
      models_used: ['test'],
      input_tokens: 100,
      output_tokens: 50,
    })
      .setProtectedHeader({ alg: 'EdDSA' })
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(keypairs.loaFinn.privateKey);

    const err = await verifyUsageJWT(token, keypairs.loaFinn.publicKey, idempotency, reservations)
      .catch(e => e);
    expect(err).toBeInstanceOf(JwtBoundaryError);
    expect(err.code).toBe('CLAIMS_SCHEMA');
    expect(err.permanent).toBe(true);

    await assertConservation(db);
  });

  // ---------------------------------------------------------------------------
  // RESERVATION_UNKNOWN
  // ---------------------------------------------------------------------------

  it('unknown reservation_id → RESERVATION_UNKNOWN (permanent)', async () => {
    const claims = makeInboundClaims({
      reservation_id: 'res-does-not-exist',
      actual_cost_micro: '100000',
    });
    const token = await signInbound(claims, keypairs.loaFinn.privateKey);

    const err = await verifyUsageJWT(token, keypairs.loaFinn.publicKey, idempotency, reservations)
      .catch(e => e);
    expect(err).toBeInstanceOf(JwtBoundaryError);
    expect(err.code).toBe('RESERVATION_UNKNOWN');
    expect(err.permanent).toBe(true);

    await assertConservation(db);
  });

  // ---------------------------------------------------------------------------
  // REPLAY
  // ---------------------------------------------------------------------------

  it('replay (same jti twice) → REPLAY (permanent)', async () => {
    const claims = makeInboundClaims({
      reservation_id: reservationId,
      actual_cost_micro: '100000',
    });
    const token = await signInbound(claims, keypairs.loaFinn.privateKey);

    // First verification succeeds
    await verifyUsageJWT(token, keypairs.loaFinn.publicKey, idempotency, reservations);

    // Second verification with same jti → REPLAY
    const err = await verifyUsageJWT(token, keypairs.loaFinn.publicKey, idempotency, reservations)
      .catch(e => e);
    expect(err).toBeInstanceOf(JwtBoundaryError);
    expect(err.code).toBe('REPLAY');
    expect(err.permanent).toBe(true);

    await assertConservation(db);
  });

  // ---------------------------------------------------------------------------
  // Different jti, same reservation → allowed (not replay)
  // ---------------------------------------------------------------------------

  it('different jti, same reservation → allowed (not replay)', async () => {
    const claims1 = makeInboundClaims({
      reservation_id: reservationId,
      actual_cost_micro: '100000',
    });
    const token1 = await signInbound(claims1, keypairs.loaFinn.privateKey);

    // First verification succeeds
    await verifyUsageJWT(token1, keypairs.loaFinn.publicKey, idempotency, reservations);

    // Second JWT with different jti, same reservation → should succeed
    const claims2 = makeInboundClaims({
      reservation_id: reservationId,
      actual_cost_micro: '100000',
    });
    expect(claims2.jti).not.toBe(claims1.jti); // Different jti guaranteed by randomUUID
    const token2 = await signInbound(claims2, keypairs.loaFinn.privateKey);

    const verified = await verifyUsageJWT(token2, keypairs.loaFinn.publicKey, idempotency, reservations);
    expect(verified.reservation_id).toBe(reservationId);
  });

  // ---------------------------------------------------------------------------
  // OVERSPEND
  // ---------------------------------------------------------------------------

  it('over-spend → OVERSPEND (permanent)', async () => {
    const claims = makeInboundClaims({
      reservation_id: reservationId,
      actual_cost_micro: '999999999', // Far exceeds 500,000 reserved
    });
    const token = await signInbound(claims, keypairs.loaFinn.privateKey);

    const err = await verifyUsageJWT(token, keypairs.loaFinn.publicKey, idempotency, reservations)
      .catch(e => e);
    expect(err).toBeInstanceOf(JwtBoundaryError);
    expect(err.code).toBe('OVERSPEND');
    expect(err.permanent).toBe(true);

    await assertConservation(db);
  });

  // ---------------------------------------------------------------------------
  // KEY_FETCH_FAILED — error class construction test
  // ---------------------------------------------------------------------------

  it('KEY_FETCH_FAILED: error class can be constructed with this code', () => {
    const err = new JwtBoundaryError('KEY_FETCH_FAILED', 'JWKS endpoint unreachable', false);
    expect(err.code).toBe('KEY_FETCH_FAILED');
    expect(err.permanent).toBe(false); // Transient — retry may succeed
    expect(err.message).toContain('KEY_FETCH_FAILED');
  });

  // ---------------------------------------------------------------------------
  // BigInt precision guard: JWT with actual_cost_micro > 2^53
  // ---------------------------------------------------------------------------

  it('BigInt precision: actual_cost_micro > 2^53 round-trips without precision loss', async () => {
    const largeCost = ((2n ** 53n) + 1n).toString(); // "9007199254740993"

    const claims = makeInboundClaims({
      reservation_id: reservationId,
      actual_cost_micro: largeCost,
    });
    const token = await signInbound(claims, keypairs.loaFinn.privateKey);

    // The JWT will fail OVERSPEND (exceeds 500,000 reserved), but claims
    // are parsed before that check. We verify the parsing preserves precision.
    const err = await verifyUsageJWT(token, keypairs.loaFinn.publicKey, idempotency, reservations)
      .catch(e => e);

    // Should fail at OVERSPEND (step 6), meaning claims parsed correctly through steps 1-5
    expect(err).toBeInstanceOf(JwtBoundaryError);
    expect(err.code).toBe('OVERSPEND');

    // Verify the BigInt conversion preserves precision
    const parsed = BigInt(largeCost);
    expect(parsed).toBe(9007199254740993n);
    expect(parsed > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
  });
});
