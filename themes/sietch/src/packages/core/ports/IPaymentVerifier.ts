/**
 * IPaymentVerifier — Payment Proof Verification Port
 *
 * Abstracts payment proof validation for credit pack purchases.
 * Production: verifies on-chain x402 payment receipts.
 * Testing: MockPaymentVerifier accepts structurally valid proofs.
 *
 * Sprint refs: Task 4.5
 *
 * @module packages/core/ports/IPaymentVerifier
 */

// =============================================================================
// PaymentProof — Proof that a payment was made
// =============================================================================

export interface PaymentProof {
  /** Payment reference (tx hash, receipt ID, etc.) */
  reference: string;
  /** Recipient address the payment was sent to */
  recipient_address: string;
  /** Amount paid in micro-USD */
  amount_micro: bigint;
  /** Payer address or ID */
  payer: string;
  /** Chain ID (e.g. 8453 for Base) */
  chain_id: number;
}

// =============================================================================
// Verification Result
// =============================================================================

export interface PaymentVerificationResult {
  /** Whether the proof is valid */
  valid: boolean;
  /** Reason for rejection (only when valid=false) */
  reason?: string;
}

// =============================================================================
// IPaymentVerifier Interface
// =============================================================================

export interface IPaymentVerifier {
  /**
   * Verify a payment proof.
   *
   * @param proof - Payment proof to verify
   * @returns Verification result
   */
  verify(proof: PaymentProof): Promise<PaymentVerificationResult>;
}
