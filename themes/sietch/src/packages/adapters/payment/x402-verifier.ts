/**
 * x402 Payment Verification Adapter — Stub Implementation
 *
 * Stub that logs payment proofs but always returns invalid.
 * Real implementation would integrate @x402/hono middleware or
 * on-chain transaction verification via viem.
 *
 * Integration point: when @x402/hono becomes available, replace this
 * with an adapter that calls the x402 verification middleware.
 *
 * Sprint refs: Task 5.2
 *
 * @module packages/adapters/payment/x402-verifier
 */

import type {
  IPaymentVerifier,
  PaymentProof,
  PaymentVerificationResult,
} from '../../core/ports/IPaymentVerifier.js';
import { logger } from '../../../utils/logger.js';

export class X402PaymentVerifier implements IPaymentVerifier {
  async verify(proof: PaymentProof): Promise<PaymentVerificationResult> {
    logger.info({
      event: 'x402.verify.stub',
      reference: proof.reference,
      recipient: proof.recipient_address,
      amount_micro: proof.amount_micro.toString(),
      chain_id: proof.chain_id,
    }, 'x402 payment proof received (stub — not yet verified on-chain)');

    // Stub: always rejects until real on-chain verification is implemented.
    // Replace this with actual verification when @x402/hono is wired in.
    return {
      valid: false,
      reason: 'x402 verification not yet implemented — use mock verifier',
    };
  }
}
