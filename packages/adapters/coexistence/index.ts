/**
 * Coexistence Adapters
 *
 * Sprint S-24: Incumbent Detection & Shadow Ledger
 * Sprint S-25: Shadow Sync Job & Verification Tiers
 * Sprint S-26: Namespaced Roles & Parallel Channels
 * Sprint S-27: Glimpse Mode & Migration Readiness
 * Sprint S-28: Migration Strategies & Rollback
 *
 * Adapters for coexistence including:
 * - IncumbentDetector: Auto-detection of Collab.Land, Matrica, Guild.xyz
 * - ScyllaDBShadowLedger: Shadow state and divergence tracking
 * - ShadowSyncJob: 6-hour periodic comparison
 * - FeatureGate: Tier-based feature access control
 * - NamespacedRoleManager: Arrakis role management in parallel mode
 * - ChannelStrategyManager: Conviction-gated channel management
 * - ParallelModeOrchestrator: Coordination of parallel mode operations
 * - GlimpseManager: Glimpse mode previews and migration readiness
 * - MigrationManager: Migration strategies, rollback, and backup activation
 *
 * @see SDD §7.1 Shadow Mode Architecture
 * @see SDD §7.2 Parallel Mode Architecture
 * @see SDD §7.2.3 Glimpse Mode
 * @see SDD §7.3 Migration Engine
 */

// Sprint S-24: Incumbent Detection
export {
  IncumbentDetector,
  createIncumbentDetector,
  type IDiscordRestService,
  type GuildMember,
  type GuildChannel,
  type GuildRole,
  type DetectionOptions,
} from './incumbent-detector.js';

// Sprint S-24: Shadow Ledger
export {
  ScyllaDBShadowLedger,
  createScyllaDBShadowLedger,
  type IScyllaClient,
} from './shadow-ledger.js';

// Sprint S-25: Shadow Sync Job
export {
  ShadowSyncJob,
  createShadowSyncJob,
  type IDiscordMemberService,
  type ICommunityRepository,
  type IEligibilityChecker,
  type INatsPublisher,
  type IMetricsClient,
  type GuildMemberData,
  type EligibilityRule,
  type ShadowSyncJobOptions,
} from './shadow-sync-job.js';

// Sprint S-25: Feature Gate
export {
  FeatureGate,
  createFeatureGate,
  createFeatureGateWithStore,
  InMemoryFeatureOverrideStore,
  FeatureAccessDeniedError,
  type ICommunityTierRepository,
  type IFeatureOverrideStore,
  type FeatureGateOptions,
} from './feature-gate.js';

// Sprint S-26: Namespaced Role Manager
export {
  NamespacedRoleManager,
  createNamespacedRoleManager,
  type IDiscordRoleService,
  type ISynthesisQueue,
  type IParallelModeConfigStore,
  type IParallelModeMetrics,
  type NamespacedRoleManagerOptions,
} from './namespaced-role-manager.js';

// Sprint S-26: Channel Strategy Manager
export {
  ChannelStrategyManager,
  createChannelStrategyManager,
  type IDiscordChannelService,
  type IChannelConfigStore,
  type IChannelMetrics,
  type ChannelStrategyManagerOptions,
  type PermissionOverwrite,
} from './channel-strategy-manager.js';

// Sprint S-26: Parallel Mode Orchestrator
export {
  ParallelModeOrchestrator,
  createParallelModeOrchestrator,
  type IParallelModeCommunityService,
  type IShadowLedgerReadiness,
  type IFeatureGateReadiness,
  type IParallelModeOrchestratorMetrics,
  type ParallelModeOrchestratorOptions,
} from './parallel-mode-orchestrator.js';

// Sprint S-27: Glimpse Mode & Migration Readiness
export {
  GlimpseManager,
  createGlimpseManager,
  type ILeaderboardDataSource,
  type IProfileDataSource,
  type IBadgeDataSource,
  type ICommunityVerificationSource,
  type IShadowStats,
  type IGlimpseConfigStore,
  type IGlimpseMetrics,
  type GlimpseManagerOptions,
} from './glimpse-manager.js';

// Sprint S-28: Migration Strategies & Rollback
export {
  MigrationManager,
  createMigrationManager,
  InMemoryMigrationStateStore,
  InMemorySnapshotStore,
  InMemoryMigrationAuditTrail,
  type IShadowLedgerForMigration,
  type IDiscordMigrationService,
  type IRoleMappingService,
  type IMigrationCommunityService,
  type IMigrationNotificationService,
  type IMigrationMetrics,
  type MigrationManagerOptions,
} from './migration-manager.js';
