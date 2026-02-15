/**
 * X402PaymentAdapter - x402 USDC Payment Verification
 *
 * Verifies on-chain x402 USDC payments on Base chain with 8-point verification:
 * 1. chainId = 8453 (Base)
 * 2. USDC contract address match
 * 3. Recipient = facilitator address
 * 4. Amount >= expected
 * 5. Minimum confirmations (12)
 * 6. Transaction status = 1 (success)
 * 7. Transaction hash uniqueness (no replay)
 * 8. Transfer event log verification
 *
 * SDD refs: §1.8 x402 Verification
 * Sprint refs: Task 2.3
 *
 * @module packages/adapters/billing/X402PaymentAdapter
 */

import { createPublicClient, http, parseAbiItem, type PublicClient } from 'viem';
import { base } from 'viem/chains';
import type Database from 'better-sqlite3';
import { logger } from '../../../utils/logger.js';

// =============================================================================
// Configuration
// =============================================================================

/** Base chain ID */
const BASE_CHAIN_ID = 8453;

/** USDC on Base — default contract address */
const DEFAULT_USDC_CONTRACT = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

/** Minimum block confirmations before accepting payment */
const DEFAULT_MIN_CONFIRMATIONS = 12;

/** USDC has 6 decimals */
const USDC_DECIMALS = 6;

/** ERC-20 Transfer event signature */
const TRANSFER_EVENT = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)'
);

// =============================================================================
// Types
// =============================================================================

export interface X402VerificationConfig {
  /** Facilitator address that receives USDC payments */
  facilitatorAddress: string;
  /** USDC contract address on Base (default: mainnet USDC) */
  usdcContract?: string;
  /** Minimum block confirmations (default: 12) */
  minConfirmations?: number;
  /** RPC URL override for Base chain */
  rpcUrl?: string;
}

export interface X402VerificationResult {
  /** Whether verification passed all 8 checks */
  valid: boolean;
  /** Transaction hash */
  txHash: string;
  /** Chain ID verified */
  chainId: number;
  /** Sender address */
  from: string;
  /** Recipient address */
  to: string;
  /** USDC amount in token decimals (6) */
  amountRaw: bigint;
  /** USD amount in micro-USD (1 USDC = 1_000_000 micro-USD) */
  amountUsdMicro: bigint;
  /** Block number */
  blockNumber: bigint;
  /** Number of confirmations at verification time */
  confirmations: bigint;
  /** Failure reason (if invalid) */
  failureReason?: string;
}

// =============================================================================
// X402PaymentAdapter
// =============================================================================

export class X402PaymentAdapter {
  private client: PublicClient;
  private db: Database.Database;
  private facilitatorAddress: string;
  private usdcContract: string;
  private minConfirmations: number;

  constructor(db: Database.Database, config: X402VerificationConfig) {
    this.db = db;
    this.facilitatorAddress = config.facilitatorAddress.toLowerCase();
    this.usdcContract = (config.usdcContract ?? DEFAULT_USDC_CONTRACT).toLowerCase();
    this.minConfirmations = config.minConfirmations ?? DEFAULT_MIN_CONFIRMATIONS;

    this.client = createPublicClient({
      chain: base,
      transport: http(config.rpcUrl),
    });
  }

  /**
   * Verify an x402 USDC payment on Base chain.
   * Performs all 8 verification checks per SDD §1.8.
   */
  async verifyPayment(
    txHash: string,
    expectedAmountUsdMicro: bigint,
  ): Promise<X402VerificationResult> {
    const txHashLower = txHash.toLowerCase() as `0x${string}`;

    // Check 7: Transaction hash uniqueness (before expensive RPC calls)
    const existingPayment = this.db.prepare(
      `SELECT id FROM crypto_payments
       WHERE provider = 'x402' AND provider_payment_id = ?`
    ).get(txHashLower);

    if (existingPayment) {
      return {
        valid: false,
        txHash: txHashLower,
        chainId: BASE_CHAIN_ID,
        from: '',
        to: '',
        amountRaw: 0n,
        amountUsdMicro: 0n,
        blockNumber: 0n,
        confirmations: 0n,
        failureReason: 'Transaction hash already used (replay detected)',
      };
    }

    try {
      // Fetch transaction and receipt in parallel
      const [tx, receipt] = await Promise.all([
        this.client.getTransaction({ hash: txHashLower }),
        this.client.getTransactionReceipt({ hash: txHashLower }),
      ]);

      // Check 1: chainId = 8453 (Base)
      if (tx.chainId !== BASE_CHAIN_ID) {
        return this.fail(txHashLower, `Wrong chain: expected ${BASE_CHAIN_ID}, got ${tx.chainId}`);
      }

      // Check 6: Transaction status = 1 (success)
      if (receipt.status !== 'success') {
        return this.fail(txHashLower, `Transaction failed: status=${receipt.status}`);
      }

      // Check 2: USDC contract address match
      if (tx.to?.toLowerCase() !== this.usdcContract) {
        return this.fail(txHashLower,
          `Wrong contract: expected ${this.usdcContract}, got ${tx.to}`);
      }

      // Check 8: Transfer event log verification
      const transferLog = receipt.logs.find(log => {
        if (log.address.toLowerCase() !== this.usdcContract) return false;
        try {
          // Check if this is a Transfer event to our facilitator
          if (log.topics[0] !== '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef') {
            return false;
          }
          // topics[2] is the 'to' address (zero-padded)
          const toAddress = '0x' + log.topics[2]!.slice(26);
          return toAddress.toLowerCase() === this.facilitatorAddress;
        } catch {
          return false;
        }
      });

      if (!transferLog) {
        return this.fail(txHashLower,
          'No USDC Transfer event to facilitator found in transaction logs');
      }

      // Extract amount from log data (uint256)
      const amountRaw = BigInt(transferLog.data);
      const fromAddress = '0x' + transferLog.topics[1]!.slice(26);

      // Check 3: Recipient = facilitator address (verified above in log search)

      // Check 4: Amount >= expected (convert USDC 6 decimals to micro-USD)
      // 1 USDC (10^6 raw) = 1_000_000 micro-USD — direct 1:1 mapping
      const amountUsdMicro = amountRaw;

      if (amountUsdMicro < expectedAmountUsdMicro) {
        return this.fail(txHashLower,
          `Under-payment: expected ${expectedAmountUsdMicro} micro-USD, got ${amountUsdMicro}`);
      }

      // Check 5: Minimum confirmations
      const currentBlock = await this.client.getBlockNumber();
      const confirmations = currentBlock - receipt.blockNumber;

      if (confirmations < BigInt(this.minConfirmations)) {
        return this.fail(txHashLower,
          `Insufficient confirmations: ${confirmations}/${this.minConfirmations}`);
      }

      logger.info({
        event: 'billing.x402.verified',
        txHash: txHashLower,
        from: fromAddress,
        amountUsdMicro: amountUsdMicro.toString(),
        confirmations: confirmations.toString(),
      }, 'x402 payment verified');

      return {
        valid: true,
        txHash: txHashLower,
        chainId: BASE_CHAIN_ID,
        from: fromAddress.toLowerCase(),
        to: this.facilitatorAddress,
        amountRaw,
        amountUsdMicro,
        blockNumber: receipt.blockNumber,
        confirmations,
      };
    } catch (err) {
      logger.error({
        event: 'billing.x402.verification_error',
        txHash: txHashLower,
        err,
      }, 'x402 verification failed');

      return this.fail(txHashLower,
        err instanceof Error ? err.message : 'Unknown verification error');
    }
  }

  private fail(txHash: string, reason: string): X402VerificationResult {
    logger.warn({
      event: 'billing.x402.rejected',
      txHash,
      reason,
    }, `x402 payment rejected: ${reason}`);

    return {
      valid: false,
      txHash,
      chainId: BASE_CHAIN_ID,
      from: '',
      to: '',
      amountRaw: 0n,
      amountUsdMicro: 0n,
      blockNumber: 0n,
      confirmations: 0n,
      failureReason: reason,
    };
  }
}
