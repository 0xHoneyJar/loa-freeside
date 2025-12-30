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

  // =========================================================================
  // Query Methods
  // =========================================================================

  /**
   * Get all communities in a specific mode
   * @param mode - Coexistence mode to filter by
   */
  getCommunitiesByMode(mode: CoexistenceMode): Promise<string[]>;

  /**
   * Get communities ready for migration (passed readiness check)
   */
  getReadyCommunities(): Promise<string[]>;

  /**
   * Get incumbent health status across all communities
   * @returns Map of communityId -> healthStatus
   */
  getIncumbentHealthOverview(): Promise<Map<string, HealthStatus>>;
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
};
