/**
 * Credit Pack Tests (Sprint 248, Task 4.6)
 *
 * Tests for:
 * - calculateCredits markup function (floor rounding, guards)
 * - Credit pack tier validation
 * - MockPaymentVerifier (structure, recipient, amount)
 * - Purchase flow (happy path, invalid pack, duplicate/idempotency)
 * - Audit trail (purchase record in credit_lot_purchases)
 *
 * Sprint refs: Task 4.6
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { calculateCredits, MIN_CREDIT_ISSUANCE } from '../../../src/packages/core/billing/pricing.js';
import {
  CREDIT_PACK_TIERS,
  DEFAULT_MARKUP_FACTOR,
  resolveCreditPack,
  validateTierConfig,
} from '../../../src/packages/core/billing/credit-packs.js';
import { MockPaymentVerifier } from '../../../src/packages/adapters/billing/MockPaymentVerifier.js';
import type { PaymentProof } from '../../../src/packages/core/ports/IPaymentVerifier.js';
import { SafeArithmeticError, MAX_MICRO_USD } from '../../../src/packages/core/protocol/arrakis-arithmetic.js';
import Database from 'better-sqlite3';
import { CREDIT_LEDGER_SCHEMA_SQL } from '../../../src/db/migrations/030_credit_ledger.js';
import { CREDIT_LOT_PURCHASES_SCHEMA_SQL } from '../../../src/db/migrations/040_credit_lot_purchases.js';
import { createHash } from 'crypto';

// =============================================================================
// calculateCredits — Markup Function (Task 4.2)
// =============================================================================

describe('calculateCredits', () => {
  it('at-cost markup (1.0) returns exact price', () => {
    const credits = calculateCredits(5_000_000n, 1.0);
    expect(credits).toBe(5_000_000n); // $5 → $5 credits
  });

  it('2x markup halves the credits', () => {
    const credits = calculateCredits(10_000_000n, 2.0);
    expect(credits).toBe(5_000_000n); // $10 → $5 credits
  });

  it('floor rounding applies (no fractional credits)', () => {
    // 7_000_000 / 3.0 = 2_333_333.333... → floor to 2_333_333
    const credits = calculateCredits(7_000_000n, 3.0);
    expect(credits).toBe(2_333_333n);
  });

  it('rejects markupFactor < 1.0', () => {
    expect(() => calculateCredits(5_000_000n, 0.5)).toThrow(SafeArithmeticError);
    expect(() => calculateCredits(5_000_000n, 0.5)).toThrow(/markupFactor must be >= 1/);
  });

  it('rejects markupFactor > 10.0', () => {
    expect(() => calculateCredits(5_000_000n, 11.0)).toThrow(SafeArithmeticError);
    expect(() => calculateCredits(5_000_000n, 11.0)).toThrow(/markupFactor must be >= 1/);
  });

  it('rejects priceMicro <= 0', () => {
    expect(() => calculateCredits(0n, 1.0)).toThrow(SafeArithmeticError);
    expect(() => calculateCredits(-1n, 1.0)).toThrow(SafeArithmeticError);
  });

  it('rejects priceMicro > MAX_MICRO_USD', () => {
    expect(() => calculateCredits(MAX_MICRO_USD + 1n, 1.0)).toThrow(SafeArithmeticError);
  });

  it('rejects result below MIN_CREDIT_ISSUANCE', () => {
    // 5000n / 10.0 = 500n which is below MIN_CREDIT_ISSUANCE (1000n)
    expect(() => calculateCredits(5000n, 10.0)).toThrow(SafeArithmeticError);
    expect(() => calculateCredits(5000n, 10.0)).toThrow(/below MIN_CREDIT_ISSUANCE/);
  });

  it('rejects NaN and Infinity markupFactor', () => {
    expect(() => calculateCredits(5_000_000n, NaN)).toThrow(SafeArithmeticError);
    expect(() => calculateCredits(5_000_000n, Infinity)).toThrow(SafeArithmeticError);
  });
});

// =============================================================================
// Credit Pack Tiers (Task 4.3)
// =============================================================================

describe('Credit Pack Tiers', () => {
  it('all default tiers produce valid credits at default markup', () => {
    const errors = validateTierConfig(DEFAULT_MARKUP_FACTOR);
    expect(errors).toHaveLength(0);
  });

  it('starter tier: $5 at 1.0 markup → 5_000_000 credits', () => {
    const resolved = resolveCreditPack('starter', 1.0);
    expect(resolved).not.toBeNull();
    expect(resolved!.creditsMicro).toBe(5_000_000n);
  });

  it('builder tier: $10 at 1.0 markup → 10_000_000 credits', () => {
    const resolved = resolveCreditPack('builder', 1.0);
    expect(resolved).not.toBeNull();
    expect(resolved!.creditsMicro).toBe(10_000_000n);
  });

  it('pro tier: $25 at 1.0 markup → 25_000_000 credits', () => {
    const resolved = resolveCreditPack('pro', 1.0);
    expect(resolved).not.toBeNull();
    expect(resolved!.creditsMicro).toBe(25_000_000n);
  });

  it('unknown packId returns null', () => {
    const resolved = resolveCreditPack('enterprise', 1.0);
    expect(resolved).toBeNull();
  });

  it('validation rejects tiers with excessive markup', () => {
    // Custom tiny tiers where 10x markup would drop below minimum
    const tinyTiers = [
      { id: 'tiny', name: 'Tiny', priceMicro: 5000n, description: 'Too small' },
    ];
    const errors = validateTierConfig(10.0, tinyTiers);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('tier count matches expected (3 default tiers)', () => {
    expect(CREDIT_PACK_TIERS).toHaveLength(3);
    expect(CREDIT_PACK_TIERS.map(t => t.id)).toEqual(['starter', 'builder', 'pro']);
  });
});

// =============================================================================
// MockPaymentVerifier (Task 4.5)
// =============================================================================

describe('MockPaymentVerifier', () => {
  const RECIPIENT = '0x1234567890abcdef1234567890abcdef12345678';
  let verifier: MockPaymentVerifier;

  beforeEach(() => {
    verifier = new MockPaymentVerifier({ recipientAddress: RECIPIENT });
  });

  function validProof(overrides?: Partial<PaymentProof>): PaymentProof {
    return {
      reference: '0xabc123',
      recipient_address: RECIPIENT,
      amount_micro: 5_000_000n,
      payer: '0xdeadbeef',
      chain_id: 8453,
      ...overrides,
    };
  }

  it('accepts structurally valid proof', async () => {
    const result = await verifier.verify(validProof());
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('rejects missing reference', async () => {
    const result = await verifier.verify(validProof({ reference: '' }));
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/reference/i);
  });

  it('rejects wrong recipient', async () => {
    const result = await verifier.verify(validProof({
      recipient_address: '0xwrongaddress',
    }));
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/recipient mismatch/i);
  });

  it('rejects zero amount', async () => {
    const result = await verifier.verify(validProof({ amount_micro: 0n }));
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/amount_micro/i);
  });

  it('rejects negative amount', async () => {
    const result = await verifier.verify(validProof({ amount_micro: -1n }));
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/amount_micro/i);
  });

  it('rejects invalid chain_id', async () => {
    const result = await verifier.verify(validProof({ chain_id: 0 }));
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/chain_id/i);
  });
});

// =============================================================================
// Purchase Flow & Idempotency (Tasks 4.4, 4.6)
// =============================================================================

describe('Credit Pack Purchase — DB Integration', () => {
  function createTestDb(): Database.Database {
    const db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(CREDIT_LEDGER_SCHEMA_SQL);
    db.exec(CREDIT_LOT_PURCHASES_SCHEMA_SQL);
    // Seed a credit account
    db.prepare(`
      INSERT INTO credit_accounts (id, entity_type, entity_id, version, created_at, updated_at)
      VALUES ('acct-buyer', 'person', 'user-1', 1, datetime('now'), datetime('now'))
    `).run();
    return db;
  }

  function generateIdempotencyKey(
    reference: string,
    recipientAddress: string,
    amountMicro: bigint,
    accountId: string,
  ): string {
    return createHash('sha256')
      .update(`${reference}:${recipientAddress}:${amountMicro.toString()}:${accountId}`)
      .digest('hex');
  }

  it('purchase creates lot and purchase record', () => {
    const db = createTestDb();
    try {
      const creditsMicro = 5_000_000n;

      // Create a credit lot (simulating what the ledger service does)
      const lotId = 'lot-test-1';
      db.prepare(`
        INSERT INTO credit_lots (id, account_id, pool_id, source_type, original_micro, available_micro, reserved_micro, consumed_micro)
        VALUES (?, ?, 'general', 'purchase', ?, ?, 0, 0)
      `).run(lotId, 'acct-buyer', creditsMicro.toString(), creditsMicro.toString());

      // Record purchase
      const idempotencyKey = generateIdempotencyKey(
        '0xabc', '0xrecipient', 5_000_000n, 'acct-buyer',
      );
      db.prepare(`
        INSERT INTO credit_lot_purchases (id, account_id, pack_id, payment_reference, idempotency_key, lot_id, amount_micro)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('pur-1', 'acct-buyer', 'starter', '0xabc', idempotencyKey, lotId, creditsMicro.toString());

      // Verify lot exists
      const lot = db.prepare('SELECT * FROM credit_lots WHERE id = ?').get(lotId) as any;
      expect(lot).toBeDefined();
      expect(lot.source_type).toBe('purchase');
      expect(BigInt(lot.original_micro)).toBe(creditsMicro);

      // Verify purchase record
      const purchase = db.prepare('SELECT * FROM credit_lot_purchases WHERE id = ?').get('pur-1') as any;
      expect(purchase).toBeDefined();
      expect(purchase.pack_id).toBe('starter');
      expect(purchase.lot_id).toBe(lotId);
      expect(BigInt(purchase.amount_micro)).toBe(creditsMicro);
    } finally {
      db.close();
    }
  });

  it('idempotency: duplicate purchase attempt returns existing lot', () => {
    const db = createTestDb();
    try {
      const idempotencyKey = generateIdempotencyKey(
        '0xabc', '0xrecipient', 5_000_000n, 'acct-buyer',
      );

      // First purchase
      db.prepare(`
        INSERT INTO credit_lots (id, account_id, pool_id, source_type, original_micro, available_micro, reserved_micro, consumed_micro)
        VALUES ('lot-1', 'acct-buyer', 'general', 'purchase', '5000000', '5000000', '0', '0')
      `).run();

      db.prepare(`
        INSERT INTO credit_lot_purchases (id, account_id, pack_id, payment_reference, idempotency_key, lot_id, amount_micro)
        VALUES ('pur-1', 'acct-buyer', 'starter', '0xabc', ?, 'lot-1', '5000000')
      `).run(idempotencyKey);

      // Duplicate check — same idempotency key already exists
      const existing = db.prepare(
        'SELECT lot_id, amount_micro FROM credit_lot_purchases WHERE idempotency_key = ?',
      ).get(idempotencyKey) as { lot_id: string; amount_micro: string } | undefined;

      expect(existing).toBeDefined();
      expect(existing!.lot_id).toBe('lot-1');
      expect(BigInt(existing!.amount_micro)).toBe(5_000_000n);
    } finally {
      db.close();
    }
  });

  it('idempotency_key UNIQUE constraint prevents duplicate inserts', () => {
    const db = createTestDb();
    try {
      const idempotencyKey = 'test-idem-key';

      db.prepare(`
        INSERT INTO credit_lots (id, account_id, pool_id, source_type, original_micro, available_micro, reserved_micro, consumed_micro)
        VALUES ('lot-1', 'acct-buyer', 'general', 'purchase', '5000000', '5000000', '0', '0')
      `).run();

      db.prepare(`
        INSERT INTO credit_lots (id, account_id, pool_id, source_type, original_micro, available_micro, reserved_micro, consumed_micro)
        VALUES ('lot-2', 'acct-buyer', 'general', 'purchase', '5000000', '5000000', '0', '0')
      `).run();

      db.prepare(`
        INSERT INTO credit_lot_purchases (id, account_id, pack_id, payment_reference, idempotency_key, lot_id, amount_micro)
        VALUES ('pur-1', 'acct-buyer', 'starter', '0xabc', ?, 'lot-1', '5000000')
      `).run(idempotencyKey);

      // Attempt duplicate insert with same idempotency_key
      expect(() => {
        db.prepare(`
          INSERT INTO credit_lot_purchases (id, account_id, pack_id, payment_reference, idempotency_key, lot_id, amount_micro)
          VALUES ('pur-2', 'acct-buyer', 'starter', '0xabc', ?, 'lot-2', '5000000')
        `).run(idempotencyKey);
      }).toThrow(/UNIQUE constraint/);
    } finally {
      db.close();
    }
  });

  it('amount_micro CHECK constraint rejects zero', () => {
    const db = createTestDb();
    try {
      db.prepare(`
        INSERT INTO credit_lots (id, account_id, pool_id, source_type, original_micro, available_micro, reserved_micro, consumed_micro)
        VALUES ('lot-1', 'acct-buyer', 'general', 'purchase', '5000000', '5000000', '0', '0')
      `).run();

      expect(() => {
        db.prepare(`
          INSERT INTO credit_lot_purchases (id, account_id, pack_id, payment_reference, idempotency_key, lot_id, amount_micro)
          VALUES ('pur-1', 'acct-buyer', 'starter', '0xabc', 'idem-1', 'lot-1', 0)
        `).run();
      }).toThrow(/CHECK constraint/);
    } finally {
      db.close();
    }
  });

  it('foreign key: account_id must reference credit_accounts', () => {
    const db = createTestDb();
    try {
      db.prepare(`
        INSERT INTO credit_lots (id, account_id, pool_id, source_type, original_micro, available_micro, reserved_micro, consumed_micro)
        VALUES ('lot-1', 'acct-buyer', 'general', 'purchase', '5000000', '5000000', '0', '0')
      `).run();

      expect(() => {
        db.prepare(`
          INSERT INTO credit_lot_purchases (id, account_id, pack_id, payment_reference, idempotency_key, lot_id, amount_micro)
          VALUES ('pur-1', 'acct-nonexistent', 'starter', '0xabc', 'idem-1', 'lot-1', '5000000')
        `).run();
      }).toThrow(/FOREIGN KEY constraint/);
    } finally {
      db.close();
    }
  });

  it('audit trail: purchase index allows account history lookup', () => {
    const db = createTestDb();
    try {
      // Create lots
      for (let i = 1; i <= 3; i++) {
        db.prepare(`
          INSERT INTO credit_lots (id, account_id, pool_id, source_type, original_micro, available_micro, reserved_micro, consumed_micro)
          VALUES (?, 'acct-buyer', 'general', 'purchase', '5000000', '5000000', '0', '0')
        `).run(`lot-${i}`);

        db.prepare(`
          INSERT INTO credit_lot_purchases (id, account_id, pack_id, payment_reference, idempotency_key, lot_id, amount_micro)
          VALUES (?, 'acct-buyer', 'starter', ?, ?, ?, '5000000')
        `).run(`pur-${i}`, `ref-${i}`, `idem-${i}`, `lot-${i}`);
      }

      // Query by account (uses idx_credit_lot_purchases_account)
      const purchases = db.prepare(
        'SELECT * FROM credit_lot_purchases WHERE account_id = ? ORDER BY created_at DESC',
      ).all('acct-buyer');

      expect(purchases).toHaveLength(3);
    } finally {
      db.close();
    }
  });
});
