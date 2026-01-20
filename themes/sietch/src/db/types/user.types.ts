/**
 * User Management Types for Gom Jabbar
 *
 * Sprint 139: Database Schema & Core Models
 *
 * TypeScript interfaces for user authentication and management.
 * Supports CLI and dashboard authentication as alternative to Discord OAuth.
 *
 * @see grimoires/loa/prd.md §12. Gom Jabbar
 * @see grimoires/loa/sdd.md §13. User Management System
 */

// =============================================================================
// Role & Permission Enums
// =============================================================================

/**
 * User roles for access control
 * - admin: Full access, can manage all users and configurations
 * - qa_admin: Can manage qa_tester users, access QA sandboxes
 * - qa_tester: Can access granted QA sandboxes only
 */
export type UserRole = 'admin' | 'qa_admin' | 'qa_tester';

/**
 * Session types for different clients
 * - cli: Command-line interface sessions (longer expiry)
 * - dashboard: Web dashboard sessions (shorter expiry)
 */
export type SessionType = 'cli' | 'dashboard';

/**
 * Audit log action types
 */
export type AuditAction =
  // Authentication events
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILED'
  | 'LOGOUT'
  | 'SESSION_EXPIRED'
  | 'SESSION_REVOKED'
  // User management events
  | 'USER_CREATED'
  | 'USER_UPDATED'
  | 'USER_DISABLED'
  | 'USER_ENABLED'
  | 'USER_DELETED'
  | 'PASSWORD_CHANGED'
  | 'PASSWORD_RESET'
  // Role management events
  | 'ROLE_GRANTED'
  | 'ROLE_REVOKED'
  // Sandbox access events
  | 'SANDBOX_ACCESS_GRANTED'
  | 'SANDBOX_ACCESS_REVOKED'
  // Security events
  | 'RATE_LIMIT_EXCEEDED'
  | 'INVALID_TOKEN'
  | 'UNAUTHORIZED_ACCESS';

// =============================================================================
// Core User Types
// =============================================================================

/**
 * User entity for local authentication
 */
export interface User {
  id: string;
  username: string;
  passwordHash: string;
  roles: UserRole[];
  sandboxAccess: string[];
  isActive: boolean;
  displayName: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
  passwordChangedAt: Date;
  requirePasswordChange: boolean;
}

/**
 * User without sensitive fields (for API responses)
 */
export interface UserPublic {
  id: string;
  username: string;
  roles: UserRole[];
  sandboxAccess: string[];
  isActive: boolean;
  displayName: string | null;
  createdAt: Date;
  lastLoginAt: Date | null;
  requirePasswordChange: boolean;
}

/**
 * User session entity
 */
export interface UserSession {
  id: string;
  userId: string;
  tokenHash: string;
  sessionType: SessionType;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: Date;
  expiresAt: Date;
  lastActivityAt: Date;
  isRevoked: boolean;
}

/**
 * Session with associated user (for auth middleware)
 */
export interface SessionWithUser extends UserSession {
  user: UserPublic;
}

/**
 * Audit log entry
 */
export interface UserAuditEntry {
  id: string;
  actorId: string | null;
  actorUsername: string | null;
  actorIp: string | null;
  targetUserId: string | null;
  targetUsername: string | null;
  action: AuditAction;
  metadata: AuditMetadata;
  createdAt: Date;
}

/**
 * Audit entry metadata (additional context)
 * Uses index signature to allow arbitrary metadata fields
 */
export interface AuditMetadata {
  sessionType?: SessionType;
  userAgent?: string;
  reason?: string;
  oldValue?: unknown;
  newValue?: unknown;
  sandboxId?: string;
  role?: UserRole;
  failureReason?: string;
  // Allow arbitrary additional fields for flexibility
  [key: string]: unknown;
}

/**
 * Login rate limit tracking
 */
export interface LoginRateLimit {
  username: string;
  failedAttempts: number;
  firstAttemptAt: Date;
  lockedUntil: Date | null;
}

// =============================================================================
// Input Types (for API operations)
// =============================================================================

/**
 * Input for creating a new user
 */
export interface CreateUserInput {
  username: string;
  password: string;
  roles?: UserRole[];
  sandboxAccess?: string[];
  displayName?: string;
  requirePasswordChange?: boolean;
}

/**
 * Input for updating an existing user
 */
export interface UpdateUserInput {
  displayName?: string;
  roles?: UserRole[];
  sandboxAccess?: string[];
  isActive?: boolean;
  requirePasswordChange?: boolean;
}

/**
 * Input for changing password
 */
export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

/**
 * Input for admin password reset
 */
export interface ResetPasswordInput {
  userId: string;
  newPassword?: string; // If not provided, generates random password
}

/**
 * Input for login request
 */
export interface LoginInput {
  username: string;
  password: string;
  sessionType: SessionType;
  userAgent?: string;
  ipAddress?: string;
}

/**
 * Result of successful login
 */
export interface LoginResult {
  user: UserPublic;
  token: string;
  expiresAt: Date;
}

// =============================================================================
// Query Types
// =============================================================================

/**
 * Query parameters for listing users
 */
export interface ListUsersQuery {
  roles?: UserRole[];
  isActive?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

/**
 * Query parameters for audit log
 */
export interface AuditLogQuery {
  actorId?: string;
  targetUserId?: string;
  actions?: AuditAction[];
  fromDate?: Date;
  toDate?: Date;
  limit?: number;
  offset?: number;
}

/**
 * Paginated result wrapper
 */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  hasMore: boolean;
}

// =============================================================================
// Database Row Types (raw SQLite data)
// =============================================================================

/**
 * Raw user row from SQLite
 */
export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  roles: string;          // JSON array string
  sandbox_access: string; // JSON array string
  is_active: number;      // 0 or 1
  display_name: string | null;
  created_by: string | null;
  created_at: string;     // ISO datetime string
  updated_at: string;     // ISO datetime string
  last_login_at: string | null;
  password_changed_at: string;
  require_password_change: number; // 0 or 1
}

/**
 * Raw session row from SQLite
 */
export interface UserSessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  session_type: SessionType;
  user_agent: string | null;
  ip_address: string | null;
  created_at: string;     // ISO datetime string
  expires_at: string;     // ISO datetime string
  last_activity_at: string;
  is_revoked: number;     // 0 or 1
}

/**
 * Raw audit log row from SQLite
 */
export interface UserAuditLogRow {
  id: string;
  actor_id: string | null;
  actor_username: string | null;
  actor_ip: string | null;
  target_user_id: string | null;
  target_username: string | null;
  action: AuditAction;
  metadata: string;       // JSON string
  created_at: string;     // ISO datetime string
}

/**
 * Raw rate limit row from SQLite
 */
export interface LoginRateLimitRow {
  username: string;
  failed_attempts: number;
  first_attempt_at: string;
  locked_until: string | null;
}

// =============================================================================
// Conversion Utilities
// =============================================================================

/**
 * Convert database row to User entity
 */
export function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    roles: JSON.parse(row.roles) as UserRole[],
    sandboxAccess: JSON.parse(row.sandbox_access) as string[],
    isActive: row.is_active === 1,
    displayName: row.display_name,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    lastLoginAt: row.last_login_at ? new Date(row.last_login_at) : null,
    passwordChangedAt: new Date(row.password_changed_at),
    requirePasswordChange: row.require_password_change === 1,
  };
}

/**
 * Convert User to public (safe) representation
 */
export function userToPublic(user: User): UserPublic {
  return {
    id: user.id,
    username: user.username,
    roles: user.roles,
    sandboxAccess: user.sandboxAccess,
    isActive: user.isActive,
    displayName: user.displayName,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    requirePasswordChange: user.requirePasswordChange,
  };
}

/**
 * Convert database row to UserSession entity
 */
export function rowToSession(row: UserSessionRow): UserSession {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    sessionType: row.session_type,
    userAgent: row.user_agent,
    ipAddress: row.ip_address,
    createdAt: new Date(row.created_at),
    expiresAt: new Date(row.expires_at),
    lastActivityAt: new Date(row.last_activity_at),
    isRevoked: row.is_revoked === 1,
  };
}

/**
 * Convert database row to UserAuditEntry
 */
export function rowToAuditEntry(row: UserAuditLogRow): UserAuditEntry {
  return {
    id: row.id,
    actorId: row.actor_id,
    actorUsername: row.actor_username,
    actorIp: row.actor_ip,
    targetUserId: row.target_user_id,
    targetUsername: row.target_username,
    action: row.action,
    metadata: JSON.parse(row.metadata) as AuditMetadata,
    createdAt: new Date(row.created_at),
  };
}

/**
 * Convert database row to LoginRateLimit
 */
export function rowToRateLimit(row: LoginRateLimitRow): LoginRateLimit {
  return {
    username: row.username,
    failedAttempts: row.failed_attempts,
    firstAttemptAt: new Date(row.first_attempt_at),
    lockedUntil: row.locked_until ? new Date(row.locked_until) : null,
  };
}
