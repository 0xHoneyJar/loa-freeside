/**
 * ITbaDepositBridge — TBA Deposit Bridge Port
 *
 * Defines the contract for bridging on-chain ERC-6551 TBA deposits
 * to off-chain credit lots. On-chain verification is MANDATORY
 * before any credit lot minting.
 *
 * SDD refs: §4.3 TbaDepositBridge, §4.3.1 Interface
 * PRD refs: FR-2.4, FR-2.5, G-2
 *
 * @module core/ports/ITbaDepositBridge
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Detection data from on-chain event monitoring.
 * Populated by the chain watcher before bridge processing.
 */
export interface DepositDetection {
  /** Blockchain chain ID (e.g., 1 for Ethereum mainnet) */
  chainId: number;
  /** On-chain transaction hash (0x-prefixed, 66 chars) */
  txHash: string;
  /** ERC-20 token contract address */
  tokenAddress: string;
  /** Raw token amount (full precision, as string to avoid overflow) */
  amountRaw: string;
  /** Sender address (the depositor) */
  fromAddress: string;
  /** Recipient address (the TBA / escrow) */
  toAddress: string;
  /** Block number where the deposit was mined */
  blockNumber: number;
  /** Log index within the transaction receipt */
  logIndex: number;
}

/**
 * Result of a deposit bridge operation.
 */
export interface DepositBridgeResult {
  /** Deposit record ID */
  depositId: string;
  /** Agent account that received the credit */
  agentAccountId: string;
  /** Amount credited in micro-USD */
  amountMicro: bigint;
  /** Credit lot ID (only if status === 'bridged') */
  lotId: string | null;
  /** Deposit status */
  status: 'detected' | 'confirmed' | 'bridged' | 'failed';
  /** Error message (only if status === 'failed') */
  errorMessage: string | null;
  /** Bridge timestamp (only if status === 'bridged') */
  bridgedAt: string | null;
}

/**
 * Stored deposit record.
 */
export interface TbaDeposit {
  id: string;
  agentAccountId: string;
  chainId: number;
  txHash: string;
  tokenAddress: string;
  amountRaw: string;
  amountMicro: bigint;
  lotId: string | null;
  escrowAddress: string;
  blockNumber: number;
  finalityConfirmed: boolean;
  status: 'detected' | 'confirmed' | 'bridged' | 'failed';
  errorMessage: string | null;
  createdAt: string;
  bridgedAt: string | null;
}

/**
 * Escrow balance verification result.
 */
export interface EscrowBalanceResult {
  /** On-chain escrow token balance in micro-USD */
  escrowBalance: bigint;
  /** Sum of bridged deposits in micro-USD */
  creditedBalance: bigint;
  /** escrowBalance - creditedBalance (should be >= 0 for non-redeemable) */
  delta: bigint;
}

/**
 * Configuration for the TBA Deposit Bridge.
 * Per SDD §4.3.3 TbaDepositBridgeConfig.
 */
export interface TbaDepositBridgeConfig {
  /** Accepted token addresses (lowercase, EIP-55) */
  acceptedTokens: string[];
  /** Escrow contract address per chain */
  escrowAddresses: Record<number, string>;
  /** Required finality depth (blocks) */
  finalityDepth: number;
  /** Deployment chain IDs */
  supportedChainIds: number[];
}

// =============================================================================
// Port Interface
// =============================================================================

export interface ITbaDepositBridge {
  /**
   * Detect and bridge an on-chain deposit to a credit lot.
   *
   * Full algorithm:
   *   validate → idempotency check → on-chain verification → agent lookup →
   *   amount conversion → mint lot → update status → emit events
   *
   * On-chain verification is MANDATORY before minting.
   */
  detectAndBridge(detection: DepositDetection): Promise<DepositBridgeResult>;

  /**
   * Get a deposit record by ID.
   */
  getDeposit(depositId: string): Promise<TbaDeposit | null>;

  /**
   * List deposits for an agent account.
   */
  listDeposits(agentAccountId: string, opts?: { limit?: number; offset?: number }): Promise<TbaDeposit[]>;

  /**
   * Verify escrow balance consistency.
   * Compares on-chain escrow token balance against sum of bridged deposits.
   */
  verifyEscrowBalance(chainId: number): Promise<EscrowBalanceResult>;
}
