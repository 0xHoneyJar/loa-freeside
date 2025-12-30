/**
 * ICoexistenceStorage - Port Interface for Coexistence Data Access
 *
 * Sprint 56: Shadow Mode Foundation - Incumbent Detection
 *
 * Defines the contract for storing and retrieving coexistence-related data:
 * - Incumbent bot configurations (detected token-gating bots)
 * - Migration states (shadow -> parallel -> primary -> exclusive)
 *
 * This interface supports the hexagonal architecture pattern, allowing
 * different storage implementations (PostgreSQL, in-memory for tests).
 *
 * @module packages/core/ports/ICoexistenceStorage
 */

import type {
  IncumbentProvider,
  HealthStatus,
  CoexistenceMode,
  MigrationStrategy,
  DetectedRole,
  IncumbentCapabilities,
  DivergenceType,
  ShadowStateSnapshot,
  TierRoleMapping,
  RolePositionStrategy,
  ChannelStrategy,
  ParallelChannelTemplate,
  CustomChannelDefinition,
} from '../../adapters/storage/schema.js';

// =============================================================================
// Incumbent Configuration Types
// =============================================================================

/**
 * Information about an incumbent token-gating bot detected in a guild
 */
export interface IncumbentInfo {
  /** Incumbent provider type */
  provider: IncumbentProvider;
  /** Detection confidence score (0-1) */
  confidence: number;
  /** Bot information if detected */
  bot: {
    id: string;
    username: string;
    joinedAt: Date;
  } | null;
  /** Relevant channel IDs */
  channels: {
    verification: string | null;
    config: string | null;
  };
  /** Detected roles that may be token-gated */
  roles: DetectedRole[];
  /** Capabilities comparison */
  capabilities: IncumbentCapabilities;
}

/**
 * Input for saving an incumbent configuration
 */
export interface SaveIncumbentInput {
  communityId: string;
  provider: IncumbentProvider;
  botId?: string;
  botUsername?: string;
  verificationChannelId?: string;
  confidence: number;
  manualOverride?: boolean;
  detectedRoles?: DetectedRole[];
  capabilities?: IncumbentCapabilities;
}

/**
 * Stored incumbent configuration with metadata
 */
export interface StoredIncumbentConfig {
  id: string;
  communityId: string;
  provider: IncumbentProvider;
  botId: string | null;
  botUsername: string | null;
  verificationChannelId: string | null;
  detectedAt: Date;
  confidence: number;
  manualOverride: boolean;
  lastHealthCheck: Date | null;
  healthStatus: HealthStatus;
  detectedRoles: DetectedRole[];
  capabilities: IncumbentCapabilities;
  createdAt: Date;
  updatedAt: Date;
}

// =============================================================================
// Migration State Types
// =============================================================================

/**
 * Coexistence state tracking for a community
 */
export interface CoexistenceState {
  mode: CoexistenceMode;
  incumbentProvider: IncumbentProvider | null;
  shadowStartedAt: Date | null;
  parallelEnabledAt: Date | null;
  primaryEnabledAt: Date | null;
  exclusiveEnabledAt: Date | null;
  lastRollbackAt: Date | null;
  rollbackCount: number;
}

/**
 * Input for creating/updating migration state
 */
export interface SaveMigrationStateInput {
  communityId: string;
  currentMode: CoexistenceMode;
  targetMode?: CoexistenceMode;
  strategy?: MigrationStrategy;
  shadowStartedAt?: Date;
  parallelEnabledAt?: Date;
  primaryEnabledAt?: Date;
  exclusiveEnabledAt?: Date;
  rollbackCount?: number;
  lastRollbackAt?: Date;
  lastRollbackReason?: string;
  readinessCheckPassed?: boolean;
  accuracyPercent?: number;
  shadowDays?: number;
}

/**
 * Stored migration state with full metadata
 */
export interface StoredMigrationState {
  id: string;
  communityId: string;
  currentMode: CoexistenceMode;
  targetMode: CoexistenceMode | null;
  strategy: MigrationStrategy | null;
  shadowStartedAt: Date | null;
  parallelEnabledAt: Date | null;
  primaryEnabledAt: Date | null;
  exclusiveEnabledAt: Date | null;
  rollbackCount: number;
  lastRollbackAt: Date | null;
  lastRollbackReason: string | null;
  readinessCheckPassed: boolean;
  accuracyPercent: number | null;
  shadowDays: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Health check update input
 */
export interface UpdateHealthInput {
  communityId: string;
  healthStatus: HealthStatus;
  lastHealthCheck: Date;
}

// =============================================================================
// Port Interface
// =============================================================================

/**
 * Port interface for coexistence data storage
 *
 * Implementations:
 * - CoexistenceStorage (PostgreSQL via Drizzle)
 * - InMemoryCoexistenceStorage (for unit tests)
 */
export interface ICoexistenceStorage {
  // =========================================================================
  // Incumbent Configuration Methods
  // =========================================================================

  /**
   * Get incumbent configuration for a community
   * @param communityId - Community UUID
   * @returns Incumbent config or null if not found
   */
  getIncumbentConfig(communityId: string): Promise<StoredIncumbentConfig | null>;

  /**
   * Save or update incumbent configuration
   * @param input - Incumbent configuration data
   * @returns Saved configuration
   */
  saveIncumbentConfig(input: SaveIncumbentInput): Promise<StoredIncumbentConfig>;

  /**
   * Update incumbent health status
   * @param input - Health check data
   */
  updateIncumbentHealth(input: UpdateHealthInput): Promise<void>;

  /**
   * Delete incumbent configuration
   * @param communityId - Community UUID
   */
  deleteIncumbentConfig(communityId: string): Promise<void>;

  /**
   * Check if community has an incumbent configured
   * @param communityId - Community UUID
   */
  hasIncumbent(communityId: string): Promise<boolean>;

  // =========================================================================
  // Migration State Methods
  // =========================================================================

  /**
   * Get migration state for a community
   * @param communityId - Community UUID
   * @returns Migration state or null if not found
   */
  getMigrationState(communityId: string): Promise<StoredMigrationState | null>;

  /**
   * Save or update migration state
   * @param input - Migration state data
   * @returns Saved state
   */
  saveMigrationState(input: SaveMigrationStateInput): Promise<StoredMigrationState>;

  /**
   * Get current coexistence mode for a community
   * @param communityId - Community UUID
   * @returns Current mode or 'shadow' if not configured
   */
  getCurrentMode(communityId: string): Promise<CoexistenceMode>;

  /**
   * Update coexistence mode (state machine transition)
   * @param communityId - Community UUID
   * @param mode - New mode
   * @param reason - Reason for transition (for rollbacks)
   */
  updateMode(
    communityId: string,
    mode: CoexistenceMode,
    reason?: string
  ): Promise<void>;

  /**
   * Record a rollback event
   * @param communityId - Community UUID
   * @param reason - Reason for rollback
   * @param targetMode - Mode to rollback to
   */
  recordRollback(
    communityId: string,
    reason: string,
    targetMode: CoexistenceMode
  ): Promise<void>;

  /**
   * Initialize migration state for a new community in shadow mode
   * @param communityId - Community UUID
   * @returns Initial migration state
   */
  initializeShadowMode(communityId: string): Promise<StoredMigrationState>;

  /**
   * Update migration state (partial update)
   * @param input - Fields to update
   */
  updateMigrationState(input: SaveMigrationStateInput): Promise<StoredMigrationState>;

  // =========================================================================
  // Community Query Methods (Sprint 64)
  // =========================================================================

  /**
   * Get community basic info by ID
   * @param communityId - Community UUID
   */
  getCommunity(communityId: string): Promise<StoredCommunityBasic | null>;

  // =========================================================================
  // Query Methods
  // =========================================================================

  /**
   * Get all communities in a specific mode
   * @param mode - Coexistence mode to filter by (single or array)
   */
  getCommunitiesByMode(mode: CoexistenceMode | CoexistenceMode[]): Promise<StoredCommunityBasic[]>;

  /**
   * Get communities ready for migration (passed readiness check)
   */
  getReadyCommunities(): Promise<string[]>;

  /**
   * Get incumbent health status across all communities
   * @returns Map of communityId -> healthStatus
   */
  getIncumbentHealthOverview(): Promise<Map<string, HealthStatus>>;

  // =========================================================================
  // Shadow Member State Methods (Sprint 57)
  // =========================================================================

  /**
   * Get shadow member state by community and member
   * @param communityId - Community UUID
   * @param memberId - Discord member ID
   */
  getShadowMemberState(
    communityId: string,
    memberId: string
  ): Promise<StoredShadowMemberState | null>;

  /**
   * Get all shadow member states for a community
   * @param communityId - Community UUID
   * @param options - Pagination and filter options
   */
  getShadowMemberStates(
    communityId: string,
    options?: {
      limit?: number;
      offset?: number;
      divergenceType?: DivergenceType;
    }
  ): Promise<StoredShadowMemberState[]>;

  /**
   * Save or update a shadow member state (upsert)
   * @param input - Shadow member state data
   */
  saveShadowMemberState(input: SaveShadowMemberInput): Promise<StoredShadowMemberState>;

  /**
   * Batch save shadow member states (for sync efficiency)
   * @param inputs - Array of shadow member state data
   */
  batchSaveShadowMemberStates(inputs: SaveShadowMemberInput[]): Promise<void>;

  /**
   * Delete shadow member state
   * @param communityId - Community UUID
   * @param memberId - Discord member ID
   */
  deleteShadowMemberState(communityId: string, memberId: string): Promise<void>;

  // =========================================================================
  // Shadow Divergence Methods (Sprint 57)
  // =========================================================================

  /**
   * Save a new divergence record
   * @param input - Divergence data
   */
  saveDivergence(input: SaveDivergenceInput): Promise<StoredDivergence>;

  /**
   * Get divergences for a community
   * @param communityId - Community UUID
   * @param options - Pagination and filter options
   */
  getDivergences(
    communityId: string,
    options?: {
      limit?: number;
      offset?: number;
      divergenceType?: DivergenceType;
      since?: Date;
      unresolved?: boolean;
    }
  ): Promise<StoredDivergence[]>;

  /**
   * Mark a divergence as resolved
   * @param divergenceId - Divergence UUID
   * @param resolutionType - How it was resolved
   */
  resolveDivergence(
    divergenceId: string,
    resolutionType: 'member_action' | 'sync_corrected' | 'manual'
  ): Promise<void>;

  /**
   * Get divergence summary for a community
   * @param communityId - Community UUID
   */
  getDivergenceSummary(communityId: string): Promise<DivergenceSummary>;

  // =========================================================================
  // Shadow Prediction Methods (Sprint 57)
  // =========================================================================

  /**
   * Save a new prediction
   * @param input - Prediction data
   */
  savePrediction(input: SavePredictionInput): Promise<StoredPrediction>;

  /**
   * Validate a prediction against actual outcome
   * @param input - Validation data
   */
  validatePrediction(input: ValidatePredictionInput): Promise<void>;

  /**
   * Get unvalidated predictions for a community
   * @param communityId - Community UUID
   * @param limit - Max predictions to return
   */
  getUnvalidatedPredictions(
    communityId: string,
    limit?: number
  ): Promise<StoredPrediction[]>;

  /**
   * Calculate accuracy percentage for a community
   * @param communityId - Community UUID
   * @param since - Only consider predictions after this date
   */
  calculateAccuracy(communityId: string, since?: Date): Promise<number>;

  // =========================================================================
  // Parallel Role Configuration Methods (Sprint 58)
  // =========================================================================

  /**
   * Get parallel role configuration for a community
   * @param communityId - Community UUID
   */
  getParallelRoleConfig(communityId: string): Promise<StoredParallelRoleConfig | null>;

  /**
   * Save or update parallel role configuration
   * @param input - Configuration data
   */
  saveParallelRoleConfig(input: SaveParallelRoleConfigInput): Promise<StoredParallelRoleConfig>;

  /**
   * Delete parallel role configuration
   * @param communityId - Community UUID
   */
  deleteParallelRoleConfig(communityId: string): Promise<void>;

  /**
   * Check if community has parallel mode enabled
   * @param communityId - Community UUID
   */
  isParallelEnabled(communityId: string): Promise<boolean>;

  // =========================================================================
  // Parallel Role Methods (Sprint 58)
  // =========================================================================

  /**
   * Get a parallel role by Discord role ID
   * @param communityId - Community UUID
   * @param discordRoleId - Discord role snowflake
   */
  getParallelRole(
    communityId: string,
    discordRoleId: string
  ): Promise<StoredParallelRole | null>;

  /**
   * Get all parallel roles for a community
   * @param communityId - Community UUID
   */
  getParallelRoles(communityId: string): Promise<StoredParallelRole[]>;

  /**
   * Get parallel role for a specific tier
   * @param communityId - Community UUID
   * @param tier - Tier number
   */
  getParallelRoleByTier(
    communityId: string,
    tier: number
  ): Promise<StoredParallelRole | null>;

  /**
   * Save a new parallel role (created in Discord)
   * @param input - Role data
   */
  saveParallelRole(input: SaveParallelRoleInput): Promise<StoredParallelRole>;

  /**
   * Update parallel role position
   * @param communityId - Community UUID
   * @param discordRoleId - Discord role snowflake
   * @param position - New position
   */
  updateParallelRolePosition(
    communityId: string,
    discordRoleId: string,
    position: number
  ): Promise<void>;

  /**
   * Update parallel role member count
   * @param communityId - Community UUID
   * @param discordRoleId - Discord role snowflake
   * @param memberCount - New member count
   */
  updateParallelRoleMemberCount(
    communityId: string,
    discordRoleId: string,
    memberCount: number
  ): Promise<void>;

  /**
   * Delete a parallel role (when removed from Discord)
   * @param communityId - Community UUID
   * @param discordRoleId - Discord role snowflake
   */
  deleteParallelRole(communityId: string, discordRoleId: string): Promise<void>;

  /**
   * Delete all parallel roles for a community
   * @param communityId - Community UUID
   */
  deleteAllParallelRoles(communityId: string): Promise<void>;

  // =========================================================================
  // Parallel Member Assignment Methods (Sprint 58)
  // =========================================================================

  /**
   * Get parallel member assignment
   * @param communityId - Community UUID
   * @param memberId - Discord member ID
   */
  getParallelMemberAssignment(
    communityId: string,
    memberId: string
  ): Promise<StoredParallelMemberAssignment | null>;

  /**
   * Get all parallel member assignments for a community
   * @param communityId - Community UUID
   * @param options - Pagination options
   */
  getParallelMemberAssignments(
    communityId: string,
    options?: {
      limit?: number;
      offset?: number;
      tier?: number;
    }
  ): Promise<StoredParallelMemberAssignment[]>;

  /**
   * Save or update parallel member assignment (upsert)
   * @param input - Assignment data
   */
  saveParallelMemberAssignment(
    input: SaveParallelMemberAssignmentInput
  ): Promise<StoredParallelMemberAssignment>;

  /**
   * Batch save parallel member assignments
   * @param inputs - Array of assignment data
   */
  batchSaveParallelMemberAssignments(
    inputs: SaveParallelMemberAssignmentInput[]
  ): Promise<void>;

  /**
   * Delete parallel member assignment
   * @param communityId - Community UUID
   * @param memberId - Discord member ID
   */
  deleteParallelMemberAssignment(communityId: string, memberId: string): Promise<void>;

  /**
   * Get members by assigned tier
   * @param communityId - Community UUID
   * @param tier - Tier number
   */
  getMembersByTier(communityId: string, tier: number): Promise<string[]>;

  // =========================================================================
  // Parallel Channel Configuration Methods (Sprint 59)
  // =========================================================================

  /**
   * Get parallel channel configuration for a community
   * @param communityId - Community UUID
   */
  getParallelChannelConfig(communityId: string): Promise<StoredParallelChannelConfig | null>;

  /**
   * Save or update parallel channel configuration
   * @param input - Configuration data
   */
  saveParallelChannelConfig(input: SaveParallelChannelConfigInput): Promise<StoredParallelChannelConfig>;

  /**
   * Delete parallel channel configuration
   * @param communityId - Community UUID
   */
  deleteParallelChannelConfig(communityId: string): Promise<void>;

  /**
   * Check if channels are enabled for a community
   * @param communityId - Community UUID
   */
  isChannelsEnabled(communityId: string): Promise<boolean>;

  // =========================================================================
  // Parallel Channel Methods (Sprint 59)
  // =========================================================================

  /**
   * Get a parallel channel by Discord channel ID
   * @param communityId - Community UUID
   * @param discordChannelId - Discord channel snowflake
   */
  getParallelChannel(
    communityId: string,
    discordChannelId: string
  ): Promise<StoredParallelChannel | null>;

  /**
   * Get all parallel channels for a community
   * @param communityId - Community UUID
   */
  getParallelChannels(communityId: string): Promise<StoredParallelChannel[]>;

  /**
   * Get parallel channels by conviction threshold
   * @param communityId - Community UUID
   * @param minConviction - Minimum conviction threshold
   */
  getParallelChannelsByConviction(
    communityId: string,
    minConviction: number
  ): Promise<StoredParallelChannel[]>;

  /**
   * Save a new parallel channel (created in Discord)
   * @param input - Channel data
   */
  saveParallelChannel(input: SaveParallelChannelInput): Promise<StoredParallelChannel>;

  /**
   * Update parallel channel member access count
   * @param communityId - Community UUID
   * @param discordChannelId - Discord channel snowflake
   * @param memberAccessCount - New access count
   */
  updateParallelChannelAccessCount(
    communityId: string,
    discordChannelId: string,
    memberAccessCount: number
  ): Promise<void>;

  /**
   * Delete a parallel channel (when removed from Discord)
   * @param communityId - Community UUID
   * @param discordChannelId - Discord channel snowflake
   */
  deleteParallelChannel(communityId: string, discordChannelId: string): Promise<void>;

  /**
   * Delete all parallel channels for a community
   * @param communityId - Community UUID
   */
  deleteAllParallelChannels(communityId: string): Promise<void>;

  // =========================================================================
  // Parallel Channel Access Methods (Sprint 59)
  // =========================================================================

  /**
   * Get channel access for a member
   * @param communityId - Community UUID
   * @param memberId - Discord member ID
   * @param channelId - Discord channel ID
   */
  getParallelChannelAccess(
    communityId: string,
    memberId: string,
    channelId: string
  ): Promise<StoredParallelChannelAccess | null>;

  /**
   * Get all channel access records for a member
   * @param communityId - Community UUID
   * @param memberId - Discord member ID
   */
  getMemberChannelAccess(
    communityId: string,
    memberId: string
  ): Promise<StoredParallelChannelAccess[]>;

  /**
   * Get all members with access to a channel
   * @param communityId - Community UUID
   * @param channelId - Discord channel ID
   */
  getChannelAccessMembers(
    communityId: string,
    channelId: string
  ): Promise<StoredParallelChannelAccess[]>;

  /**
   * Save or update channel access (upsert)
   * @param input - Access data
   */
  saveParallelChannelAccess(
    input: SaveParallelChannelAccessInput
  ): Promise<StoredParallelChannelAccess>;

  /**
   * Batch save channel access records
   * @param inputs - Array of access data
   */
  batchSaveParallelChannelAccess(
    inputs: SaveParallelChannelAccessInput[]
  ): Promise<void>;

  /**
   * Delete channel access record
   * @param communityId - Community UUID
   * @param memberId - Discord member ID
   * @param channelId - Discord channel ID
   */
  deleteParallelChannelAccess(
    communityId: string,
    memberId: string,
    channelId: string
  ): Promise<void>;

  /**
   * Get members who need access granted (conviction >= threshold, no access)
   * @param communityId - Community UUID
   * @param channelId - Discord channel ID
   * @param minConviction - Threshold for access
   */
  getMembersNeedingAccess(
    communityId: string,
    channelId: string,
    minConviction: number
  ): Promise<string[]>;

  /**
   * Get members who need access revoked (conviction < threshold, has access)
   * @param communityId - Community UUID
   * @param channelId - Discord channel ID
   * @param minConviction - Threshold for access
   */
  getMembersNeedingRevocation(
    communityId: string,
    channelId: string,
    minConviction: number
  ): Promise<string[]>;
}

// =============================================================================
// Community Basic Types (Sprint 64)
// =============================================================================

/**
 * Basic community information for health monitoring
 */
export interface StoredCommunityBasic {
  id: string;
  name: string;
  discordGuildId: string | null;
  telegramChatId: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// =============================================================================
// Shadow Member State Types (Sprint 57)
// =============================================================================

/**
 * Input for saving/updating a shadow member state
 */
export interface SaveShadowMemberInput {
  communityId: string;
  memberId: string;
  incumbentRoles?: string[];
  incumbentTier?: number | null;
  incumbentLastUpdate?: Date;
  arrakisRoles?: string[];
  arrakisTier?: number | null;
  arrakisConviction?: number | null;
  arrakisLastCalculated?: Date;
  divergenceType?: DivergenceType | null;
  divergenceReason?: string | null;
  divergenceDetectedAt?: Date | null;
}

/**
 * Stored shadow member state
 */
export interface StoredShadowMemberState {
  id: string;
  communityId: string;
  memberId: string;
  incumbentRoles: string[];
  incumbentTier: number | null;
  incumbentLastUpdate: Date | null;
  arrakisRoles: string[];
  arrakisTier: number | null;
  arrakisConviction: number | null;
  arrakisLastCalculated: Date | null;
  divergenceType: DivergenceType | null;
  divergenceReason: string | null;
  divergenceDetectedAt: Date | null;
  lastSyncAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Input for saving a divergence record
 */
export interface SaveDivergenceInput {
  communityId: string;
  memberId: string;
  divergenceType: DivergenceType;
  incumbentState: ShadowStateSnapshot;
  arrakisState: ShadowStateSnapshot;
  reason?: string;
}

/**
 * Stored divergence record
 */
export interface StoredDivergence {
  id: string;
  communityId: string;
  memberId: string;
  divergenceType: DivergenceType;
  incumbentState: ShadowStateSnapshot;
  arrakisState: ShadowStateSnapshot;
  reason: string | null;
  detectedAt: Date;
  resolvedAt: Date | null;
  resolutionType: string | null;
  createdAt: Date;
}

/**
 * Input for saving a prediction record
 */
export interface SavePredictionInput {
  communityId: string;
  memberId: string;
  predictedRoles: string[];
  predictedTier?: number | null;
  predictedConviction?: number | null;
}

/**
 * Input for validating a prediction
 */
export interface ValidatePredictionInput {
  predictionId: string;
  actualRoles: string[];
  actualTier?: number | null;
  accurate: boolean;
  accuracyScore: number;
  accuracyDetails?: string;
}

/**
 * Stored prediction record
 */
export interface StoredPrediction {
  id: string;
  communityId: string;
  memberId: string;
  predictedRoles: string[];
  predictedTier: number | null;
  predictedConviction: number | null;
  predictedAt: Date;
  actualRoles: string[] | null;
  actualTier: number | null;
  validatedAt: Date | null;
  accurate: boolean | null;
  accuracyScore: number | null;
  accuracyDetails: string | null;
  createdAt: Date;
}

/**
 * Summary of divergences for a community
 */
export interface DivergenceSummary {
  communityId: string;
  totalMembers: number;
  matchCount: number;
  arrakisHigherCount: number;
  arrakisLowerCount: number;
  mismatchCount: number;
  accuracyPercent: number;
}

// =============================================================================
// Parallel Mode Types (Sprint 58)
// =============================================================================

/**
 * Input for saving/updating parallel role configuration
 */
export interface SaveParallelRoleConfigInput {
  communityId: string;
  namespace?: string;
  enabled?: boolean;
  positionStrategy?: RolePositionStrategy;
  tierRoleMapping?: TierRoleMapping[];
  customRoleNames?: Record<string, string>;
  grantPermissions?: boolean;
  setupCompletedAt?: Date;
  lastSyncAt?: Date;
  totalRolesCreated?: number;
}

/**
 * Stored parallel role configuration
 */
export interface StoredParallelRoleConfig {
  id: string;
  communityId: string;
  namespace: string;
  enabled: boolean;
  positionStrategy: RolePositionStrategy;
  tierRoleMapping: TierRoleMapping[];
  customRoleNames: Record<string, string>;
  grantPermissions: boolean;
  setupCompletedAt: Date | null;
  lastSyncAt: Date | null;
  totalRolesCreated: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Input for saving a parallel role (created in Discord)
 */
export interface SaveParallelRoleInput {
  communityId: string;
  discordRoleId: string;
  roleName: string;
  baseName: string;
  tier: number;
  minConviction: number;
  position: number;
  incumbentReferenceId?: string;
  color?: string;
  mentionable?: boolean;
  hoist?: boolean;
}

/**
 * Stored parallel role record
 */
export interface StoredParallelRole {
  id: string;
  communityId: string;
  discordRoleId: string;
  roleName: string;
  baseName: string;
  tier: number;
  minConviction: number;
  position: number;
  incumbentReferenceId: string | null;
  color: string | null;
  mentionable: boolean;
  hoist: boolean;
  memberCount: number;
  lastMemberCountUpdate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Input for saving/updating a parallel member assignment
 */
export interface SaveParallelMemberAssignmentInput {
  communityId: string;
  memberId: string;
  assignedTier?: number | null;
  assignedRoleIds?: string[];
  currentConviction?: number | null;
  incumbentTier?: number | null;
  incumbentRoleIds?: string[];
  lastAssignmentAt?: Date;
}

/**
 * Stored parallel member assignment
 */
export interface StoredParallelMemberAssignment {
  id: string;
  communityId: string;
  memberId: string;
  assignedTier: number | null;
  assignedRoleIds: string[];
  currentConviction: number | null;
  incumbentTier: number | null;
  incumbentRoleIds: string[];
  lastAssignmentAt: Date | null;
  lastSyncAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

// =============================================================================
// Parallel Channel Types (Sprint 59)
// =============================================================================

/**
 * Input for saving/updating parallel channel configuration
 */
export interface SaveParallelChannelConfigInput {
  communityId: string;
  strategy?: ChannelStrategy;
  enabled?: boolean;
  categoryName?: string;
  categoryId?: string;
  channelTemplates?: ParallelChannelTemplate[];
  customChannels?: CustomChannelDefinition[];
  mirrorSourceChannels?: string[];
  setupCompletedAt?: Date;
  lastSyncAt?: Date;
  totalChannelsCreated?: number;
}

/**
 * Stored parallel channel configuration
 */
export interface StoredParallelChannelConfig {
  id: string;
  communityId: string;
  strategy: ChannelStrategy;
  enabled: boolean;
  categoryName: string;
  categoryId: string | null;
  channelTemplates: ParallelChannelTemplate[];
  customChannels: CustomChannelDefinition[];
  mirrorSourceChannels: string[];
  setupCompletedAt: Date | null;
  lastSyncAt: Date | null;
  totalChannelsCreated: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Input for saving a parallel channel (created in Discord)
 */
export interface SaveParallelChannelInput {
  communityId: string;
  discordChannelId: string;
  channelName: string;
  channelType: 'text' | 'voice';
  minConviction: number;
  categoryId?: string;
  topic?: string;
  templateId?: string;
  isDefault?: boolean;
  mirrorSourceId?: string;
  isPublicView?: boolean;
}

/**
 * Stored parallel channel record
 */
export interface StoredParallelChannel {
  id: string;
  communityId: string;
  discordChannelId: string;
  channelName: string;
  channelType: 'text' | 'voice';
  minConviction: number;
  categoryId: string | null;
  topic: string | null;
  templateId: string | null;
  isDefault: boolean;
  mirrorSourceId: string | null;
  isPublicView: boolean;
  memberAccessCount: number;
  lastAccessUpdate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Input for saving/updating channel access for a member
 */
export interface SaveParallelChannelAccessInput {
  communityId: string;
  memberId: string;
  channelId: string;
  hasAccess?: boolean;
  currentConviction?: number | null;
  accessGrantedAt?: Date;
  lastAccessCheckAt?: Date;
}

/**
 * Stored parallel channel access record
 */
export interface StoredParallelChannelAccess {
  id: string;
  communityId: string;
  memberId: string;
  channelId: string;
  hasAccess: boolean;
  currentConviction: number | null;
  accessGrantedAt: Date | null;
  accessRevokedAt: Date | null;
  lastAccessCheckAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Re-export schema types for convenience
 */
export type {
  IncumbentProvider,
  HealthStatus,
  CoexistenceMode,
  MigrationStrategy,
  DetectedRole,
  IncumbentCapabilities,
  DivergenceType,
  ShadowStateSnapshot,
  TierRoleMapping,
  RolePositionStrategy,
  ChannelStrategy,
  ParallelChannelTemplate,
  CustomChannelDefinition,
};
