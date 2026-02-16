/**
 * JWT Test Helper Factory (Task 4.2, Sprint 298)
 *
 * Provides Ed25519 keypair generation and JWT signing utilities for
 * cross-system E2E tests. All keys are real Ed25519 (not mocked).
 *
 * SDD refs: §3.3.2 JWT test factory
 * Sprint refs: Task 4.2
 */

import { generateKeyPairSync, type KeyObject } from 'crypto';
import { SignJWT } from 'jose';
import type { OutboundClaims, InboundClaims } from '../../src/packages/core/protocol/jwt-boundary.js';

// =============================================================================
// Keypair Types
// =============================================================================

export interface TestKeypair {
  publicKey: KeyObject;
  privateKey: KeyObject;
}

export interface TestKeypairs {
  arrakis: TestKeypair;
  loaFinn: TestKeypair;
}

// =============================================================================
// Keypair Generation
// =============================================================================

/**
 * Generate two Ed25519 keypairs: one for arrakis (outbound) and one for
 * loa-finn (inbound). Uses Node.js crypto — no external dependencies.
 */
export function createTestKeypairs(): TestKeypairs {
  return {
    arrakis: generateEd25519Keypair(),
    loaFinn: generateEd25519Keypair(),
  };
}

function generateEd25519Keypair(): TestKeypair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { publicKey, privateKey };
}

// =============================================================================
// JWT Signing
// =============================================================================

/**
 * Sign an outbound JWT (arrakis → loa-finn) with Ed25519.
 */
export async function signOutbound(
  claims: OutboundClaims,
  privateKey: KeyObject,
): Promise<string> {
  return new SignJWT({ ...claims } as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: 'EdDSA' })
    .setIssuedAt()
    .setExpirationTime('5m')
    .setIssuer('arrakis')
    .setAudience('loa-finn')
    .sign(privateKey);
}

/**
 * Sign an inbound JWT (loa-finn → arrakis) with Ed25519.
 */
export async function signInbound(
  claims: InboundClaims,
  privateKey: KeyObject,
): Promise<string> {
  return new SignJWT({ ...claims } as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: 'EdDSA' })
    .setIssuedAt()
    .setExpirationTime('5m')
    .setIssuer('loa-finn')
    .setAudience('arrakis')
    .sign(privateKey);
}

/**
 * Sign an inbound JWT with custom header (for algorithm rejection tests).
 */
export async function signInboundWithAlg(
  claims: InboundClaims,
  privateKey: KeyObject,
  alg: string,
): Promise<string> {
  return new SignJWT({ ...claims } as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg })
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
}

// =============================================================================
// Claim Factories
// =============================================================================

/**
 * Create a valid InboundClaims object with sensible defaults.
 */
export function makeInboundClaims(overrides: Partial<InboundClaims> = {}): InboundClaims {
  return {
    jti: crypto.randomUUID(),
    finalized: true,
    reservation_id: `res-${Math.random().toString(36).slice(2, 10)}`,
    actual_cost_micro: '500000',
    models_used: ['claude-sonnet-4-5-20250929'],
    input_tokens: 1000,
    output_tokens: 500,
    ...overrides,
  };
}
