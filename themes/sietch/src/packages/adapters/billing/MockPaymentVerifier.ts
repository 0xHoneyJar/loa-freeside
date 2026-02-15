/**
 * MockPaymentVerifier — Test/Dev Payment Verification
 *
 * Accepts any PaymentProof with valid structure.
 * Validates:
 *   - All required fields present
 *   - proof.recipient_address matches configured recipient
 *   - proof.amount_micro > 0
 *
 * Sprint refs: Task 4.5
 *
 * @module packages/adapters/billing/MockPaymentVerifier
 */

import type {
  IPaymentVerifier,
  PaymentProof,
  PaymentVerificationResult,
} from '../../core/ports/IPaymentVerifier.js';

export interface MockPaymentVerifierConfig {
  /** Expected recipient address for payment validation */
  recipientAddress: string;
}

export class MockPaymentVerifier implements IPaymentVerifier {
  private readonly recipientAddress: string;

  constructor(config: MockPaymentVerifierConfig) {
    this.recipientAddress = config.recipientAddress;
  }

  async verify(proof: PaymentProof): Promise<PaymentVerificationResult> {
    // Validate required fields
    if (!proof.reference || typeof proof.reference !== 'string') {
      return { valid: false, reason: 'Missing or invalid payment reference' };
    }

    if (!proof.recipient_address || typeof proof.recipient_address !== 'string') {
      return { valid: false, reason: 'Missing or invalid recipient address' };
    }

    if (!proof.payer || typeof proof.payer !== 'string') {
      return { valid: false, reason: 'Missing or invalid payer' };
    }

    if (typeof proof.chain_id !== 'number' || proof.chain_id <= 0) {
      return { valid: false, reason: 'Missing or invalid chain_id' };
    }

    // Validate recipient matches expected address
    if (proof.recipient_address !== this.recipientAddress) {
      return {
        valid: false,
        reason: `Recipient mismatch: expected ${this.recipientAddress}, got ${proof.recipient_address}`,
      };
    }

    // Validate amount
    if (typeof proof.amount_micro !== 'bigint' || proof.amount_micro <= 0n) {
      return { valid: false, reason: 'amount_micro must be a positive bigint' };
    }

    return { valid: true };
  }
}
