import { describe, it, expect } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { signOrder, verifyOrder, type CanonicalOrder } from '../order-signer.js';

const order: CanonicalOrder = {
  order_id: 'ord_1',
  product: 'access-risk-audit',
  inputs: { chain: 'ethereum', contract: '0x' + '2'.repeat(40), snapshot_date: '2026-06-01', threshold: 1 },
  schema_version: '0.1.0',
  preset_version: 'access-risk-audit',
  audit_request_digest: 'a'.repeat(64),
};

describe('order-signer (S4-T1 / H-5)', () => {
  it('signs and verifies a canonical order', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const signed = signOrder(order, privateKey);
    expect(signed.signature.length).toBeGreaterThan(0);
    expect(verifyOrder(signed, publicKey)).toBe(true);
  });

  it('verification FAILS on any field tamper (the whole payload is signed, not just inputs_digest)', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const signed = signOrder(order, privateKey);

    // tamper a deep input
    const t1 = { ...signed, order: { ...signed.order, inputs: { ...signed.order.inputs, threshold: 999 } } };
    expect(verifyOrder(t1, publicKey)).toBe(false);

    // tamper the bound AuditRequest digest
    const t2 = { ...signed, order: { ...signed.order, audit_request_digest: 'b'.repeat(64) } };
    expect(verifyOrder(t2, publicKey)).toBe(false);

    // tamper the preset version
    const t3 = { ...signed, order: { ...signed.order, preset_version: 'other' } };
    expect(verifyOrder(t3, publicKey)).toBe(false);
  });

  it('verification fails under a different key', () => {
    const a = generateKeyPairSync('ed25519');
    const b = generateKeyPairSync('ed25519');
    const signed = signOrder(order, a.privateKey);
    expect(verifyOrder(signed, b.publicKey)).toBe(false);
  });
});
