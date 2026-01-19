/**
 * Scope Validation Middleware
 *
 * Sprint 121: Scope Validation
 *
 * Prevents privilege escalation attacks by ensuring users can only modify
 * tiers at or below their own tier level. Uses the server's role mappings
 * to determine the user's tier based on their Discord roles.
 *
 * @see grimoires/loa/sdd.md §4.2 Security Middleware
 * @module api/middleware/scopeValidation
 */

import type { Request, Response, NextFunction } from 'express';
import type { AuthenticatedDashboardRequest } from './dashboardAuth.js';
import type { CurrentConfiguration, RoleMapping } from '../../db/types/config.types.js';
import type { IConfigService } from '../../services/config/ConfigService.js';
import { logger } from '../../utils/logger.js';
import { recordScopeViolation, getScopeMetricsPrometheus } from './scopeMetrics.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Request with scope validation context
 */
export interface ScopeValidatedRequest extends AuthenticatedDashboardRequest {
  /** User's highest tier index (0 = highest privilege) */
  userTierIndex: number;
  /** User's highest tier ID */
  userTierId: string | null;
  /** All tier IDs the user has access to modify (at or below their level) */
  allowedTierIds: string[];
  /** Current server configuration */
  serverConfig: CurrentConfiguration;
}

/**
 * Tier hierarchy configuration
 */
export interface TierHierarchy {
  /** Tier ID */
  id: string;
  /** Tier index (0 = highest tier) */
  index: number;
}

/**
 * Configuration for scope validation middleware
 */
export interface ScopeValidationConfig {
  configService: IConfigService;
  /** Optional tier hierarchy (if not provided, uses role mapping priority) */
  tierHierarchy?: TierHierarchy[];
  /** Discord API for fetching user roles */
  discordApi?: {
    getMemberRoles: (guildId: string, userId: string, accessToken: string) => Promise<string[]>;
  };
  logger?: typeof logger;
}

/**
 * Scope validation result
 */
export interface ScopeValidationResult {
  allowed: boolean;
  userTierIndex: number;
  userTierId: string | null;
  allowedTierIds: string[];
  blockedTierIds?: string[];
  reason?: string;
}

// =============================================================================
// Constants
// =============================================================================

const DISCORD_API_BASE = 'https://discord.com/api/v10';

/**
 * Sprint 134 (HIGH-002): Production mode check for error sanitization
 */
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Cache user roles for 5 minutes
const USER_ROLES_CACHE = new Map<
  string,
  {
    roles: string[];
    fetchedAt: number;
  }
>();
const USER_ROLES_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Extract tier IDs from a request body.
 *
 * Supports multiple request body formats:
 * - { tierId: string }
 * - { tierIds: string[] }
 * - { changes: Array<{ tierId: string }> }
 * - { thresholds: { [tierId]: ... } }
 *
 * @param body - Request body
 * @returns Array of tier IDs found in the request
 */
export function extractTargetTiers(body: unknown): string[] {
  const tierIds: Set<string> = new Set();

  if (!body || typeof body !== 'object') {
    return [];
  }

  const obj = body as Record<string, unknown>;

  // Direct tierId field
  if (typeof obj.tierId === 'string') {
    tierIds.add(obj.tierId);
  }

  // Array of tierIds
  if (Array.isArray(obj.tierIds)) {
    for (const id of obj.tierIds) {
      if (typeof id === 'string') {
        tierIds.add(id);
      }
    }
  }

  // Changes array with tierId field (threshold/feature gate changes)
  if (Array.isArray(obj.changes)) {
    for (const change of obj.changes) {
      if (change && typeof change === 'object' && typeof (change as Record<string, unknown>).tierId === 'string') {
        tierIds.add((change as Record<string, unknown>).tierId as string);
      }
    }
  }

  // Thresholds object with tier IDs as keys
  if (obj.thresholds && typeof obj.thresholds === 'object') {
    for (const tierId of Object.keys(obj.thresholds)) {
      tierIds.add(tierId);
    }
  }

  // Role mapping changes (newTierId field)
  if (Array.isArray(obj.changes)) {
    for (const change of obj.changes) {
      if (change && typeof change === 'object') {
        const c = change as Record<string, unknown>;
        if (typeof c.newTierId === 'string') {
          tierIds.add(c.newTierId);
        }
        // Also check oldTierId for moves
        if (typeof c.oldTierId === 'string') {
          tierIds.add(c.oldTierId);
        }
      }
    }
  }

  // Feature gate changes (tierId field)
  if (Array.isArray(obj.featureGates)) {
    for (const gate of obj.featureGates) {
      if (gate && typeof gate === 'object' && typeof (gate as Record<string, unknown>).tierId === 'string') {
        tierIds.add((gate as Record<string, unknown>).tierId as string);
      }
    }
  }

  return Array.from(tierIds);
}

/**
 * Get user's Discord roles in a guild.
 *
 * @param guildId - Discord guild ID
 * @param userId - Discord user ID
 * @param accessToken - User's Discord access token
 * @returns Array of role IDs the user has
 */
export async function fetchUserRoles(
  guildId: string,
  userId: string,
  accessToken: string
): Promise<string[]> {
  // Check cache first
  const cacheKey = `${guildId}:${userId}`;
  const cached = USER_ROLES_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < USER_ROLES_CACHE_TTL) {
    return cached.roles;
  }

  // Fetch from Discord API
  const response = await fetch(`${DISCORD_API_BASE}/users/@me/guilds/${guildId}/member`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      // User is not in the guild
      return [];
    }
    throw new Error(`Discord API error: ${response.status}`);
  }

  interface MemberResponse {
    roles: string[];
  }

  const member = (await response.json()) as MemberResponse;
  const roles = member.roles || [];

  // Update cache
  USER_ROLES_CACHE.set(cacheKey, {
    roles,
    fetchedAt: Date.now(),
  });

  return roles;
}

/**
 * Clear user roles cache for a specific user.
 */
export function clearUserRolesCache(guildId: string, userId: string): void {
  USER_ROLES_CACHE.delete(`${guildId}:${userId}`);
}

/**
 * Clear all user roles cache.
 */
export function clearAllUserRolesCache(): void {
  USER_ROLES_CACHE.clear();
}

/**
 * Get the user's highest tier level based on their Discord roles.
 *
 * The tier hierarchy is determined by the priority field in role mappings,
 * or by explicit tier hierarchy configuration. Lower index = higher tier.
 *
 * @param userRoles - User's Discord role IDs
 * @param roleMappings - Server's role-to-tier mappings
 * @param tierHierarchy - Optional explicit tier hierarchy
 * @returns User's highest tier index and ID
 */
export function getUserHighestTierLevel(
  userRoles: string[],
  roleMappings: Record<string, RoleMapping>,
  tierHierarchy?: TierHierarchy[]
): { tierIndex: number; tierId: string | null } {
  // If no tier hierarchy provided, build from role mappings
  const hierarchy: Map<string, number> = new Map();

  if (tierHierarchy) {
    for (const tier of tierHierarchy) {
      hierarchy.set(tier.id, tier.index);
    }
  } else {
    // Build hierarchy from role mappings (higher priority = higher tier = lower index)
    const tierPriorities: Map<string, number> = new Map();
    for (const mapping of Object.values(roleMappings)) {
      if (mapping.status !== 'active') continue;
      const current = tierPriorities.get(mapping.tierId);
      if (current === undefined || mapping.priority > current) {
        tierPriorities.set(mapping.tierId, mapping.priority);
      }
    }

    // Sort by priority descending and assign indices
    const sortedTiers = Array.from(tierPriorities.entries())
      .sort((a, b) => b[1] - a[1]);

    for (let i = 0; i < sortedTiers.length; i++) {
      const tier = sortedTiers[i];
      if (tier) {
        hierarchy.set(tier[0], i);
      }
    }
  }

  // Find user's highest tier (lowest index)
  let highestTierIndex = Infinity;
  let highestTierId: string | null = null;

  for (const roleId of userRoles) {
    const mapping = roleMappings[roleId];
    if (!mapping || mapping.status !== 'active') continue;

    const tierIndex = hierarchy.get(mapping.tierId);
    if (tierIndex !== undefined && tierIndex < highestTierIndex) {
      highestTierIndex = tierIndex;
      highestTierId = mapping.tierId;
    }
  }

  // If user has no mapped roles, they have lowest privilege (highest index)
  if (highestTierIndex === Infinity) {
    highestTierIndex = hierarchy.size;
  }

  return { tierIndex: highestTierIndex, tierId: highestTierId };
}

/**
 * Get all tier IDs the user is allowed to modify (at or below their level).
 *
 * @param userTierIndex - User's tier index
 * @param roleMappings - Server's role-to-tier mappings
 * @param tierHierarchy - Optional explicit tier hierarchy
 * @returns Array of tier IDs the user can modify
 */
export function getAllowedTierIds(
  userTierIndex: number,
  roleMappings: Record<string, RoleMapping>,
  tierHierarchy?: TierHierarchy[]
): string[] {
  const hierarchy: Map<string, number> = new Map();

  if (tierHierarchy) {
    for (const tier of tierHierarchy) {
      hierarchy.set(tier.id, tier.index);
    }
  } else {
    // Build from role mappings
    const tierPriorities: Map<string, number> = new Map();
    for (const mapping of Object.values(roleMappings)) {
      if (mapping.status !== 'active') continue;
      const current = tierPriorities.get(mapping.tierId);
      if (current === undefined || mapping.priority > current) {
        tierPriorities.set(mapping.tierId, mapping.priority);
      }
    }

    const sortedTiers = Array.from(tierPriorities.entries())
      .sort((a, b) => b[1] - a[1]);

    for (let i = 0; i < sortedTiers.length; i++) {
      const tier = sortedTiers[i];
      if (tier) {
        hierarchy.set(tier[0], i);
      }
    }
  }

  // Return all tiers at or below user's level (index >= userTierIndex)
  const allowed: string[] = [];
  for (const [tierId, index] of hierarchy) {
    if (index >= userTierIndex) {
      allowed.push(tierId);
    }
  }

  return allowed;
}

/**
 * Validate that user can modify the target tiers.
 *
 * @param targetTierIds - Tier IDs the user wants to modify
 * @param allowedTierIds - Tier IDs the user is allowed to modify
 * @returns Validation result
 */
export function validateTierAccess(
  targetTierIds: string[],
  allowedTierIds: string[]
): { valid: boolean; blockedTierIds: string[] } {
  const allowedSet = new Set(allowedTierIds);
  const blockedTierIds: string[] = [];

  for (const tierId of targetTierIds) {
    if (!allowedSet.has(tierId)) {
      blockedTierIds.push(tierId);
    }
  }

  return {
    valid: blockedTierIds.length === 0,
    blockedTierIds,
  };
}

// =============================================================================
// Middleware Factory
// =============================================================================

/**
 * Create scope validation middleware.
 *
 * This middleware validates that the authenticated user has permission to
 * modify the tiers specified in the request body. It prevents privilege
 * escalation by ensuring users can only modify tiers at or below their
 * own tier level.
 *
 * @param config - Scope validation configuration
 * @returns Express middleware function
 */
export function createScopeValidator(config: ScopeValidationConfig) {
  const { configService, tierHierarchy, discordApi, logger: log = logger } = config;

  /**
   * Scope validation middleware.
   *
   * Validates that the user has permission to modify the target tiers.
   * Returns 403 Forbidden if the user attempts to modify a tier above their level.
   */
  async function scopeValidator(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const dashboardReq = req as AuthenticatedDashboardRequest;
      const { dashboardSession, serverId } = dashboardReq;

      if (!dashboardSession) {
        res.status(401).json({
          error: 'UNAUTHORIZED',
          message: 'Authentication required',
        });
        return;
      }

      if (!serverId) {
        res.status(400).json({
          error: 'MISSING_SERVER_ID',
          message: 'Server ID is required',
        });
        return;
      }

      // Get current server configuration
      const serverConfig = await configService.getCurrentConfiguration(serverId);

      // Extract target tiers from request body
      const targetTierIds = extractTargetTiers(req.body);

      // If no tier IDs in request, allow (nothing to validate)
      if (targetTierIds.length === 0) {
        (req as ScopeValidatedRequest).userTierIndex = 0;
        (req as ScopeValidatedRequest).userTierId = null;
        (req as ScopeValidatedRequest).allowedTierIds = [];
        (req as ScopeValidatedRequest).serverConfig = serverConfig;
        return next();
      }

      // Fetch user's Discord roles
      let userRoles: string[];
      if (discordApi) {
        userRoles = await discordApi.getMemberRoles(
          serverId,
          dashboardSession.userId,
          dashboardSession.accessToken
        );
      } else {
        userRoles = await fetchUserRoles(
          serverId,
          dashboardSession.userId,
          dashboardSession.accessToken
        );
      }

      // Determine user's tier level
      const { tierIndex, tierId } = getUserHighestTierLevel(
        userRoles,
        serverConfig.roleMappings,
        tierHierarchy
      );

      // Get allowed tier IDs
      const allowedTierIds = getAllowedTierIds(
        tierIndex,
        serverConfig.roleMappings,
        tierHierarchy
      );

      // Validate access
      const validation = validateTierAccess(targetTierIds, allowedTierIds);

      if (!validation.valid) {
        // Record metric
        recordScopeViolation();

        // Log the violation attempt (always log full details server-side)
        log.warn(
          {
            userId: dashboardSession.userId,
            serverId,
            userTierId: tierId,
            userTierIndex: tierIndex,
            attemptedTiers: validation.blockedTierIds,
            allowedTiers: allowedTierIds,
          },
          'Scope validation failed - privilege escalation attempt blocked'
        );

        // Sprint 134 (HIGH-002): Sanitize error response in production
        // In production, return generic error message without tier details
        // In development, return detailed error for debugging
        if (IS_PRODUCTION) {
          res.status(403).json({
            error: 'SCOPE_VIOLATION',
            message: 'You do not have permission to modify the requested resources.',
          });
        } else {
          // Development mode - include details for debugging
          const blockedTiersList = validation.blockedTierIds.join(', ');
          res.status(403).json({
            error: 'SCOPE_VIOLATION',
            message: `Cannot modify tier(s): ${blockedTiersList}. You can only modify tiers at or below your current level.`,
            details: {
              userTierId: tierId,
              blockedTiers: validation.blockedTierIds,
              allowedTiers: allowedTierIds,
            },
          });
        }
        return;
      }

      // Attach validation context to request
      (req as ScopeValidatedRequest).userTierIndex = tierIndex;
      (req as ScopeValidatedRequest).userTierId = tierId;
      (req as ScopeValidatedRequest).allowedTierIds = allowedTierIds;
      (req as ScopeValidatedRequest).serverConfig = serverConfig;

      next();
    } catch (error) {
      log.error({ error }, 'Scope validation error');
      res.status(500).json({
        error: 'SCOPE_VALIDATION_ERROR',
        message: 'Failed to validate scope permissions',
      });
    }
  }

  /**
   * Validate scope without blocking (for read operations).
   * Attaches scope context to request without enforcing restrictions.
   */
  async function scopeContext(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const dashboardReq = req as AuthenticatedDashboardRequest;
      const { dashboardSession, serverId } = dashboardReq;

      if (!dashboardSession || !serverId) {
        return next();
      }

      const serverConfig = await configService.getCurrentConfiguration(serverId);

      let userRoles: string[];
      if (discordApi) {
        userRoles = await discordApi.getMemberRoles(
          serverId,
          dashboardSession.userId,
          dashboardSession.accessToken
        );
      } else {
        userRoles = await fetchUserRoles(
          serverId,
          dashboardSession.userId,
          dashboardSession.accessToken
        );
      }

      const { tierIndex, tierId } = getUserHighestTierLevel(
        userRoles,
        serverConfig.roleMappings,
        tierHierarchy
      );

      const allowedTierIds = getAllowedTierIds(
        tierIndex,
        serverConfig.roleMappings,
        tierHierarchy
      );

      (req as ScopeValidatedRequest).userTierIndex = tierIndex;
      (req as ScopeValidatedRequest).userTierId = tierId;
      (req as ScopeValidatedRequest).allowedTierIds = allowedTierIds;
      (req as ScopeValidatedRequest).serverConfig = serverConfig;

      next();
    } catch (error) {
      log.error({ error }, 'Scope context error');
      // Don't fail - just continue without context
      next();
    }
  }

  return {
    scopeValidator,
    scopeContext,
  };
}

// =============================================================================
// Exports
// =============================================================================

export type ScopeValidationMiddleware = ReturnType<typeof createScopeValidator>;

// Re-export metrics functions for convenience
export { getScopeMetricsPrometheus } from './scopeMetrics.js';
