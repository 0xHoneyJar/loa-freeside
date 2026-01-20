/**
 * Authentication and Authorization Middleware
 *
 * Sprint 111: Security Remediation (CRITICAL-002)
 * Sprint 143: Sandbox Access Management (Bearer token support)
 *
 * Provides authentication and authorization for REST API endpoints,
 * specifically for the simulation/sandbox testing system.
 *
 * Features:
 * - API key authentication (for service-to-service and QA testing)
 * - Bearer token authentication (for local user sessions)
 * - Caller identity extraction
 * - Sandbox access verification
 * - Self-or-admin authorization
 *
 * @module api/middleware/auth
 */

import type { Request, Response, NextFunction } from 'express';
import { logger } from '../../utils/logger.js';
import { getAuthService } from '../../services/auth/AuthService.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Caller identity attached to authenticated requests
 */
export interface Caller {
  /** User ID from token or API key context */
  userId: string;
  /** Assigned roles (e.g., 'admin', 'qa_admin', 'qa_tester', 'user') */
  roles: string[];
  /** Sandboxes the caller has access to */
  sandboxAccess: string[];
}

/**
 * Extended request with authentication context
 */
export interface AuthenticatedRequest extends Request {
  caller?: Caller;
  sandboxId?: string;
}

/**
 * API key configuration for simulation access
 */
export interface ApiKeyConfig {
  /** The API key value */
  key: string;
  /** User ID associated with this key */
  userId: string;
  /** Roles granted to this key */
  roles: string[];
  /** Sandboxes this key can access ('*' for all) */
  sandboxAccess: string[];
}

// =============================================================================
// Configuration
// =============================================================================

/**
 * Admin roles that bypass certain authorization checks
 */
export const ADMIN_ROLES = ['admin', 'qa_admin'] as const;

/**
 * Roles that can perform QA testing operations
 */
export const QA_ROLES = ['admin', 'qa_admin', 'qa_tester'] as const;

/**
 * Load API key configurations from environment
 *
 * Format: SIMULATION_API_KEYS="key1:user1:role1,role2:sandbox1,sandbox2;key2:user2:admin:*"
 *
 * Examples:
 * - "test-key:user123:qa_tester:sandbox-1,sandbox-2" - QA tester with specific sandbox access
 * - "admin-key:admin1:admin,qa_admin:*" - Admin with all sandbox access
 */
function loadApiKeyConfigs(): Map<string, ApiKeyConfig> {
  const configs = new Map<string, ApiKeyConfig>();
  const envKeys = process.env.SIMULATION_API_KEYS || '';

  if (!envKeys) {
    return configs;
  }

  const keyDefinitions = envKeys.split(';').filter(Boolean);
  for (const definition of keyDefinitions) {
    const parts = definition.split(':');
    if (parts.length < 4) {
      logger.warn({ definition: definition.substring(0, 10) + '...' }, 'Invalid API key definition format');
      continue;
    }

    const [key, userId, rolesStr, sandboxStr] = parts;
    if (!key || !userId) {
      continue;
    }

    const roles = rolesStr?.split(',').filter(Boolean) || [];
    const sandboxAccess = sandboxStr === '*' ? ['*'] : sandboxStr?.split(',').filter(Boolean) || [];

    configs.set(key, {
      key,
      userId,
      roles,
      sandboxAccess,
    });
  }

  return configs;
}

// Load API keys at module initialization
let apiKeyConfigs = loadApiKeyConfigs();

/**
 * Reload API key configurations (useful for testing)
 */
export function reloadApiKeyConfigs(): void {
  apiKeyConfigs = loadApiKeyConfigs();
}

/**
 * Set API key configurations directly (for testing)
 */
export function setApiKeyConfigs(configs: Map<string, ApiKeyConfig>): void {
  apiKeyConfigs = configs;
}

/**
 * Get current API key configurations (for testing)
 */
export function getApiKeyConfigs(): Map<string, ApiKeyConfig> {
  return apiKeyConfigs;
}

// =============================================================================
// Authentication Middleware
// =============================================================================

/**
 * Validate API key and extract caller identity
 *
 * @param apiKey - The API key to validate
 * @returns Caller identity if valid, null otherwise
 */
function validateApiKey(apiKey: string): Caller | null {
  const config = apiKeyConfigs.get(apiKey);
  if (!config) {
    return null;
  }

  return {
    userId: config.userId,
    roles: config.roles,
    sandboxAccess: config.sandboxAccess,
  };
}

/**
 * Authentication middleware
 *
 * Extracts and validates authentication from request headers.
 * Supports API key authentication via X-Api-Key header.
 *
 * @example
 * ```typescript
 * router.use(requireAuth);
 * router.get('/protected', (req, res) => {
 *   const { userId } = req.caller;
 *   // ...
 * });
 * ```
 */
export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Try API key authentication first
  const apiKey = req.headers['x-api-key'];

  if (apiKey && typeof apiKey === 'string') {
    const caller = validateApiKey(apiKey);

    if (caller) {
      req.caller = caller;
      return next();
    }

    // Invalid API key
    logger.warn(
      { apiKeyPrefix: apiKey.substring(0, 8) + '...' },
      'Invalid simulation API key attempt'
    );
    res.status(401).json({ error: 'Invalid authentication credentials' });
    return;
  }

  // Try Bearer token authentication (local user sessions)
  const authHeader = req.headers.authorization;

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7); // Remove 'Bearer ' prefix

    try {
      const authService = getAuthService();
      const authContext = await authService.getAuthContext(token);

      if (authContext) {
        req.caller = {
          userId: authContext.userId,
          roles: authContext.roles,
          sandboxAccess: authContext.sandboxAccess,
        };
        return next();
      }

      // Invalid or expired session token
      logger.warn(
        { tokenPrefix: token.substring(0, 8) + '...' },
        'Invalid or expired session token'
      );
      res.status(401).json({ error: 'Invalid or expired session' });
      return;
    } catch (error) {
      logger.error({ error }, 'Session validation error');
      res.status(500).json({ error: 'Authentication service error' });
      return;
    }
  }

  // No authentication provided
  res.status(401).json({ error: 'Authentication required' });
}

// =============================================================================
// Authorization Middleware
// =============================================================================

/**
 * Check if caller has an admin role
 */
export function hasAdminRole(caller: Caller): boolean {
  return ADMIN_ROLES.some((role) => caller.roles.includes(role));
}

/**
 * Check if caller has a QA role
 */
export function hasQARole(caller: Caller): boolean {
  return QA_ROLES.some((role) => caller.roles.includes(role));
}

/**
 * Check if caller has access to a specific sandbox
 */
export function hasSandboxAccess(caller: Caller, sandboxId: string): boolean {
  // Admin roles have universal sandbox access
  if (hasAdminRole(caller)) {
    return true;
  }

  // Wildcard grants access to all sandboxes
  if (caller.sandboxAccess.includes('*')) {
    return true;
  }

  // Check explicit sandbox access
  return caller.sandboxAccess.includes(sandboxId);
}

/**
 * Sandbox access authorization middleware
 *
 * Verifies the authenticated caller has access to the requested sandbox.
 * Must be used after requireAuth middleware.
 *
 * @example
 * ```typescript
 * router.use(requireAuth);
 * router.use('/:sandboxId/*', requireSandboxAccess);
 * ```
 */
export function requireSandboxAccess(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const { caller } = req;
  const sandboxId = req.params.sandboxId;

  if (!caller) {
    // Should never happen if requireAuth is applied first
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  if (!sandboxId) {
    // No sandbox ID in route - pass through
    return next();
  }

  // Store sandboxId on request for later use
  req.sandboxId = sandboxId;

  if (!hasSandboxAccess(caller, sandboxId)) {
    logger.warn(
      { userId: caller.userId, sandboxId, roles: caller.roles },
      'Sandbox access denied'
    );
    res.status(403).json({ error: 'Access denied to this sandbox' });
    return;
  }

  next();
}

/**
 * Self-or-admin authorization middleware
 *
 * Ensures the caller can only access their own resources,
 * unless they have an admin role.
 *
 * @example
 * ```typescript
 * router.use(requireAuth);
 * router.use('/:sandboxId/:userId/*', requireSelfOrAdmin);
 * ```
 */
export function requireSelfOrAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const { caller } = req;
  const targetUserId = req.params.userId;

  if (!caller) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  if (!targetUserId) {
    // No user ID in route - pass through
    return next();
  }

  // Admin roles can access any user's resources
  if (hasAdminRole(caller)) {
    return next();
  }

  // Non-admin users can only access their own resources
  if (caller.userId !== targetUserId) {
    logger.warn(
      { callerId: caller.userId, targetUserId, roles: caller.roles },
      'Cross-user access denied'
    );
    res.status(403).json({ error: 'Access denied to other user resources' });
    return;
  }

  next();
}

/**
 * QA role requirement middleware
 *
 * Ensures the caller has a QA role (qa_tester, qa_admin, or admin).
 * Used for operations that should only be performed by QA testers.
 *
 * @example
 * ```typescript
 * router.patch('/:userId/thresholds', requireAuth, requireQARole, handler);
 * ```
 */
export function requireQARole(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const { caller } = req;

  if (!caller) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  if (!hasQARole(caller)) {
    logger.warn(
      { userId: caller.userId, roles: caller.roles },
      'QA role required but not present'
    );
    res.status(403).json({ error: 'QA role required for this operation' });
    return;
  }

  next();
}

/**
 * Admin role requirement middleware
 *
 * Ensures the caller has an admin role (qa_admin or admin).
 * Used for sensitive operations.
 *
 * @example
 * ```typescript
 * router.delete('/sandbox/:sandboxId/reset', requireAuth, requireAdminRole, handler);
 * ```
 */
export function requireAdminRole(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const { caller } = req;

  if (!caller) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  if (!hasAdminRole(caller)) {
    logger.warn(
      { userId: caller.userId, roles: caller.roles },
      'Admin role required but not present'
    );
    res.status(403).json({ error: 'Admin role required for this operation' });
    return;
  }

  next();
}

