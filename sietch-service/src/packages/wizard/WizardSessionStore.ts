/**
 * WizardSessionStore
 *
 * Sprint 42: WizardEngine & Session Store
 *
 * Redis-backed session storage for wizard state persistence.
 * Sessions survive container restarts and have configurable TTL.
 *
 * Key structure:
 *   wizard:session:{sessionId} - Session data
 *   wizard:guild:{guildId}:user:{userId} - Active session lookup
 *   wizard:guild:{guildId}:sessions - Set of active session IDs
 *
 * @module packages/wizard/WizardSessionStore
 */

import { Redis } from 'ioredis';
import {
  WizardSession,
  CreateSessionParams,
  UpdateSessionParams,
  SessionFilter,
  SessionQueryResult,
  DEFAULT_SESSION_TTL,
  createWizardSession,
  serializeSession,
  deserializeSession,
  isSessionExpired,
} from './WizardSession.js';
import { WizardState, isValidTransition, isTerminalState } from './WizardState.js';

/**
 * Session store configuration.
 */
export interface SessionStoreConfig {
  /** Redis client instance */
  redis: Redis;
  /** Key prefix for all wizard keys */
  keyPrefix?: string;
  /** Session TTL in seconds */
  ttl?: number;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Session store error.
 */
export class SessionStoreError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly sessionId?: string
  ) {
    super(message);
    this.name = 'SessionStoreError';
  }
}

/**
 * WizardSessionStore - Redis-backed session storage.
 */
export class WizardSessionStore {
  private readonly redis: Redis;
  private readonly keyPrefix: string;
  private readonly ttl: number;
  private readonly debug: boolean;

  constructor(config: SessionStoreConfig) {
    this.redis = config.redis;
    this.keyPrefix = config.keyPrefix ?? 'wizard';
    this.ttl = config.ttl ?? DEFAULT_SESSION_TTL;
    this.debug = config.debug ?? false;
  }

  /**
   * Generate Redis key for session data.
   */
  private sessionKey(sessionId: string): string {
    return `${this.keyPrefix}:session:${sessionId}`;
  }

  /**
   * Generate Redis key for user's active session lookup.
   */
  private userSessionKey(guildId: string, userId: string): string {
    return `${this.keyPrefix}:guild:${guildId}:user:${userId}`;
  }

  /**
   * Generate Redis key for guild's session set.
   */
  private guildSessionsKey(guildId: string): string {
    return `${this.keyPrefix}:guild:${guildId}:sessions`;
  }

  /**
   * Log debug message.
   */
  private log(message: string, data?: Record<string, unknown>): void {
    if (this.debug) {
      console.log(`[WizardSessionStore] ${message}`, data ?? '');
    }
  }

  /**
   * Create a new wizard session.
   *
   * @param params - Session creation parameters
   * @returns Created session
   * @throws SessionStoreError if user already has active session
   */
  async create(params: CreateSessionParams): Promise<WizardSession> {
    this.log('Creating session', params);

    // Check for existing active session
    const existingSessionId = await this.getActiveSessionId(params.guildId, params.userId);
    if (existingSessionId) {
      const existing = await this.get(existingSessionId);
      if (existing && !isSessionExpired(existing) && !isTerminalState(existing.state)) {
        throw new SessionStoreError(
          `User already has an active wizard session: ${existingSessionId}`,
          'SESSION_EXISTS',
          existingSessionId
        );
      }
      // Clean up expired or completed session
      await this.delete(existingSessionId);
    }

    // Create new session
    const session = createWizardSession(params);

    // Store session data
    const pipeline = this.redis.pipeline();

    // Session data with TTL
    pipeline.setex(this.sessionKey(session.id), this.ttl, serializeSession(session));

    // User active session lookup
    pipeline.setex(this.userSessionKey(params.guildId, params.userId), this.ttl, session.id);

    // Add to guild sessions set
    pipeline.sadd(this.guildSessionsKey(params.guildId), session.id);

    await pipeline.exec();

    this.log('Session created', { sessionId: session.id });
    return session;
  }

  /**
   * Get a session by ID.
   *
   * @param sessionId - Session ID
   * @returns Session or null if not found
   */
  async get(sessionId: string): Promise<WizardSession | null> {
    this.log('Getting session', { sessionId });

    const data = await this.redis.get(this.sessionKey(sessionId));
    if (!data) {
      this.log('Session not found', { sessionId });
      return null;
    }

    const session = deserializeSession(data);
    this.log('Session retrieved', { sessionId, state: session.state });
    return session;
  }

  /**
   * Get the active session ID for a user in a guild.
   *
   * @param guildId - Discord guild ID
   * @param userId - Discord user ID
   * @returns Session ID or null
   */
  async getActiveSessionId(guildId: string, userId: string): Promise<string | null> {
    return this.redis.get(this.userSessionKey(guildId, userId));
  }

  /**
   * Get the active session for a user in a guild.
   *
   * @param guildId - Discord guild ID
   * @param userId - Discord user ID
   * @returns Session or null
   */
  async getActiveSession(guildId: string, userId: string): Promise<WizardSession | null> {
    const sessionId = await this.getActiveSessionId(guildId, userId);
    if (!sessionId) {
      return null;
    }
    return this.get(sessionId);
  }

  /**
   * Update a session.
   *
   * @param sessionId - Session ID
   * @param updates - Update parameters
   * @returns Updated session
   * @throws SessionStoreError if session not found or invalid transition
   */
  async update(sessionId: string, updates: UpdateSessionParams): Promise<WizardSession> {
    this.log('Updating session', { sessionId, updates });

    const session = await this.get(sessionId);
    if (!session) {
      throw new SessionStoreError(`Session not found: ${sessionId}`, 'SESSION_NOT_FOUND', sessionId);
    }

    // Validate state transition if state is being updated
    if (updates.state && updates.state !== session.state) {
      if (!isValidTransition(session.state, updates.state)) {
        throw new SessionStoreError(
          `Invalid state transition: ${session.state} -> ${updates.state}`,
          'INVALID_TRANSITION',
          sessionId
        );
      }
      // Add current state to history
      session.history.push(session.state);
      session.state = updates.state;
      session.stepCount++;
    }

    // Merge data updates
    if (updates.data) {
      session.data = { ...session.data, ...updates.data };
    }

    // Update error if provided
    if (updates.error !== undefined) {
      session.error = updates.error;
    }

    // Update message ID if provided
    if (updates.messageId && session.metadata) {
      session.metadata.messageId = updates.messageId;
    }

    // Update timestamps
    session.updatedAt = new Date().toISOString();

    // Extend TTL if not terminal state
    if (!isTerminalState(session.state)) {
      session.expiresAt = new Date(Date.now() + this.ttl * 1000).toISOString();
    }

    // Save updated session
    const ttlSeconds = isTerminalState(session.state)
      ? 60 // Keep terminal sessions for 1 minute for final read
      : this.ttl;

    await this.redis.setex(this.sessionKey(sessionId), ttlSeconds, serializeSession(session));

    this.log('Session updated', { sessionId, state: session.state });
    return session;
  }

  /**
   * Transition session to a new state.
   *
   * @param sessionId - Session ID
   * @param newState - Target state
   * @param data - Optional data update
   * @returns Updated session
   */
  async transition(
    sessionId: string,
    newState: WizardState,
    data?: Partial<UpdateSessionParams['data']>
  ): Promise<WizardSession> {
    return this.update(sessionId, { state: newState, data });
  }

  /**
   * Mark session as failed with error message.
   *
   * @param sessionId - Session ID
   * @param error - Error message
   * @returns Updated session
   */
  async fail(sessionId: string, error: string): Promise<WizardSession> {
    return this.update(sessionId, { state: WizardState.FAILED, error });
  }

  /**
   * Delete a session.
   *
   * @param sessionId - Session ID
   * @returns true if session was deleted
   */
  async delete(sessionId: string): Promise<boolean> {
    this.log('Deleting session', { sessionId });

    const session = await this.get(sessionId);
    if (!session) {
      return false;
    }

    const pipeline = this.redis.pipeline();

    // Delete session data
    pipeline.del(this.sessionKey(sessionId));

    // Remove from user active session lookup
    pipeline.del(this.userSessionKey(session.guildId, session.userId));

    // Remove from guild sessions set
    pipeline.srem(this.guildSessionsKey(session.guildId), sessionId);

    await pipeline.exec();

    this.log('Session deleted', { sessionId });
    return true;
  }

  /**
   * Extend session TTL.
   *
   * @param sessionId - Session ID
   * @param additionalSeconds - Seconds to add (default: full TTL)
   * @returns true if TTL was extended
   */
  async extendTTL(sessionId: string, additionalSeconds?: number): Promise<boolean> {
    const session = await this.get(sessionId);
    if (!session || isTerminalState(session.state)) {
      return false;
    }

    const newTTL = additionalSeconds ?? this.ttl;
    session.expiresAt = new Date(Date.now() + newTTL * 1000).toISOString();
    session.updatedAt = new Date().toISOString();

    await this.redis.setex(this.sessionKey(sessionId), newTTL, serializeSession(session));
    return true;
  }

  /**
   * Query sessions with filters.
   *
   * @param filter - Filter options
   * @returns Query result
   */
  async query(filter: SessionFilter): Promise<SessionQueryResult> {
    this.log('Querying sessions', filter);

    const sessions: WizardSession[] = [];

    // If filtering by guild, use guild sessions set
    if (filter.guildId) {
      const sessionIds = await this.redis.smembers(this.guildSessionsKey(filter.guildId));

      for (const sessionId of sessionIds) {
        const session = await this.get(sessionId);
        if (session && this.matchesFilter(session, filter)) {
          sessions.push(session);
        }
      }
    } else {
      // Full scan - not recommended for production
      this.log('WARNING: Full session scan - consider adding guildId filter');

      const keys = await this.redis.keys(`${this.keyPrefix}:session:*`);
      for (const key of keys) {
        const data = await this.redis.get(key);
        if (data) {
          const session = deserializeSession(data);
          if (this.matchesFilter(session, filter)) {
            sessions.push(session);
          }
        }
      }
    }

    // Sort by creation time (newest first)
    sessions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    this.log('Query complete', { count: sessions.length });
    return { sessions, total: sessions.length };
  }

  /**
   * Check if session matches filter criteria.
   */
  private matchesFilter(session: WizardSession, filter: SessionFilter): boolean {
    // Skip expired unless explicitly included
    if (!filter.includeExpired && isSessionExpired(session)) {
      return false;
    }

    if (filter.guildId && session.guildId !== filter.guildId) {
      return false;
    }

    if (filter.userId && session.userId !== filter.userId) {
      return false;
    }

    if (filter.state && session.state !== filter.state) {
      return false;
    }

    if (filter.states && !filter.states.includes(session.state)) {
      return false;
    }

    if (filter.createdAfter && new Date(session.createdAt) < filter.createdAfter) {
      return false;
    }

    if (filter.createdBefore && new Date(session.createdAt) > filter.createdBefore) {
      return false;
    }

    return true;
  }

  /**
   * Get statistics for a guild.
   *
   * @param guildId - Discord guild ID
   * @returns Session statistics
   */
  async getGuildStats(guildId: string): Promise<{
    total: number;
    active: number;
    completed: number;
    failed: number;
    byState: Record<WizardState, number>;
  }> {
    const { sessions } = await this.query({ guildId, includeExpired: true });

    const stats = {
      total: sessions.length,
      active: 0,
      completed: 0,
      failed: 0,
      byState: {} as Record<WizardState, number>,
    };

    for (const session of sessions) {
      stats.byState[session.state] = (stats.byState[session.state] ?? 0) + 1;

      if (session.state === WizardState.COMPLETE) {
        stats.completed++;
      } else if (session.state === WizardState.FAILED) {
        stats.failed++;
      } else if (!isSessionExpired(session)) {
        stats.active++;
      }
    }

    return stats;
  }

  /**
   * Clean up expired sessions for a guild.
   *
   * @param guildId - Discord guild ID
   * @returns Number of sessions cleaned up
   */
  async cleanupExpired(guildId: string): Promise<number> {
    const sessionIds = await this.redis.smembers(this.guildSessionsKey(guildId));
    let cleaned = 0;

    for (const sessionId of sessionIds) {
      const session = await this.get(sessionId);
      if (!session || isSessionExpired(session) || isTerminalState(session.state)) {
        await this.delete(sessionId);
        cleaned++;
      }
    }

    this.log('Cleanup complete', { guildId, cleaned });
    return cleaned;
  }

  /**
   * Check if Redis connection is healthy.
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.redis.ping();
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Create a WizardSessionStore instance.
 *
 * @param redis - Redis client
 * @param config - Optional configuration
 * @returns Session store instance
 */
export function createWizardSessionStore(
  redis: Redis,
  config?: Partial<Omit<SessionStoreConfig, 'redis'>>
): WizardSessionStore {
  return new WizardSessionStore({ redis, ...config });
}
