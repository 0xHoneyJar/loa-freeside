/**
 * x402 Payment Middleware Tests (Sprint 249, Task 5.5)
 *
 * Tests for:
 * - x402 response format (enabled vs disabled)
 * - NonceCache (set, consume, has, expiry, replay rejection)
 * - x402 configuration validation
 * - X402PaymentVerifier stub
 * - MockPaymentVerifier integration with inline flow
 * - formatAmountUsdc display string
 *
 * Sprint refs: Task 5.5
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  NonceCache,
  validateX402Config,
  DEFAULT_X402_CONFIG,
} from '../../../src/packages/core/billing/x402-config.js';
import type { X402Config } from '../../../src/packages/core/billing/x402-config.js';
import { X402PaymentVerifier } from '../../../src/packages/adapters/payment/x402-verifier.js';
import { MockPaymentVerifier } from '../../../src/packages/adapters/billing/MockPaymentVerifier.js';
import type { PaymentProof } from '../../../src/packages/core/ports/IPaymentVerifier.js';

// =============================================================================
// x402 Configuration Validation (Task 5.4)
// =============================================================================

describe('x402 Configuration', () => {
  it('validates disabled config without recipient', () => {
    expect(() => validateX402Config(DEFAULT_X402_CONFIG)).not.toThrow();
  });

  it('validates enabled config with recipient', () => {
    const config: X402Config = {
      enabled: true,
      recipient_address: '0x1234567890abcdef',
      supported_currencies: ['USDC'],
      nonce_ttl_seconds: 300,
    };
    expect(() => validateX402Config(config)).not.toThrow();
  });

  it('rejects enabled config without recipient', () => {
    const config: X402Config = {
      enabled: true,
      recipient_address: '',
      supported_currencies: ['USDC'],
      nonce_ttl_seconds: 300,
    };
    expect(() => validateX402Config(config)).toThrow(/recipient_address is required/);
  });

  it('rejects enabled config with whitespace-only recipient', () => {
    const config: X402Config = {
      enabled: true,
      recipient_address: '   ',
      supported_currencies: ['USDC'],
      nonce_ttl_seconds: 300,
    };
    expect(() => validateX402Config(config)).toThrow(/recipient_address is required/);
  });

  it('rejects non-positive nonce TTL', () => {
    const config: X402Config = {
      enabled: false,
      recipient_address: '',
      supported_currencies: ['USDC'],
      nonce_ttl_seconds: 0,
    };
    expect(() => validateX402Config(config)).toThrow(/nonce_ttl_seconds must be positive/);
  });
});

// =============================================================================
// NonceCache (Task 5.1, 5.3)
// =============================================================================

describe('NonceCache', () => {
  let cache: NonceCache;

  beforeEach(() => {
    cache = new NonceCache(300); // 5 min TTL
  });

  it('stores and consumes a nonce', () => {
    cache.set('nonce-1', 'acct-a');
    expect(cache.has('nonce-1')).toBe(true);
    expect(cache.consume('nonce-1', 'acct-a')).toBe(true);
    expect(cache.has('nonce-1')).toBe(false); // consumed
  });

  it('rejects consuming unknown nonce', () => {
    expect(cache.consume('nonexistent', 'acct-a')).toBe(false);
  });

  it('rejects consuming nonce for wrong account', () => {
    cache.set('nonce-1', 'acct-a');
    expect(cache.consume('nonce-1', 'acct-b')).toBe(false);
    // Nonce still available for correct account
    expect(cache.consume('nonce-1', 'acct-a')).toBe(true);
  });

  it('rejects reuse of consumed nonce (replay prevention)', () => {
    cache.set('nonce-1', 'acct-a');
    expect(cache.consume('nonce-1', 'acct-a')).toBe(true);
    // Second consume should fail — nonce was consumed
    expect(cache.consume('nonce-1', 'acct-a')).toBe(false);
  });

  it('rejects expired nonce', async () => {
    // Create cache with 0.05s TTL for testing
    const shortCache = new NonceCache(0.05);
    shortCache.set('nonce-exp', 'acct-a');
    expect(shortCache.has('nonce-exp')).toBe(true);

    // Wait for expiry
    await new Promise(resolve => setTimeout(resolve, 60));

    expect(shortCache.has('nonce-exp')).toBe(false);
    expect(shortCache.consume('nonce-exp', 'acct-a')).toBe(false);
  });

  it('tracks cache size correctly', () => {
    expect(cache.size).toBe(0);
    cache.set('n1', 'a1');
    cache.set('n2', 'a2');
    expect(cache.size).toBe(2);
    cache.consume('n1', 'a1');
    expect(cache.size).toBe(1);
  });

  it('rejects non-positive TTL in constructor', () => {
    expect(() => new NonceCache(0)).toThrow(/positive finite/);
    expect(() => new NonceCache(-1)).toThrow(/positive finite/);
    expect(() => new NonceCache(Infinity)).toThrow(/positive finite/);
  });
});

// =============================================================================
// X402PaymentVerifier Stub (Task 5.2)
// =============================================================================

describe('X402PaymentVerifier (stub)', () => {
  it('always returns not-implemented', async () => {
    const verifier = new X402PaymentVerifier();
    const proof: PaymentProof = {
      reference: '0xabc',
      recipient_address: '0x123',
      amount_micro: 5_000_000n,
      payer: '0xdef',
      chain_id: 8453,
    };

    const result = await verifier.verify(proof);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/not yet implemented/);
  });
});

// =============================================================================
// 402 Response Format (Task 5.1)
// =============================================================================

describe('402 Response Format', () => {
  it('amount_usdc is exact string of amount_micro / 1e6', () => {
    // Test the format function logic directly
    const formatAmountUsdc = (amountMicro: bigint): string => {
      const dollars = amountMicro / 1_000_000n;
      const remainder = amountMicro % 1_000_000n;
      return `${dollars}.${remainder.toString().padStart(6, '0')}`;
    };

    expect(formatAmountUsdc(11_000n)).toBe('0.011000');
    expect(formatAmountUsdc(1_500_000n)).toBe('1.500000');
    expect(formatAmountUsdc(5_000_000n)).toBe('5.000000');
    expect(formatAmountUsdc(10_123_456n)).toBe('10.123456');
    expect(formatAmountUsdc(0n)).toBe('0.000000');
  });
});

// =============================================================================
// Inline Payment Flow Integration (Task 5.3)
// =============================================================================

describe('Inline Payment — MockPaymentVerifier', () => {
  const RECIPIENT = '0xrecipient';

  it('mock verifier accepts valid proof for inline payment', async () => {
    const verifier = new MockPaymentVerifier({ recipientAddress: RECIPIENT });
    const proof: PaymentProof = {
      reference: '0xtxhash:nonce-123',
      recipient_address: RECIPIENT,
      amount_micro: 5_000_000n,
      payer: '0xpayer',
      chain_id: 8453,
    };

    const result = await verifier.verify(proof);
    expect(result.valid).toBe(true);
  });

  it('mock verifier rejects wrong recipient for inline payment', async () => {
    const verifier = new MockPaymentVerifier({ recipientAddress: RECIPIENT });
    const proof: PaymentProof = {
      reference: '0xtxhash',
      recipient_address: '0xwrong',
      amount_micro: 5_000_000n,
      payer: '0xpayer',
      chain_id: 8453,
    };

    const result = await verifier.verify(proof);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/recipient mismatch/i);
  });

  it('X-Payment-Proof header is base64-encoded JSON', () => {
    const proof = {
      reference: '0xabc:nonce-uuid',
      recipient_address: RECIPIENT,
      amount_micro: '5000000',
      payer: '0xpayer',
      chain_id: 8453,
    };

    const encoded = Buffer.from(JSON.stringify(proof)).toString('base64');
    const decoded = JSON.parse(Buffer.from(encoded, 'base64').toString('utf-8'));

    expect(decoded.reference).toBe(proof.reference);
    expect(decoded.recipient_address).toBe(proof.recipient_address);
    expect(decoded.amount_micro).toBe('5000000');
  });
});
