/**
 * req_hash Wire-Bytes Binding Tests
 * Sprint S11-T3: req_hash Mismatch Contract (IMP-003)
 *
 * Verifies:
 * 1. computeReqHash determinism and format
 * 2. Wire-bytes binding contract (same string → same hash)
 * 3. Sensitivity to serialization differences
 *
 * @see SDD §6.3.2 req_hash Contract
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { computeReqHash } from '@arrakis/adapters/agent/req-hash';

// --------------------------------------------------------------------------
// Determinism
// --------------------------------------------------------------------------

describe('computeReqHash — determinism', () => {
  it('returns the same hash for the same input', () => {
    const body = '{"agent":"default","messages":[{"role":"user","content":"hello"}]}';
    expect(computeReqHash(body)).toBe(computeReqHash(body));
  });

  it('matches hand-computed SHA-256 base64url', () => {
    const body = 'test-body';
    const expected = createHash('sha256').update(body, 'utf8').digest('base64url');
    expect(computeReqHash(body)).toBe(expected);
  });

  it('returns base64url encoding (no padding, URL-safe chars)', () => {
    const hash = computeReqHash('some input');
    // base64url: no +, no /, no =
    expect(hash).not.toMatch(/[+/=]/);
    // Should be 43 chars (256 bits / 6 bits per char = 43 chars, no padding)
    expect(hash).toHaveLength(43);
  });

  it('produces different hashes for different inputs', () => {
    const a = computeReqHash('body-a');
    const b = computeReqHash('body-b');
    expect(a).not.toBe(b);
  });
});

// --------------------------------------------------------------------------
// Wire-Bytes Binding Contract
// --------------------------------------------------------------------------

describe('computeReqHash — wire-bytes binding', () => {
  it('JSON.stringify order sensitivity: different key order → different hash', () => {
    const bodyA = JSON.stringify({ agent: 'default', messages: [] });
    const bodyB = JSON.stringify({ messages: [], agent: 'default' });
    // Different key orders produce different strings, hence different hashes
    expect(bodyA).not.toBe(bodyB);
    expect(computeReqHash(bodyA)).not.toBe(computeReqHash(bodyB));
  });

  it('whitespace sensitivity: pretty vs compact → different hash', () => {
    const obj = { agent: 'default', messages: [{ role: 'user', content: 'hi' }] };
    const compact = JSON.stringify(obj);
    const pretty = JSON.stringify(obj, null, 2);
    expect(computeReqHash(compact)).not.toBe(computeReqHash(pretty));
  });

  it('contract: hash(serialized) called once, used for both JWT and fetch', () => {
    // Simulates the correct usage pattern:
    // 1. Serialize once
    // 2. Hash the serialized string
    // 3. Use serialized string for fetch body AND hash for JWT claim
    const request = { agent: 'default', messages: [{ role: 'user', content: 'hello' }] };
    const wireBytes = JSON.stringify(request);
    const jwtClaimHash = computeReqHash(wireBytes);
    const fetchBodyHash = computeReqHash(wireBytes);
    expect(jwtClaimHash).toBe(fetchBodyHash);
  });

  it('contract violation: re-serializing produces different hash', () => {
    // This is the anti-pattern: serializing twice may produce different strings
    // if object has been mutated or if serialization is non-deterministic
    const request = { agent: 'default', z: 1, a: 2 };
    const firstSerialization = JSON.stringify(request);
    // Reconstruct object in different order (simulating parse + re-serialize)
    const parsed = JSON.parse(firstSerialization);
    // In V8, JSON.parse preserves insertion order, so this would match.
    // But if someone manually constructs a new object with different order:
    const reordered = JSON.stringify({ a: parsed.a, z: parsed.z, agent: parsed.agent });
    expect(computeReqHash(firstSerialization)).not.toBe(computeReqHash(reordered));
  });

  it('handles empty body', () => {
    const hash = computeReqHash('');
    // SHA-256 of empty string is well-known
    const expected = createHash('sha256').update('', 'utf8').digest('base64url');
    expect(hash).toBe(expected);
    expect(hash).toHaveLength(43);
  });

  it('handles unicode content', () => {
    const body = JSON.stringify({ content: '日本語テスト 🎉' });
    const hash = computeReqHash(body);
    expect(hash).toHaveLength(43);
    expect(computeReqHash(body)).toBe(hash); // deterministic
  });

  it('handles large body', () => {
    const largeBody = JSON.stringify({ data: 'x'.repeat(100_000) });
    const hash = computeReqHash(largeBody);
    expect(hash).toHaveLength(43);
  });
});

// --------------------------------------------------------------------------
// Edge Cases
// --------------------------------------------------------------------------

describe('computeReqHash — edge cases', () => {
  it('treats null bytes as valid content', () => {
    const body = 'before\0after';
    const hash = computeReqHash(body);
    expect(hash).toHaveLength(43);
    expect(computeReqHash(body)).toBe(hash);
  });

  it('newline variations produce different hashes', () => {
    expect(computeReqHash('line\n')).not.toBe(computeReqHash('line\r\n'));
  });
});
