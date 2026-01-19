/**
 * SimulationService - Orchestration Service for QA Sandbox Simulations
 *
 * Sprint 106: SimulationContext Foundation
 *
 * Manages the complete lifecycle of simulation contexts within sandboxes.
 * Provides Redis storage operations with proper serialization and
 * optimistic locking for concurrent access.
 *
 * @see SDD §4.2 SimulationService
 * @module services/sandbox/simulation-service
 */

import { createLogger, type ILogger } from '../../packages/infrastructure/logging/index.js';

/**
 * Minimal Redis interface for sandbox operations.
 * Avoids importing ioredis types directly to prevent version mismatch issues
 * and rootDir issues in monorepo builds.
 */
export interface MinimalRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<'OK'>;
  set(key: string, value: string, mode: 'EX' | 'PX', duration: number): Promise<'OK'>;
  del(...keys: string[]): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  scan(
    cursor: number | string,
    ...args: (string | number)[]
  ): Promise<[string, string[]]>;
  exists(...keys: string[]): Promise<number>;
  hget(key: string, field: string): Promise<string | null>;
  hset(key: string, field: string, value: string): Promise<number>;
  hdel(key: string, ...fields: string[]): Promise<number>;
  hgetall(key: string): Promise<Record<string, string>>;
  sadd(key: string, ...members: string[]): Promise<number>;
  srem(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  expire(key: string, seconds: number): Promise<number>;
  ttl(key: string): Promise<number>;
}
import {
  type SimulationContext,
  type SimulatedMemberState,
  type AssumedRole,
  type ThresholdOverrides,
  type TierId,
  type BadgeId,
  type EngagementStage,
  createSimulationContext,
  createDefaultMemberState,
  createAssumedRole,
  isValidTierId,
  isValidBadgeId,
  isValidEngagementStage,
  getEffectiveThresholds,
  calculateTierFromBgt,
  getDefaultRankForTier,
  tierMeetsRequirement,
  TIER_DISPLAY_NAMES,
  TIER_ORDER,
  DEFAULT_BGT_THRESHOLDS,
} from './simulation-context.js';

// =============================================================================
// Constants
// =============================================================================

/**
 * Redis key prefix for simulation contexts
 * Pattern: sandbox:simulation:{sandboxId}:{userId}
 */
export const SIMULATION_KEY_PREFIX = 'sandbox:simulation';

/**
 * Maximum length for a Redis key segment
 * Prevents memory exhaustion and keeps keys manageable
 */
export const MAX_KEY_SEGMENT_LENGTH = 64;

/**
 * Pattern for valid Redis key segments
 * Allows alphanumeric characters, hyphens, and underscores only
 * Prevents injection via wildcards (*), delimiters (:), or other patterns
 */
export const VALID_KEY_SEGMENT_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * Default TTL for simulation contexts (matches sandbox TTL)
 * 24 hours in seconds
 */
export const DEFAULT_CONTEXT_TTL_SECONDS = 24 * 60 * 60;

// =============================================================================
// Key Sanitization (CRITICAL-001 Fix)
// =============================================================================

/**
 * Error thrown when key segment validation fails
 */
export class KeyValidationError extends Error {
  constructor(
    public readonly segment: 'sandboxId' | 'userId',
    message: string
  ) {
    super(message);
    this.name = 'KeyValidationError';
  }
}

/**
 * Sanitize a Redis key segment to prevent injection attacks
 *
 * Validates that the segment:
 * - Contains only safe characters (alphanumeric, hyphens, underscores)
 * - Does not exceed maximum length
 * - Does not contain wildcards, delimiters, or other dangerous patterns
 *
 * @param segment - The key segment to validate
 * @param segmentName - Name of the segment for error messages ('sandboxId' or 'userId')
 * @returns The validated segment (unchanged if valid)
 * @throws KeyValidationError if segment is invalid
 *
 * @example
 * sanitizeRedisKeySegment('user123', 'userId');     // Returns 'user123'
 * sanitizeRedisKeySegment('a*b', 'sandboxId');      // Throws KeyValidationError
 * sanitizeRedisKeySegment('a:b:c', 'userId');       // Throws KeyValidationError
 */
export function sanitizeRedisKeySegment(
  segment: string,
  segmentName: 'sandboxId' | 'userId'
): string {
  // Check for empty or non-string input
  if (!segment || typeof segment !== 'string') {
    throw new KeyValidationError(
      segmentName,
      `Invalid ${segmentName}: must be a non-empty string`
    );
  }

  // Check length
  if (segment.length > MAX_KEY_SEGMENT_LENGTH) {
    throw new KeyValidationError(
      segmentName,
      `Invalid ${segmentName}: exceeds maximum length of ${MAX_KEY_SEGMENT_LENGTH} characters`
    );
  }

  // Check for safe characters only
  if (!VALID_KEY_SEGMENT_PATTERN.test(segment)) {
    throw new KeyValidationError(
      segmentName,
      `Invalid ${segmentName}: contains unsafe characters (only alphanumeric, hyphens, underscores allowed)`
    );
  }

  return segment;
}

/**
 * Redis key pattern for listing all contexts in a sandbox
 * Sanitizes sandboxId before constructing pattern
 *
 * @param sandboxId - The sandbox ID to create pattern for
 * @returns Redis key pattern for KEYS command
 * @throws KeyValidationError if sandboxId is invalid
 */
export function SIMULATION_KEY_PATTERN(sandboxId: string): string {
  const safeSandboxId = sanitizeRedisKeySegment(sandboxId, 'sandboxId');
  return `${SIMULATION_KEY_PREFIX}:${safeSandboxId}:*`;
}

// =============================================================================
// Types
// =============================================================================

/**
 * Error codes for simulation operations
 */
export enum SimulationErrorCode {
  /** Context not found */
  NOT_FOUND = 'SIM_001',
  /** Validation error */
  VALIDATION_ERROR = 'SIM_002',
  /** Version conflict (optimistic locking) */
  VERSION_CONFLICT = 'SIM_003',
  /** Redis operation failed */
  STORAGE_ERROR = 'SIM_004',
  /** Sandbox not active */
  SANDBOX_INACTIVE = 'SIM_005',
}

/**
 * Simulation-specific error
 */
export class SimulationError extends Error {
  constructor(
    public readonly code: SimulationErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'SimulationError';
  }
}

/**
 * Result of a simulation operation
 */
export interface SimulationResult<T> {
  success: boolean;
  data?: T;
  error?: {
    code: SimulationErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Options for creating/updating simulation context
 */
export interface SimulationContextOptions {
  /** Time-to-live in seconds (defaults to sandbox TTL) */
  ttlSeconds?: number;

  /** Expected version for optimistic locking */
  expectedVersion?: number;
}

/**
 * Source of tier determination
 */
export type TierSource = 'assumed' | 'computed';

/**
 * Tier information for whoami result
 */
export interface TierInfo {
  /** Tier ID */
  tierId: TierId;
  /** Display name */
  displayName: string;
  /** Rank within the tier */
  rank: number;
  /** Source of tier determination (only on effectiveTier) */
  source?: TierSource;
}

/**
 * Result of whoami operation
 */
export interface WhoamiResult {
  /** Sandbox ID */
  sandboxId: string;
  /** User ID */
  userId: string;
  /** Currently assumed role (null if none) */
  assumedRole: AssumedRole | null;
  /** Tier computed from member state */
  computedTier: TierInfo;
  /** Effective tier (assumed if set, otherwise computed) */
  effectiveTier: TierInfo & { source: TierSource };
  /** Current member state */
  memberState: SimulatedMemberState;
  /** Current threshold overrides (null if using defaults) */
  thresholdOverrides: ThresholdOverrides | null;
  /** Context version for optimistic locking */
  contextVersion: number;
}

/**
 * Result of state update operation (Sprint 108)
 */
export interface StateUpdateResult {
  /** Fields that were updated */
  updatedFields: string[];
  /** New member state after update */
  newState: SimulatedMemberState;
  /** Computed tier based on new state */
  computedTier: TierInfo;
  /** Context version after update */
  contextVersion: number;
}

// =============================================================================
// Permission Check Types (Sprint 109)
// =============================================================================

/**
 * Blur level based on engagement stage (from Progressive Gate)
 */
export type BlurLevel = 'none' | 'light' | 'medium' | 'heavy';

/**
 * Result of an access check
 */
export interface AccessCheckResult {
  /** Whether access is granted */
  allowed: boolean;
  /** The tier of the user */
  effectiveTier: TierId;
  /** The required tier for access */
  requiredTier: TierId | null;
  /** Blur level based on engagement stage */
  blurLevel: BlurLevel;
  /** Reason for the result (human-readable) */
  reason: string;
  /** All permissions available at the effective tier */
  permissions: string[];
}

/**
 * Result of tier check operation
 */
export interface TierCheckResult {
  /** Effective tier ID */
  tierId: TierId;
  /** Display name */
  tierName: string;
  /** Role color (hex) */
  roleColor: string;
  /** Source: assumed or computed */
  source: TierSource;
  /** Rank within the tier */
  rankInTier: number;
  /** Data used for tier computation */
  computedFrom: {
    bgtBalance: number;
    thresholdUsed: string;
  };
}

/**
 * Result of badge eligibility check
 */
export interface BadgeCheckResult {
  /** Badge identifier */
  badgeId: string;
  /** Badge display name */
  displayName: string;
  /** Whether user is eligible for this badge */
  eligible: boolean;
  /** Reason for eligibility/ineligibility */
  reason: string;
  /** Badge category */
  category: string;
}

// =============================================================================
// Serialization Functions (SDD §4.2.1)
// =============================================================================

/**
 * Serialize a SimulationContext to JSON string for Redis storage
 *
 * @param context - The context to serialize
 * @returns JSON string
 */
export function serializeContext(context: SimulationContext): string {
  return JSON.stringify(context);
}

/**
 * Deserialize a JSON string from Redis to SimulationContext
 *
 * @param json - The JSON string to deserialize
 * @returns Parsed SimulationContext
 * @throws Error if JSON is invalid or doesn't match schema
 */
export function deserializeContext(json: string): SimulationContext {
  const parsed = JSON.parse(json);

  // Validate required fields
  if (!parsed.sandboxId || typeof parsed.sandboxId !== 'string') {
    throw new Error('Invalid context: missing or invalid sandboxId');
  }
  if (!parsed.userId || typeof parsed.userId !== 'string') {
    throw new Error('Invalid context: missing or invalid userId');
  }
  if (!parsed.memberState || typeof parsed.memberState !== 'object') {
    throw new Error('Invalid context: missing or invalid memberState');
  }

  return parsed as SimulationContext;
}

/**
 * Build Redis key for a simulation context
 *
 * Sanitizes both sandboxId and userId to prevent key injection attacks.
 *
 * @param sandboxId - The sandbox ID
 * @param userId - The user ID
 * @returns Redis key string
 * @throws KeyValidationError if sandboxId or userId contains unsafe characters
 */
export function buildContextKey(sandboxId: string, userId: string): string {
  const safeSandboxId = sanitizeRedisKeySegment(sandboxId, 'sandboxId');
  const safeUserId = sanitizeRedisKeySegment(userId, 'userId');
  return `${SIMULATION_KEY_PREFIX}:${safeSandboxId}:${safeUserId}`;
}

// =============================================================================
// SimulationService Implementation
// =============================================================================

/**
 * SimulationService
 *
 * Orchestrates all simulation operations within a sandbox.
 * Provides CRUD operations for simulation contexts with Redis storage.
 */
export class SimulationService {
  private readonly logger: ILogger;

  constructor(
    private readonly redis: MinimalRedis,
    logger?: ILogger
  ) {
    this.logger = logger ?? createLogger({ service: 'SimulationService' });
  }

  // ===========================================================================
  // CRUD Operations (SDD §4.2.2)
  // ===========================================================================

  /**
   * Create a new simulation context for a user in a sandbox
   *
   * @param sandboxId - The sandbox ID
   * @param userId - The Discord user ID
   * @param options - Optional configuration
   * @returns SimulationResult with the created context
   */
  async createContext(
    sandboxId: string,
    userId: string,
    options?: SimulationContextOptions
  ): Promise<SimulationResult<SimulationContext>> {
    const key = buildContextKey(sandboxId, userId);

    // Check if context already exists
    const existing = await this.redis.get(key);
    if (existing) {
      this.logger.debug('Context already exists, returning existing', {
        sandboxId,
        userId,
      });
      return {
        success: true,
        data: deserializeContext(existing),
      };
    }

    // Create new context
    const context = createSimulationContext(sandboxId, userId);
    const json = serializeContext(context);
    const ttl = options?.ttlSeconds ?? DEFAULT_CONTEXT_TTL_SECONDS;

    try {
      await this.redis.set(key, json, 'EX', ttl);

      this.logger.info('Created simulation context', {
        sandboxId,
        userId,
        ttl,
      });

      return { success: true, data: context };
    } catch (err) {
      this.logger.error('Failed to create simulation context', {
        sandboxId,
        userId,
        error: String(err),
      });

      return {
        success: false,
        error: {
          code: SimulationErrorCode.STORAGE_ERROR,
          message: 'Failed to store simulation context',
          details: { originalError: String(err) },
        },
      };
    }
  }

  /**
   * Get an existing simulation context
   *
   * @param sandboxId - The sandbox ID
   * @param userId - The Discord user ID
   * @returns SimulationResult with the context or null if not found
   */
  async getContext(
    sandboxId: string,
    userId: string
  ): Promise<SimulationResult<SimulationContext | null>> {
    const key = buildContextKey(sandboxId, userId);

    try {
      const json = await this.redis.get(key);

      if (!json) {
        return { success: true, data: null };
      }

      const context = deserializeContext(json);
      return { success: true, data: context };
    } catch (err) {
      this.logger.error('Failed to get simulation context', {
        sandboxId,
        userId,
        error: String(err),
      });

      return {
        success: false,
        error: {
          code: SimulationErrorCode.STORAGE_ERROR,
          message: 'Failed to retrieve simulation context',
          details: { originalError: String(err) },
        },
      };
    }
  }

  /**
   * Get or create a simulation context
   *
   * Convenience method that returns existing context or creates a new one.
   *
   * @param sandboxId - The sandbox ID
   * @param userId - The Discord user ID
   * @param options - Optional configuration
   * @returns SimulationResult with the context
   */
  async getOrCreateContext(
    sandboxId: string,
    userId: string,
    options?: SimulationContextOptions
  ): Promise<SimulationResult<SimulationContext>> {
    const result = await this.getContext(sandboxId, userId);

    if (!result.success) {
      return result as SimulationResult<SimulationContext>;
    }

    if (result.data) {
      return { success: true, data: result.data };
    }

    return this.createContext(sandboxId, userId, options);
  }

  /**
   * Update a simulation context
   *
   * Uses optimistic locking to prevent concurrent modification issues.
   *
   * @param context - The updated context
   * @param options - Optional configuration including expected version
   * @returns SimulationResult with the updated context
   */
  async updateContext(
    context: SimulationContext,
    options?: SimulationContextOptions
  ): Promise<SimulationResult<SimulationContext>> {
    const key = buildContextKey(context.sandboxId, context.userId);

    // If expected version is specified, check for conflicts
    if (options?.expectedVersion !== undefined) {
      const existing = await this.redis.get(key);
      if (existing) {
        const existingContext = deserializeContext(existing);
        if (existingContext.version !== options.expectedVersion) {
          return {
            success: false,
            error: {
              code: SimulationErrorCode.VERSION_CONFLICT,
              message: 'Context version conflict',
              details: {
                expected: options.expectedVersion,
                actual: existingContext.version,
              },
            },
          };
        }
      }
    }

    // Update timestamp and version
    const updatedContext: SimulationContext = {
      ...context,
      updatedAt: new Date().toISOString(),
      version: context.version + 1,
    };

    const json = serializeContext(updatedContext);
    const ttl = options?.ttlSeconds ?? DEFAULT_CONTEXT_TTL_SECONDS;

    try {
      await this.redis.set(key, json, 'EX', ttl);

      this.logger.debug('Updated simulation context', {
        sandboxId: context.sandboxId,
        userId: context.userId,
        version: updatedContext.version,
      });

      return { success: true, data: updatedContext };
    } catch (err) {
      this.logger.error('Failed to update simulation context', {
        sandboxId: context.sandboxId,
        userId: context.userId,
        error: String(err),
      });

      return {
        success: false,
        error: {
          code: SimulationErrorCode.STORAGE_ERROR,
          message: 'Failed to update simulation context',
          details: { originalError: String(err) },
        },
      };
    }
  }

  /**
   * Delete a simulation context
   *
   * @param sandboxId - The sandbox ID
   * @param userId - The Discord user ID
   * @returns SimulationResult indicating success
   */
  async deleteContext(
    sandboxId: string,
    userId: string
  ): Promise<SimulationResult<void>> {
    const key = buildContextKey(sandboxId, userId);

    try {
      const deleted = await this.redis.del(key);

      if (deleted === 0) {
        this.logger.debug('Context not found for deletion', {
          sandboxId,
          userId,
        });
      } else {
        this.logger.info('Deleted simulation context', {
          sandboxId,
          userId,
        });
      }

      return { success: true };
    } catch (err) {
      this.logger.error('Failed to delete simulation context', {
        sandboxId,
        userId,
        error: String(err),
      });

      return {
        success: false,
        error: {
          code: SimulationErrorCode.STORAGE_ERROR,
          message: 'Failed to delete simulation context',
          details: { originalError: String(err) },
        },
      };
    }
  }

  /**
   * List all simulation contexts in a sandbox
   *
   * @param sandboxId - The sandbox ID
   * @returns SimulationResult with array of contexts
   */
  async listContexts(
    sandboxId: string
  ): Promise<SimulationResult<SimulationContext[]>> {
    const pattern = SIMULATION_KEY_PATTERN(sandboxId);

    try {
      const keys = await this.redis.keys(pattern);

      if (keys.length === 0) {
        return { success: true, data: [] };
      }

      const contexts: SimulationContext[] = [];

      for (const key of keys) {
        const json = await this.redis.get(key);
        if (json) {
          contexts.push(deserializeContext(json));
        }
      }

      return { success: true, data: contexts };
    } catch (err) {
      this.logger.error('Failed to list simulation contexts', {
        sandboxId,
        error: String(err),
      });

      return {
        success: false,
        error: {
          code: SimulationErrorCode.STORAGE_ERROR,
          message: 'Failed to list simulation contexts',
          details: { originalError: String(err) },
        },
      };
    }
  }

  /**
   * Delete all simulation contexts in a sandbox
   *
   * Used during sandbox teardown.
   *
   * @param sandboxId - The sandbox ID
   * @returns SimulationResult with count of deleted contexts
   */
  async deleteAllContexts(
    sandboxId: string
  ): Promise<SimulationResult<number>> {
    const pattern = SIMULATION_KEY_PATTERN(sandboxId);

    try {
      const keys = await this.redis.keys(pattern);

      if (keys.length === 0) {
        return { success: true, data: 0 };
      }

      const deleted = await this.redis.del(...keys);

      this.logger.info('Deleted all simulation contexts', {
        sandboxId,
        count: deleted,
      });

      return { success: true, data: deleted };
    } catch (err) {
      this.logger.error('Failed to delete all simulation contexts', {
        sandboxId,
        error: String(err),
      });

      return {
        success: false,
        error: {
          code: SimulationErrorCode.STORAGE_ERROR,
          message: 'Failed to delete all simulation contexts',
          details: { originalError: String(err) },
        },
      };
    }
  }

  // ===========================================================================
  // Role Operations (Preview for Sprint 107)
  // ===========================================================================

  /**
   * Assume a role within the simulation
   *
   * Sets the assumed role on the context, allowing the user to
   * appear as a member of the specified tier with the given badges.
   *
   * @param sandboxId - The sandbox ID
   * @param userId - The Discord user ID
   * @param tierId - The tier to assume
   * @param options - Optional role configuration including expected version for optimistic locking
   * @returns SimulationResult with updated context
   */
  async assumeRole(
    sandboxId: string,
    userId: string,
    tierId: TierId,
    options?: {
      rank?: number;
      badges?: BadgeId[];
      note?: string;
      expectedVersion?: number;
    }
  ): Promise<SimulationResult<SimulationContext>> {
    // Validate tier ID
    if (!isValidTierId(tierId)) {
      return {
        success: false,
        error: {
          code: SimulationErrorCode.VALIDATION_ERROR,
          message: `Invalid tier ID: ${tierId}`,
          details: { tierId },
        },
      };
    }

    // Validate badges if provided
    if (options?.badges) {
      for (const badgeId of options.badges) {
        if (!isValidBadgeId(badgeId)) {
          return {
            success: false,
            error: {
              code: SimulationErrorCode.VALIDATION_ERROR,
              message: `Invalid badge ID: ${badgeId}`,
              details: { badgeId },
            },
          };
        }
      }
    }

    // Get or create context
    const result = await this.getOrCreateContext(sandboxId, userId);
    if (!result.success || !result.data) {
      return result as SimulationResult<SimulationContext>;
    }

    const context = result.data;

    // Create assumed role
    const assumedRole = createAssumedRole(tierId, {
      rank: options?.rank,
      badges: options?.badges,
      note: options?.note,
    });

    // Update context
    const updatedContext: SimulationContext = {
      ...context,
      assumedRole,
    };

    const updateResult = await this.updateContext(updatedContext, {
      expectedVersion: options?.expectedVersion,
    });

    if (updateResult.success) {
      this.logger.info('Role assumed', {
        sandboxId,
        userId,
        tierId,
        rank: assumedRole.rank,
        badges: assumedRole.badges,
      });
    }

    return updateResult;
  }

  /**
   * Clear the assumed role, returning to default state
   *
   * @param sandboxId - The sandbox ID
   * @param userId - The Discord user ID
   * @returns SimulationResult with updated context
   */
  async clearRole(
    sandboxId: string,
    userId: string
  ): Promise<SimulationResult<SimulationContext>> {
    const result = await this.getContext(sandboxId, userId);
    if (!result.success) {
      return result as SimulationResult<SimulationContext>;
    }

    if (!result.data) {
      return {
        success: false,
        error: {
          code: SimulationErrorCode.NOT_FOUND,
          message: 'Simulation context not found',
          details: { sandboxId, userId },
        },
      };
    }

    const context = result.data;

    // Clear assumed role
    const updatedContext: SimulationContext = {
      ...context,
      assumedRole: null,
    };

    const updateResult = await this.updateContext(updatedContext);

    if (updateResult.success) {
      this.logger.info('Role cleared', { sandboxId, userId });
    }

    return updateResult;
  }

  /**
   * Get current role information (whoami)
   *
   * Returns the current assumed role, computed tier, and full state.
   *
   * @param sandboxId - The sandbox ID
   * @param userId - The Discord user ID
   * @returns SimulationResult with WhoamiResult
   */
  async whoami(
    sandboxId: string,
    userId: string
  ): Promise<SimulationResult<WhoamiResult>> {
    // Get or create context
    const result = await this.getOrCreateContext(sandboxId, userId);
    if (!result.success || !result.data) {
      return result as unknown as SimulationResult<WhoamiResult>;
    }

    const context = result.data;

    // Calculate computed tier from member state
    const effectiveThresholds = getEffectiveThresholds(context.thresholdOverrides);
    const computedTierId = calculateTierFromBgt(
      context.memberState.bgtBalance,
      effectiveThresholds
    );

    // Determine effective tier (assumed > computed)
    const effectiveTierId = context.assumedRole?.tierId ?? computedTierId;
    const tierSource: TierSource = context.assumedRole ? 'assumed' : 'computed';

    const whoamiResult: WhoamiResult = {
      sandboxId,
      userId,
      assumedRole: context.assumedRole,
      computedTier: {
        tierId: computedTierId,
        displayName: TIER_DISPLAY_NAMES[computedTierId],
        rank: context.assumedRole?.rank ?? getDefaultRankForTier(computedTierId),
      },
      effectiveTier: {
        tierId: effectiveTierId,
        displayName: TIER_DISPLAY_NAMES[effectiveTierId],
        rank: context.assumedRole?.rank ?? getDefaultRankForTier(effectiveTierId),
        source: tierSource,
      },
      memberState: context.memberState,
      thresholdOverrides: context.thresholdOverrides,
      contextVersion: context.version,
    };

    this.logger.debug('Whoami result', {
      sandboxId,
      userId,
      effectiveTier: effectiveTierId,
      tierSource,
    });

    return { success: true, data: whoamiResult };
  }

  // ===========================================================================
  // State Operations (Sprint 108)
  // ===========================================================================

  /**
   * Get current member state
   *
   * Convenience method that returns just the member state without
   * the full context. Useful for quick state checks.
   *
   * @param sandboxId - The sandbox ID
   * @param userId - The Discord user ID
   * @returns SimulationResult with member state
   */
  async getState(
    sandboxId: string,
    userId: string
  ): Promise<SimulationResult<SimulatedMemberState>> {
    const result = await this.getContext(sandboxId, userId);
    if (!result.success) {
      return result as unknown as SimulationResult<SimulatedMemberState>;
    }

    if (!result.data) {
      return {
        success: false,
        error: {
          code: SimulationErrorCode.NOT_FOUND,
          message: 'Simulation context not found',
          details: { sandboxId, userId },
        },
      };
    }

    return { success: true, data: result.data.memberState };
  }

  /**
   * Set member state with enhanced result
   *
   * Updates member state and returns detailed result including
   * which fields were updated and the computed tier.
   *
   * @param sandboxId - The sandbox ID
   * @param userId - The Discord user ID
   * @param updates - Partial member state updates
   * @param options - Optional configuration including expected version for optimistic locking
   * @returns SimulationResult with StateUpdateResult
   */
  async setState(
    sandboxId: string,
    userId: string,
    updates: Partial<SimulatedMemberState>,
    options?: SimulationContextOptions
  ): Promise<SimulationResult<StateUpdateResult>> {
    // Track which fields are being updated
    const updatedFields = Object.keys(updates).filter(
      (key) => updates[key as keyof SimulatedMemberState] !== undefined
    );

    // Use updateMemberState for validation and storage
    const result = await this.updateMemberState(sandboxId, userId, updates, options);
    if (!result.success || !result.data) {
      return result as unknown as SimulationResult<StateUpdateResult>;
    }

    const context = result.data;

    // Calculate computed tier from updated state
    const effectiveThresholds = getEffectiveThresholds(context.thresholdOverrides);
    const computedTierId = calculateTierFromBgt(
      context.memberState.bgtBalance,
      effectiveThresholds
    );

    const stateResult: StateUpdateResult = {
      updatedFields,
      newState: context.memberState,
      computedTier: {
        tierId: computedTierId,
        displayName: TIER_DISPLAY_NAMES[computedTierId],
        rank: getDefaultRankForTier(computedTierId),
      },
      contextVersion: context.version,
    };

    this.logger.debug('State set via setState', {
      sandboxId,
      userId,
      updatedFields,
      computedTier: computedTierId,
    });

    return { success: true, data: stateResult };
  }

  /**
   * Update member state within the simulation
   *
   * @param sandboxId - The sandbox ID
   * @param userId - The Discord user ID
   * @param updates - Partial member state updates
   * @param options - Optional configuration including expected version for optimistic locking
   * @returns SimulationResult with updated context
   */
  async updateMemberState(
    sandboxId: string,
    userId: string,
    updates: Partial<SimulatedMemberState>,
    options?: SimulationContextOptions
  ): Promise<SimulationResult<SimulationContext>> {
    // Validate engagement stage if provided
    if (updates.engagementStage && !isValidEngagementStage(updates.engagementStage)) {
      return {
        success: false,
        error: {
          code: SimulationErrorCode.VALIDATION_ERROR,
          message: `Invalid engagement stage: ${updates.engagementStage}`,
          details: { engagementStage: updates.engagementStage },
        },
      };
    }

    // Validate numeric fields are non-negative
    const numericFields = ['bgtBalance', 'convictionScore', 'activityScore', 'tenureDays', 'engagementPoints'];
    for (const field of numericFields) {
      const value = updates[field as keyof SimulatedMemberState];
      if (typeof value === 'number' && value < 0) {
        return {
          success: false,
          error: {
            code: SimulationErrorCode.VALIDATION_ERROR,
            message: `${field} cannot be negative`,
            details: { field, value },
          },
        };
      }
    }

    // Get or create context
    const result = await this.getOrCreateContext(sandboxId, userId);
    if (!result.success || !result.data) {
      return result as SimulationResult<SimulationContext>;
    }

    const context = result.data;

    // Merge updates into member state
    const updatedContext: SimulationContext = {
      ...context,
      memberState: {
        ...context.memberState,
        ...updates,
      },
    };

    const updateResult = await this.updateContext(updatedContext, options);

    if (updateResult.success) {
      this.logger.debug('Member state updated', {
        sandboxId,
        userId,
        updates,
      });
    }

    return updateResult;
  }

  /**
   * Reset member state to defaults
   *
   * @param sandboxId - The sandbox ID
   * @param userId - The Discord user ID
   * @returns SimulationResult with updated context
   */
  async resetMemberState(
    sandboxId: string,
    userId: string
  ): Promise<SimulationResult<SimulationContext>> {
    const result = await this.getContext(sandboxId, userId);
    if (!result.success) {
      return result as SimulationResult<SimulationContext>;
    }

    if (!result.data) {
      return {
        success: false,
        error: {
          code: SimulationErrorCode.NOT_FOUND,
          message: 'Simulation context not found',
          details: { sandboxId, userId },
        },
      };
    }

    const context = result.data;

    // Reset to default member state
    const updatedContext: SimulationContext = {
      ...context,
      memberState: createDefaultMemberState(),
    };

    const updateResult = await this.updateContext(updatedContext);

    if (updateResult.success) {
      this.logger.info('Member state reset', { sandboxId, userId });
    }

    return updateResult;
  }

  // ===========================================================================
  // Threshold Operations (Sprint 110)
  // ===========================================================================

  /**
   * Get current threshold overrides
   *
   * @param sandboxId - The sandbox ID
   * @param userId - The Discord user ID
   * @returns SimulationResult with threshold overrides or null if using defaults
   */
  async getThresholdOverrides(
    sandboxId: string,
    userId: string
  ): Promise<SimulationResult<ThresholdOverrides | null>> {
    const result = await this.getContext(sandboxId, userId);
    if (!result.success) {
      return result as SimulationResult<ThresholdOverrides | null>;
    }

    if (!result.data) {
      return {
        success: false,
        error: {
          code: SimulationErrorCode.NOT_FOUND,
          message: 'Simulation context not found',
          details: { sandboxId, userId },
        },
      };
    }

    return { success: true, data: result.data.thresholdOverrides };
  }

  /**
   * Set threshold overrides for the simulation
   *
   * @param sandboxId - The sandbox ID
   * @param userId - The Discord user ID
   * @param overrides - Threshold overrides to apply
   * @param options - Optional configuration including expected version for optimistic locking
   * @returns SimulationResult with updated context
   */
  async setThresholdOverrides(
    sandboxId: string,
    userId: string,
    overrides: ThresholdOverrides,
    options?: SimulationContextOptions
  ): Promise<SimulationResult<SimulationContext>> {
    // Validate all thresholds are positive
    for (const [key, value] of Object.entries(overrides)) {
      if (value !== undefined && value <= 0) {
        return {
          success: false,
          error: {
            code: SimulationErrorCode.VALIDATION_ERROR,
            message: `Threshold ${key} must be positive`,
            details: { threshold: key, value },
          },
        };
      }
    }

    // Get or create context
    const result = await this.getOrCreateContext(sandboxId, userId);
    if (!result.success || !result.data) {
      return result as SimulationResult<SimulationContext>;
    }

    const context = result.data;

    // Set overrides
    const updatedContext: SimulationContext = {
      ...context,
      thresholdOverrides: overrides,
    };

    const updateResult = await this.updateContext(updatedContext, options);

    if (updateResult.success) {
      this.logger.info('Threshold overrides set', {
        sandboxId,
        userId,
        overrides,
      });
    }

    return updateResult;
  }

  /**
   * Clear threshold overrides, reverting to production values
   *
   * @param sandboxId - The sandbox ID
   * @param userId - The Discord user ID
   * @returns SimulationResult with updated context
   */
  async clearThresholdOverrides(
    sandboxId: string,
    userId: string
  ): Promise<SimulationResult<SimulationContext>> {
    const result = await this.getContext(sandboxId, userId);
    if (!result.success) {
      return result as SimulationResult<SimulationContext>;
    }

    if (!result.data) {
      return {
        success: false,
        error: {
          code: SimulationErrorCode.NOT_FOUND,
          message: 'Simulation context not found',
          details: { sandboxId, userId },
        },
      };
    }

    const context = result.data;

    // Clear overrides
    const updatedContext: SimulationContext = {
      ...context,
      thresholdOverrides: null,
    };

    const updateResult = await this.updateContext(updatedContext);

    if (updateResult.success) {
      this.logger.info('Threshold overrides cleared', { sandboxId, userId });
    }

    return updateResult;
  }

  // ===========================================================================
  // Permission Check Operations (Sprint 109)
  // ===========================================================================

  /**
   * Check access to a channel
   *
   * Uses the Sietch theme's channel template to determine required tier
   * for the specified channel or category.
   *
   * @param sandboxId - The sandbox ID
   * @param userId - The Discord user ID
   * @param channelId - Channel name/id to check (e.g., 'council-chamber', 'naib-council')
   * @returns SimulationResult with AccessCheckResult
   */
  async checkChannelAccess(
    sandboxId: string,
    userId: string,
    channelId: string
  ): Promise<SimulationResult<AccessCheckResult>> {
    // Get or create context
    const result = await this.getOrCreateContext(sandboxId, userId);
    if (!result.success || !result.data) {
      return result as unknown as SimulationResult<AccessCheckResult>;
    }

    const context = result.data;

    // Calculate effective tier
    const effectiveThresholds = getEffectiveThresholds(context.thresholdOverrides);
    const computedTierId = calculateTierFromBgt(
      context.memberState.bgtBalance,
      effectiveThresholds
    );
    const effectiveTierId = context.assumedRole?.tierId ?? computedTierId;

    // Get blur level based on engagement stage
    const blurLevel = this.getBlurLevel(context.memberState.engagementStage);

    // Get permissions for effective tier
    const permissions = this.getPermissionsForTier(effectiveTierId);

    // Look up channel in channel template
    const channelInfo = this.findChannelInTemplate(channelId);

    if (!channelInfo) {
      // Channel not found - treat as general access
      return {
        success: true,
        data: {
          allowed: true,
          effectiveTier: effectiveTierId,
          requiredTier: null,
          blurLevel,
          reason: 'Channel not restricted',
          permissions,
        },
      };
    }

    const requiredTier = channelInfo.tierRestriction as TierId | null;

    if (!requiredTier) {
      // No tier restriction
      return {
        success: true,
        data: {
          allowed: true,
          effectiveTier: effectiveTierId,
          requiredTier: null,
          blurLevel,
          reason: 'Channel is open to all tiers',
          permissions,
        },
      };
    }

    // Check if effective tier meets requirement
    const allowed = tierMeetsRequirement(effectiveTierId, requiredTier);

    return {
      success: true,
      data: {
        allowed,
        effectiveTier: effectiveTierId,
        requiredTier,
        blurLevel,
        reason: allowed
          ? `Access granted: ${TIER_DISPLAY_NAMES[effectiveTierId]} meets ${TIER_DISPLAY_NAMES[requiredTier]} requirement`
          : `Access denied: ${TIER_DISPLAY_NAMES[effectiveTierId]} does not meet ${TIER_DISPLAY_NAMES[requiredTier]} requirement`,
        permissions,
      },
    };
  }

  /**
   * Check access to a feature/permission
   *
   * @param sandboxId - The sandbox ID
   * @param userId - The Discord user ID
   * @param featureId - Feature/permission ID to check (e.g., 'vote', 'council_access')
   * @returns SimulationResult with AccessCheckResult
   */
  async checkFeatureAccess(
    sandboxId: string,
    userId: string,
    featureId: string
  ): Promise<SimulationResult<AccessCheckResult>> {
    // Get or create context
    const result = await this.getOrCreateContext(sandboxId, userId);
    if (!result.success || !result.data) {
      return result as unknown as SimulationResult<AccessCheckResult>;
    }

    const context = result.data;

    // Calculate effective tier
    const effectiveThresholds = getEffectiveThresholds(context.thresholdOverrides);
    const computedTierId = calculateTierFromBgt(
      context.memberState.bgtBalance,
      effectiveThresholds
    );
    const effectiveTierId = context.assumedRole?.tierId ?? computedTierId;

    // Get blur level based on engagement stage
    const blurLevel = this.getBlurLevel(context.memberState.engagementStage);

    // Get permissions for effective tier
    const permissions = this.getPermissionsForTier(effectiveTierId);

    // Check if feature is in permissions
    const allowed = permissions.includes(featureId);

    // Find which tier grants this permission (for context)
    const grantingTier = this.findTierWithPermission(featureId);

    return {
      success: true,
      data: {
        allowed,
        effectiveTier: effectiveTierId,
        requiredTier: grantingTier,
        blurLevel,
        reason: allowed
          ? `Feature "${featureId}" is available at ${TIER_DISPLAY_NAMES[effectiveTierId]} tier`
          : grantingTier
            ? `Feature "${featureId}" requires ${TIER_DISPLAY_NAMES[grantingTier]} tier or higher`
            : `Feature "${featureId}" is not available at any tier`,
        permissions,
      },
    };
  }

  /**
   * Check current tier status
   *
   * @param sandboxId - The sandbox ID
   * @param userId - The Discord user ID
   * @returns SimulationResult with TierCheckResult
   */
  async checkTier(
    sandboxId: string,
    userId: string
  ): Promise<SimulationResult<TierCheckResult>> {
    // Get or create context
    const result = await this.getOrCreateContext(sandboxId, userId);
    if (!result.success || !result.data) {
      return result as unknown as SimulationResult<TierCheckResult>;
    }

    const context = result.data;

    // Calculate tiers
    const effectiveThresholds = getEffectiveThresholds(context.thresholdOverrides);
    const computedTierId = calculateTierFromBgt(
      context.memberState.bgtBalance,
      effectiveThresholds
    );
    const effectiveTierId = context.assumedRole?.tierId ?? computedTierId;
    const source: TierSource = context.assumedRole ? 'assumed' : 'computed';

    // Get tier color
    const tierColors: Record<TierId, string> = {
      naib: '#FFD700',
      fedaykin: '#4169E1',
      usul: '#9B59B6',
      sayyadina: '#6610F2',
      mushtamal: '#20C997',
      sihaya: '#28A745',
      qanat: '#17A2B8',
      ichwan: '#FD7E14',
      hajra: '#C2B280',
    };

    // Determine which threshold was used for computation
    const thresholdUsed = this.getThresholdUsed(computedTierId, effectiveThresholds);

    return {
      success: true,
      data: {
        tierId: effectiveTierId,
        tierName: TIER_DISPLAY_NAMES[effectiveTierId],
        roleColor: tierColors[effectiveTierId],
        source,
        rankInTier: context.assumedRole?.rank ?? getDefaultRankForTier(effectiveTierId),
        computedFrom: {
          bgtBalance: context.memberState.bgtBalance,
          thresholdUsed,
        },
      },
    };
  }

  /**
   * Check badge eligibility
   *
   * Evaluates all badges from the Sietch theme against current simulated state.
   *
   * @param sandboxId - The sandbox ID
   * @param userId - The Discord user ID
   * @returns SimulationResult with array of BadgeCheckResult
   */
  async checkBadges(
    sandboxId: string,
    userId: string
  ): Promise<SimulationResult<BadgeCheckResult[]>> {
    // Get or create context
    const result = await this.getOrCreateContext(sandboxId, userId);
    if (!result.success || !result.data) {
      return result as unknown as SimulationResult<BadgeCheckResult[]>;
    }

    const context = result.data;

    // Get effective tier for tier_reached badges
    const effectiveThresholds = getEffectiveThresholds(context.thresholdOverrides);
    const computedTierId = calculateTierFromBgt(
      context.memberState.bgtBalance,
      effectiveThresholds
    );
    const effectiveTierId = context.assumedRole?.tierId ?? computedTierId;

    // Evaluate all Sietch badges
    const badgeResults: BadgeCheckResult[] = [];

    // Tenure badges
    badgeResults.push(this.evaluateTenureBadge('og', 'OG', 180, context.memberState.tenureDays));
    badgeResults.push(this.evaluateTenureBadge('veteran', 'Sietch Veteran', 90, context.memberState.tenureDays));
    badgeResults.push(this.evaluateTenureBadge('elder', 'Elder', 30, context.memberState.tenureDays));

    // Tier-reached badges
    badgeResults.push(this.evaluateTierReachedBadge('naib_ascended', 'Naib Ascended', 'naib', effectiveTierId));
    badgeResults.push(this.evaluateTierReachedBadge('fedaykin_initiated', 'Fedaykin Initiated', 'fedaykin', effectiveTierId));
    badgeResults.push(this.evaluateTierReachedBadge('usul_ascended', 'Usul Ascended', 'usul', effectiveTierId));

    // Activity badges
    badgeResults.push(this.evaluateActivityBadge('desert_active', 'Desert Active', 50, context.memberState.activityScore));
    badgeResults.push(this.evaluateActivityBadge('sietch_engaged', 'Sietch Engaged', 25, context.memberState.activityScore));

    // Conviction badge
    badgeResults.push({
      badgeId: 'first_maker',
      displayName: 'First Maker',
      eligible: context.memberState.convictionScore >= 100,
      reason: context.memberState.convictionScore >= 100
        ? `Conviction score ${context.memberState.convictionScore} >= 100`
        : `Conviction score ${context.memberState.convictionScore} < 100 required`,
      category: 'achievement',
    });

    // Special badges (Water Sharer requires custom evaluator)
    badgeResults.push({
      badgeId: 'water_sharer',
      displayName: 'Water Sharer',
      eligible: false, // Custom evaluator required - cannot evaluate in simulation
      reason: 'Water Sharer badge requires custom evaluator (referral lineage)',
      category: 'special',
    });

    this.logger.debug('Badge check completed', {
      sandboxId,
      userId,
      eligibleCount: badgeResults.filter((b) => b.eligible).length,
      totalBadges: badgeResults.length,
    });

    return { success: true, data: badgeResults };
  }

  // ===========================================================================
  // Private Helpers (Sprint 109)
  // ===========================================================================

  /**
   * Get blur level based on engagement stage
   */
  private getBlurLevel(stage: EngagementStage): BlurLevel {
    switch (stage) {
      case 'verified':
        return 'none';
      case 'engaged':
        return 'light';
      case 'free':
      default:
        return 'heavy';
    }
  }

  /**
   * Get permissions for a tier
   * Returns cumulative permissions (includes all lower tier permissions)
   */
  private getPermissionsForTier(tierId: TierId): string[] {
    const tierPermissions: Record<TierId, string[]> = {
      naib: ['view_all', 'council_access', 'vote', 'govern', 'naib_ceremony'],
      fedaykin: ['view_all', 'vote', 'elite_access', 'water_share'],
      usul: ['view_premium', 'vote', 'inner_circle'],
      sayyadina: ['view_premium', 'vote', 'ceremony_access'],
      mushtamal: ['view_premium', 'vote', 'garden_access'],
      sihaya: ['view_standard', 'vote'],
      qanat: ['view_standard', 'limited_vote'],
      ichwan: ['view_basic'],
      hajra: ['view_general'],
    };

    return tierPermissions[tierId] ?? ['view_general'];
  }

  /**
   * Find channel in Sietch channel template
   */
  private findChannelInTemplate(channelId: string): { tierRestriction?: string } | null {
    // Simplified channel template lookup
    // In production, this would use SietchTheme.getChannelTemplate()
    const channelMap: Record<string, { tierRestriction?: string }> = {
      // Naib Council
      'council-chamber': { tierRestriction: 'naib' },
      'naib-voice': { tierRestriction: 'naib' },
      'naib-council': { tierRestriction: 'naib' },
      // Fedaykin Quarters
      'war-room': { tierRestriction: 'fedaykin' },
      'fedaykin-voice': { tierRestriction: 'fedaykin' },
      'fedaykin-quarters': { tierRestriction: 'fedaykin' },
      // Common/unrestricted
      'sietch-lounge': {},
      'the-door': {},
      'desert-laws': {},
      'announcements': {},
      'census': {},
      'introductions': {},
      'spice-market': {},
      'desert-voice': {},
      'bot-commands': {},
      'leaderboard': {},
      'oasis-lounge': {},
      'taqwa-waiting': {},
    };

    return channelMap[channelId] ?? null;
  }

  /**
   * Find which tier grants a permission
   */
  private findTierWithPermission(featureId: string): TierId | null {
    const tierPermissions: Record<TierId, string[]> = {
      naib: ['view_all', 'council_access', 'vote', 'govern', 'naib_ceremony'],
      fedaykin: ['view_all', 'vote', 'elite_access', 'water_share'],
      usul: ['view_premium', 'vote', 'inner_circle'],
      sayyadina: ['view_premium', 'vote', 'ceremony_access'],
      mushtamal: ['view_premium', 'vote', 'garden_access'],
      sihaya: ['view_standard', 'vote'],
      qanat: ['view_standard', 'limited_vote'],
      ichwan: ['view_basic'],
      hajra: ['view_general'],
    };

    // Find the lowest tier that has this permission (most accessible)
    for (const tier of [...TIER_ORDER].reverse()) {
      if (tierPermissions[tier]?.includes(featureId)) {
        return tier;
      }
    }

    return null;
  }

  /**
   * Get threshold description used for tier computation
   */
  private getThresholdUsed(tierId: TierId, thresholds: ThresholdOverrides | null): string {
    const defaults = DEFAULT_BGT_THRESHOLDS;
    const actual = thresholds ?? {};

    // For rank-based tiers, return rank description
    if (tierId === 'naib') return 'Rank 1-7';
    if (tierId === 'fedaykin') return 'Rank 8-69';

    // For BGT-based tiers
    const threshold = actual[tierId] ?? defaults[tierId as keyof typeof defaults];
    return threshold !== undefined
      ? `BGT >= ${threshold}${actual[tierId] ? ' (overridden)' : ''}`
      : 'Default thresholds';
  }

  /**
   * Evaluate tenure badge
   */
  private evaluateTenureBadge(
    badgeId: string,
    displayName: string,
    requiredDays: number,
    actualDays: number
  ): BadgeCheckResult {
    return {
      badgeId,
      displayName,
      eligible: actualDays >= requiredDays,
      reason: actualDays >= requiredDays
        ? `Tenure ${actualDays} days >= ${requiredDays} required`
        : `Tenure ${actualDays} days < ${requiredDays} required`,
      category: 'tenure',
    };
  }

  /**
   * Evaluate tier-reached badge
   */
  private evaluateTierReachedBadge(
    badgeId: string,
    displayName: string,
    requiredTier: TierId,
    actualTier: TierId
  ): BadgeCheckResult {
    const eligible = tierMeetsRequirement(actualTier, requiredTier);
    return {
      badgeId,
      displayName,
      eligible,
      reason: eligible
        ? `Current tier ${TIER_DISPLAY_NAMES[actualTier]} meets ${TIER_DISPLAY_NAMES[requiredTier]} requirement`
        : `Current tier ${TIER_DISPLAY_NAMES[actualTier]} does not meet ${TIER_DISPLAY_NAMES[requiredTier]} requirement`,
      category: 'achievement',
    };
  }

  /**
   * Evaluate activity badge
   */
  private evaluateActivityBadge(
    badgeId: string,
    displayName: string,
    requiredScore: number,
    actualScore: number
  ): BadgeCheckResult {
    return {
      badgeId,
      displayName,
      eligible: actualScore >= requiredScore,
      reason: actualScore >= requiredScore
        ? `Activity score ${actualScore} >= ${requiredScore} required`
        : `Activity score ${actualScore} < ${requiredScore} required`,
      category: 'activity',
    };
  }
}

/**
 * Factory function to create SimulationService
 */
export function createSimulationService(
  redis: MinimalRedis,
  logger?: ILogger
): SimulationService {
  return new SimulationService(redis, logger);
}
