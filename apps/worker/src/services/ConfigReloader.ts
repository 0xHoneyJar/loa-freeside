/**
 * Configuration Hot-Reload Service
 * Sprint S-7: Multi-Tenancy & Integration
 *
 * Enables configuration changes without worker restart.
 * Uses Redis pub/sub for distributed invalidation.
 */

import type { Logger } from 'pino';
import type { StateManager } from './StateManager.js';
import type { TenantContextManager } from './TenantContext.js';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export interface ConfigReloadEvent {
  type: 'tenant_config' | 'global_config' | 'feature_flag';
  targetId?: string; // communityId for tenant_config, null for global
  timestamp: number;
  source: string; // Pod/service that triggered the reload
}

export interface ConfigReloaderOptions {
  channel: string;
  pollIntervalMs: number;
  podName: string;
}

const DEFAULT_OPTIONS: ConfigReloaderOptions = {
  channel: 'arrakis:config:reload',
  pollIntervalMs: 30_000,
  podName: process.env['POD_NAME'] || 'local',
};

// --------------------------------------------------------------------------
// Config Reloader
// --------------------------------------------------------------------------

export class ConfigReloader {
  private readonly log: Logger;
  private readonly stateManager: StateManager;
  private readonly tenantManager: TenantContextManager;
  private readonly options: ConfigReloaderOptions;
  private unsubscribe: (() => void) | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(
    stateManager: StateManager,
    tenantManager: TenantContextManager,
    logger: Logger,
    options: Partial<ConfigReloaderOptions> = {}
  ) {
    this.stateManager = stateManager;
    this.tenantManager = tenantManager;
    this.log = logger.child({ component: 'ConfigReloader' });
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Start listening for config reload events
   */
  start(): void {
    if (this.isRunning) {
      this.log.warn('ConfigReloader already running');
      return;
    }

    this.isRunning = true;

    // Subscribe to Redis pub/sub channel
    this.unsubscribe = this.stateManager.subscribe(
      this.options.channel,
      (message) => this.handleReloadEvent(message)
    );

    // Start periodic poll for missed events
    this.pollInterval = setInterval(
      () => this.pollForChanges(),
      this.options.pollIntervalMs
    );

    this.log.info(
      { channel: this.options.channel, pollIntervalMs: this.options.pollIntervalMs },
      'ConfigReloader started'
    );
  }

  /**
   * Stop listening for config reload events
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    this.log.info('ConfigReloader stopped');
  }

  /**
   * Trigger a config reload for a specific tenant
   */
  async triggerReload(communityId: string): Promise<void> {
    const event: ConfigReloadEvent = {
      type: 'tenant_config',
      targetId: communityId,
      timestamp: Date.now(),
      source: this.options.podName,
    };

    await this.stateManager.publish(this.options.channel, JSON.stringify(event));

    this.log.info({ communityId }, 'Triggered tenant config reload');
  }

  /**
   * Trigger a global config reload (all tenants)
   */
  async triggerGlobalReload(): Promise<void> {
    const event: ConfigReloadEvent = {
      type: 'global_config',
      timestamp: Date.now(),
      source: this.options.podName,
    };

    await this.stateManager.publish(this.options.channel, JSON.stringify(event));

    this.log.info('Triggered global config reload');
  }

  /**
   * Trigger a feature flag reload
   */
  async triggerFeatureFlagReload(flagId?: string): Promise<void> {
    const event: ConfigReloadEvent = {
      type: 'feature_flag',
      targetId: flagId,
      timestamp: Date.now(),
      source: this.options.podName,
    };

    await this.stateManager.publish(this.options.channel, JSON.stringify(event));

    this.log.info({ flagId }, 'Triggered feature flag reload');
  }

  // --------------------------------------------------------------------------
  // Private handlers
  // --------------------------------------------------------------------------

  private handleReloadEvent(message: string): void {
    try {
      const event = JSON.parse(message) as ConfigReloadEvent;

      this.log.debug(
        { type: event.type, targetId: event.targetId, source: event.source },
        'Received config reload event'
      );

      switch (event.type) {
        case 'tenant_config':
          if (event.targetId) {
            this.tenantManager.invalidateCache(event.targetId);
            this.log.info({ communityId: event.targetId }, 'Tenant config cache invalidated');
          }
          break;

        case 'global_config':
          this.tenantManager.invalidateAllCaches();
          this.log.info('All tenant config caches invalidated');
          break;

        case 'feature_flag':
          // Feature flags would be handled by a separate manager
          this.log.debug({ flagId: event.targetId }, 'Feature flag reload (not implemented)');
          break;

        default:
          this.log.warn({ type: event.type }, 'Unknown config reload event type');
      }
    } catch (error) {
      this.log.error({ error, message }, 'Failed to parse config reload event');
    }
  }

  private async pollForChanges(): Promise<void> {
    // This is a fallback in case pub/sub messages are missed
    // In practice, we could check a "last_updated" timestamp in Redis
    // and invalidate caches if our local timestamp is older

    const stats = this.tenantManager.getCacheStats();
    this.log.debug({ cacheSize: stats.size }, 'Config poll (cache stats)');
  }
}

// --------------------------------------------------------------------------
// Factory
// --------------------------------------------------------------------------

export function createConfigReloader(
  stateManager: StateManager,
  tenantManager: TenantContextManager,
  logger: Logger,
  options?: Partial<ConfigReloaderOptions>
): ConfigReloader {
  return new ConfigReloader(stateManager, tenantManager, logger, options);
}
