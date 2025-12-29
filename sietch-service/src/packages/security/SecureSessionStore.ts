/**
 * SecureSessionStore - Session Security Enhancements
 *
 * Sprint 51: High Priority Hardening (P1) - Observability & Session Security
 *
 * Implements IP binding, device fingerprinting, and failed attempt rate limiting
 * to prevent session hijacking and brute force attacks.
 *
 * Security Features:
 * - IP address binding with session validation
 * - Device fingerprinting (User-Agent + Accept headers)
 * - Failed attempt rate limiting (10 attempts → 15min lockout)
 * - Suspicious activity detection and alerting
 *
 * @module packages/security/SecureSessionStore
 */

import { Redis } from 'ioredis';
import * as crypto from 'node:crypto';
import { createChildLogger } from '../../utils/logger.js';

/**
 * Session security context
 */
export interface SessionSecurityContext {
  /** Client IP address */
  ipAddress: string;
  /** User-Agent header */
  userAgent: string;
  /** Accept header */
  acceptHeader?: string;
  /** Additional context headers */
  customHeaders?: Record<string, string>;
}

/**
 * Secure session data
 */
export interface SecureSession {
  /** Session ID */
  sessionId: string;
  /** User ID */
  userId: string;
  /** Guild/Community ID */
  guildId: string;
  /** Session data payload */
  data: Record<string, unknown>;
  /** IP address at session creation */
  boundIpAddress: string;
  /** Device fingerprint */
  deviceFingerprint: string;
  /** Session created at timestamp */
  createdAt: Date;
  /** Session last accessed at timestamp */
  lastAccessedAt: Date;
  /** Session expires at timestamp */
  expiresAt: Date;
  /** Failed validation attempts */
  failedAttempts: number;
}

/**
 * Session validation result
 */
export interface SessionValidationResult {
  /** Whether session is valid */
  valid: boolean;
  /** Validation failure reason */
  reason?: 'session_not_found' | 'ip_mismatch' | 'fingerprint_mismatch' | 'expired' | 'locked_out';
  /** Session data (if valid) */
  session?: SecureSession;
}

/**
 * Rate limit status
 */
export interface RateLimitStatus {
  /** Whether rate limit is active */
  limited: boolean;
  /** Failed attempt count */
  attempts: number;
  /** Lockout expiry timestamp (if locked out) */
  lockoutExpiresAt?: Date;
}

/**
 * SecureSessionStore configuration
 */
export interface SecureSessionStoreConfig {
  /** Redis client */
  redis: Redis;
  /** Session TTL in seconds (default: 15 minutes) */
  sessionTtl?: number;
  /** Failed attempt threshold (default: 10) */
  failedAttemptThreshold?: number;
  /** Lockout duration in seconds (default: 900 = 15 minutes) */
  lockoutDuration?: number;
  /** Enable IP binding (default: true) */
  enableIpBinding?: boolean;
  /** Enable device fingerprinting (default: true) */
  enableFingerprinting?: boolean;
  /** Key prefix for Redis keys (default: 'secure_session') */
  keyPrefix?: string;
}

/**
 * SecureSessionStore - Production-grade session security
 *
 * Prevents session hijacking via IP binding and device fingerprinting.
 * Implements rate limiting to prevent brute force attacks.
 */
export class SecureSessionStore {
  private readonly redis: Redis;
  private readonly sessionTtl: number;
  private readonly failedAttemptThreshold: number;
  private readonly lockoutDuration: number;
  private readonly enableIpBinding: boolean;
  private readonly enableFingerprinting: boolean;
  private readonly keyPrefix: string;
  private readonly rateLimitSalt: string;
  private readonly logger = createChildLogger({ module: 'SecureSessionStore' });

  constructor(config: SecureSessionStoreConfig) {
    this.redis = config.redis;
    this.sessionTtl = config.sessionTtl ?? 900; // 15 minutes default
    this.failedAttemptThreshold = config.failedAttemptThreshold ?? 10;
    this.lockoutDuration = config.lockoutDuration ?? 900; // 15 minutes default
    this.enableIpBinding = config.enableIpBinding ?? true;
    this.enableFingerprinting = config.enableFingerprinting ?? true;
    this.keyPrefix = config.keyPrefix ?? 'secure_session';
    // Generate random salt for rate limit keys (defense-in-depth against Redis key prediction)
    this.rateLimitSalt = crypto.randomBytes(8).toString('hex');
  }

  /**
   * Redis key for session data
   */
  private sessionKey(sessionId: string): string {
    return `${this.keyPrefix}:${sessionId}`;
  }

  /**
   * Redis key for rate limit tracking
   * Uses salted hash to prevent key prediction attacks
   */
  private rateLimitKey(userId: string, guildId: string): string {
    const hash = crypto
      .createHash('sha256')
      .update(`${this.rateLimitSalt}:${guildId}:${userId}`)
      .digest('hex')
      .substring(0, 16);
    return `${this.keyPrefix}:rate_limit:${hash}`;
  }

  /**
   * Generate device fingerprint from security context
   *
   * Combines User-Agent and Accept headers to create unique device identifier.
   * Uses SHA256 hash for consistent fingerprint generation.
   */
  generateDeviceFingerprint(context: SessionSecurityContext): string {
    const components = [
      context.userAgent,
      context.acceptHeader ?? '',
      // Additional headers can be added here for stronger fingerprinting
    ].filter(Boolean);

    const fingerprintString = components.join('|');
    return crypto.createHash('sha256').update(fingerprintString).digest('hex');
  }

  /**
   * Create a new secure session
   */
  async createSession(
    userId: string,
    guildId: string,
    context: SessionSecurityContext,
    data: Record<string, unknown> = {}
  ): Promise<SecureSession> {
    // Check rate limit before creating session
    const rateLimitStatus = await this.checkRateLimit(userId, guildId);
    if (rateLimitStatus.limited) {
      throw new Error(
        `User ${userId} is locked out until ${rateLimitStatus.lockoutExpiresAt?.toISOString()}`
      );
    }

    // Generate session ID
    const sessionId = this.generateSessionId();

    // Generate device fingerprint
    const deviceFingerprint = this.generateDeviceFingerprint(context);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.sessionTtl * 1000);

    const session: SecureSession = {
      sessionId,
      userId,
      guildId,
      data,
      boundIpAddress: context.ipAddress,
      deviceFingerprint,
      createdAt: now,
      lastAccessedAt: now,
      expiresAt,
      failedAttempts: 0,
    };

    // Store session in Redis
    await this.redis.setex(
      this.sessionKey(sessionId),
      this.sessionTtl,
      JSON.stringify(session)
    );

    return session;
  }

  /**
   * Validate and retrieve session
   */
  async validateSession(
    sessionId: string,
    context: SessionSecurityContext
  ): Promise<SessionValidationResult> {
    // Retrieve session from Redis
    const sessionData = await this.redis.get(this.sessionKey(sessionId));

    if (!sessionData) {
      return {
        valid: false,
        reason: 'session_not_found',
      };
    }

    const session: SecureSession = JSON.parse(sessionData);

    // Check expiration
    if (new Date(session.expiresAt) < new Date()) {
      await this.deleteSession(sessionId);
      return {
        valid: false,
        reason: 'expired',
      };
    }

    // Check rate limit (lockout status)
    const rateLimitStatus = await this.checkRateLimit(session.userId, session.guildId);
    if (rateLimitStatus.limited) {
      return {
        valid: false,
        reason: 'locked_out',
      };
    }

    // Validate IP binding (if enabled)
    if (this.enableIpBinding && session.boundIpAddress !== context.ipAddress) {
      await this.recordFailedAttempt(session.userId, session.guildId, sessionId);
      return {
        valid: false,
        reason: 'ip_mismatch',
      };
    }

    // Validate device fingerprint (if enabled)
    if (this.enableFingerprinting) {
      const currentFingerprint = this.generateDeviceFingerprint(context);
      if (session.deviceFingerprint !== currentFingerprint) {
        await this.recordFailedAttempt(session.userId, session.guildId, sessionId);
        return {
          valid: false,
          reason: 'fingerprint_mismatch',
        };
      }
    }

    // Session is valid - update last accessed timestamp
    session.lastAccessedAt = new Date();
    await this.redis.setex(
      this.sessionKey(sessionId),
      this.sessionTtl,
      JSON.stringify(session)
    );

    return {
      valid: true,
      session,
    };
  }

  /**
   * Update session data
   */
  async updateSession(
    sessionId: string,
    data: Partial<Record<string, unknown>>
  ): Promise<void> {
    const sessionData = await this.redis.get(this.sessionKey(sessionId));
    if (!sessionData) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const session: SecureSession = JSON.parse(sessionData);
    session.data = { ...session.data, ...data };
    session.lastAccessedAt = new Date();

    await this.redis.setex(
      this.sessionKey(sessionId),
      this.sessionTtl,
      JSON.stringify(session)
    );
  }

  /**
   * Delete session
   */
  async deleteSession(sessionId: string): Promise<void> {
    await this.redis.del(this.sessionKey(sessionId));
  }

  /**
   * Revoke all sessions for a user (e.g., on password reset)
   */
  async revokeUserSessions(userId: string, guildId: string): Promise<number> {
    // Scan for all sessions matching user + guild
    const pattern = `${this.keyPrefix}:*`;
    const keys = await this.scanKeys(pattern);

    let revokedCount = 0;

    for (const key of keys) {
      const sessionData = await this.redis.get(key);
      if (!sessionData) continue;

      const session: SecureSession = JSON.parse(sessionData);
      if (session.userId === userId && session.guildId === guildId) {
        await this.redis.del(key);
        revokedCount++;
      }
    }

    return revokedCount;
  }

  /**
   * Check rate limit status for user
   */
  async checkRateLimit(userId: string, guildId: string): Promise<RateLimitStatus> {
    const key = this.rateLimitKey(userId, guildId);
    const attempts = await this.redis.get(key);

    if (!attempts) {
      return { limited: false, attempts: 0 };
    }

    const attemptCount = parseInt(attempts, 10);

    if (attemptCount >= this.failedAttemptThreshold) {
      const ttl = await this.redis.ttl(key);
      const lockoutExpiresAt = new Date(Date.now() + ttl * 1000);

      return {
        limited: true,
        attempts: attemptCount,
        lockoutExpiresAt,
      };
    }

    return {
      limited: false,
      attempts: attemptCount,
    };
  }

  /**
   * Record failed validation attempt
   */
  private async recordFailedAttempt(
    userId: string,
    guildId: string,
    sessionId: string
  ): Promise<void> {
    const key = this.rateLimitKey(userId, guildId);

    // Increment attempt counter with expiry
    const attempts = await this.redis.incr(key);
    if (attempts === 1) {
      // First attempt - set expiry
      await this.redis.expire(key, this.lockoutDuration);
    }

    // Update session with failed attempt count
    const sessionData = await this.redis.get(this.sessionKey(sessionId));
    if (sessionData) {
      const session: SecureSession = JSON.parse(sessionData);
      session.failedAttempts++;
      await this.redis.setex(
        this.sessionKey(sessionId),
        this.sessionTtl,
        JSON.stringify(session)
      );
    }

    // Log suspicious activity with structured logging
    this.logger.warn(
      { userId, guildId, attempts, threshold: this.failedAttemptThreshold },
      'Failed session validation attempt'
    );
  }

  /**
   * Reset rate limit for user (e.g., after successful authentication)
   */
  async resetRateLimit(userId: string, guildId: string): Promise<void> {
    const key = this.rateLimitKey(userId, guildId);
    await this.redis.del(key);
  }

  /**
   * Generate cryptographically secure session ID
   */
  private generateSessionId(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Scan Redis keys matching pattern
   */
  private async scanKeys(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';

    do {
      const [nextCursor, batch] = await this.redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100
      );
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== '0');

    return keys;
  }

  /**
   * Get session statistics
   */
  async getStats(): Promise<{
    totalSessions: number;
    activeSessions: number;
  }> {
    const pattern = `${this.keyPrefix}:*`;
    const keys = await this.scanKeys(pattern);

    // Filter out rate limit keys
    const sessionKeys = keys.filter((k) => !k.includes('rate_limit'));

    return {
      totalSessions: sessionKeys.length,
      activeSessions: sessionKeys.length,
    };
  }
}

/**
 * Factory function to create SecureSessionStore
 */
export function createSecureSessionStore(
  config: SecureSessionStoreConfig
): SecureSessionStore {
  return new SecureSessionStore(config);
}
