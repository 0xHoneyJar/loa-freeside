import {
  createPublicClient,
  http,
  fallback,
  type Address,
  type PublicClient,
  type AbiEvent,
} from 'viem';
import { berachain } from 'viem/chains';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import type { EligibilityEntry, BurnEvent } from '../types/index.js';

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
 * Prevents RPC timeouts on large historical ranges
 */
const BLOCK_RANGE = 10000n;

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
 * Chain Service
 *
 * Queries Berachain RPC via viem to fetch BGT eligibility data.
 *
 * Eligibility is determined by:
 * 1. BGT balance (via balanceOf on BGT token) - how much BGT a wallet holds
 * 2. Burn history (Transfer events to 0x0) - wallets that have EVER burned BGT are ineligible
 *
 * This approach is simpler than tracking claim events from reward vaults,
 * as we only care about current holdings and whether the wallet has ever redeemed.
 *
 * Supports multiple RPC endpoints with automatic fallback.
 */
class ChainService {
  private client: PublicClient;
  private rpcHealth: Map<string, RpcEndpointHealth> = new Map();
  private currentRpcIndex: number = 0;

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

    logger.info(
      { rpcUrls: config.chain.rpcUrls, count: config.chain.rpcUrls.length },
      'Chain service initialized with multiple RPC endpoints'
    );
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

  /**
   * Fetch complete eligibility data from chain
   *
   * Strategy:
   * 1. Get all wallets that have ever received BGT (Transfer events TO addresses)
   * 2. Get all wallets that have ever burned BGT (Transfer events to 0x0)
   * 3. Filter out wallets that have burned (ineligible forever)
   * 4. Query current balanceOf for remaining wallets
   * 5. Sort by BGT held and assign ranks/roles
   *
   * @returns Sorted list of eligible wallets (no burns, sorted by BGT held desc)
   */
  async fetchEligibilityData(): Promise<EligibilityEntry[]> {
    logger.info('Starting eligibility data fetch from chain');

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

    logger.info(
      {
        totalEligible: ranked.length,
        naib: ranked.filter((w) => w.role === 'naib').length,
        fedaykin: ranked.filter((w) => w.role === 'fedaykin').length,
      },
      'Eligibility data fetch complete'
    );

    return ranked;
  }

  /**
   * Fetch all wallets that have ever received BGT
   * Queries Transfer events where 'to' is not 0x0
   */
  async fetchBgtRecipients(): Promise<Set<Address>> {
    const currentBlock = await this.client.getBlockNumber();
    const recipients = new Set<Address>();
    let fromBlock = 0n;

    logger.info('Fetching all BGT recipients from Transfer events');

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
          { fromBlock, toBlock: endBlock, count: batchLogs.length, uniqueRecipients: recipients.size },
          'Fetched Transfer log batch'
        );
      } catch (error) {
        logger.warn({ fromBlock, toBlock: endBlock, error }, 'Error fetching Transfer logs');
        throw error;
      }

      fromBlock = endBlock + 1n;
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
   */
  private async fetchTransferLogs(
    address: Address,
    toBlock: bigint,
    toAddress: Address
  ): Promise<BurnEvent[]> {
    const events: BurnEvent[] = [];
    let fromBlock = 0n;

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
   *
   * @param address - Wallet address to check
   * @returns true if the wallet has burned any BGT, false otherwise
   */
  async hasWalletBurnedBgt(address: Address): Promise<boolean> {
    const currentBlock = await this.client.getBlockNumber();
    let fromBlock = 0n;

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
   */
  async getWalletBgtBalance(address: Address): Promise<bigint> {
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
   */
  async checkWalletEligibility(address: Address): Promise<EligibilityEntry | null> {
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
}

/**
 * Singleton chain service instance
 */
export const chainService = new ChainService();
