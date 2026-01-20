/**
 * AuthService - Authentication & Session Management for Gom Jabbar
 *
 * Sprint 140: UserService & AuthService Core
 *
 * Provides authentication and session management:
 * - Username/password authentication
 * - Session token generation and validation
 * - Rate limiting for brute force protection
 * - Unified auth middleware support
 *
 * Security Features:
 * - Argon2id password verification
 * - SHA-256 session token hashing
 * - Rate limiting (5 attempts / 15 min)
 * - Session expiration (CLI: 24h, Dashboard: 8h)
 *
 * @see grimoires/loa/sdd.md §13.5 AuthService Interface
 */

import { logger } from '../../utils/logger.js';
import {
  verifyPassword,
  generateSessionToken,
  hashSessionToken,
} from '../../utils/password.js';
import {
  getUserById,
  getUserByUsername,
  updateLastLogin,
  createSession,
  getActiveSession,
  getUserSessions,
  updateSessionActivity,
  revokeSession,
  revokeAllUserSessions,
  logUserAuditEvent,
  isRateLimited,
  recordFailedLogin,
  clearRateLimit,
  type User,
  type UserPublic,
  type UserSession,
  type SessionType,
} from '../../db/queries/user-queries.js';
import { userToPublic } from '../../db/types/user.types.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Login request
 */
export interface LoginRequest {
  username: string;
  password: string;
  sessionType: SessionType;
  userAgent?: string;
  ipAddress?: string;
}

/**
 * Login result
 */
export interface LoginResult {
  success: boolean;
  user?: UserPublic;
  token?: string;
  expiresAt?: Date;
  requirePasswordChange?: boolean;
  error?: string;
  remainingAttempts?: number;
  lockedUntil?: Date;
}

/**
 * Session validation result
 */
export interface SessionValidationResult {
  valid: boolean;
  user?: UserPublic;
  session?: UserSession;
  error?: string;
}

/**
 * Auth context (for middleware)
 */
export interface AuthContext {
  userId: string;
  username: string;
  roles: string[];
  sandboxAccess: string[];
  authType: 'local' | 'discord' | 'api_key';
  sessionId?: string;
}

/**
 * Service configuration
 */
export interface AuthServiceConfig {
  /** CLI session expiry in hours (default: 24) */
  cliSessionExpiryHours?: number;
  /** Dashboard session expiry in hours (default: 8) */
  dashboardSessionExpiryHours?: number;
  /** Max failed login attempts before lockout (default: 5) */
  maxLoginAttempts?: number;
  /** Lockout duration in minutes (default: 15) */
  lockoutDurationMinutes?: number;
  /** Enable debug logging */
  debug?: boolean;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_CLI_SESSION_EXPIRY_HOURS = 24;
const DEFAULT_DASHBOARD_SESSION_EXPIRY_HOURS = 8;
const DEFAULT_MAX_LOGIN_ATTEMPTS = 5;
const DEFAULT_LOCKOUT_DURATION_MINUTES = 15;

// =============================================================================
// AuthService Class
// =============================================================================

/**
 * Authentication and Session Management Service
 *
 * Handles user authentication with rate limiting and
 * session management for CLI and dashboard clients.
 */
export class AuthService {
  private readonly cliSessionExpiryHours: number;
  private readonly dashboardSessionExpiryHours: number;
  private readonly maxLoginAttempts: number;
  private readonly lockoutDurationMinutes: number;
  private readonly debug: boolean;

  constructor(config: AuthServiceConfig = {}) {
    this.cliSessionExpiryHours = config.cliSessionExpiryHours ?? DEFAULT_CLI_SESSION_EXPIRY_HOURS;
    this.dashboardSessionExpiryHours = config.dashboardSessionExpiryHours ?? DEFAULT_DASHBOARD_SESSION_EXPIRY_HOURS;
    this.maxLoginAttempts = config.maxLoginAttempts ?? DEFAULT_MAX_LOGIN_ATTEMPTS;
    this.lockoutDurationMinutes = config.lockoutDurationMinutes ?? DEFAULT_LOCKOUT_DURATION_MINUTES;
    this.debug = config.debug ?? false;

    this.log('AuthService initialized', {
      cliSessionExpiryHours: this.cliSessionExpiryHours,
      dashboardSessionExpiryHours: this.dashboardSessionExpiryHours,
      maxLoginAttempts: this.maxLoginAttempts,
    });
  }

  // ===========================================================================
  // Authentication
  // ===========================================================================

  /**
   * Authenticate a user with username/password
   *
   * @param request - Login request with credentials
   * @returns Login result with session token or error
   */
  async login(request: LoginRequest): Promise<LoginResult> {
    const { username, password, sessionType, userAgent, ipAddress } = request;

    // Check rate limiting
    const rateStatus = isRateLimited(username);
    if (rateStatus.limited) {
      this.log('Login blocked by rate limit', { username });

      logUserAuditEvent({
        targetUsername: username,
        actorIp: ipAddress,
        action: 'RATE_LIMIT_EXCEEDED',
        metadata: { lockedUntil: rateStatus.lockedUntil?.toISOString() },
      });

      return {
        success: false,
        error: 'Too many login attempts. Please try again later.',
        lockedUntil: rateStatus.lockedUntil!,
        remainingAttempts: 0,
      };
    }

    // Find user
    const user = getUserByUsername(username);
    if (!user) {
      // Record failed attempt (even for non-existent users to prevent enumeration)
      const limit = recordFailedLogin(username, this.lockoutDurationMinutes, this.maxLoginAttempts);

      logUserAuditEvent({
        targetUsername: username,
        actorIp: ipAddress,
        action: 'LOGIN_FAILED',
        metadata: { reason: 'User not found' },
      });

      this.log('Login failed - user not found', { username });

      return {
        success: false,
        error: 'Invalid username or password',
        remainingAttempts: Math.max(0, this.maxLoginAttempts - limit.failedAttempts),
      };
    }

    // Check if account is active
    if (!user.isActive) {
      logUserAuditEvent({
        targetUserId: user.id,
        targetUsername: username,
        actorIp: ipAddress,
        action: 'LOGIN_FAILED',
        metadata: { reason: 'Account disabled' },
      });

      this.log('Login failed - account disabled', { username });

      return {
        success: false,
        error: 'Account is disabled. Contact an administrator.',
      };
    }

    // Verify password
    const passwordValid = await verifyPassword(password, user.passwordHash);
    if (!passwordValid) {
      const limit = recordFailedLogin(username, this.lockoutDurationMinutes, this.maxLoginAttempts);

      logUserAuditEvent({
        targetUserId: user.id,
        targetUsername: username,
        actorIp: ipAddress,
        action: 'LOGIN_FAILED',
        metadata: { reason: 'Invalid password' },
      });

      this.log('Login failed - invalid password', { username });

      return {
        success: false,
        error: 'Invalid username or password',
        remainingAttempts: Math.max(0, this.maxLoginAttempts - limit.failedAttempts),
        lockedUntil: limit.lockedUntil || undefined,
      };
    }

    // Clear rate limit on successful login
    clearRateLimit(username);

    // Generate session token
    const token = generateSessionToken(32);
    const tokenHash = hashSessionToken(token);

    // Calculate expiry
    const expiryHours = sessionType === 'cli'
      ? this.cliSessionExpiryHours
      : this.dashboardSessionExpiryHours;
    const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000);

    // Create session
    const session = createSession({
      userId: user.id,
      tokenHash,
      sessionType,
      userAgent,
      ipAddress,
      expiresAt,
    });

    // Update last login
    updateLastLogin(user.id);

    // Audit log
    logUserAuditEvent({
      actorId: user.id,
      actorUsername: username,
      actorIp: ipAddress,
      action: 'LOGIN_SUCCESS',
      metadata: {
        sessionType,
        sessionId: session.id,
        userAgent,
      },
    });

    this.log('Login successful', { username, sessionType });

    return {
      success: true,
      user: userToPublic(user),
      token,
      expiresAt,
      requirePasswordChange: user.requirePasswordChange,
    };
  }

  /**
   * Logout - revoke a session
   */
  async logout(
    token: string,
    ipAddress?: string
  ): Promise<{ success: boolean; error?: string }> {
    const tokenHash = hashSessionToken(token);
    const session = getActiveSession(tokenHash);

    if (!session) {
      return { success: false, error: 'Invalid or expired session' };
    }

    // Revoke session
    revokeSession(session.id);

    // Get user for audit
    const user = getUserById(session.userId);

    // Audit log
    logUserAuditEvent({
      actorId: session.userId,
      actorUsername: user?.username,
      actorIp: ipAddress,
      action: 'LOGOUT',
      metadata: { sessionId: session.id },
    });

    this.log('Logout successful', { userId: session.userId });

    return { success: true };
  }

  /**
   * Logout all sessions for a user
   */
  async logoutAll(
    userId: string,
    ipAddress?: string
  ): Promise<{ success: boolean; revokedCount: number }> {
    const count = revokeAllUserSessions(userId);

    // Get user for audit
    const user = getUserById(userId);

    // Audit log
    logUserAuditEvent({
      actorId: userId,
      actorUsername: user?.username,
      actorIp: ipAddress,
      action: 'LOGOUT',
      metadata: { allSessions: true, revokedCount: count },
    });

    this.log('Logout all sessions', { userId, revokedCount: count });

    return { success: true, revokedCount: count };
  }

  // ===========================================================================
  // Session Management
  // ===========================================================================

  /**
   * Validate a session token
   *
   * @param token - Session token to validate
   * @returns Validation result with user if valid
   */
  async validateSession(token: string): Promise<SessionValidationResult> {
    const tokenHash = hashSessionToken(token);
    const session = getActiveSession(tokenHash);

    if (!session) {
      return {
        valid: false,
        error: 'Invalid or expired session',
      };
    }

    // Get user
    const user = getUserById(session.userId);
    if (!user) {
      return {
        valid: false,
        error: 'User not found',
      };
    }

    // Check if user is still active
    if (!user.isActive) {
      revokeSession(session.id);
      return {
        valid: false,
        error: 'Account is disabled',
      };
    }

    // Update session activity
    updateSessionActivity(session.id);

    return {
      valid: true,
      user: userToPublic(user),
      session,
    };
  }

  /**
   * Get auth context from session token (for middleware)
   */
  async getAuthContext(token: string): Promise<AuthContext | null> {
    const result = await this.validateSession(token);
    if (!result.valid || !result.user || !result.session) {
      return null;
    }

    return {
      userId: result.user.id,
      username: result.user.username,
      roles: result.user.roles,
      sandboxAccess: result.user.sandboxAccess,
      authType: 'local',
      sessionId: result.session.id,
    };
  }

  /**
   * Refresh session expiry
   */
  async refreshSession(token: string): Promise<{ success: boolean; newExpiresAt?: Date }> {
    const tokenHash = hashSessionToken(token);
    const session = getActiveSession(tokenHash);

    if (!session) {
      return { success: false };
    }

    // Update activity (which extends session visibility)
    updateSessionActivity(session.id);

    return { success: true };
  }

  /**
   * List active sessions for a user
   */
  listUserSessions(userId: string): UserSession[] {
    return getUserSessions(userId);
  }

  /**
   * Revoke a specific session
   */
  async revokeSessionById(
    sessionId: string,
    actorId: string,
    ipAddress?: string
  ): Promise<{ success: boolean }> {
    const success = revokeSession(sessionId);

    if (success) {
      const actor = getUserById(actorId);
      logUserAuditEvent({
        actorId,
        actorUsername: actor?.username,
        actorIp: ipAddress,
        action: 'SESSION_REVOKED',
        metadata: { sessionId },
      });
    }

    return { success };
  }

  // ===========================================================================
  // Authorization Helpers
  // ===========================================================================

  /**
   * Check if user has required role
   */
  hasRole(user: UserPublic, role: string): boolean {
    return user.roles.includes(role as any);
  }

  /**
   * Check if user has any of the required roles
   */
  hasAnyRole(user: UserPublic, roles: string[]): boolean {
    return roles.some(role => user.roles.includes(role as any));
  }

  /**
   * Check if user can access a sandbox
   */
  canAccessSandbox(user: UserPublic, sandboxId: string): boolean {
    // Admins have full access
    if (user.roles.includes('admin')) return true;

    // Check sandbox access list
    return user.sandboxAccess.includes(sandboxId) || user.sandboxAccess.includes('*');
  }

  // ===========================================================================
  // Debug Logging
  // ===========================================================================

  private log(message: string, context?: Record<string, unknown>): void {
    if (this.debug) {
      logger.debug({ ...context }, `[AuthService] ${message}`);
    }
  }
}

// =============================================================================
// Factory & Singleton
// =============================================================================

let serviceInstance: AuthService | null = null;

/**
 * Get AuthService instance
 */
export function getAuthService(config?: AuthServiceConfig): AuthService {
  if (!serviceInstance) {
    serviceInstance = new AuthService(config);
  }
  return serviceInstance;
}

/**
 * Reset service instance (for testing)
 */
export function resetAuthService(): void {
  serviceInstance = null;
}
