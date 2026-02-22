/**
 * JWT Boundary Module — Cross-System Economic Verification (Task 4.1, Sprint 298)
 *
 * Defines the verification protocol at the JWT boundary between arrakis and
 * loa-finn. Every usage JWT crossing this boundary undergoes 6-step verification:
 *
 * 1. Signature verification (EdDSA only)
 * 2. Algorithm whitelist check
 * 3. Claims schema validation (zod)
 * 4. Reservation existence check
 * 5. Replay detection (keyed by jti)
 * 6. Overspend guard (cost ≤ reserved)
 *
 * SDD refs: §3.3.1 JWT boundary
 * Sprint refs: Task 4.1
 *
 * @module packages/core/protocol/jwt-boundary
 */

import { z } from 'zod';
import { jwtVerify } from 'jose';
import type { KeyObject } from 'crypto';

// =============================================================================
// Error Taxonomy
// =============================================================================

/** Error codes for JWT boundary verification failures. */
export type JwtErrorCode =
  | 'SIGNATURE_INVALID'
  | 'ALGORITHM_REJECTED'
  | 'CLAIMS_SCHEMA'
  | 'RESERVATION_UNKNOWN'
  | 'OVERSPEND'
  | 'REPLAY'
  | 'KEY_FETCH_FAILED';

/**
 * Typed error for JWT boundary verification failures.
 * `permanent: true` means the JWT will never pass — no retry.
 */
export class JwtBoundaryError extends Error {
  readonly code: JwtErrorCode;
  readonly permanent: boolean;

  constructor(code: JwtErrorCode, message: string, permanent = true) {
    super(`JwtBoundary [${code}]: ${message}`);
    this.name = 'JwtBoundaryError';
    this.code = code;
    this.permanent = permanent;
  }
}

// =============================================================================
// Claims Types
// =============================================================================

/**
 * Claims sent outbound from arrakis to loa-finn (usage request).
 */
export interface OutboundClaims {
  /** Unique JWT ID — replay detection key */
  jti: string;
  /** Reservation ID in arrakis */
  reservation_id: string;
  /** Budget reservation ID — explicit alias for finn-side finalization (Sprint 4.1) */
  budget_reservation_id: string;
  /** Reserved amount in micro-USD (string for BigInt safety) */
  reserved_micro: string;
  /** Model pool requested */
  pool_id: string;
  /** Account making the request */
  account_id: string;
  /** NFT token ID for personality routing (Sprint 4.1) */
  nft_id: string | null;
  /** Community tier (1-9) for pool selection (Sprint 4.1) */
  tier: number;
}

/**
 * Claims received inbound from loa-finn to arrakis (usage report).
 * This is the payload verified by `verifyUsageJWT`.
 */
export interface InboundClaims {
  /** Unique JWT ID — replay detection key */
  jti: string;
  /** Whether the usage was finalized (must be true) */
  finalized: true;
  /** Reservation ID referenced */
  reservation_id: string;
  /** Actual cost in micro-USD (string for BigInt safety) */
  actual_cost_micro: string;
  /** Models used in this invocation */
  models_used: string[];
  /** Token counts */
  input_tokens: number;
  output_tokens: number;
}

// =============================================================================
// Claims Schema (zod)
// =============================================================================

/** UUID v4 pattern for jti validation */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Zod schema for inbound usage JWT claims.
 * Validates structure, types, and business constraints.
 */
export const inboundClaimsSchema = z.object({
  jti: z.string().regex(UUID_PATTERN, 'jti must be a valid UUID v4'),
  finalized: z.literal(true, { errorMap: () => ({ message: 'finalized must be true' }) }),
  reservation_id: z.string().min(1, 'reservation_id required').max(256),
  actual_cost_micro: z.string()
    .min(1, 'actual_cost_micro required')
    .refine(
      (val) => {
        try {
          return BigInt(val) >= 0n;
        } catch {
          return false;
        }
      },
      { message: 'actual_cost_micro must be a non-negative integer string' },
    ),
  models_used: z.array(z.string().max(128)).max(20),
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
});

// =============================================================================
// Verification Interfaces
// =============================================================================

/** Store for jti-based replay detection. */
export interface IdempotencyStore {
  /** Returns true if jti has been seen before. If not, records it. */
  checkAndRecord(jti: string): boolean;
}

/** Active reservation lookup for existence + overspend checks. */
export interface ActiveReservations {
  /** Get the reserved amount for a reservation ID, or undefined if not found. */
  getReservedMicro(reservationId: string): bigint | undefined;
}

// =============================================================================
// Verification
// =============================================================================

/**
 * Verify an inbound usage JWT from loa-finn.
 *
 * 6-step verification:
 * 1. Signature verification via jose (EdDSA only)
 * 2. Algorithm whitelist (reject non-EdDSA)
 * 3. Claims schema validation (zod)
 * 4. Reservation existence check
 * 5. Replay detection (jti-keyed)
 * 6. Overspend guard (actual_cost ≤ reserved)
 *
 * @param token - Compact JWT string
 * @param publicKey - Ed25519 public KeyObject
 * @param idempotencyStore - jti replay detection store
 * @param activeReservations - reservation lookup
 * @returns Validated InboundClaims
 * @throws {JwtBoundaryError} with specific error code
 *
 * Note: KEY_FETCH_FAILED is a higher-layer error (key provisioning/rotation).
 * It is not thrown by this function. The error code exists for callers that
 * fetch keys before invoking verifyUsageJWT.
 */
export async function verifyUsageJWT(
  token: string,
  publicKey: KeyObject,
  idempotencyStore: IdempotencyStore,
  activeReservations: ActiveReservations,
): Promise<InboundClaims> {
  // Step 1 + 2: Signature verification with algorithm restriction
  let payload: Record<string, unknown>;
  try {
    const result = await jwtVerify(token, publicKey, {
      algorithms: ['EdDSA'],
    });
    payload = result.payload as Record<string, unknown>;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Distinguish algorithm rejection from signature failure
    if (message.includes('alg') || message.includes('algorithm')) {
      throw new JwtBoundaryError('ALGORITHM_REJECTED', `Algorithm not allowed: ${message}`);
    }
    throw new JwtBoundaryError('SIGNATURE_INVALID', `Signature verification failed: ${message}`);
  }

  // Step 3: Claims schema validation
  const parseResult = inboundClaimsSchema.safeParse(payload);
  if (!parseResult.success) {
    const issues = parseResult.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new JwtBoundaryError('CLAIMS_SCHEMA', `Invalid claims: ${issues}`);
  }
  const claims = parseResult.data;

  // Step 4: Reservation existence check
  const reservedMicro = activeReservations.getReservedMicro(claims.reservation_id);
  if (reservedMicro === undefined) {
    throw new JwtBoundaryError(
      'RESERVATION_UNKNOWN',
      `Reservation ${claims.reservation_id} not found`,
    );
  }

  // Step 5: Replay detection (keyed by jti, NOT reservation_id)
  const isDuplicate = idempotencyStore.checkAndRecord(claims.jti);
  if (isDuplicate) {
    throw new JwtBoundaryError('REPLAY', `Duplicate jti: ${claims.jti}`);
  }

  // Step 6: Overspend guard
  const actualCost = BigInt(claims.actual_cost_micro);
  if (actualCost > reservedMicro) {
    throw new JwtBoundaryError(
      'OVERSPEND',
      `Actual cost ${actualCost} exceeds reserved ${reservedMicro}`,
    );
  }

  return claims;
}
