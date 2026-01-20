/**
 * Authentication Services for Gom Jabbar
 *
 * Sprint 140: UserService & AuthService Core
 *
 * Exports user management and authentication services.
 *
 * @see grimoires/loa/prd.md §12. Gom Jabbar
 * @see grimoires/loa/sdd.md §13. User Management System
 */

// =============================================================================
// UserService
// =============================================================================
export {
  UserService,
  UserServiceError,
  getUserService,
  resetUserService,
  type CreateUserInput,
  type CreateUserResult,
  type UpdateUserInput,
  type ChangePasswordInput,
  type ResetPasswordResult,
  type UserServiceConfig,
  type ActorContext,
} from './UserService.js';

// =============================================================================
// AuthService
// =============================================================================
export {
  AuthService,
  getAuthService,
  resetAuthService,
  type LoginRequest,
  type LoginResult,
  type SessionValidationResult,
  type AuthContext,
  type AuthServiceConfig,
} from './AuthService.js';

// =============================================================================
// Re-export types from db for convenience
// =============================================================================
export type {
  User,
  UserPublic,
  UserSession,
  UserRole,
  SessionType,
  AuditAction,
  ListUsersQuery,
  AuditLogQuery,
  PaginatedResult,
} from '../../db/types/user.types.js';
