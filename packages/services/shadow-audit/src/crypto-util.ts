import { timingSafeEqual } from 'node:crypto';

/**
 * Constant-time string comparison with no length oracle.
 *
 * Always execute timingSafeEqual against the expected byte length, then apply
 * the length constraint to already-computed booleans.
 */
export function timingSafeEqualStr(presented: string, expected: string): boolean {
  const presentedBytes = Buffer.from(presented);
  const expectedBytes = Buffer.from(expected);
  const filled = Buffer.alloc(expectedBytes.length, 0);
  presentedBytes.copy(filled, 0, 0, Math.min(presentedBytes.length, filled.length));
  const contentMatch = timingSafeEqual(filled, expectedBytes);
  const lengthMatch = presentedBytes.length === expectedBytes.length;
  return contentMatch && lengthMatch;
}
