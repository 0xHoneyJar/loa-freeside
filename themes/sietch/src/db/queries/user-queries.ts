/**
 * User Management Queries for Gom Jabbar
 *
 * Sprint 139: Database Schema & Core Models
 *
 * Database operations for user authentication and management.
 * Provides CRUD operations for users, sessions, and audit logging.
 *
 * @see grimoires/loa/sdd.md §13. User Management System
 */

import { randomUUID } from 'crypto';
import { getDatabase } from '../connection.js';
import {
  type User,
  type UserPublic,
  type UserSession,
  type UserAuditEntry,
  type LoginRateLimit,
  type UserRole,
  type SessionType,
  type AuditAction,
  type AuditMetadata,
  type UserRow,
  type UserSessionRow,
  type UserAuditLogRow,
  type LoginRateLimitRow,
  type ListUsersQuery,
  type AuditLogQuery,
  type PaginatedResult,
  rowToUser,
  rowToSession,
  rowToAuditEntry,
  rowToRateLimit,
  userToPublic,
} from '../types/user.types.js';

// Re-export types for consumers
export type {
  User,
  UserPublic,
  UserSession,
  UserAuditEntry,
  LoginRateLimit,
  UserRole,
  SessionType,
  AuditAction,
  AuditMetadata,
  ListUsersQuery,
  AuditLogQuery,
  PaginatedResult,
};

// =============================================================================
// User CRUD Operations
// =============================================================================

/**
 * Create a new user
 */
export function createUser(params: {
  username: string;
  passwordHash: string;
  roles?: UserRole[];
  sandboxAccess?: string[];
  displayName?: string;
  createdBy?: string;
  requirePasswordChange?: boolean;
}): User {
  const database = getDatabase();
  const id = randomUUID();
  const roles = params.roles || ['qa_tester'];
  const sandboxAccess = params.sandboxAccess || [];

  const stmt = database.prepare(`
    INSERT INTO users (
      id, username, password_hash, roles, sandbox_access,
      display_name, created_by, require_password_change
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    params.username,
    params.passwordHash,
    JSON.stringify(roles),
    JSON.stringify(sandboxAccess),
    params.displayName || null,
    params.createdBy || null,
    params.requirePasswordChange ? 1 : 0
  );

  return getUserById(id)!;
}

/**
 * Get user by ID
 */
export function getUserById(id: string): User | null {
  const database = getDatabase();
  const row = database.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  return row ? rowToUser(row) : null;
}

/**
 * Get user by username (case-insensitive)
 */
export function getUserByUsername(username: string): User | null {
  const database = getDatabase();
  const row = database.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
  return row ? rowToUser(row) : null;
}

/**
 * List users with filtering and pagination
 */
export function listUsers(query: ListUsersQuery = {}): PaginatedResult<UserPublic> {
  const database = getDatabase();
  const params: unknown[] = [];
  let whereClauses: string[] = [];

  if (query.isActive !== undefined) {
    whereClauses.push('is_active = ?');
    params.push(query.isActive ? 1 : 0);
  }

  if (query.search) {
    whereClauses.push('(username LIKE ? OR display_name LIKE ?)');
    const searchPattern = `%${query.search}%`;
    params.push(searchPattern, searchPattern);
  }

  // Role filtering uses JSON LIKE (SQLite doesn't have native JSON array contains)
  if (query.roles && query.roles.length > 0) {
    const roleClauses = query.roles.map(() => "roles LIKE ?");
    whereClauses.push(`(${roleClauses.join(' OR ')})`);
    query.roles.forEach(role => params.push(`%"${role}"%`));
  }

  const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  // Get total count
  const countRow = database.prepare(`SELECT COUNT(*) as count FROM users ${whereClause}`).get(...params) as { count: number };
  const total = countRow.count;

  // Get paginated results
  const limit = query.limit || 50;
  const offset = query.offset || 0;
  params.push(limit, offset);

  const rows = database.prepare(`
    SELECT * FROM users ${whereClause}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params) as UserRow[];

  const items = rows.map(row => userToPublic(rowToUser(row)));

  return {
    items,
    total,
    hasMore: offset + items.length < total,
  };
}

/**
 * Update user fields
 */
export function updateUser(id: string, updates: {
  displayName?: string;
  roles?: UserRole[];
  sandboxAccess?: string[];
  isActive?: boolean;
  requirePasswordChange?: boolean;
}): User | null {
  const database = getDatabase();
  const setClauses: string[] = ['updated_at = datetime(\'now\')'];
  const params: unknown[] = [];

  if (updates.displayName !== undefined) {
    setClauses.push('display_name = ?');
    params.push(updates.displayName);
  }

  if (updates.roles !== undefined) {
    setClauses.push('roles = ?');
    params.push(JSON.stringify(updates.roles));
  }

  if (updates.sandboxAccess !== undefined) {
    setClauses.push('sandbox_access = ?');
    params.push(JSON.stringify(updates.sandboxAccess));
  }

  if (updates.isActive !== undefined) {
    setClauses.push('is_active = ?');
    params.push(updates.isActive ? 1 : 0);
  }

  if (updates.requirePasswordChange !== undefined) {
    setClauses.push('require_password_change = ?');
    params.push(updates.requirePasswordChange ? 1 : 0);
  }

  params.push(id);

  database.prepare(`UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);

  return getUserById(id);
}

/**
 * Update user's password hash
 */
export function updateUserPassword(id: string, passwordHash: string): boolean {
  const database = getDatabase();
  const result = database.prepare(`
    UPDATE users
    SET password_hash = ?, password_changed_at = datetime('now'),
        require_password_change = 0, updated_at = datetime('now')
    WHERE id = ?
  `).run(passwordHash, id);

  return result.changes > 0;
}

/**
 * Update last login timestamp
 */
export function updateLastLogin(id: string): void {
  const database = getDatabase();
  database.prepare(`
    UPDATE users SET last_login_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `).run(id);
}

/**
 * Delete user (hard delete)
 */
export function deleteUser(id: string): boolean {
  const database = getDatabase();
  const result = database.prepare('DELETE FROM users WHERE id = ?').run(id);
  return result.changes > 0;
}

// =============================================================================
// Session Management
// =============================================================================

/**
 * Create a new session
 */
export function createSession(params: {
  userId: string;
  tokenHash: string;
  sessionType: SessionType;
  userAgent?: string;
  ipAddress?: string;
  expiresAt: Date;
}): UserSession {
  const database = getDatabase();
  const id = randomUUID();

  const stmt = database.prepare(`
    INSERT INTO user_sessions (
      id, user_id, token_hash, session_type, user_agent, ip_address, expires_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    params.userId,
    params.tokenHash,
    params.sessionType,
    params.userAgent || null,
    params.ipAddress || null,
    params.expiresAt.toISOString()
  );

  return getSessionById(id)!;
}

/**
 * Get session by ID
 */
export function getSessionById(id: string): UserSession | null {
  const database = getDatabase();
  const row = database.prepare('SELECT * FROM user_sessions WHERE id = ?').get(id) as UserSessionRow | undefined;
  return row ? rowToSession(row) : null;
}

/**
 * Get session by token hash
 */
export function getSessionByTokenHash(tokenHash: string): UserSession | null {
  const database = getDatabase();
  const row = database.prepare('SELECT * FROM user_sessions WHERE token_hash = ?').get(tokenHash) as UserSessionRow | undefined;
  return row ? rowToSession(row) : null;
}

/**
 * Get active session by token hash (not expired, not revoked)
 */
export function getActiveSession(tokenHash: string): UserSession | null {
  const database = getDatabase();
  const row = database.prepare(`
    SELECT * FROM user_sessions
    WHERE token_hash = ?
      AND is_revoked = 0
      AND expires_at > datetime('now')
  `).get(tokenHash) as UserSessionRow | undefined;
  return row ? rowToSession(row) : null;
}

/**
 * Get all active sessions for a user
 */
export function getUserSessions(userId: string): UserSession[] {
  const database = getDatabase();
  const rows = database.prepare(`
    SELECT * FROM user_sessions
    WHERE user_id = ? AND is_revoked = 0
    ORDER BY created_at DESC
  `).all(userId) as UserSessionRow[];

  return rows.map(rowToSession);
}

/**
 * Update session activity timestamp
 */
export function updateSessionActivity(id: string): void {
  const database = getDatabase();
  database.prepare(`
    UPDATE user_sessions SET last_activity_at = datetime('now')
    WHERE id = ?
  `).run(id);
}

/**
 * Revoke a specific session
 */
export function revokeSession(id: string): boolean {
  const database = getDatabase();
  const result = database.prepare(`
    UPDATE user_sessions SET is_revoked = 1
    WHERE id = ?
  `).run(id);

  return result.changes > 0;
}

/**
 * Revoke all sessions for a user
 */
export function revokeAllUserSessions(userId: string): number {
  const database = getDatabase();
  const result = database.prepare(`
    UPDATE user_sessions SET is_revoked = 1
    WHERE user_id = ? AND is_revoked = 0
  `).run(userId);

  return result.changes;
}

/**
 * Clean up expired sessions (maintenance job)
 */
export function cleanupExpiredSessions(): number {
  const database = getDatabase();
  const result = database.prepare(`
    DELETE FROM user_sessions
    WHERE expires_at < datetime('now', '-7 days')
  `).run();

  return result.changes;
}

// =============================================================================
// Audit Logging
// =============================================================================

/**
 * Log a user audit event
 */
export function logUserAuditEvent(params: {
  actorId?: string;
  actorUsername?: string;
  actorIp?: string;
  targetUserId?: string;
  targetUsername?: string;
  action: AuditAction;
  metadata?: AuditMetadata;
}): string {
  const database = getDatabase();
  const id = randomUUID();

  const stmt = database.prepare(`
    INSERT INTO user_audit_log (
      id, actor_id, actor_username, actor_ip,
      target_user_id, target_username, action, metadata
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    params.actorId || null,
    params.actorUsername || null,
    params.actorIp || null,
    params.targetUserId || null,
    params.targetUsername || null,
    params.action,
    JSON.stringify(params.metadata || {})
  );

  return id;
}

/**
 * Query audit log with filtering
 */
export function queryUserAuditLog(query: AuditLogQuery = {}): PaginatedResult<UserAuditEntry> {
  const database = getDatabase();
  const params: unknown[] = [];
  let whereClauses: string[] = [];

  if (query.actorId) {
    whereClauses.push('actor_id = ?');
    params.push(query.actorId);
  }

  if (query.targetUserId) {
    whereClauses.push('target_user_id = ?');
    params.push(query.targetUserId);
  }

  if (query.actions && query.actions.length > 0) {
    const placeholders = query.actions.map(() => '?').join(', ');
    whereClauses.push(`action IN (${placeholders})`);
    params.push(...query.actions);
  }

  if (query.fromDate) {
    whereClauses.push('created_at >= ?');
    params.push(query.fromDate.toISOString());
  }

  if (query.toDate) {
    whereClauses.push('created_at <= ?');
    params.push(query.toDate.toISOString());
  }

  const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  // Get total count
  const countRow = database.prepare(`SELECT COUNT(*) as count FROM user_audit_log ${whereClause}`).get(...params) as { count: number };
  const total = countRow.count;

  // Get paginated results
  const limit = query.limit || 100;
  const offset = query.offset || 0;
  params.push(limit, offset);

  const rows = database.prepare(`
    SELECT * FROM user_audit_log ${whereClause}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params) as UserAuditLogRow[];

  const items = rows.map(rowToAuditEntry);

  return {
    items,
    total,
    hasMore: offset + items.length < total,
  };
}

/**
 * Get recent login failures for a user (for security alerts)
 */
export function getRecentLoginFailures(username: string, sinceMinutes: number = 60): UserAuditEntry[] {
  const database = getDatabase();
  const rows = database.prepare(`
    SELECT * FROM user_audit_log
    WHERE target_username = ?
      AND action = 'LOGIN_FAILED'
      AND created_at > datetime('now', ?)
    ORDER BY created_at DESC
  `).all(username, `-${sinceMinutes} minutes`) as UserAuditLogRow[];

  return rows.map(rowToAuditEntry);
}

// =============================================================================
// Rate Limiting
// =============================================================================

/**
 * Get rate limit status for a username
 */
export function getRateLimitStatus(username: string): LoginRateLimit | null {
  const database = getDatabase();
  const row = database.prepare('SELECT * FROM login_rate_limits WHERE username = ?').get(username) as LoginRateLimitRow | undefined;
  return row ? rowToRateLimit(row) : null;
}

/**
 * Record a failed login attempt
 */
export function recordFailedLogin(username: string, lockoutMinutes: number = 15, maxAttempts: number = 5): LoginRateLimit {
  const database = getDatabase();

  // Upsert rate limit record
  database.prepare(`
    INSERT INTO login_rate_limits (username, failed_attempts, first_attempt_at)
    VALUES (?, 1, datetime('now'))
    ON CONFLICT(username) DO UPDATE SET
      failed_attempts = CASE
        WHEN first_attempt_at < datetime('now', '-15 minutes') THEN 1
        ELSE failed_attempts + 1
      END,
      first_attempt_at = CASE
        WHEN first_attempt_at < datetime('now', '-15 minutes') THEN datetime('now')
        ELSE first_attempt_at
      END
  `).run(username);

  // Check if we need to lock
  const current = getRateLimitStatus(username)!;
  if (current.failedAttempts >= maxAttempts && !current.lockedUntil) {
    database.prepare(`
      UPDATE login_rate_limits
      SET locked_until = datetime('now', ?)
      WHERE username = ?
    `).run(`+${lockoutMinutes} minutes`, username);
  }

  return getRateLimitStatus(username)!;
}

/**
 * Clear rate limit after successful login
 */
export function clearRateLimit(username: string): void {
  const database = getDatabase();
  database.prepare('DELETE FROM login_rate_limits WHERE username = ?').run(username);
}

/**
 * Check if a username is currently rate limited
 */
export function isRateLimited(username: string): { limited: boolean; lockedUntil: Date | null; remainingAttempts: number } {
  const rateLimit = getRateLimitStatus(username);

  if (!rateLimit) {
    return { limited: false, lockedUntil: null, remainingAttempts: 5 };
  }

  // Check if lockout has expired
  if (rateLimit.lockedUntil && rateLimit.lockedUntil <= new Date()) {
    clearRateLimit(username);
    return { limited: false, lockedUntil: null, remainingAttempts: 5 };
  }

  // Check if attempt window has expired
  const windowExpiry = new Date(rateLimit.firstAttemptAt.getTime() + 15 * 60 * 1000);
  if (windowExpiry <= new Date()) {
    clearRateLimit(username);
    return { limited: false, lockedUntil: null, remainingAttempts: 5 };
  }

  const remainingAttempts = Math.max(0, 5 - rateLimit.failedAttempts);

  return {
    limited: rateLimit.lockedUntil !== null,
    lockedUntil: rateLimit.lockedUntil,
    remainingAttempts,
  };
}

/**
 * Cleanup old rate limit records (maintenance job)
 */
export function cleanupOldRateLimits(): number {
  const database = getDatabase();
  const result = database.prepare(`
    DELETE FROM login_rate_limits
    WHERE first_attempt_at < datetime('now', '-1 day')
  `).run();

  return result.changes;
}
