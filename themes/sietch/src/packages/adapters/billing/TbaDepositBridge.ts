/**
 * TbaDepositBridge — On-Chain Deposit → Credit Lot Bridge
 *
 * Bridges verified on-chain ERC-6551 TBA deposits to off-chain credit lots.
 * On-chain verification is MANDATORY before any minting. The bridge:
 *
 *   1. Validates detection data (escrow, chain, token)
 *   2. Checks idempotency (tx_hash UNIQUE)
 *   3. Fetches transaction receipt via RPC
 *   4. Verifies receipt status, block match, finality depth
 *   5. Parses ERC-20 Transfer logs (topic, from, to, amount, token)
 *   6. Looks up agent by TBA address
 *   7. Converts amount (USDC 6 decimals → micro-USD 1:1)
 *   8. Mints credit lot with source_type='tba_deposit' in a single tx
 *   9. Emits TbaDepositBridged event (dual-write via EventConsolidationAdapter)
 *
 * Security: Steps 3-5 are the mandatory on-chain verification gate.
 * No credit lot is ever minted without verified receipt + log match.
 *
 * SDD refs: §4.3 TbaDepositBridge, §4.3.2 Bridge Algorithm, §4.3.3 Config
 * PRD refs: FR-2.4, FR-2.5, G-2, G-5
 * Sprint refs: Sprint 288, Tasks 5.3, 5.5
 *
 * @module adapters/billing/TbaDepositBridge
 */

import { randomUUID } from 'crypto';
import { createPublicClient, http, type PublicClient } from 'viem';
import type Database from 'better-sqlite3';
import { logger } from '../../../utils/logger.js';
import { sqliteTimestamp } from './protocol/timestamps.js';
import { normalizeAddress } from './address-utils.js';
import type { IEconomicEventEmitter } from '../../core/ports/IEconomicEventEmitter.js';
import type { ICreditLedgerService } from '../../core/ports/ICreditLedgerService.js';
import type {
  ITbaDepositBridge,
  DepositDetection,
  DepositBridgeResult,
  TbaDeposit,
  EscrowBalanceResult,
  TbaDepositBridgeConfig,
} from '../../core/ports/ITbaDepositBridge.js';

// =============================================================================
// Constants
// =============================================================================

/** ERC-20 Transfer(address,address,uint256) event topic0 */
const ERC20_TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

/** USDC decimals (6) — 1 USDC raw = 1_000_000 micro-USD (1:1 mapping) */
const USDC_DECIMALS = 6;

// =============================================================================
// Viem Chain Registry (minimal — only chains we actually bridge on)
// =============================================================================

/**
 * Resolve a viem-compatible chain object from chainId.
 * We dynamically import only what we need rather than bundling all chains.
 */
function getChainRpcUrl(chainId: number, rpcUrls?: Record<number, string>): string | undefined {
  return rpcUrls?.[chainId];
}

// =============================================================================
// TbaDepositBridge
// =============================================================================

export class TbaDepositBridge implements ITbaDepositBridge {
  private db: Database.Database;
  private config: TbaDepositBridgeConfig;
  private eventEmitter: IEconomicEventEmitter | null;
  private creditLedger: ICreditLedgerService;
  private clients: Map<number, PublicClient> = new Map();
  private rpcUrls: Record<number, string>;

  constructor(
    db: Database.Database,
    config: TbaDepositBridgeConfig,
    creditLedger: ICreditLedgerService,
    eventEmitter?: IEconomicEventEmitter,
    rpcUrls?: Record<number, string>,
  ) {
    this.db = db;
    this.config = config;
    this.creditLedger = creditLedger;
    this.eventEmitter = eventEmitter ?? null;
    this.rpcUrls = rpcUrls ?? {};
  }

  // ---------------------------------------------------------------------------
  // detectAndBridge — Main bridge algorithm
  // ---------------------------------------------------------------------------

  async detectAndBridge(detection: DepositDetection): Promise<DepositBridgeResult> {
    const { chainId, txHash, tokenAddress, amountRaw, fromAddress, toAddress, blockNumber, logIndex } = detection;

    // Step 1: Validate detection fields
    this.validateDetection(detection);

    // Step 2: Idempotency check — tx_hash UNIQUE
    const existing = this.findByTxHash(txHash);
    if (existing) {
      return this.toResult(existing);
    }

    // Step 3: Insert 'detected' record
    // fromAddress is the TBA that sent the deposit; toAddress is our escrow.
    const depositId = randomUUID();
    const agentAccountId = this.lookupAgentByTba(fromAddress);

    if (!agentAccountId) {
      // Unknown TBA — record as failed
      return this.createFailedDeposit(depositId, detection, null, 'Unknown TBA address: no agent identity bound');
    }

    const now = sqliteTimestamp();
    this.db.prepare(`
      INSERT INTO tba_deposits
        (id, agent_account_id, chain_id, tx_hash, token_address,
         amount_raw, amount_micro, escrow_address, block_number,
         finality_confirmed, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 0, 'detected', ?)
    `).run(depositId, agentAccountId, chainId, txHash, tokenAddress.toLowerCase(),
      amountRaw, toAddress.toLowerCase(), blockNumber, now);

    // Step 4: ON-CHAIN VERIFICATION (mandatory before minting)
    let verificationResult: OnChainVerificationResult;
    try {
      verificationResult = await this.verifyOnChain(detection);
    } catch (err: any) {
      return this.failDeposit(depositId, agentAccountId, `On-chain verification error: ${err.message}`);
    }

    if (!verificationResult.valid) {
      return this.failDeposit(depositId, agentAccountId, verificationResult.reason!);
    }

    // Step 5: Check finality
    if (!verificationResult.finalityReached) {
      // Not yet final — update to 'confirmed' but don't bridge yet
      this.db.prepare(
        `UPDATE tba_deposits SET status = 'confirmed', finality_confirmed = 0 WHERE id = ?`
      ).run(depositId);

      return {
        depositId,
        agentAccountId,
        amountMicro: 0n,
        lotId: null,
        status: 'confirmed',
        errorMessage: null,
        bridgedAt: null,
      };
    }

    // Step 6: Amount conversion — USDC raw (6 decimals) → micro-USD (1:1)
    const amountMicro = BigInt(amountRaw);
    if (amountMicro <= 0n) {
      return this.failDeposit(depositId, agentAccountId, `Invalid amount: ${amountRaw}`);
    }

    // Step 7: Bridge — mint lot + update status in single transaction
    return this.bridgeDeposit(depositId, agentAccountId, amountMicro, detection, verificationResult);
  }

  // ---------------------------------------------------------------------------
  // getDeposit / listDeposits
  // ---------------------------------------------------------------------------

  async getDeposit(depositId: string): Promise<TbaDeposit | null> {
    const row = this.db.prepare(
      `SELECT * FROM tba_deposits WHERE id = ?`
    ).get(depositId) as DepositRow | undefined;

    return row ? this.mapRow(row) : null;
  }

  async listDeposits(agentAccountId: string, opts?: { limit?: number; offset?: number }): Promise<TbaDeposit[]> {
    const limit = Math.min(opts?.limit ?? 20, 100);
    const offset = opts?.offset ?? 0;

    const rows = this.db.prepare(`
      SELECT * FROM tba_deposits
      WHERE agent_account_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(agentAccountId, limit, offset) as DepositRow[];

    return rows.map(r => this.mapRow(r));
  }

  // ---------------------------------------------------------------------------
  // verifyEscrowBalance — Escrow conservation check
  // ---------------------------------------------------------------------------

  async verifyEscrowBalance(chainId: number): Promise<EscrowBalanceResult> {
    const escrowAddress = this.config.escrowAddresses[chainId];
    if (!escrowAddress) {
      throw Object.assign(
        new Error(`No escrow configured for chain ${chainId}`),
        { code: 'VALIDATION_ERROR' },
      );
    }

    // Sum all bridged deposits for this chain
    const creditedRow = this.db.prepare(`
      SELECT COALESCE(SUM(amount_micro), 0) as total
      FROM tba_deposits
      WHERE chain_id = ? AND status = 'bridged'
    `).get(chainId) as { total: number };

    const creditedBalance = BigInt(creditedRow.total);

    // Fetch on-chain escrow balance for each accepted token
    let escrowBalance = 0n;
    const client = this.getOrCreateClient(chainId);

    for (const tokenAddress of this.config.acceptedTokens) {
      try {
        const balance = await client.readContract({
          address: tokenAddress as `0x${string}`,
          abi: ERC20_BALANCE_OF_ABI,
          functionName: 'balanceOf',
          args: [escrowAddress as `0x${string}`],
        });
        // USDC: raw balance = micro-USD (6 decimals, 1:1)
        escrowBalance += balance as bigint;
      } catch (err: any) {
        logger.warn({
          event: 'tba.escrow.balance_error',
          chainId,
          tokenAddress,
          err: err.message,
        }, 'Failed to read escrow token balance');
      }
    }

    const delta = escrowBalance - creditedBalance;

    if (delta < 0n) {
      logger.warn({
        event: 'tba.escrow.deficit',
        chainId,
        escrowBalance: escrowBalance.toString(),
        creditedBalance: creditedBalance.toString(),
        delta: delta.toString(),
      }, 'ESCROW DEFICIT DETECTED: credited exceeds on-chain balance');
    }

    return { escrowBalance, creditedBalance, delta };
  }

  // ---------------------------------------------------------------------------
  // Private: Validation
  // ---------------------------------------------------------------------------

  private validateDetection(detection: DepositDetection): void {
    const { chainId, txHash, tokenAddress, toAddress } = detection;

    // Chain ID must be supported
    if (!this.config.supportedChainIds.includes(chainId)) {
      throw Object.assign(
        new Error(`Unsupported chain: ${chainId}`),
        { code: 'VALIDATION_ERROR' },
      );
    }

    // Token must be accepted
    if (!this.config.acceptedTokens.includes(tokenAddress.toLowerCase())) {
      throw Object.assign(
        new Error(`Token not accepted: ${tokenAddress}`),
        { code: 'VALIDATION_ERROR' },
      );
    }

    // Recipient must be our escrow address
    const expectedEscrow = this.config.escrowAddresses[chainId];
    if (!expectedEscrow || toAddress.toLowerCase() !== expectedEscrow.toLowerCase()) {
      throw Object.assign(
        new Error(`Recipient ${toAddress} does not match escrow ${expectedEscrow}`),
        { code: 'VALIDATION_ERROR' },
      );
    }

    // tx_hash format: 0x + 64 hex chars
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      throw Object.assign(
        new Error(`Invalid transaction hash: ${txHash}`),
        { code: 'VALIDATION_ERROR' },
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Private: On-chain verification
  // ---------------------------------------------------------------------------

  private async verifyOnChain(detection: DepositDetection): Promise<OnChainVerificationResult> {
    const { chainId, txHash, tokenAddress, amountRaw, fromAddress, toAddress, blockNumber, logIndex } = detection;
    const client = this.getOrCreateClient(chainId);

    // Fetch receipt (the authoritative on-chain record)
    const receipt = await client.getTransactionReceipt({
      hash: txHash as `0x${string}`,
    });

    // Check 1: Receipt status must be success
    if (receipt.status !== 'success') {
      return { valid: false, reason: `Transaction failed: status=${receipt.status}`, finalityReached: false };
    }

    // Check 2: Block number must match detection
    if (Number(receipt.blockNumber) !== blockNumber) {
      return {
        valid: false,
        reason: `Block mismatch: receipt=${receipt.blockNumber}, detection=${blockNumber}`,
        finalityReached: false,
      };
    }

    // Check 3: Parse ERC-20 Transfer log
    const transferLog = receipt.logs.find(log => {
      // Must be from the expected token contract
      if (log.address.toLowerCase() !== tokenAddress.toLowerCase()) return false;

      // Must be Transfer event
      if (log.topics[0] !== ERC20_TRANSFER_TOPIC) return false;

      // topics[1] = from (zero-padded to 32 bytes)
      const logFrom = '0x' + log.topics[1]!.slice(26);
      if (logFrom.toLowerCase() !== fromAddress.toLowerCase()) return false;

      // topics[2] = to (zero-padded to 32 bytes)
      const logTo = '0x' + log.topics[2]!.slice(26);
      if (logTo.toLowerCase() !== toAddress.toLowerCase()) return false;

      // log.data = amount (uint256)
      const logAmount = BigInt(log.data);
      if (logAmount.toString() !== amountRaw) return false;

      // If logIndex specified, verify it matches
      if (log.logIndex !== undefined && log.logIndex !== logIndex) return false;

      return true;
    });

    if (!transferLog) {
      return {
        valid: false,
        reason: 'No matching ERC-20 Transfer event found in receipt logs',
        finalityReached: false,
      };
    }

    // Check 4: Finality depth
    const currentBlock = await client.getBlockNumber();
    const confirmations = Number(currentBlock) - blockNumber;
    const finalityReached = confirmations >= this.config.finalityDepth;

    return {
      valid: true,
      finalityReached,
      reason: null,
      receiptHash: receipt.transactionHash,
      verifiedLogIndex: transferLog.logIndex ?? logIndex,
      confirmations,
    };
  }

  // ---------------------------------------------------------------------------
  // Private: Bridge (mint lot + update status)
  // ---------------------------------------------------------------------------

  private bridgeDeposit(
    depositId: string,
    agentAccountId: string,
    amountMicro: bigint,
    detection: DepositDetection,
    verification: OnChainVerificationResult,
  ): DepositBridgeResult {
    const now = sqliteTimestamp();
    const idempotencyKey = `tba_deposit:${detection.txHash}`;

    // Mint credit lot via CreditLedgerService (which runs its own transaction)
    // We need to do this synchronously within a transaction, but mintLot is async.
    // Instead, we create the lot directly in the same transaction pattern as PeerTransferService.
    return this.db.transaction(() => {
      // Re-check status inside transaction (concurrent bridge attempts)
      const current = this.db.prepare(
        `SELECT status FROM tba_deposits WHERE id = ?`
      ).get(depositId) as { status: string } | undefined;

      if (current?.status === 'bridged') {
        const existing = this.db.prepare(
          `SELECT * FROM tba_deposits WHERE id = ?`
        ).get(depositId) as DepositRow;
        return this.toResult(this.mapRow(existing));
      }

      // Create the credit lot directly (same pattern as PeerTransferService)
      const lotId = randomUUID();
      this.db.prepare(`
        INSERT INTO credit_lots
          (id, account_id, pool_id, source_type, source_id,
           original_micro, available_micro, reserved_micro, consumed_micro, created_at)
        VALUES (?, ?, 'general', 'tba_deposit', ?, ?, ?, 0, 0, ?)
      `).run(lotId, agentAccountId, depositId, amountMicro.toString(), amountMicro.toString(), now);

      // Create ledger entry
      const entryId = randomUUID();
      const entrySeq = this.allocateSeq(agentAccountId);
      const postBalance = this.snapshotBalance(agentAccountId);
      const preBalance = postBalance - amountMicro;

      this.db.prepare(`
        INSERT INTO credit_ledger
          (id, account_id, pool_id, lot_id, entry_seq, entry_type,
           amount_micro, idempotency_key, description,
           pre_balance_micro, post_balance_micro, created_at)
        VALUES (?, ?, 'general', ?, ?, 'deposit', ?, ?, ?, ?, ?, ?)
      `).run(
        entryId, agentAccountId, lotId, entrySeq,
        amountMicro.toString(), idempotencyKey,
        `TBA deposit from ${detection.fromAddress}`,
        preBalance.toString(), postBalance.toString(), now,
      );

      // Update balance cache
      this.upsertBalance(agentAccountId);

      // Update deposit record
      const metadata = JSON.stringify({
        receiptHash: verification.receiptHash,
        verifiedLogIndex: verification.verifiedLogIndex,
        confirmations: verification.confirmations,
        verifiedAt: now,
      });

      this.db.prepare(`
        UPDATE tba_deposits
        SET status = 'bridged',
            amount_micro = ?,
            lot_id = ?,
            finality_confirmed = 1,
            metadata = ?,
            bridged_at = ?
        WHERE id = ?
      `).run(amountMicro.toString(), lotId, metadata, now, depositId);

      // Emit TbaDepositBridged event (dual-write)
      if (this.eventEmitter) {
        try {
          this.eventEmitter.emitInTransaction(this.db, {
            eventType: 'TbaDepositBridged',
            entityType: 'account',
            entityId: agentAccountId,
            correlationId: `tba:deposit:${detection.txHash}`,
            idempotencyKey: `tba:bridged:${detection.txHash}`,
            payload: {
              depositId,
              agentAccountId,
              lotId,
              amountMicro: amountMicro.toString(),
              chainId: detection.chainId,
              txHash: detection.txHash,
              fromAddress: detection.fromAddress,
              escrowAddress: detection.toAddress,
              blockNumber: detection.blockNumber,
              timestamp: now,
            },
          });
        } catch {
          logger.warn({ event: 'tba.deposit.event_failed', depositId }, 'TbaDepositBridged event emission failed');
        }
      }

      logger.info({
        event: 'tba.deposit.bridged',
        depositId,
        agentAccountId,
        lotId,
        amountMicro: amountMicro.toString(),
        txHash: detection.txHash,
        chainId: detection.chainId,
      }, 'TBA deposit bridged to credit lot');

      return {
        depositId,
        agentAccountId,
        amountMicro,
        lotId,
        status: 'bridged' as const,
        errorMessage: null,
        bridgedAt: now,
      };
    })();
  }

  // ---------------------------------------------------------------------------
  // Private: Failure paths
  // ---------------------------------------------------------------------------

  private createFailedDeposit(
    depositId: string,
    detection: DepositDetection,
    agentAccountId: string | null,
    errorMessage: string,
  ): DepositBridgeResult {
    const now = sqliteTimestamp();

    this.db.prepare(`
      INSERT OR IGNORE INTO tba_deposits
        (id, agent_account_id, chain_id, tx_hash, token_address,
         amount_raw, amount_micro, escrow_address, block_number,
         finality_confirmed, status, error_message, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 0, 'failed', ?, ?)
    `).run(
      depositId, agentAccountId ?? 'unknown', detection.chainId,
      detection.txHash, detection.tokenAddress.toLowerCase(),
      detection.amountRaw, detection.toAddress.toLowerCase(),
      detection.blockNumber, errorMessage, now,
    );

    // Emit TbaDepositFailed
    if (this.eventEmitter && agentAccountId) {
      try {
        this.eventEmitter.emit({
          eventType: 'TbaDepositFailed',
          entityType: 'account',
          entityId: agentAccountId,
          correlationId: `tba:deposit:${detection.txHash}`,
          idempotencyKey: `tba:failed:${detection.txHash}`,
          payload: {
            depositId,
            agentAccountId,
            errorMessage,
            chainId: detection.chainId,
            txHash: detection.txHash,
            timestamp: now,
          },
        });
      } catch {
        logger.warn({ event: 'tba.deposit.failed_event_error', depositId }, 'TbaDepositFailed event emission failed');
      }
    }

    logger.warn({
      event: 'tba.deposit.failed',
      depositId,
      txHash: detection.txHash,
      errorMessage,
    }, 'TBA deposit failed');

    return {
      depositId,
      agentAccountId: agentAccountId ?? 'unknown',
      amountMicro: 0n,
      lotId: null,
      status: 'failed',
      errorMessage,
      bridgedAt: null,
    };
  }

  private failDeposit(depositId: string, agentAccountId: string, errorMessage: string): DepositBridgeResult {
    const now = sqliteTimestamp();

    this.db.transaction(() => {
      this.db.prepare(`
        UPDATE tba_deposits
        SET status = 'failed', error_message = ?
        WHERE id = ?
      `).run(errorMessage, depositId);

      // Emit TbaDepositFailed within transaction
      if (this.eventEmitter) {
        try {
          this.eventEmitter.emitInTransaction(this.db, {
            eventType: 'TbaDepositFailed',
            entityType: 'account',
            entityId: agentAccountId,
            correlationId: `tba:deposit:${depositId}`,
            idempotencyKey: `tba:failed:${depositId}`,
            payload: {
              depositId,
              agentAccountId,
              errorMessage,
              timestamp: now,
            },
          });
        } catch {
          logger.warn({ event: 'tba.deposit.failed_event_error', depositId }, 'TbaDepositFailed event emission failed');
        }
      }
    })();

    logger.warn({
      event: 'tba.deposit.failed',
      depositId,
      agentAccountId,
      errorMessage,
    }, 'TBA deposit verification failed');

    return {
      depositId,
      agentAccountId,
      amountMicro: 0n,
      lotId: null,
      status: 'failed',
      errorMessage,
      bridgedAt: null,
    };
  }

  // ---------------------------------------------------------------------------
  // Private: Helpers
  // ---------------------------------------------------------------------------

  private findByTxHash(txHash: string): TbaDeposit | null {
    const row = this.db.prepare(
      `SELECT * FROM tba_deposits WHERE tx_hash = ?`
    ).get(txHash) as DepositRow | undefined;

    return row ? this.mapRow(row) : null;
  }

  private lookupAgentByTba(tbaAddress: string): string | null {
    // Use LOWER() for case-insensitive match — Ethereum addresses may be stored
    // as lowercase or EIP-55 checksummed; both representations are valid.
    const row = this.db.prepare(
      `SELECT account_id FROM agent_identity WHERE LOWER(tba_address) = LOWER(?)`
    ).get(tbaAddress.toLowerCase()) as { account_id: string } | undefined;

    return row?.account_id ?? null;
  }

  private getOrCreateClient(chainId: number): PublicClient {
    const existing = this.clients.get(chainId);
    if (existing) return existing;

    const rpcUrl = getChainRpcUrl(chainId, this.rpcUrls);
    const client = createPublicClient({
      transport: http(rpcUrl),
    });

    this.clients.set(chainId, client);
    return client;
  }

  /**
   * Allocate next entry_seq for an account in the general pool.
   * Same pattern as CreditLedgerAdapter.
   */
  private allocateSeq(accountId: string): number {
    const row = this.db.prepare(`
      SELECT COALESCE(MAX(entry_seq), 0) + 1 as next_seq
      FROM credit_ledger
      WHERE account_id = ? AND pool_id = 'general'
    `).get(accountId) as { next_seq: number };
    return row.next_seq;
  }

  /**
   * Snapshot current available balance for the general pool.
   */
  private snapshotBalance(accountId: string): bigint {
    const row = this.db.prepare(`
      SELECT COALESCE(SUM(available_micro), 0) as total
      FROM credit_lots
      WHERE account_id = ? AND pool_id = 'general'
    `).get(accountId) as { total: number };
    return BigInt(row.total);
  }

  /**
   * Upsert balance cache for the general pool.
   */
  private upsertBalance(accountId: string): void {
    const balance = this.snapshotBalance(accountId);
    const reserved = this.db.prepare(`
      SELECT COALESCE(SUM(reserved_micro), 0) as total
      FROM credit_lots
      WHERE account_id = ? AND pool_id = 'general'
    `).get(accountId) as { total: number };

    this.db.prepare(`
      INSERT INTO credit_balances (account_id, pool_id, available_micro, reserved_micro, updated_at)
      VALUES (?, 'general', ?, ?, datetime('now'))
      ON CONFLICT(account_id, pool_id) DO UPDATE SET
        available_micro = excluded.available_micro,
        reserved_micro = excluded.reserved_micro,
        updated_at = excluded.updated_at
    `).run(accountId, balance.toString(), BigInt(reserved.total).toString());
  }

  // ---------------------------------------------------------------------------
  // Private: Row mapping
  // ---------------------------------------------------------------------------

  private mapRow(row: DepositRow): TbaDeposit {
    return {
      id: row.id,
      agentAccountId: row.agent_account_id,
      chainId: row.chain_id,
      txHash: row.tx_hash,
      tokenAddress: row.token_address,
      amountRaw: row.amount_raw,
      amountMicro: BigInt(row.amount_micro),
      lotId: row.lot_id,
      escrowAddress: row.escrow_address,
      blockNumber: row.block_number,
      finalityConfirmed: row.finality_confirmed === 1,
      status: row.status as TbaDeposit['status'],
      errorMessage: row.error_message,
      createdAt: row.created_at,
      bridgedAt: row.bridged_at,
    };
  }

  private toResult(deposit: TbaDeposit): DepositBridgeResult {
    return {
      depositId: deposit.id,
      agentAccountId: deposit.agentAccountId,
      amountMicro: deposit.amountMicro,
      lotId: deposit.lotId,
      status: deposit.status,
      errorMessage: deposit.errorMessage,
      bridgedAt: deposit.bridgedAt,
    };
  }
}

// =============================================================================
// Internal Types
// =============================================================================

interface DepositRow {
  id: string;
  agent_account_id: string;
  chain_id: number;
  tx_hash: string;
  token_address: string;
  amount_raw: string;
  amount_micro: number;
  lot_id: string | null;
  escrow_address: string;
  block_number: number;
  finality_confirmed: number;
  status: string;
  error_message: string | null;
  metadata: string | null;
  created_at: string;
  bridged_at: string | null;
}

interface OnChainVerificationResult {
  valid: boolean;
  finalityReached: boolean;
  reason: string | null;
  receiptHash?: string;
  verifiedLogIndex?: number;
  confirmations?: number;
}

/** Minimal ERC-20 balanceOf ABI for escrow balance checks */
const ERC20_BALANCE_OF_ABI = [
  {
    type: 'function' as const,
    name: 'balanceOf' as const,
    stateMutability: 'view' as const,
    inputs: [{ name: 'account', type: 'address' as const }],
    outputs: [{ name: 'balance', type: 'uint256' as const }],
  },
] as const;
