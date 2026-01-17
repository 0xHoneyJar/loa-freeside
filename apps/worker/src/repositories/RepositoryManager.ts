/**
 * Repository Manager
 * Sprint S-8: ScyllaDB Integration
 *
 * Manages repository lifecycle and provides tenant-scoped access.
 * Integrates ScyllaDB repositories with tenant context from S-7.
 */

import type { Logger } from 'pino';
import type { ScyllaClient } from '../infrastructure/scylla/scylla-client.js';
import type { StateManager } from '../services/StateManager.js';
import type { TenantContextManager, TenantRequestContext } from '../services/TenantContext.js';
import { ScoreRepository, createScoreRepository } from './ScoreRepository.js';
import { LeaderboardRepository, createLeaderboardRepository } from './LeaderboardRepository.js';
import { EligibilityRepository, createEligibilityRepository } from './EligibilityRepository.js';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export interface RepositoryManagerConfig {
  eligibilityCacheTtlMs?: number;
}

export interface TenantRepositories {
  scores: ScoreRepository;
  leaderboards: LeaderboardRepository;
  eligibility: EligibilityRepository;
}

// --------------------------------------------------------------------------
// Repository Manager
// --------------------------------------------------------------------------

export class RepositoryManager {
  private readonly log: Logger;
  private readonly scylla: ScyllaClient;
  private readonly stateManager: StateManager;
  private readonly tenantManager: TenantContextManager;
  private readonly config: RepositoryManagerConfig;

  // Singleton repositories (stateless, tenant context passed per operation)
  private readonly scoreRepo: ScoreRepository;
  private readonly leaderboardRepo: LeaderboardRepository;
  private readonly eligibilityRepo: EligibilityRepository;

  private isInitialized = false;

  constructor(
    scyllaClient: ScyllaClient,
    stateManager: StateManager,
    tenantManager: TenantContextManager,
    logger: Logger,
    config: RepositoryManagerConfig = {}
  ) {
    this.scylla = scyllaClient;
    this.stateManager = stateManager;
    this.tenantManager = tenantManager;
    this.log = logger.child({ component: 'RepositoryManager' });
    this.config = config;

    // Create singleton repositories
    this.scoreRepo = createScoreRepository(scyllaClient, logger);
    this.leaderboardRepo = createLeaderboardRepository(scyllaClient, logger);
    this.eligibilityRepo = createEligibilityRepository(
      scyllaClient,
      stateManager,
      logger
    );

    this.log.info('RepositoryManager created');
  }

  /**
   * Initialize repository manager (connect to ScyllaDB)
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      this.log.warn('RepositoryManager already initialized');
      return;
    }

    this.log.info('Initializing RepositoryManager...');

    // Connect to ScyllaDB
    await this.scylla.connect();

    // Verify connection health
    const healthy = await this.scylla.isHealthy();
    if (!healthy) {
      throw new Error('ScyllaDB connection not healthy after connect');
    }

    this.isInitialized = true;
    this.log.info('RepositoryManager initialized successfully');
  }

  /**
   * Check if manager is ready
   */
  isReady(): boolean {
    return this.isInitialized;
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{ healthy: boolean; scylla: boolean }> {
    const scyllaHealthy = await this.scylla.isHealthy();

    return {
      healthy: scyllaHealthy && this.isInitialized,
      scylla: scyllaHealthy,
    };
  }

  /**
   * Get repositories for a tenant context
   * Returns the same singleton instances with tenant context passed per operation
   */
  getRepositories(): TenantRepositories {
    if (!this.isInitialized) {
      throw new Error('RepositoryManager not initialized. Call initialize() first.');
    }

    return {
      scores: this.scoreRepo,
      leaderboards: this.leaderboardRepo,
      eligibility: this.eligibilityRepo,
    };
  }

  /**
   * Create tenant context and get repositories in one call
   * Convenience method for handler use
   */
  async forTenant(guildId: string, userId?: string): Promise<{
    ctx: TenantRequestContext;
    repos: TenantRepositories;
  }> {
    const ctx = await this.tenantManager.createContext(guildId, userId);
    const repos = this.getRepositories();

    return { ctx, repos };
  }

  /**
   * Get score repository directly
   */
  get scores(): ScoreRepository {
    return this.scoreRepo;
  }

  /**
   * Get leaderboard repository directly
   */
  get leaderboards(): LeaderboardRepository {
    return this.leaderboardRepo;
  }

  /**
   * Get eligibility repository directly
   */
  get eligibility(): EligibilityRepository {
    return this.eligibilityRepo;
  }

  /**
   * Get ScyllaDB metrics
   */
  getMetrics() {
    return this.scylla.getMetrics();
  }

  /**
   * Shutdown repository manager
   */
  async shutdown(): Promise<void> {
    this.log.info('Shutting down RepositoryManager...');

    try {
      await this.scylla.close();
      this.isInitialized = false;
      this.log.info('RepositoryManager shutdown complete');
    } catch (error) {
      this.log.error({ error }, 'Error during RepositoryManager shutdown');
      throw error;
    }
  }
}

// --------------------------------------------------------------------------
// Factory
// --------------------------------------------------------------------------

export function createRepositoryManager(
  scyllaClient: ScyllaClient,
  stateManager: StateManager,
  tenantManager: TenantContextManager,
  logger: Logger,
  config?: RepositoryManagerConfig
): RepositoryManager {
  return new RepositoryManager(scyllaClient, stateManager, tenantManager, logger, config);
}
