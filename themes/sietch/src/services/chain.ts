import {
  createPublicClient,
  http,
  fallback,
  isAddress,
  type Address,
  type PublicClient,
  type AbiEvent,
} from 'viem';
import { berachain } from 'viem/chains';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import type { EligibilityEntry, BurnEvent } from '../types/index.js';
import {
  HybridChainProvider,
  createChainProvider,
  type BalanceWithUSD,
} from '@arrakis/adapters/chain';

/**
 * Transfer event ABI from BGT token
 * Used to detect burns (transfers to 0x0) and incoming transfers
 */
const TRANSFER_EVENT = {
  type: 'event',
  name: 'Transfer',
  inputs: [
    { name: 'from', type: 'address', indexed: true },
    { name: 'to', type: 'address', indexed: true },
    { name: 'value', type: 'uint256', indexed: false },
  ],
} as const satisfies AbiEvent;

/**
 * ERC20 balanceOf ABI for querying BGT holdings
 */
const BALANCE_OF_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: 'balance', type: 'uint256' }],
  },
] as const;

/**
 * Zero address for burn detection
 */
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

/**
 * Block range for paginated log queries
 * Berachain RPC limits eth_getLogs to 10,000 blocks max
 */
const BLOCK_RANGE = 10000n;

/**
 * Berachain chain ID
 */
const BERACHAIN_CHAIN_ID = 80094;

/**
 * RPC endpoint health tracking
 */
interface RpcEndpointHealth {
  url: string;
  failureCount: number;
  lastFailure: Date | null;
  isHealthy: boolean;
}

/**
 * Top holders result from Dune Sim Token Holders API
 */
interface TopHoldersResult {
  holders: Array<{
    address: Address;
    balance: bigint;
    rank: number;
  }>;
  totalHolders: number;
}

/**
 * Chain Service
 *
 * Sprint 17: Dune Sim Migration
 *
 * Queries Berachain to fetch BGT eligibility data. Supports two modes:
 *
 * 1. **Dune Sim Mode** (hybrid/dune_sim): Uses Token Holders API for pre-ranked
 *    holder lists with RPC fallback for burn detection. Much faster and simpler.
 *
 * 2. **RPC Mode** (rpc): Uses direct viem RPC calls for full backward compatibility.
 *
 * Eligibility is determined by:
 * 1. BGT balance (via balanceOf on BGT token) - how much BGT a wallet holds
 * 2. Burn history (Transfer events to 0x0) - wallets that have EVER burned BGT are ineligible
 *
 * Supports multiple RPC endpoints with automatic fallback.
 */
class ChainService {
  private client: PublicClient;
  private rpcHealth: Map<string, RpcEndpointHealth> = new Map();
  private currentRpcIndex: number = 0;

  // Dune Sim provider (Sprint 17)
  private provider: HybridChainProvider | null = null;
  private providerMode: 'rpc' | 'dune_sim' | 'hybrid';

  constructor() {
    // Initialize health tracking for all configured RPCs
    for (const url of config.chain.rpcUrls) {
      this.rpcHealth.set(url, {
        url,
        failureCount: 0,
        lastFailure: null,
        isHealthy: true,
      });
    }

    // Create fallback transport with all configured RPCs
    const transports = config.chain.rpcUrls.map((url) =>
      http(url, {
        timeout: 30000, // 30 second timeout
        retryCount: 2,
        retryDelay: 1000,
      })
    );

    this.client = createPublicClient({
      chain: berachain,
      transport: fallback(transports, {
        rank: true, // Use fastest endpoint
        retryCount: 3,
        retryDelay: 1000,
      }),
    });

    // Initialize Dune Sim provider if configured (Sprint 17)
    this.providerMode = config.chain.provider;
    if (this.providerMode === 'hybrid' || this.providerMode === 'dune_sim') {
      try {
        const result = createChainProvider(logger, { mode: this.providerMode });
        this.provider = result.provider as HybridChainProvider;
        logger.info(
          { mode: result.mode, configSummary: result.configSummary },
          'Dune Sim provider initialized for Sietch chain service'
        );
      } catch (error) {
        logger.warn(
          { error: (error as Error).message, mode: this.providerMode },
          'Failed to initialize Dune Sim provider, falling back to RPC'
        );
        this.providerMode = 'rpc';
        this.provider = null;
      }
    }

    logger.info(
      {
        rpcUrls: config.chain.rpcUrls,
        count: config.chain.rpcUrls.length,
        providerMode: this.providerMode,
        duneSimEnabled: this.provider !== null,
      },
      'Chain service initialized'
    );
  }

  /**
   * Get the current provider mode
   */
  getProviderMode(): 'rpc' | 'dune_sim' | 'hybrid' {
    return this.providerMode;
  }

  /**
   * Check if Dune Sim provider is available
   */
  isDuneSimAvailable(): boolean {
    return this.provider !== null;
  }

  /**
   * Get health status of all RPC endpoints
   */
  getRpcHealth(): RpcEndpointHealth[] {
    return Array.from(this.rpcHealth.values());
  }

  /**
   * Mark an RPC endpoint as failed
   */
  private markRpcFailed(url: string): void {
    const health = this.rpcHealth.get(url);
    if (health) {
      health.failureCount++;
      health.lastFailure = new Date();
      // Mark unhealthy after 3 consecutive failures
      if (health.failureCount >= 3) {
        health.isHealthy = false;
        logger.warn({ url, failureCount: health.failureCount }, 'RPC endpoint marked unhealthy');
      }
    }
  }

  /**
   * Reset RPC endpoint health on success
   */
  private markRpcHealthy(url: string): void {
    const health = this.rpcHealth.get(url);
    if (health && !health.isHealthy) {
      health.failureCount = 0;
      health.isHealthy = true;
      logger.info({ url }, 'RPC endpoint recovered');
    }
  }

  // ==========================================================================
  // Dune Sim Methods (Sprint 17)
  // ==========================================================================

  /**
   * Get top BGT holders using Dune Sim Token Holders API
   *
   * Returns pre-ranked holders sorted by balance descending.
   * This is the key optimization - replaces complex Transfer event
   * scanning + multicall balance queries with a single API call.
   *
   * @param limit - Maximum number of holders to return (default: 100)
   * @returns Pre-ranked holders with balances
   * @throws Error if Dune Sim provider is not available
   */
  async getTopBgtHolders(limit: number = 100): Promise<TopHoldersResult> {
    if (!this.provider) {
      throw new Error('Token Holders API not available - Dune Sim provider not configured');
    }

    const result = await this.provider.getTopTokenHolders(
      config.chain.bgtAddress as Address,
      {
        chainId: BERACHAIN_CHAIN_ID,
        limit,
        decimals: 18, // BGT uses 18 decimals (MEDIUM-4 remediation)
      }
    );

    return {
      holders: result.holders.map((h) => ({
        address: h.address as Address,
        balance: h.balance,
        rank: h.rank,
      })),
      totalHolders: result.totalHolders,
    };
  }

  /**
   * Validate Ethereum address at runtime (MEDIUM-2 remediation)
   * @throws Error if address is invalid
   */
  private validateAddress(address: string): Address {
    if (!isAddress(address)) {
      throw new Error(`Invalid Ethereum address: ${address}`);
    }
    return address as Address;
  }

  /**
   * Get wallet BGT balance with USD pricing (Dune Sim exclusive)
   *
   * @param address - Wallet address to check
   * @returns Balance with USD pricing information
   * @throws Error if Dune Sim provider is not available or address is invalid
   */
  async getWalletBgtBalanceWithUSD(address: Address): Promise<BalanceWithUSD> {
    // Input validation (MEDIUM-2 remediation)
    this.validateAddress(address);

    if (!this.provider) {
      throw new Error('Balance with USD not available - Dune Sim provider not configured');
    }

    return this.provider.getBalanceWithUSD(
      BERACHAIN_CHAIN_ID,
      address,
      config.chain.bgtAddress as Address
    );
  }

  /**
   * Fetch burned wallets as a Set (helper for Dune Sim flow)
   *
   * Queries RPC for Transfer events to 0x0 and returns the set
   * of wallet addresses that have ever burned BGT.
   */
  async fetchBurnedWalletsSet(): Promise<Set<string>> {
    const burnEvents = await this.fetchBurnEvents();
    const burnedWallets = new Set<string>();
    for (const burn of burnEvents) {
      burnedWallets.add(burn.from.toLowerCase());
    }
    return burnedWallets;
  }

  // ==========================================================================
  // Main Eligibility Methods
  // ==========================================================================

  /**
   * Fetch complete eligibility data from chain
   *
   * Automatically uses Dune Sim Token Holders API when available,
   * falling back to RPC-based approach if not configured.
   *
   * @returns Sorted list of eligible wallets (no burns, sorted by BGT held desc)
   */
  async fetchEligibilityData(): Promise<EligibilityEntry[]> {
    // Use Dune Sim if available
    if (this.provider) {
      return this.fetchEligibilityDataViaDuneSim();
    }

    // Fallback to RPC-based approach
    return this.fetchEligibilityDataViaRPC();
  }

  /**
   * Fetch eligibility data using Dune Sim Token Holders API
   *
   * New simplified flow (Sprint 17):
   * 1. Get top 100 holders from Token Holders API (pre-ranked!)
   * 2. Get burned wallets from RPC (reliable historical data)
   * 3. Filter out burned wallets
   * 4. Take top 69 and assign roles
   *
   * Performance: ~500ms vs 2-5 seconds with RPC
   */
  private async fetchEligibilityDataViaDuneSim(): Promise<EligibilityEntry[]> {
    logger.info({ mode: 'dune_sim' }, 'Fetching eligibility via Dune Sim Token Holders API');

    const startTime = Date.now();

    // 1. Get top 100 holders (need extra for burn filtering)
    const { holders, totalHolders } = await this.getTopBgtHolders(100);

    // 2. Get burned wallets (keep RPC - reliable historical data)
    const burnedWallets = await this.fetchBurnedWalletsSet();

    // 3. Filter out burned wallets and take top 69
    const eligible = holders
      .filter((h) => !burnedWallets.has(h.address.toLowerCase()))
      .slice(0, 69)
      .map((holder, idx) => ({
        address: holder.address,
        bgtClaimed: holder.balance,
        bgtBurned: 0n,
        bgtHeld: holder.balance,
        rank: idx + 1,
        role: (idx < 7 ? 'naib' : 'fedaykin') as 'naib' | 'fedaykin' | 'none',
      }));

    const duration = Date.now() - startTime;

    logger.info(
      {
        mode: 'dune_sim',
        totalHolders,
        holdersChecked: holders.length,
        burnedFiltered: holders.length - eligible.length,
        eligible: eligible.length,
        naib: eligible.filter((e) => e.role === 'naib').length,
        fedaykin: eligible.filter((e) => e.role === 'fedaykin').length,
        durationMs: duration,
      },
      'Eligibility data fetched via Dune Sim'
    );

    return eligible;
  }

  /**
   * Fetch eligibility data using RPC (fallback path)
   *
   * Original RPC-based flow:
   * 1. Get all wallets that have ever received BGT (Transfer events TO addresses)
   * 2. Get all wallets that have ever burned BGT (Transfer events to 0x0)
   * 3. Filter out wallets that have burned (ineligible forever)
   * 4. Query current balanceOf for remaining wallets
   * 5. Sort by BGT held and assign ranks/roles
   *
   * @returns Sorted list of eligible wallets (no burns, sorted by BGT held desc)
   */
  private async fetchEligibilityDataViaRPC(): Promise<EligibilityEntry[]> {
    logger.info({ mode: 'rpc' }, 'Fetching eligibility via RPC (fallback)');

    const startTime = Date.now();

    // 1. Get all BGT burn events (transfers to 0x0)
    // These wallets are permanently ineligible
    const burnEvents = await this.fetchBurnEvents();
    const burnedWallets = new Set<string>();
    let totalBurned = 0n;
    for (const burn of burnEvents) {
      burnedWallets.add(burn.from.toLowerCase());
      totalBurned += burn.amount;
    }
    logger.info(
      { burnedWalletCount: burnedWallets.size, totalBurnedWei: totalBurned.toString() },
      'Fetched burn events - these wallets are ineligible'
    );

    // 2. Get all wallets that have ever received BGT
    const receivedWallets = await this.fetchBgtRecipients();
    logger.info({ count: receivedWallets.size }, 'Found wallets that have received BGT');

    // 3. Filter out wallets that have burned
    const eligibleAddresses: Address[] = [];
    for (const address of receivedWallets) {
      if (!burnedWallets.has(address.toLowerCase())) {
        eligibleAddresses.push(address as Address);
      }
    }
    logger.info(
      { eligible: eligibleAddresses.length, filtered: receivedWallets.size - eligibleAddresses.length },
      'Filtered eligible wallets (no burns)'
    );

    // 4. Query current balances for eligible wallets
    const walletData = await this.fetchBalances(eligibleAddresses);
    logger.info({ wallets: walletData.length }, 'Fetched current balances');

    // 5. Filter out zero balances and sort by BGT held descending
    const nonZeroWallets = walletData.filter((w) => w.bgtHeld > 0n);
    nonZeroWallets.sort((a, b) => {
      if (b.bgtHeld > a.bgtHeld) return 1;
      if (b.bgtHeld < a.bgtHeld) return -1;
      return 0;
    });

    // 6. Assign ranks and roles
    const ranked = this.assignRanksAndRoles(nonZeroWallets);

    const duration = Date.now() - startTime;

    logger.info(
      {
        mode: 'rpc',
        totalEligible: ranked.length,
        naib: ranked.filter((w) => w.role === 'naib').length,
        fedaykin: ranked.filter((w) => w.role === 'fedaykin').length,
        durationMs: duration,
      },
      'Eligibility data fetch complete (RPC)'
    );

    return ranked;
  }

  // ==========================================================================
  // RPC Methods (kept for burn detection and fallback)
  // ==========================================================================

  /**
   * Fetch all wallets that have ever received BGT
   * Queries Transfer events where 'to' is not 0x0
   *
   * Uses startBlock from config to limit historical queries.
   * Default behavior: query last 50K blocks if startBlock is 0.
   */
  async fetchBgtRecipients(): Promise<Set<Address>> {
    const currentBlock = await this.client.getBlockNumber();
    const recipients = new Set<Address>();

    // Use configured start block, or default to last 50K blocks
    // 50K / 10K batches = 5 RPC requests
    const DEFAULT_LOOKBACK = 50_000n;
    let fromBlock: bigint;
    if (config.chain.startBlock > 0) {
      fromBlock = BigInt(config.chain.startBlock);
    } else {
      fromBlock = currentBlock > DEFAULT_LOOKBACK ? currentBlock - DEFAULT_LOOKBACK : 0n;
    }

    logger.info({ fromBlock: fromBlock.toString(), currentBlock: currentBlock.toString() }, 'Fetching BGT recipients from Transfer events');

    while (fromBlock <= currentBlock) {
      const endBlock = fromBlock + BLOCK_RANGE - 1n > currentBlock ? currentBlock : fromBlock + BLOCK_RANGE - 1n;

      try {
        const batchLogs = await this.client.getLogs({
          address: config.chain.bgtAddress as Address,
          event: TRANSFER_EVENT,
          fromBlock,
          toBlock: endBlock,
        });

        for (const log of batchLogs) {
          // Only track recipients (not burns to 0x0)
          if (log.args.to && log.args.to !== ZERO_ADDRESS) {
            recipients.add(log.args.to.toLowerCase() as Address);
          }
        }

        logger.debug(
          { fromBlock: fromBlock.toString(), toBlock: endBlock.toString(), count: batchLogs.length, uniqueRecipients: recipients.size },
          'Fetched Transfer log batch'
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.warn({ fromBlock: fromBlock.toString(), toBlock: endBlock.toString(), error: errorMessage }, 'Error fetching Transfer logs');
        throw new Error(`Failed to fetch Transfer logs: ${errorMessage}`);
      }

      fromBlock = endBlock + 1n;

      // Small delay between batches to avoid rate limiting
      if (fromBlock <= currentBlock) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    return recipients;
  }

  /**
   * Fetch current BGT balances for a list of addresses
   * Uses multicall for efficiency
   */
  async fetchBalances(addresses: Address[]): Promise<EligibilityEntry[]> {
    if (addresses.length === 0) {
      return [];
    }

    const entries: EligibilityEntry[] = [];
    const batchSize = 100; // Multicall batch size

    for (let i = 0; i < addresses.length; i += batchSize) {
      const batch = addresses.slice(i, i + batchSize);

      try {
        const results = await this.client.multicall({
          contracts: batch.map((address) => ({
            address: config.chain.bgtAddress as Address,
            abi: BALANCE_OF_ABI,
            functionName: 'balanceOf',
            args: [address],
          })),
        });

        for (let j = 0; j < batch.length; j++) {
          const result = results[j];
          const batchAddress = batch[j];
          if (result && result.status === 'success' && batchAddress) {
            const balance = result.result as bigint;
            entries.push({
              address: batchAddress,
              bgtClaimed: balance, // Using balance as "claimed" for backwards compatibility
              bgtBurned: 0n, // We already filtered out burners
              bgtHeld: balance,
              role: 'none' as const,
            });
          }
        }

        logger.debug(
          { batchStart: i, batchEnd: i + batch.length, successful: entries.length },
          'Fetched balance batch'
        );
      } catch (error) {
        logger.warn({ batchStart: i, error }, 'Error fetching balance batch');
        throw error;
      }
    }

    return entries;
  }

  /**
   * Fetch Transfer events to 0x0 (burns) from BGT token
   */
  async fetchBurnEvents(): Promise<BurnEvent[]> {
    const currentBlock = await this.client.getBlockNumber();

    return this.fetchTransferLogs(
      config.chain.bgtAddress as Address,
      currentBlock,
      ZERO_ADDRESS
    );
  }

  /**
   * Fetch Transfer logs with pagination (for burns)
   * Uses startBlock from config to limit historical queries.
   */
  private async fetchTransferLogs(
    address: Address,
    toBlock: bigint,
    toAddress: Address
  ): Promise<BurnEvent[]> {
    const events: BurnEvent[] = [];

    // Use configured start block, or default to last 50K blocks
    const DEFAULT_LOOKBACK = 50_000n;
    let fromBlock: bigint;
    if (config.chain.startBlock > 0) {
      fromBlock = BigInt(config.chain.startBlock);
    } else {
      fromBlock = toBlock > DEFAULT_LOOKBACK ? toBlock - DEFAULT_LOOKBACK : 0n;
    }

    logger.info({ fromBlock: fromBlock.toString(), toBlock: toBlock.toString() }, 'Fetching burn events from Transfer logs');

    while (fromBlock <= toBlock) {
      const endBlock = fromBlock + BLOCK_RANGE - 1n > toBlock ? toBlock : fromBlock + BLOCK_RANGE - 1n;

      try {
        const batchLogs = await this.client.getLogs({
          address,
          event: TRANSFER_EVENT,
          args: { to: toAddress },
          fromBlock,
          toBlock: endBlock,
        });

        for (const log of batchLogs) {
          if (log.args.from && log.args.value !== undefined) {
            events.push({
              from: log.args.from,
              amount: log.args.value,
            });
          }
        }

        logger.debug(
          { fromBlock, toBlock: endBlock, count: batchLogs.length },
          'Fetched Transfer log batch'
        );
      } catch (error) {
        logger.warn(
          { fromBlock, toBlock: endBlock, error },
          'Error fetching Transfer logs'
        );
        throw error;
      }

      fromBlock = endBlock + 1n;
    }

    return events;
  }

  /**
   * Check if a specific wallet has ever burned BGT
   * Uses startBlock from config to limit historical queries.
   *
   * @param address - Wallet address to check
   * @returns true if the wallet has burned any BGT, false otherwise
   * @throws Error if address is invalid
   */
  async hasWalletBurnedBgt(address: Address): Promise<boolean> {
    // Input validation (MEDIUM-2 remediation)
    this.validateAddress(address);

    const currentBlock = await this.client.getBlockNumber();

    // Use configured start block, or default to last 50K blocks
    const DEFAULT_LOOKBACK = 50_000n;
    let fromBlock: bigint;
    if (config.chain.startBlock > 0) {
      fromBlock = BigInt(config.chain.startBlock);
    } else {
      fromBlock = currentBlock > DEFAULT_LOOKBACK ? currentBlock - DEFAULT_LOOKBACK : 0n;
    }

    while (fromBlock <= currentBlock) {
      const endBlock = fromBlock + BLOCK_RANGE - 1n > currentBlock ? currentBlock : fromBlock + BLOCK_RANGE - 1n;

      try {
        const logs = await this.client.getLogs({
          address: config.chain.bgtAddress as Address,
          event: TRANSFER_EVENT,
          args: { from: address, to: ZERO_ADDRESS },
          fromBlock,
          toBlock: endBlock,
        });

        // If we find any burn event, return true immediately
        if (logs.length > 0) {
          return true;
        }
      } catch (error) {
        logger.warn({ address, fromBlock, toBlock: endBlock, error }, 'Error checking burn history');
        throw error;
      }

      fromBlock = endBlock + 1n;
    }

    return false;
  }

  /**
   * Get the current BGT balance for a specific wallet
   *
   * @param address - Wallet address to check
   * @returns BGT balance in wei
   * @throws Error if address is invalid
   */
  async getWalletBgtBalance(address: Address): Promise<bigint> {
    // Input validation (MEDIUM-2 remediation)
    this.validateAddress(address);

    // Use Dune Sim if available for faster response
    if (this.provider) {
      try {
        const balance = await this.provider.getBalance(
          BERACHAIN_CHAIN_ID,
          address,
          config.chain.bgtAddress as Address
        );
        return balance;
      } catch (error) {
        logger.warn({ address, error: (error as Error).message }, 'Dune Sim balance check failed, falling back to RPC');
      }
    }

    // RPC fallback
    try {
      const balance = await this.client.readContract({
        address: config.chain.bgtAddress as Address,
        abi: BALANCE_OF_ABI,
        functionName: 'balanceOf',
        args: [address],
      });
      return balance as bigint;
    } catch (error) {
      logger.warn({ address, error }, 'Error fetching BGT balance');
      throw error;
    }
  }

  /**
   * Check eligibility for a specific wallet
   * A wallet is eligible if:
   * 1. It has a non-zero BGT balance
   * 2. It has NEVER burned any BGT
   *
   * @param address - Wallet address to check
   * @returns Eligibility entry or null if ineligible
   * @throws Error if address is invalid
   */
  async checkWalletEligibility(address: Address): Promise<EligibilityEntry | null> {
    // Input validation (MEDIUM-2 remediation)
    this.validateAddress(address);

    // First check if they've ever burned BGT
    const hasBurned = await this.hasWalletBurnedBgt(address);
    if (hasBurned) {
      logger.debug({ address }, 'Wallet has burned BGT - ineligible');
      return null;
    }

    // Then check their current balance
    const balance = await this.getWalletBgtBalance(address);
    if (balance === 0n) {
      logger.debug({ address }, 'Wallet has zero BGT balance - ineligible');
      return null;
    }

    return {
      address,
      bgtClaimed: balance,
      bgtBurned: 0n,
      bgtHeld: balance,
      role: 'none',
    };
  }

  /**
   * Assign ranks (1-69) and roles (naib/fedaykin/none) to sorted wallets
   */
  private assignRanksAndRoles(sortedWallets: EligibilityEntry[]): EligibilityEntry[] {
    return sortedWallets.map((wallet, index) => {
      const rank = index + 1;
      let role: 'naib' | 'fedaykin' | 'none' = 'none';

      if (rank <= 7) {
        role = 'naib';
      } else if (rank <= 69) {
        role = 'fedaykin';
      }

      return {
        ...wallet,
        rank: rank <= 69 ? rank : undefined,
        role,
      };
    });
  }

  /**
   * Get current block number
   */
  async getCurrentBlock(): Promise<bigint> {
    return this.client.getBlockNumber();
  }

  /**
   * Check if RPC is healthy
   */
  async isHealthy(): Promise<boolean> {
    try {
      await this.client.getBlockNumber();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get detailed health status including Dune Sim
   */
  async getDetailedHealth(): Promise<{
    healthy: boolean;
    rpc: { healthy: boolean };
    duneSim: { available: boolean; mode: string };
  }> {
    const rpcHealthy = await this.isHealthy();
    return {
      healthy: rpcHealthy || this.provider !== null,
      rpc: { healthy: rpcHealthy },
      duneSim: {
        available: this.provider !== null,
        mode: this.providerMode,
      },
    };
  }
}

/**
 * Singleton chain service instance
 */
export const chainService = new ChainService();
