/**
 * User Management Routes (Gom Jabbar)
 *
 * Sprint 142: CLI User Management Commands
 *
 * Admin-only endpoints for managing local user accounts.
 * Protected by local authentication (requireLocalAuth).
 *
 * Endpoints:
 * - GET    /api/users           - List users (admin, qa_admin)
 * - POST   /api/users           - Create user (admin, qa_admin)
 * - GET    /api/users/:id       - Get user details (admin, qa_admin)
 * - PATCH  /api/users/:id       - Update user (admin, qa_admin)
 * - POST   /api/users/:id/disable - Disable user (admin, qa_admin)
 * - POST   /api/users/:id/enable  - Enable user (admin, qa_admin)
 * - DELETE /api/users/:id       - Delete user (admin only)
 * - POST   /api/users/:id/reset-password - Reset password (admin, qa_admin)
 *
 * @see grimoires/loa/sdd.md §13. User Management System
 * @see grimoires/loa/prd.md §12 Gom Jabbar
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import {
  getUserService,
  UserServiceError,
  type CreateUserInput,
  type UpdateUserInput,
} from '../../services/auth/UserService.js';
import type { UserRole } from '../../db/types/user.types.js';
import {
  requireLocalAuth,
  requireRoles,
  type AuthenticatedRequest,
} from './auth.routes.js';

// =============================================================================
// Validation Schemas
// =============================================================================

const createUserSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_]+$/, 'Username must be alphanumeric with underscores'),
  password: z.string().min(8).optional(),
  roles: z.array(z.enum(['admin', 'qa_admin', 'qa_tester'])).optional(),
  sandboxAccess: z.array(z.string()).optional(),
  displayName: z.string().max(100).optional(),
  requirePasswordChange: z.boolean().optional(),
});

const updateUserSchema = z.object({
  displayName: z.string().max(100).optional(),
  roles: z.array(z.enum(['admin', 'qa_admin', 'qa_tester'])).optional(),
  sandboxAccess: z.array(z.string()).optional(),
  requirePasswordChange: z.boolean().optional(),
});

const listUsersSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  role: z.enum(['admin', 'qa_admin', 'qa_tester']).optional(),
  isActive: z.enum(['true', 'false']).transform(v => v === 'true').optional(),
  search: z.string().max(100).optional(),
});

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Extract client IP from request
 */
function getClientIp(req: Request): string | undefined {
  const xForwardedFor = req.headers['x-forwarded-for'];
  if (typeof xForwardedFor === 'string') {
    const parts = xForwardedFor.split(',');
    const firstPart = parts[0];
    return firstPart ? firstPart.trim() : undefined;
  }
  return req.socket.remoteAddress;
}

/**
 * Map UserServiceError to HTTP status code
 */
function getErrorStatusCode(error: UserServiceError): number {
  switch (error.code) {
    case 'USER_NOT_FOUND':
      return 404;
    case 'USER_EXISTS':
    case 'CANNOT_REVOKE_OWN_ADMIN':
      return 409;
    case 'INSUFFICIENT_PERMISSIONS':
      return 403;
    case 'INVALID_USERNAME':
    case 'INVALID_ROLES':
    case 'WEAK_PASSWORD':
    case 'INVALID_PASSWORD':
      return 400;
    default:
      return 500;
  }
}

// =============================================================================
// Route Factory
// =============================================================================

/**
 * Create user management routes
 */
export function createUsersRouter(): Router {
  const router = Router();
  const userService = getUserService();

  // Apply authentication to all routes
  router.use(requireLocalAuth);
  router.use(requireRoles('admin', 'qa_admin'));

  /**
   * GET /api/users
   *
   * List users with filtering
   */
  router.get('/', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const parseResult = listUsersSchema.safeParse(req.query);
      if (!parseResult.success) {
        const firstError = parseResult.error.errors[0];
        res.status(400).json({
          success: false,
          error: firstError?.message ?? 'Invalid query parameters',
        });
        return;
      }

      const { limit, offset, role, isActive, search } = parseResult.data;

      const result = userService.listUsers({
        limit: limit ?? 20,
        offset: offset ?? 0,
        roles: role ? [role as UserRole] : undefined,
        isActive,
        search,
      });

      res.json({
        success: true,
        users: result.items,
        total: result.total,
        hasMore: result.hasMore,
      });
    } catch (error) {
      logger.error({ error }, 'List users endpoint error');
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  });

  /**
   * POST /api/users
   *
   * Create a new user
   */
  router.post('/', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const parseResult = createUserSchema.safeParse(req.body);
      if (!parseResult.success) {
        const firstError = parseResult.error.errors[0];
        res.status(400).json({
          success: false,
          error: firstError?.message ?? 'Validation failed',
        });
        return;
      }

      const input: CreateUserInput = parseResult.data;
      const actor = {
        userId: req.authContext!.userId,
        username: req.authContext!.username,
        ip: getClientIp(req),
      };

      const result = await userService.createUser(input, actor);

      res.status(201).json({
        success: true,
        user: result.user,
        generatedPassword: result.generatedPassword,
      });
    } catch (error) {
      if (error instanceof UserServiceError) {
        res.status(getErrorStatusCode(error)).json({
          success: false,
          error: error.message,
          code: error.code,
        });
        return;
      }
      logger.error({ error }, 'Create user endpoint error');
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  });

  /**
   * GET /api/users/:id
   *
   * Get user details
   */
  router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.params.id;
      if (!userId) {
        res.status(400).json({
          success: false,
          error: 'User ID required',
        });
        return;
      }

      const user = userService.getUser(userId);

      if (!user) {
        res.status(404).json({
          success: false,
          error: 'User not found',
        });
        return;
      }

      res.json({
        success: true,
        user,
      });
    } catch (error) {
      logger.error({ error }, 'Get user endpoint error');
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  });

  /**
   * PATCH /api/users/:id
   *
   * Update user properties
   */
  router.patch('/:id', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.params.id;
      if (!userId) {
        res.status(400).json({
          success: false,
          error: 'User ID required',
        });
        return;
      }

      const parseResult = updateUserSchema.safeParse(req.body);
      if (!parseResult.success) {
        const firstError = parseResult.error.errors[0];
        res.status(400).json({
          success: false,
          error: firstError?.message ?? 'Validation failed',
        });
        return;
      }

      const input: UpdateUserInput = parseResult.data;
      const actor = {
        userId: req.authContext!.userId,
        username: req.authContext!.username,
        ip: getClientIp(req),
      };

      const user = await userService.updateUser(userId, input, actor);

      res.json({
        success: true,
        user,
      });
    } catch (error) {
      if (error instanceof UserServiceError) {
        res.status(getErrorStatusCode(error)).json({
          success: false,
          error: error.message,
          code: error.code,
        });
        return;
      }
      logger.error({ error }, 'Update user endpoint error');
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  });

  /**
   * POST /api/users/:id/disable
   *
   * Disable a user account
   */
  router.post('/:id/disable', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.params.id;
      if (!userId) {
        res.status(400).json({
          success: false,
          error: 'User ID required',
        });
        return;
      }

      const actor = {
        userId: req.authContext!.userId,
        username: req.authContext!.username,
        ip: getClientIp(req),
      };

      await userService.disableUser(userId, actor);

      res.json({
        success: true,
        message: 'User disabled',
      });
    } catch (error) {
      if (error instanceof UserServiceError) {
        res.status(getErrorStatusCode(error)).json({
          success: false,
          error: error.message,
          code: error.code,
        });
        return;
      }
      logger.error({ error }, 'Disable user endpoint error');
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  });

  /**
   * POST /api/users/:id/enable
   *
   * Enable a user account
   */
  router.post('/:id/enable', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.params.id;
      if (!userId) {
        res.status(400).json({
          success: false,
          error: 'User ID required',
        });
        return;
      }

      const actor = {
        userId: req.authContext!.userId,
        username: req.authContext!.username,
        ip: getClientIp(req),
      };

      await userService.enableUser(userId, actor);

      res.json({
        success: true,
        message: 'User enabled',
      });
    } catch (error) {
      if (error instanceof UserServiceError) {
        res.status(getErrorStatusCode(error)).json({
          success: false,
          error: error.message,
          code: error.code,
        });
        return;
      }
      logger.error({ error }, 'Enable user endpoint error');
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  });

  /**
   * DELETE /api/users/:id
   *
   * Delete a user (admin only)
   */
  router.delete('/:id', requireRoles('admin'), async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.params.id;
      if (!userId) {
        res.status(400).json({
          success: false,
          error: 'User ID required',
        });
        return;
      }

      const actor = {
        userId: req.authContext!.userId,
        username: req.authContext!.username,
        ip: getClientIp(req),
      };

      await userService.deleteUser(userId, actor);

      res.json({
        success: true,
        message: 'User deleted',
      });
    } catch (error) {
      if (error instanceof UserServiceError) {
        res.status(getErrorStatusCode(error)).json({
          success: false,
          error: error.message,
          code: error.code,
        });
        return;
      }
      logger.error({ error }, 'Delete user endpoint error');
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  });

  /**
   * POST /api/users/:id/reset-password
   *
   * Reset user password
   */
  router.post('/:id/reset-password', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.params.id;
      if (!userId) {
        res.status(400).json({
          success: false,
          error: 'User ID required',
        });
        return;
      }

      const actor = {
        userId: req.authContext!.userId,
        username: req.authContext!.username,
        ip: getClientIp(req),
      };

      const result = await userService.resetPassword(userId, undefined, actor);

      res.json({
        success: true,
        generatedPassword: result.generatedPassword,
        message: 'Password has been reset. User will be required to change password on next login.',
      });
    } catch (error) {
      if (error instanceof UserServiceError) {
        res.status(getErrorStatusCode(error)).json({
          success: false,
          error: error.message,
          code: error.code,
        });
        return;
      }
      logger.error({ error }, 'Reset password endpoint error');
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  });

  /**
   * POST /api/users/:id/sandbox-access
   *
   * Grant sandbox access to a user
   */
  router.post('/:id/sandbox-access', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.params.id;
      const { sandboxId } = req.body;

      if (!userId) {
        res.status(400).json({
          success: false,
          error: 'User ID required',
        });
        return;
      }

      if (!sandboxId || typeof sandboxId !== 'string') {
        res.status(400).json({
          success: false,
          error: 'Sandbox ID required',
        });
        return;
      }

      const actor = {
        userId: req.authContext!.userId,
        username: req.authContext!.username,
        ip: getClientIp(req),
      };

      await userService.grantSandboxAccess(userId, sandboxId, actor);

      res.json({
        success: true,
        message: `Sandbox access granted: ${sandboxId}`,
      });
    } catch (error) {
      if (error instanceof UserServiceError) {
        res.status(getErrorStatusCode(error)).json({
          success: false,
          error: error.message,
          code: error.code,
        });
        return;
      }
      logger.error({ error }, 'Grant sandbox access endpoint error');
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  });

  /**
   * DELETE /api/users/:id/sandbox-access/:sandboxId
   *
   * Revoke sandbox access from a user
   */
  router.delete('/:id/sandbox-access/:sandboxId', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.params.id;
      const sandboxId = req.params.sandboxId;

      if (!userId) {
        res.status(400).json({
          success: false,
          error: 'User ID required',
        });
        return;
      }

      if (!sandboxId) {
        res.status(400).json({
          success: false,
          error: 'Sandbox ID required',
        });
        return;
      }

      const actor = {
        userId: req.authContext!.userId,
        username: req.authContext!.username,
        ip: getClientIp(req),
      };

      await userService.revokeSandboxAccess(userId, sandboxId, actor);

      res.json({
        success: true,
        message: `Sandbox access revoked: ${sandboxId}`,
      });
    } catch (error) {
      if (error instanceof UserServiceError) {
        res.status(getErrorStatusCode(error)).json({
          success: false,
          error: error.message,
          code: error.code,
        });
        return;
      }
      logger.error({ error }, 'Revoke sandbox access endpoint error');
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  });

  /**
   * GET /api/users/:id/sandbox-access
   *
   * List user's sandbox access
   */
  router.get('/:id/sandbox-access', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.params.id;

      if (!userId) {
        res.status(400).json({
          success: false,
          error: 'User ID required',
        });
        return;
      }

      const user = userService.getUser(userId);

      if (!user) {
        res.status(404).json({
          success: false,
          error: 'User not found',
        });
        return;
      }

      res.json({
        success: true,
        userId: user.id,
        username: user.username,
        sandboxAccess: user.sandboxAccess,
      });
    } catch (error) {
      logger.error({ error }, 'List sandbox access endpoint error');
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  });

  return router;
}

// =============================================================================
// Exports
// =============================================================================

export { createUsersRouter as default };
