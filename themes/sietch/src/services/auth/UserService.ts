/**
 * UserService - User Account Management for Gom Jabbar
 *
 * Sprint 140: UserService & AuthService Core
 *
 * Provides CRUD operations for local user accounts:
 * - User creation with password hashing
 * - Role management (admin, qa_admin, qa_tester)
 * - Sandbox access control
 * - Account enable/disable
 *
 * Security Features:
 * - Argon2id password hashing
 * - Role-based access control
 * - Audit logging for all operations
 * - qa_admin cannot manage admin users
 *
 * @see grimoires/loa/sdd.md §13.4 UserService Interface
 */

import { logger } from '../../utils/logger.js';
import {
  hashPassword,
  validatePasswordStrength,
  generateRandomPassword,
  type PasswordValidationResult,
} from '../../utils/password.js';
import {
  createUser as dbCreateUser,
  getUserById,
  getUserByUsername,
  listUsers as dbListUsers,
  updateUser as dbUpdateUser,
  updateUserPassword,
  deleteUser as dbDeleteUser,
  logUserAuditEvent,
  revokeAllUserSessions,
  type User,
  type UserPublic,
  type UserRole,
  type ListUsersQuery,
  type PaginatedResult,
} from '../../db/queries/user-queries.js';
import { userToPublic } from '../../db/types/user.types.js';

// =============================================================================
// Types
// =============================================================================

/**
 * User creation input
 */
export interface CreateUserInput {
  username: string;
  password?: string;  // If not provided, generates random password
  roles?: UserRole[];
  sandboxAccess?: string[];
  displayName?: string;
  requirePasswordChange?: boolean;
}

/**
 * User creation result
 */
export interface CreateUserResult {
  user: UserPublic;
  generatedPassword?: string;  // Only returned if password was auto-generated
}

/**
 * User update input
 */
export interface UpdateUserInput {
  displayName?: string;
  roles?: UserRole[];
  sandboxAccess?: string[];
  isActive?: boolean;
  requirePasswordChange?: boolean;
}

/**
 * Password change input
 */
export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

/**
 * Admin password reset result
 */
export interface ResetPasswordResult {
  success: boolean;
  generatedPassword?: string;
}

/**
 * Service configuration
 */
export interface UserServiceConfig {
  debug?: boolean;
}

/**
 * Actor context for audit logging
 */
export interface ActorContext {
  userId: string;
  username: string;
  ip?: string;
}

// =============================================================================
// UserService Class
// =============================================================================

/**
 * User Account Management Service
 *
 * Implements CRUD operations with role-based access control.
 * All operations are audit logged.
 *
 * Role Hierarchy:
 * - admin: Can manage all users
 * - qa_admin: Can manage qa_tester users only
 * - qa_tester: Cannot manage users
 */
export class UserService {
  private readonly debug: boolean;

  constructor(config: UserServiceConfig = {}) {
    this.debug = config.debug ?? false;
    this.log('UserService initialized');
  }

  // ===========================================================================
  // User CRUD Operations
  // ===========================================================================

  /**
   * Create a new user
   *
   * @param input - User creation parameters
   * @param actor - User performing the action (for audit)
   * @returns Created user and optional generated password
   */
  async createUser(
    input: CreateUserInput,
    actor: ActorContext
  ): Promise<CreateUserResult> {
    // Validate username format
    if (!this.isValidUsername(input.username)) {
      throw new UserServiceError(
        'Invalid username format. Must be 3-32 characters, alphanumeric with underscores.',
        'INVALID_USERNAME'
      );
    }

    // Check for existing user
    const existing = getUserByUsername(input.username);
    if (existing) {
      throw new UserServiceError(
        `User "${input.username}" already exists`,
        'USER_EXISTS'
      );
    }

    // Determine password
    let password = input.password;
    let generatedPassword: string | undefined;

    if (!password) {
      password = generateRandomPassword(16);
      generatedPassword = password;
    }

    // Validate password strength
    const validation = validatePasswordStrength(password);
    if (!validation.valid) {
      throw new UserServiceError(
        `Password does not meet requirements: ${validation.errors.join(', ')}`,
        'WEAK_PASSWORD'
      );
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Validate roles
    const roles = input.roles || ['qa_tester'];
    if (!this.areValidRoles(roles)) {
      throw new UserServiceError(
        'Invalid roles specified',
        'INVALID_ROLES'
      );
    }

    // Check actor permissions
    if (!this.canCreateUserWithRoles(actor.userId, roles)) {
      throw new UserServiceError(
        'Insufficient permissions to create user with specified roles',
        'INSUFFICIENT_PERMISSIONS'
      );
    }

    // Create user in database
    const user = dbCreateUser({
      username: input.username,
      passwordHash,
      roles,
      sandboxAccess: input.sandboxAccess || [],
      displayName: input.displayName,
      createdBy: actor.userId,
      requirePasswordChange: input.requirePasswordChange ?? true,
    });

    // Audit log
    logUserAuditEvent({
      actorId: actor.userId,
      actorUsername: actor.username,
      actorIp: actor.ip,
      targetUserId: user.id,
      targetUsername: user.username,
      action: 'USER_CREATED',
      metadata: {
        roles,
        sandboxAccess: input.sandboxAccess,
        requirePasswordChange: input.requirePasswordChange ?? true,
      },
    });

    this.log('User created', { username: user.username, roles });

    return {
      user: userToPublic(user),
      generatedPassword,
    };
  }

  /**
   * Get user by ID
   */
  getUser(userId: string): UserPublic | null {
    const user = getUserById(userId);
    return user ? userToPublic(user) : null;
  }

  /**
   * Get user by username
   */
  getUserByUsername(username: string): UserPublic | null {
    const user = getUserByUsername(username);
    return user ? userToPublic(user) : null;
  }

  /**
   * List users with filtering
   */
  listUsers(query: ListUsersQuery = {}): PaginatedResult<UserPublic> {
    return dbListUsers(query);
  }

  /**
   * Update user properties
   */
  async updateUser(
    userId: string,
    input: UpdateUserInput,
    actor: ActorContext
  ): Promise<UserPublic> {
    // Get target user
    const targetUser = getUserById(userId);
    if (!targetUser) {
      throw new UserServiceError('User not found', 'USER_NOT_FOUND');
    }

    // Check permissions
    if (!this.canModifyUser(actor.userId, targetUser)) {
      throw new UserServiceError(
        'Insufficient permissions to modify this user',
        'INSUFFICIENT_PERMISSIONS'
      );
    }

    // Validate role changes
    if (input.roles) {
      if (!this.areValidRoles(input.roles)) {
        throw new UserServiceError('Invalid roles specified', 'INVALID_ROLES');
      }
      if (!this.canAssignRoles(actor.userId, input.roles)) {
        throw new UserServiceError(
          'Cannot assign admin role without admin permissions',
          'INSUFFICIENT_PERMISSIONS'
        );
      }
    }

    // Apply updates
    const updated = dbUpdateUser(userId, input);
    if (!updated) {
      throw new UserServiceError('Failed to update user', 'UPDATE_FAILED');
    }

    // Audit log
    logUserAuditEvent({
      actorId: actor.userId,
      actorUsername: actor.username,
      actorIp: actor.ip,
      targetUserId: userId,
      targetUsername: targetUser.username,
      action: 'USER_UPDATED',
      metadata: {
        changes: input,
      },
    });

    this.log('User updated', { userId, changes: Object.keys(input) });

    return userToPublic(updated);
  }

  /**
   * Disable a user account
   */
  async disableUser(userId: string, actor: ActorContext): Promise<void> {
    const targetUser = getUserById(userId);
    if (!targetUser) {
      throw new UserServiceError('User not found', 'USER_NOT_FOUND');
    }

    if (!this.canModifyUser(actor.userId, targetUser)) {
      throw new UserServiceError(
        'Insufficient permissions to disable this user',
        'INSUFFICIENT_PERMISSIONS'
      );
    }

    dbUpdateUser(userId, { isActive: false });

    // Revoke all sessions
    revokeAllUserSessions(userId);

    // Audit log
    logUserAuditEvent({
      actorId: actor.userId,
      actorUsername: actor.username,
      actorIp: actor.ip,
      targetUserId: userId,
      targetUsername: targetUser.username,
      action: 'USER_DISABLED',
    });

    this.log('User disabled', { userId });
  }

  /**
   * Enable a user account
   */
  async enableUser(userId: string, actor: ActorContext): Promise<void> {
    const targetUser = getUserById(userId);
    if (!targetUser) {
      throw new UserServiceError('User not found', 'USER_NOT_FOUND');
    }

    if (!this.canModifyUser(actor.userId, targetUser)) {
      throw new UserServiceError(
        'Insufficient permissions to enable this user',
        'INSUFFICIENT_PERMISSIONS'
      );
    }

    dbUpdateUser(userId, { isActive: true });

    // Audit log
    logUserAuditEvent({
      actorId: actor.userId,
      actorUsername: actor.username,
      actorIp: actor.ip,
      targetUserId: userId,
      targetUsername: targetUser.username,
      action: 'USER_ENABLED',
    });

    this.log('User enabled', { userId });
  }

  /**
   * Delete a user account
   *
   * Note: Only admins can delete users. qa_admin cannot delete.
   */
  async deleteUser(userId: string, actor: ActorContext): Promise<void> {
    const targetUser = getUserById(userId);
    if (!targetUser) {
      throw new UserServiceError('User not found', 'USER_NOT_FOUND');
    }

    // Only admins can delete
    const actorUser = getUserById(actor.userId);
    if (!actorUser || !actorUser.roles.includes('admin')) {
      throw new UserServiceError(
        'Only admins can delete users',
        'INSUFFICIENT_PERMISSIONS'
      );
    }

    // Revoke all sessions first
    revokeAllUserSessions(userId);

    // Delete user
    const deleted = dbDeleteUser(userId);
    if (!deleted) {
      throw new UserServiceError('Failed to delete user', 'DELETE_FAILED');
    }

    // Audit log
    logUserAuditEvent({
      actorId: actor.userId,
      actorUsername: actor.username,
      actorIp: actor.ip,
      targetUserId: userId,
      targetUsername: targetUser.username,
      action: 'USER_DELETED',
    });

    this.log('User deleted', { userId });
  }

  // ===========================================================================
  // Password Management
  // ===========================================================================

  /**
   * Change password (user changing their own password)
   */
  async changePassword(
    userId: string,
    input: ChangePasswordInput,
    actor: ActorContext
  ): Promise<void> {
    const user = getUserById(userId);
    if (!user) {
      throw new UserServiceError('User not found', 'USER_NOT_FOUND');
    }

    // Verify current password
    const { verifyPassword } = await import('../../utils/password.js');
    const valid = await verifyPassword(input.currentPassword, user.passwordHash);
    if (!valid) {
      throw new UserServiceError('Current password is incorrect', 'INVALID_PASSWORD');
    }

    // Validate new password
    const validation = validatePasswordStrength(input.newPassword);
    if (!validation.valid) {
      throw new UserServiceError(
        `New password does not meet requirements: ${validation.errors.join(', ')}`,
        'WEAK_PASSWORD'
      );
    }

    // Hash and update
    const newHash = await hashPassword(input.newPassword);
    updateUserPassword(userId, newHash);

    // Audit log
    logUserAuditEvent({
      actorId: actor.userId,
      actorUsername: actor.username,
      actorIp: actor.ip,
      targetUserId: userId,
      targetUsername: user.username,
      action: 'PASSWORD_CHANGED',
    });

    this.log('Password changed', { userId });
  }

  /**
   * Reset password (admin resetting user's password)
   */
  async resetPassword(
    userId: string,
    newPassword: string | undefined,
    actor: ActorContext
  ): Promise<ResetPasswordResult> {
    const targetUser = getUserById(userId);
    if (!targetUser) {
      throw new UserServiceError('User not found', 'USER_NOT_FOUND');
    }

    // Check permissions
    if (!this.canModifyUser(actor.userId, targetUser)) {
      throw new UserServiceError(
        'Insufficient permissions to reset password',
        'INSUFFICIENT_PERMISSIONS'
      );
    }

    // Generate or use provided password
    let password = newPassword;
    let generatedPassword: string | undefined;

    if (!password) {
      password = generateRandomPassword(16);
      generatedPassword = password;
    }

    // Validate password
    const validation = validatePasswordStrength(password);
    if (!validation.valid) {
      throw new UserServiceError(
        `Password does not meet requirements: ${validation.errors.join(', ')}`,
        'WEAK_PASSWORD'
      );
    }

    // Hash and update
    const newHash = await hashPassword(password);
    updateUserPassword(userId, newHash);

    // Force password change on next login
    dbUpdateUser(userId, { requirePasswordChange: true });

    // Audit log
    logUserAuditEvent({
      actorId: actor.userId,
      actorUsername: actor.username,
      actorIp: actor.ip,
      targetUserId: userId,
      targetUsername: targetUser.username,
      action: 'PASSWORD_RESET',
    });

    this.log('Password reset', { userId });

    return {
      success: true,
      generatedPassword,
    };
  }

  // ===========================================================================
  // Role Management
  // ===========================================================================

  /**
   * Grant a role to a user
   */
  async grantRole(
    userId: string,
    role: UserRole,
    actor: ActorContext
  ): Promise<void> {
    const targetUser = getUserById(userId);
    if (!targetUser) {
      throw new UserServiceError('User not found', 'USER_NOT_FOUND');
    }

    if (!this.canModifyUser(actor.userId, targetUser)) {
      throw new UserServiceError(
        'Insufficient permissions',
        'INSUFFICIENT_PERMISSIONS'
      );
    }

    if (!this.canAssignRoles(actor.userId, [role])) {
      throw new UserServiceError(
        'Cannot grant admin role without admin permissions',
        'INSUFFICIENT_PERMISSIONS'
      );
    }

    if (targetUser.roles.includes(role)) {
      return; // Already has role
    }

    const newRoles = [...targetUser.roles, role];
    dbUpdateUser(userId, { roles: newRoles });

    // Audit log
    logUserAuditEvent({
      actorId: actor.userId,
      actorUsername: actor.username,
      actorIp: actor.ip,
      targetUserId: userId,
      targetUsername: targetUser.username,
      action: 'ROLE_GRANTED',
      metadata: { role },
    });

    this.log('Role granted', { userId, role });
  }

  /**
   * Revoke a role from a user
   */
  async revokeRole(
    userId: string,
    role: UserRole,
    actor: ActorContext
  ): Promise<void> {
    const targetUser = getUserById(userId);
    if (!targetUser) {
      throw new UserServiceError('User not found', 'USER_NOT_FOUND');
    }

    if (!this.canModifyUser(actor.userId, targetUser)) {
      throw new UserServiceError(
        'Insufficient permissions',
        'INSUFFICIENT_PERMISSIONS'
      );
    }

    // Can't revoke admin role from self
    if (actor.userId === userId && role === 'admin') {
      throw new UserServiceError(
        'Cannot revoke your own admin role',
        'CANNOT_REVOKE_OWN_ADMIN'
      );
    }

    if (!targetUser.roles.includes(role)) {
      return; // Doesn't have role
    }

    const newRoles = targetUser.roles.filter(r => r !== role);
    if (newRoles.length === 0) {
      newRoles.push('qa_tester'); // Must have at least one role
    }

    dbUpdateUser(userId, { roles: newRoles });

    // Audit log
    logUserAuditEvent({
      actorId: actor.userId,
      actorUsername: actor.username,
      actorIp: actor.ip,
      targetUserId: userId,
      targetUsername: targetUser.username,
      action: 'ROLE_REVOKED',
      metadata: { role },
    });

    this.log('Role revoked', { userId, role });
  }

  // ===========================================================================
  // Sandbox Access Management
  // ===========================================================================

  /**
   * Grant sandbox access to a user
   */
  async grantSandboxAccess(
    userId: string,
    sandboxId: string,
    actor: ActorContext
  ): Promise<void> {
    const targetUser = getUserById(userId);
    if (!targetUser) {
      throw new UserServiceError('User not found', 'USER_NOT_FOUND');
    }

    if (!this.canModifyUser(actor.userId, targetUser)) {
      throw new UserServiceError(
        'Insufficient permissions',
        'INSUFFICIENT_PERMISSIONS'
      );
    }

    if (targetUser.sandboxAccess.includes(sandboxId)) {
      return; // Already has access
    }

    const newAccess = [...targetUser.sandboxAccess, sandboxId];
    dbUpdateUser(userId, { sandboxAccess: newAccess });

    // Audit log
    logUserAuditEvent({
      actorId: actor.userId,
      actorUsername: actor.username,
      actorIp: actor.ip,
      targetUserId: userId,
      targetUsername: targetUser.username,
      action: 'SANDBOX_ACCESS_GRANTED',
      metadata: { sandboxId },
    });

    this.log('Sandbox access granted', { userId, sandboxId });
  }

  /**
   * Revoke sandbox access from a user
   */
  async revokeSandboxAccess(
    userId: string,
    sandboxId: string,
    actor: ActorContext
  ): Promise<void> {
    const targetUser = getUserById(userId);
    if (!targetUser) {
      throw new UserServiceError('User not found', 'USER_NOT_FOUND');
    }

    if (!this.canModifyUser(actor.userId, targetUser)) {
      throw new UserServiceError(
        'Insufficient permissions',
        'INSUFFICIENT_PERMISSIONS'
      );
    }

    if (!targetUser.sandboxAccess.includes(sandboxId)) {
      return; // Doesn't have access
    }

    const newAccess = targetUser.sandboxAccess.filter(id => id !== sandboxId);
    dbUpdateUser(userId, { sandboxAccess: newAccess });

    // Audit log
    logUserAuditEvent({
      actorId: actor.userId,
      actorUsername: actor.username,
      actorIp: actor.ip,
      targetUserId: userId,
      targetUsername: targetUser.username,
      action: 'SANDBOX_ACCESS_REVOKED',
      metadata: { sandboxId },
    });

    this.log('Sandbox access revoked', { userId, sandboxId });
  }

  // ===========================================================================
  // Permission Helpers
  // ===========================================================================

  /**
   * Check if actor can modify target user
   *
   * Rules:
   * - admin can modify anyone
   * - qa_admin can only modify qa_tester users
   * - qa_tester cannot modify anyone
   */
  private canModifyUser(actorId: string, targetUser: User): boolean {
    const actor = getUserById(actorId);
    if (!actor) return false;

    // Admin can modify anyone
    if (actor.roles.includes('admin')) return true;

    // qa_admin can only modify qa_testers
    if (actor.roles.includes('qa_admin')) {
      // Can't modify admins or other qa_admins
      if (targetUser.roles.includes('admin') || targetUser.roles.includes('qa_admin')) {
        return false;
      }
      return true;
    }

    return false;
  }

  /**
   * Check if actor can create user with specified roles
   */
  private canCreateUserWithRoles(actorId: string, roles: UserRole[]): boolean {
    const actor = getUserById(actorId);
    if (!actor) return false;

    // Admin can create anyone
    if (actor.roles.includes('admin')) return true;

    // qa_admin can only create qa_tester
    if (actor.roles.includes('qa_admin')) {
      return roles.every(r => r === 'qa_tester');
    }

    return false;
  }

  /**
   * Check if actor can assign specified roles
   */
  private canAssignRoles(actorId: string, roles: UserRole[]): boolean {
    const actor = getUserById(actorId);
    if (!actor) return false;

    // Only admin can assign admin role
    if (roles.includes('admin') && !actor.roles.includes('admin')) {
      return false;
    }

    // Only admin can assign qa_admin role
    if (roles.includes('qa_admin') && !actor.roles.includes('admin')) {
      return false;
    }

    return true;
  }

  // ===========================================================================
  // Validation Helpers
  // ===========================================================================

  /**
   * Validate username format
   */
  private isValidUsername(username: string): boolean {
    if (!username || typeof username !== 'string') return false;
    if (username.length < 3 || username.length > 32) return false;
    return /^[a-zA-Z0-9_]+$/.test(username);
  }

  /**
   * Validate role array
   */
  private areValidRoles(roles: UserRole[]): boolean {
    const validRoles: UserRole[] = ['admin', 'qa_admin', 'qa_tester'];
    return roles.every(r => validRoles.includes(r));
  }

  // ===========================================================================
  // Debug Logging
  // ===========================================================================

  private log(message: string, context?: Record<string, unknown>): void {
    if (this.debug) {
      logger.debug({ ...context }, `[UserService] ${message}`);
    }
  }
}

// =============================================================================
// Error Class
// =============================================================================

export class UserServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = 'UserServiceError';
  }
}

// =============================================================================
// Factory & Singleton
// =============================================================================

let serviceInstance: UserService | null = null;

/**
 * Get UserService instance
 */
export function getUserService(config?: UserServiceConfig): UserService {
  if (!serviceInstance) {
    serviceInstance = new UserService(config);
  }
  return serviceInstance;
}

/**
 * Reset service instance (for testing)
 */
export function resetUserService(): void {
  serviceInstance = null;
}
