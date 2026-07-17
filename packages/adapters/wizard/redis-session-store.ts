/**
 * RedisWizardSessionStore
 *
 * Sprint S-20: Wizard Session Store & State Model
 *
 * Redis-backed implementation of IWizardSessionStore.
 * Features:
 * - 15-minute TTL with auto-refresh on access
 * - Guild index for quick lookup
 * - IP binding for session security
 * - State machine validation on transitions
 *
 * @see SDD §6.3.3 Session Store (Redis)
 */

import type { Logger } from 'pino';
import type {
  IWizardSessionStore,
  SessionValidationResult,
  StateTransitionResult,
  SessionStats,
} from '@freeside/core/ports';
import type {
  WizardSession,
  WizardState,
  WizardSessionData,
  NewWizardSession,
} from '@freeside/core/domain';
import {
  isValidTransition,
  validateSessionData,
  WizardState as WizardStateEnum,
} from '@freeside/core/domain';
import {
  DEFAULT_SESSION_TTL_SECONDS,
  SESSION_KEY_PREFIXES,
} from '@freeside/core/ports';

// =============================================================================
// Types
// =============================================================================

/**
 * Redis client interface.
 * Matches ioredis and node-redis clients.
 */
export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  setex(key: string, seconds: number, value: string): Promise<unknown>;
  del(key: string | string[]): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  exists(...keys: string[]): Promise<number>;
  incr(key: string): Promise<number>;
  incrby(key: string, increment: number): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  quit(): Promise<unknown>;
}

/**
 * Options for creating RedisWizardSessionStore.
 */
export interface RedisSessionStoreOptions {
  /** Redis client */
  redis: RedisClient;
  /** Logger instance */
  logger: Logger;
  /** Custom TTL in seconds (default: 900) */
  ttlSeconds?: number;
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Redis-backed wizard session store.
 */
export class RedisWizardSessionStore implements IWizardSessionStore {
  private readonly redis: RedisClient;
  private readonly log: Logger;
  public readonly ttlSeconds: number;

  constructor(options: RedisSessionStoreOptions) {
    this.redis = options.redis;
    this.log = options.logger.child({ component: 'RedisWizardSessionStore' });
    this.ttlSeconds = options.ttlSeconds ?? DEFAULT_SESSION_TTL_SECONDS;
  }

  // ===========================================================================
  // CRUD Operations
  // ===========================================================================

  async create(session: NewWizardSession): Promise<WizardSession> {
    const id = crypto.randomUUID();
    const now = new Date();

    // Check if session already exists for this guild
    const existingSession = await this.getByGuild(session.guildId);
    if (existingSession) {
      throw new Error(`Session already exists for guild ${session.guildId}`);
    }

    const fullSession: WizardSession = {
      ...session,
      id,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + this.ttlSeconds * 1000),
    };

    // Store session
    await this.redis.setex(
      `${SESSION_KEY_PREFIXES.SESSION}${id}`,
      this.ttlSeconds,
      JSON.stringify(fullSession)
    );

    // Create guild index
    await this.redis.setex(
      `${SESSION_KEY_PREFIXES.GUILD}${session.guildId}`,
      this.ttlSeconds,
      id
    );

    // Update stats
    await this.incrementStat('created');
    await this.incrementStatByState(fullSession.state);

    this.log.info(
      { sessionId: id, guildId: session.guildId, userId: session.userId },
      'Wizard session created'
    );

    return fullSession;
  }

  async get(sessionId: string): Promise<WizardSession | null> {
    const data = await this.redis.get(`${SESSION_KEY_PREFIXES.SESSION}${sessionId}`);
    if (!data) {
      return null;
    }

    const session = this.deserializeSession(data);

    // Check if expired
    if (session && new Date() > session.expiresAt) {
      await this.delete(sessionId);
      return null;
    }

    return session;
  }

  async getByGuild(guildId: string): Promise<WizardSession | null> {
    const sessionId = await this.redis.get(`${SESSION_KEY_PREFIXES.GUILD}${guildId}`);
    if (!sessionId) {
      return null;
    }

    return this.get(sessionId);
  }

  async update(
    sessionId: string,
    updates: Partial<WizardSession>
  ): Promise<WizardSession | null> {
    const session = await this.get(sessionId);
    if (!session) {
      return null;
    }

    const now = new Date();
    const updatedSession: WizardSession = {
      ...session,
      ...updates,
      id: session.id, // Cannot change ID
      guildId: session.guildId, // Cannot change guild
      communityId: session.communityId, // Cannot change community
      createdAt: session.createdAt, // Cannot change creation time
      updatedAt: now,
      expiresAt: new Date(now.getTime() + this.ttlSeconds * 1000),
    };

    // Track state change for stats
    if (updates.state && updates.state !== session.state) {
      await this.decrementStatByState(session.state);
      await this.incrementStatByState(updates.state);
    }

    await this.redis.setex(
      `${SESSION_KEY_PREFIXES.SESSION}${sessionId}`,
      this.ttlSeconds,
      JSON.stringify(updatedSession)
    );

    // Refresh guild index TTL
    await this.redis.expire(
      `${SESSION_KEY_PREFIXES.GUILD}${session.guildId}`,
      this.ttlSeconds
    );

    this.log.debug(
      { sessionId, updatedFields: Object.keys(updates) },
      'Wizard session updated'
    );

    return updatedSession;
  }

  async delete(sessionId: string): Promise<boolean> {
    const session = await this.get(sessionId);
    if (!session) {
      return false;
    }

    // Delete session and guild index
    await this.redis.del([
      `${SESSION_KEY_PREFIXES.SESSION}${sessionId}`,
      `${SESSION_KEY_PREFIXES.GUILD}${session.guildId}`,
    ]);

    // Update stats
    await this.decrementStatByState(session.state);
    await this.incrementStat('deleted');

    this.log.info({ sessionId, guildId: session.guildId }, 'Wizard session deleted');

    return true;
  }

  async deleteByGuild(guildId: string): Promise<boolean> {
    const sessionId = await this.redis.get(`${SESSION_KEY_PREFIXES.GUILD}${guildId}`);
    if (!sessionId) {
      return false;
    }

    return this.delete(sessionId);
  }

  // ===========================================================================
  // State Machine Operations
  // ===========================================================================

  async transition(
    sessionId: string,
    newState: WizardState,
    data?: Partial<WizardSessionData>
  ): Promise<StateTransitionResult> {
    const session = await this.get(sessionId);
    if (!session) {
      return {
        success: false,
        error: 'Session not found',
      };
    }

    // Validate state transition
    if (!isValidTransition(session.state, newState)) {
      this.log.warn(
        { sessionId, from: session.state, to: newState },
        'Invalid state transition attempted'
      );
      return {
        success: false,
        error: `Invalid state transition: ${session.state} → ${newState}`,
      };
    }

    // Validate data for the target state
    const mergedData = { ...session.data, ...data };
    const validation = validateSessionData(newState, mergedData);
    if (!validation.valid) {
      return {
        success: false,
        error: `Data validation failed: ${validation.errors.join(', ')}`,
      };
    }

    // Perform the update
    const updatedSession = await this.update(sessionId, {
      state: newState,
      data: mergedData,
    });

    if (!updatedSession) {
      return {
        success: false,
        error: 'Failed to update session',
      };
    }

    this.log.info(
      { sessionId, from: session.state, to: newState },
      'State transition completed'
    );

    // Track completion
    if (newState === WizardStateEnum.DEPLOY) {
      await this.incrementStat('completed');
    }

    return {
      success: true,
      session: updatedSession,
    };
  }

  // ===========================================================================
  // Security Operations
  // ===========================================================================

  async validateSession(
    sessionId: string,
    ipAddress: string
  ): Promise<SessionValidationResult> {
    const session = await this.get(sessionId);

    if (!session) {
      return { valid: false, reason: 'not_found' };
    }

    // Check expiration
    if (new Date() > session.expiresAt) {
      return { valid: false, reason: 'expired' };
    }

    // Check IP binding
    if (session.ipAddress && session.ipAddress !== ipAddress) {
      this.log.warn(
        { sessionId, expected: session.ipAddress, actual: ipAddress },
        'IP mismatch - potential session hijacking'
      );
      return { valid: false, reason: 'ip_mismatch' };
    }

    return { valid: true, session };
  }

  async bindToIp(sessionId: string, ipAddress: string): Promise<WizardSession | null> {
    const session = await this.get(sessionId);
    if (!session) {
      return null;
    }

    // Don't rebind if already bound
    if (session.ipAddress) {
      this.log.warn(
        { sessionId, existingIp: session.ipAddress, newIp: ipAddress },
        'Attempted to rebind already-bound session'
      );
      return session;
    }

    const updated = await this.update(sessionId, { ipAddress });

    this.log.info({ sessionId, ipAddress }, 'Session bound to IP');

    return updated;
  }

  // ===========================================================================
  // Utility Operations
  // ===========================================================================

  async refresh(sessionId: string): Promise<boolean> {
    const session = await this.get(sessionId);
    if (!session) {
      return false;
    }

    const now = new Date();
    const newExpiration = new Date(now.getTime() + this.ttlSeconds * 1000);

    // Update both keys
    await this.redis.expire(
      `${SESSION_KEY_PREFIXES.SESSION}${sessionId}`,
      this.ttlSeconds
    );
    await this.redis.expire(
      `${SESSION_KEY_PREFIXES.GUILD}${session.guildId}`,
      this.ttlSeconds
    );

    // Update the session's expiresAt
    await this.update(sessionId, { expiresAt: newExpiration });

    return true;
  }

  async existsForGuild(guildId: string): Promise<boolean> {
    const count = await this.redis.exists(`${SESSION_KEY_PREFIXES.GUILD}${guildId}`);
    return count > 0;
  }

  async getStats(): Promise<SessionStats> {
    // Get all active session keys
    const sessionKeys = await this.redis.keys(`${SESSION_KEY_PREFIXES.SESSION}*`);

    // Initialize state counts
    const sessionsByState: Record<WizardState, number> = {
      [WizardStateEnum.INIT]: 0,
      [WizardStateEnum.CHAIN_SELECT]: 0,
      [WizardStateEnum.ASSET_CONFIG]: 0,
      [WizardStateEnum.ELIGIBILITY_RULES]: 0,
      [WizardStateEnum.ROLE_MAPPING]: 0,
      [WizardStateEnum.CHANNEL_STRUCTURE]: 0,
      [WizardStateEnum.REVIEW]: 0,
      [WizardStateEnum.DEPLOY]: 0,
    };

    let totalDurationSeconds = 0;
    let validSessions = 0;
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;

    let createdLastHour = 0;
    let completedLastHour = 0;

    // Count sessions by state and calculate average duration
    for (const key of sessionKeys) {
      const sessionId = key.replace(SESSION_KEY_PREFIXES.SESSION, '');
      const session = await this.get(sessionId);

      if (session) {
        validSessions++;
        sessionsByState[session.state]++;

        const duration = (now - session.createdAt.getTime()) / 1000;
        totalDurationSeconds += duration;

        // Count sessions created in last hour
        if (session.createdAt.getTime() > oneHourAgo) {
          createdLastHour++;
        }

        // Count completions (DEPLOY state) in last hour
        if (
          session.state === WizardStateEnum.DEPLOY &&
          session.updatedAt.getTime() > oneHourAgo
        ) {
          completedLastHour++;
        }
      }
    }

    return {
      activeSessions: validSessions,
      sessionsByState,
      averageDurationSeconds: validSessions > 0 ? totalDurationSeconds / validSessions : 0,
      createdLastHour,
      completedLastHour,
    };
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  async close(): Promise<void> {
    await this.redis.quit();
    this.log.info('Wizard session store closed');
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private deserializeSession(data: string): WizardSession | null {
    try {
      const parsed = JSON.parse(data);
      return {
        ...parsed,
        createdAt: new Date(parsed.createdAt),
        updatedAt: new Date(parsed.updatedAt),
        expiresAt: new Date(parsed.expiresAt),
      };
    } catch (error) {
      this.log.error({ error, data }, 'Failed to deserialize session');
      return null;
    }
  }

  private async incrementStat(field: string): Promise<void> {
    try {
      await this.redis.incr(`${SESSION_KEY_PREFIXES.STATS}:${field}`);
    } catch {
      // Stats are non-critical, ignore errors
    }
  }

  private async incrementStatByState(state: WizardState): Promise<void> {
    try {
      await this.redis.incr(`${SESSION_KEY_PREFIXES.STATS}:state:${state}`);
    } catch {
      // Stats are non-critical, ignore errors
    }
  }

  private async decrementStatByState(state: WizardState): Promise<void> {
    try {
      await this.redis.incrby(`${SESSION_KEY_PREFIXES.STATS}:state:${state}`, -1);
    } catch {
      // Stats are non-critical, ignore errors
    }
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a Redis-backed wizard session store.
 *
 * @param options - Store options
 * @returns Wizard session store instance
 */
export function createRedisWizardSessionStore(
  options: RedisSessionStoreOptions
): IWizardSessionStore {
  return new RedisWizardSessionStore(options);
}
