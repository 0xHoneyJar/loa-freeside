import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Compare bounded, fixed-size digests instead of variable-length secrets.
 *
 * Header parsing already exposes attacker-controlled input length to the
 * transport. The public cap prevents oversized allocation/work here; hashing
 * then gives timingSafeEqual two fixed-size values without revealing the
 * expected secret's length through the comparison primitive.
 */
export function timingSafeEqualStr(presented: string, expected: string): boolean {
  const presentedBytes = Buffer.from(presented);
  if (presentedBytes.length > 4096) return false;
  const presentedDigest = createHash('sha256').update(presentedBytes).digest();
  const expectedDigest = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(presentedDigest, expectedDigest);
}
