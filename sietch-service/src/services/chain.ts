import {
  createPublicClient,
  http,
  type Address,
  type PublicClient,
  type AbiEvent,
} from 'viem';
import { berachain } from 'viem/chains';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import type { EligibilityEntry, ClaimEvent, BurnEvent } from '../types/index.js';

/**
 * RewardPaid event ABI from reward vaults
 * Emitted when a user claims BGT rewards
 */
const REWARD_PAID_EVENT = {
  type: 'event',
  name: 'RewardPaid',
  inputs: [
    { name: 'user', type: 'address', indexed: true },
    { name: 'reward', type: 'uint256', indexed: false },
  ],
} as const satisfies AbiEvent;

/**
 * Transfer event ABI from BGT token
 * Used to detect burns (transfers to 0x0)
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
 * Zero address for burn detection
 */
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

/**
 * Block range for paginated log queries
 * Prevents RPC timeouts on large historical ranges
 */
const BLOCK_RANGE = 10000n;

/**
 * Chain Service
 *
 * Queries Berachain RPC via viem to fetch BGT eligibility data.
 * Fetches claim events from reward vaults and burn events from BGT transfers.
 */
class ChainService {
  private client: PublicClient;

  constructor() {
    this.client = createPublicClient({
      chain: berachain,
      transport: http(config.chain.rpcUrl),
    });

    logger.info({ rpcUrl: config.chain.rpcUrl }, 'Chain service initialized');
  }

  /**
   * Fetch complete eligibility data from chain
   *
   * @returns Sorted list of eligible wallets (no burns, sorted by BGT held desc)
   */
  async fetchEligibilityData(): Promise<EligibilityEntry[]> {
    logger.info('Starting eligibility data fetch from chain');

    // 1. Get all BGT claim events from reward vaults
    const claimEvents = await this.fetchClaimEvents();
    logger.info({ count: claimEvents.length }, 'Fetched claim events');

    // 2. Get all BGT burn events (transfers to 0x0)
    const burnEvents = await this.fetchBurnEvents();
    logger.info({ count: burnEvents.length }, 'Fetched burn events');

    // 3. Aggregate by wallet
    const walletData = this.aggregateWalletData(claimEvents, burnEvents);
    logger.info({ wallets: walletData.length }, 'Aggregated wallet data');

    // 4. Filter out wallets that have burned any BGT
    const eligibleWallets = walletData.filter((w) => w.bgtBurned === 0n);
    logger.info({ eligible: eligibleWallets.length }, 'Filtered eligible wallets');

    // 5. Sort by BGT held descending
    eligibleWallets.sort((a, b) => {
      if (b.bgtHeld > a.bgtHeld) return 1;
      if (b.bgtHeld < a.bgtHeld) return -1;
      return 0;
    });

    // 6. Assign ranks and roles
    const ranked = this.assignRanksAndRoles(eligibleWallets);

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
   * Fetch RewardPaid events from all configured reward vaults
   */
  async fetchClaimEvents(): Promise<ClaimEvent[]> {
    const events: ClaimEvent[] = [];
    const currentBlock = await this.client.getBlockNumber();

    for (const vaultAddress of config.chain.rewardVaultAddresses) {
      logger.debug({ vault: vaultAddress }, 'Fetching claim events from vault');

      const vaultEvents = await this.fetchRewardPaidLogs(vaultAddress, currentBlock);
      events.push(...vaultEvents);
    }

    return events;
  }

  /**
   * Fetch Transfer events to 0x0 (burns) from BGT token
   */
  async fetchBurnEvents(): Promise<BurnEvent[]> {
    const currentBlock = await this.client.getBlockNumber();

    return this.fetchTransferLogs(
      config.chain.bgtAddress,
      currentBlock,
      ZERO_ADDRESS
    );
  }

  /**
   * Fetch RewardPaid logs with pagination
   */
  private async fetchRewardPaidLogs(
    address: Address,
    toBlock: bigint
  ): Promise<ClaimEvent[]> {
    const events: ClaimEvent[] = [];
    let fromBlock = 0n;

    while (fromBlock <= toBlock) {
      const endBlock = fromBlock + BLOCK_RANGE - 1n > toBlock ? toBlock : fromBlock + BLOCK_RANGE - 1n;

      try {
        const batchLogs = await this.client.getLogs({
          address,
          event: REWARD_PAID_EVENT,
          fromBlock,
          toBlock: endBlock,
        });

        for (const log of batchLogs) {
          if (log.args.user && log.args.reward !== undefined) {
            events.push({
              recipient: log.args.user,
              amount: log.args.reward,
            });
          }
        }

        logger.debug(
          { fromBlock, toBlock: endBlock, count: batchLogs.length },
          'Fetched RewardPaid log batch'
        );
      } catch (error) {
        logger.warn(
          { fromBlock, toBlock: endBlock, error },
          'Error fetching RewardPaid logs'
        );
        throw error;
      }

      fromBlock = endBlock + 1n;
    }

    return events;
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
   * Aggregate claim and burn events by wallet
   */
  aggregateWalletData(claims: ClaimEvent[], burns: BurnEvent[]): EligibilityEntry[] {
    const wallets = new Map<Address, EligibilityEntry>();

    // Sum up claims
    for (const claim of claims) {
      const address = claim.recipient.toLowerCase() as Address;
      const existing = wallets.get(address) ?? {
        address,
        bgtClaimed: 0n,
        bgtBurned: 0n,
        bgtHeld: 0n,
        role: 'none' as const,
      };
      existing.bgtClaimed += claim.amount;
      existing.bgtHeld = existing.bgtClaimed - existing.bgtBurned;
      wallets.set(address, existing);
    }

    // Sum up burns
    for (const burn of burns) {
      const address = burn.from.toLowerCase() as Address;
      const existing = wallets.get(address);
      if (existing) {
        existing.bgtBurned += burn.amount;
        existing.bgtHeld = existing.bgtClaimed - existing.bgtBurned;
      }
    }

    return Array.from(wallets.values());
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
