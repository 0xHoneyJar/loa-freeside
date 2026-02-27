/**
 * req_hash Wire-Bytes Binding Tests
 * Sprint S11-T3: req_hash Mismatch Contract (IMP-003)
 *
 * Verifies:
 * 1. computeReqHash determinism and format
 * 2. Wire-bytes binding contract (same bytes → same hash)
 * 3. Sensitivity to serialization differences
 *
 * Current hounfour API:
 *   computeReqHash(body: Buffer, contentEncoding?: string): string
 *   Returns: "sha256:<64 hex chars>"
 *
 * @see SDD §6.3.2 req_hash Contract
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { computeReqHash } from '@arrakis/adapters/agent';

/** Helper: convert string to Buffer for computeReqHash */
function toBuffer(s: string): Buffer {
  return Buffer.from(s, 'utf-8');
}

/** Expected format: "sha256:" + 64 hex chars = 71 chars total */
const HASH_PREFIX = 'sha256:';
const HASH_LENGTH = 71; // 7 prefix + 64 hex

// --------------------------------------------------------------------------
// Determinism
// --------------------------------------------------------------------------

describe('computeReqHash — determinism', () => {
  it('returns the same hash for the same input', () => {
    const body = toBuffer('{"agent":"default","messages":[{"role":"user","content":"hello"}]}');
    expect(computeReqHash(body)).toBe(computeReqHash(body));
  });

  it('matches hand-computed SHA-256 hex', () => {
    const body = 'test-body';
    const expectedHex = createHash('sha256').update(body, 'utf8').digest('hex');
    expect(computeReqHash(toBuffer(body))).toBe(`sha256:${expectedHex}`);
  });

  it('returns sha256:<hex> format', () => {
    const hash = computeReqHash(toBuffer('some input'));
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(hash).toHaveLength(HASH_LENGTH);
  });

  it('produces different hashes for different inputs', () => {
    const a = computeReqHash(toBuffer('body-a'));
    const b = computeReqHash(toBuffer('body-b'));
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
    expect(computeReqHash(toBuffer(bodyA))).not.toBe(computeReqHash(toBuffer(bodyB)));
  });

  it('whitespace sensitivity: pretty vs compact → different hash', () => {
    const obj = { agent: 'default', messages: [{ role: 'user', content: 'hi' }] };
    const compact = JSON.stringify(obj);
    const pretty = JSON.stringify(obj, null, 2);
    expect(computeReqHash(toBuffer(compact))).not.toBe(computeReqHash(toBuffer(pretty)));
  });

  it('contract: hash(serialized) called once, used for both JWT and fetch', () => {
    // Simulates the correct usage pattern:
    // 1. Serialize once
    // 2. Hash the serialized string
    // 3. Use serialized string for fetch body AND hash for JWT claim
    const request = { agent: 'default', messages: [{ role: 'user', content: 'hello' }] };
    const wireBytes = JSON.stringify(request);
    const jwtClaimHash = computeReqHash(toBuffer(wireBytes));
    const fetchBodyHash = computeReqHash(toBuffer(wireBytes));
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
    expect(computeReqHash(toBuffer(firstSerialization))).not.toBe(computeReqHash(toBuffer(reordered)));
  });

  it('handles empty body', () => {
    const hash = computeReqHash(toBuffer(''));
    // SHA-256 of empty string is well-known
    const expected = `sha256:${createHash('sha256').update('', 'utf8').digest('hex')}`;
    expect(hash).toBe(expected);
    expect(hash).toHaveLength(HASH_LENGTH);
  });

  it('handles unicode content', () => {
    const body = JSON.stringify({ content: '日本語テスト' });
    const hash = computeReqHash(toBuffer(body));
    expect(hash).toHaveLength(HASH_LENGTH);
    expect(computeReqHash(toBuffer(body))).toBe(hash); // deterministic
  });

  it('handles large body', () => {
    const largeBody = JSON.stringify({ data: 'x'.repeat(100_000) });
    const hash = computeReqHash(toBuffer(largeBody));
    expect(hash).toHaveLength(HASH_LENGTH);
  });
});

// --------------------------------------------------------------------------
// Edge Cases
// --------------------------------------------------------------------------

describe('computeReqHash — edge cases', () => {
  it('treats null bytes as valid content', () => {
    const body = 'before\0after';
    const hash = computeReqHash(toBuffer(body));
    expect(hash).toHaveLength(HASH_LENGTH);
    expect(computeReqHash(toBuffer(body))).toBe(hash);
  });

  it('newline variations produce different hashes', () => {
    expect(computeReqHash(toBuffer('line\n'))).not.toBe(computeReqHash(toBuffer('line\r\n')));
  });
});
