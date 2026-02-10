/**
 * Request Hash — Wire-Bytes Binding for req_hash JWT Claim
 * Sprint S11-T3: req_hash Mismatch Contract (IMP-003)
 *
 * Computes a deterministic hash of the request body for inclusion as
 * the `req_hash` JWT claim. loa-finn verifies that the hash of the
 * received wire bytes matches this claim, detecting proxy tampering
 * or serialization divergence.
 *
 * CRITICAL: This function MUST be called on the exact same string
 * that is passed to `fetch()` as the request body. Using a different
 * serialization will cause REQ_HASH_MISMATCH errors.
 *
 * @see SDD §6.3.2 req_hash Contract
 * @see Flatline IMP-003
 */

import { createHash } from 'node:crypto';

/**
 * Compute a base64url-encoded SHA-256 hash of the request body string.
 *
 * @param rawBody - The exact JSON string that will be sent as the request body.
 *                  Must be the same string passed to `fetch()`.
 * @returns base64url(SHA-256(rawBody)) — URL-safe, no padding
 */
export function computeReqHash(rawBody: string): string {
  return createHash('sha256')
    .update(rawBody, 'utf8')
    .digest('base64url');
}
