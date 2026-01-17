/**
 * Rate Limiter Service Tests
 * Sprint SEC-3: Rate Limiting & Credential Management
 *
 * Tests for DoS protection rate limiting per M-4 finding.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiterService, createRateLimiterService, getRateLimitMessage } from '../../src/services/RateLimiterService.js';
import { RateLimiterRes } from 'rate-limiter-flexible';
import type { Logger } from 'pino';

// --------------------------------------------------------------------------
// Mocks
// --------------------------------------------------------------------------

// Mock Redis client
function createMockRedis() {
  const data = new Map<string, { points: number; timestamp: number }>();

  return {
    data,
    // These are internal methods used by rate-limiter-flexible
    multi: () => ({
      set: vi.fn().mockReturnThis(),
      pexpire: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    }),
    get: vi.fn((key: string) => {
      const entry = data.get(key);
      if (!entry) return Promise.resolve(null);
      return Promise.resolve(JSON.stringify(entry));
    }),
    set: vi.fn((key: string, value: string) => {
      data.set(key, JSON.parse(value));
      return Promise.resolve('OK');
    }),
    del: vi.fn((key: string) => {
      data.delete(key);
      return Promise.resolve(1);
    }),
    // For RateLimiterRedis
    defineCommand: vi.fn(),
    rlflx_incr: vi.fn(),
    rlflxIncr: vi.fn(),
    eval: vi.fn(),
  };
}

// Mock logger
function createMockLogger(): Logger {
  return {
    child: vi.fn().mockReturnThis(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  } as unknown as Logger;
}

// --------------------------------------------------------------------------
// Unit Tests (without Redis)
// --------------------------------------------------------------------------

describe('RateLimiterService', () => {
  describe('getRateLimitMessage', () => {
    it('should return guild message for guild rate limit', () => {
      const result = {
        allowed: false,
        type: 'guild' as const,
        key: '123',
        remaining: 0,
        limit: 100,
        retryAfterMs: 1000,
      };

      const message = getRateLimitMessage(result);
      expect(message).toContain('server');
      expect(message).toContain('1 second');
    });

    it('should return user message for user rate limit', () => {
      const result = {
        allowed: false,
        type: 'user' as const,
        key: '456',
        remaining: 0,
        limit: 5,
        retryAfterMs: 2000,
      };

      const message = getRateLimitMessage(result);
      expect(message).toContain('You');
      expect(message).toContain('slow down');
      expect(message).toContain('2 seconds');
    });

    it('should handle singular second', () => {
      const result = {
        allowed: false,
        type: 'user' as const,
        key: '456',
        remaining: 0,
        limit: 5,
        retryAfterMs: 500, // Less than 1 second rounds to 1
      };

      const message = getRateLimitMessage(result);
      expect(message).toContain('1 second');
      expect(message).not.toContain('seconds');
    });

    it('should handle plural seconds', () => {
      const result = {
        allowed: false,
        type: 'guild' as const,
        key: '123',
        remaining: 0,
        limit: 100,
        retryAfterMs: 3500,
      };

      const message = getRateLimitMessage(result);
      expect(message).toContain('4 seconds');
    });
  });

  describe('createRateLimiterService factory', () => {
    it('should create service with default config', () => {
      const redis = createMockRedis();
      const logger = createMockLogger();

      const service = createRateLimiterService(redis as any, logger);

      expect(service).toBeInstanceOf(RateLimiterService);
      expect(logger.child).toHaveBeenCalledWith({ component: 'RateLimiterService' });
    });

    it('should create service with custom config', () => {
      const redis = createMockRedis();
      const logger = createMockLogger();

      const service = createRateLimiterService(redis as any, logger, {
        guildLimit: 200,
        userLimit: 10,
      });

      expect(service).toBeInstanceOf(RateLimiterService);
    });
  });
});

// --------------------------------------------------------------------------
// Integration-style Tests (mocking rate-limiter-flexible behavior)
// --------------------------------------------------------------------------

describe('RateLimiterService behavior', () => {
  let service: RateLimiterService;
  let logger: Logger;
  let consumeGuild: ReturnType<typeof vi.fn>;
  let consumeUser: ReturnType<typeof vi.fn>;
  let getGuild: ReturnType<typeof vi.fn>;
  let getUser: ReturnType<typeof vi.fn>;
  let deleteGuild: ReturnType<typeof vi.fn>;
  let deleteUser: ReturnType<typeof vi.fn>;
  let rewardGuild: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    logger = createMockLogger();

    // Create mocks for the limiter methods
    consumeGuild = vi.fn().mockResolvedValue({ remainingPoints: 99 });
    consumeUser = vi.fn().mockResolvedValue({ remainingPoints: 4 });
    getGuild = vi.fn().mockResolvedValue({ remainingPoints: 100 });
    getUser = vi.fn().mockResolvedValue({ remainingPoints: 5 });
    deleteGuild = vi.fn().mockResolvedValue(undefined);
    deleteUser = vi.fn().mockResolvedValue(undefined);
    rewardGuild = vi.fn().mockResolvedValue(undefined);

    // Create a mock service with injectable limiters
    const redis = createMockRedis();
    service = new RateLimiterService(redis as any, logger);

    // Override the private limiter methods
    (service as any).guildLimiter = {
      consume: consumeGuild,
      get: getGuild,
      delete: deleteGuild,
      reward: rewardGuild,
    };
    (service as any).userLimiter = {
      consume: consumeUser,
      get: getUser,
      delete: deleteUser,
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('checkLimits', () => {
    it('should allow request when both limits pass', async () => {
      const result = await service.checkLimits('guild123', 'user456');

      expect(result.allowed).toBe(true);
      expect(consumeGuild).toHaveBeenCalledWith('guild123');
      expect(consumeUser).toHaveBeenCalledWith('user456');
    });

    it('should deny request when guild limit exceeded', async () => {
      // Create actual RateLimiterRes instance (rate-limiter-flexible rejects with this)
      const rateLimitRes = new RateLimiterRes(0, 500, 101, false);
      consumeGuild.mockRejectedValueOnce(rateLimitRes);

      const result = await service.checkLimits('guild123', 'user456');

      expect(result.allowed).toBe(false);
      expect(result.type).toBe('guild');
      expect(result.retryAfterMs).toBe(500);
      expect(consumeUser).not.toHaveBeenCalled();
    });

    it('should deny request when user limit exceeded and refund guild', async () => {
      // Create actual RateLimiterRes instance
      const rateLimitRes = new RateLimiterRes(0, 800, 6, false);
      consumeUser.mockRejectedValueOnce(rateLimitRes);

      const result = await service.checkLimits('guild123', 'user456');

      expect(result.allowed).toBe(false);
      expect(result.type).toBe('user');
      expect(result.retryAfterMs).toBe(800);
      expect(rewardGuild).toHaveBeenCalledWith('guild123', 1);
    });

    it('should skip guild check if no guildId provided', async () => {
      const result = await service.checkLimits(null, 'user456');

      expect(result.allowed).toBe(true);
      expect(consumeGuild).not.toHaveBeenCalled();
      expect(consumeUser).toHaveBeenCalledWith('user456');
    });

    it('should skip user check if no userId provided', async () => {
      const result = await service.checkLimits('guild123', null);

      expect(result.allowed).toBe(true);
      expect(consumeGuild).toHaveBeenCalledWith('guild123');
      expect(consumeUser).not.toHaveBeenCalled();
    });

    it('should allow request if neither guildId nor userId provided', async () => {
      const result = await service.checkLimits(null, null);

      expect(result.allowed).toBe(true);
      expect(consumeGuild).not.toHaveBeenCalled();
      expect(consumeUser).not.toHaveBeenCalled();
    });
  });

  describe('checkGuild', () => {
    it('should return allowed when under limit', async () => {
      const result = await service.checkGuild('guild123');

      expect(result.allowed).toBe(true);
      expect(result.type).toBe('guild');
      expect(result.remaining).toBe(99);
    });

    it('should return denied when over limit', async () => {
      // Create actual RateLimiterRes instance
      const rateLimitRes = new RateLimiterRes(0, 1000, 101, false);
      consumeGuild.mockRejectedValueOnce(rateLimitRes);

      const result = await service.checkGuild('guild123');

      expect(result.allowed).toBe(false);
      expect(result.retryAfterMs).toBe(1000);
    });

    it('should fail open on unknown error', async () => {
      consumeGuild.mockRejectedValueOnce(new Error('Redis connection failed'));

      const result = await service.checkGuild('guild123');

      expect(result.allowed).toBe(true); // Fail open
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('checkUser', () => {
    it('should return allowed when under limit', async () => {
      const result = await service.checkUser('user456');

      expect(result.allowed).toBe(true);
      expect(result.type).toBe('user');
      expect(result.remaining).toBe(4);
    });

    it('should return denied when over limit', async () => {
      // Create actual RateLimiterRes instance
      const rateLimitRes = new RateLimiterRes(0, 500, 6, false);
      consumeUser.mockRejectedValueOnce(rateLimitRes);

      const result = await service.checkUser('user456');

      expect(result.allowed).toBe(false);
      expect(result.retryAfterMs).toBe(500);
    });
  });

  describe('getStatus', () => {
    it('should return guild status', async () => {
      getGuild.mockResolvedValueOnce({ remainingPoints: 95 });

      const status = await service.getStatus('guild123');

      expect(status.guild?.remaining).toBe(95);
      expect(status.guild?.limit).toBe(100);
    });

    it('should return user status', async () => {
      getUser.mockResolvedValueOnce({ remainingPoints: 3 });

      const status = await service.getStatus(undefined, 'user456');

      expect(status.user?.remaining).toBe(3);
      expect(status.user?.limit).toBe(5);
    });

    it('should return both statuses', async () => {
      getGuild.mockResolvedValueOnce({ remainingPoints: 80 });
      getUser.mockResolvedValueOnce({ remainingPoints: 2 });

      const status = await service.getStatus('guild123', 'user456');

      expect(status.guild?.remaining).toBe(80);
      expect(status.user?.remaining).toBe(2);
    });

    it('should return default limits when no data exists', async () => {
      getGuild.mockResolvedValueOnce(null);
      getUser.mockResolvedValueOnce(null);

      const status = await service.getStatus('guild123', 'user456');

      expect(status.guild?.remaining).toBe(100);
      expect(status.user?.remaining).toBe(5);
    });
  });

  describe('reset', () => {
    it('should reset guild rate limit', async () => {
      await service.reset('guild123');

      expect(deleteGuild).toHaveBeenCalledWith('guild123');
      expect(logger.info).toHaveBeenCalledWith(
        { guildId: 'guild123' },
        'Guild rate limit reset'
      );
    });

    it('should reset user rate limit', async () => {
      await service.reset(undefined, 'user456');

      expect(deleteUser).toHaveBeenCalledWith('user456');
      expect(logger.info).toHaveBeenCalledWith(
        { userId: 'user456' },
        'User rate limit reset'
      );
    });

    it('should reset both limits', async () => {
      await service.reset('guild123', 'user456');

      expect(deleteGuild).toHaveBeenCalledWith('guild123');
      expect(deleteUser).toHaveBeenCalledWith('user456');
    });
  });
});

// --------------------------------------------------------------------------
// Edge Cases
// --------------------------------------------------------------------------

describe('RateLimiterService edge cases', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = createMockLogger();
  });

  describe('concurrent requests', () => {
    it('should handle multiple concurrent checks', async () => {
      const redis = createMockRedis();
      const service = new RateLimiterService(redis as any, logger);

      // Mock the limiters
      const consume = vi.fn().mockResolvedValue({ remainingPoints: 50 });
      (service as any).guildLimiter = { consume };
      (service as any).userLimiter = { consume };

      // Simulate concurrent requests
      const results = await Promise.all([
        service.checkLimits('guild123', 'user1'),
        service.checkLimits('guild123', 'user2'),
        service.checkLimits('guild123', 'user3'),
      ]);

      expect(results.every(r => r.allowed)).toBe(true);
      expect(consume).toHaveBeenCalledTimes(6); // 3 guild + 3 user
    });
  });

  describe('undefined and empty values', () => {
    it('should handle undefined guildId', async () => {
      const redis = createMockRedis();
      const service = new RateLimiterService(redis as any, logger);

      const consume = vi.fn().mockResolvedValue({ remainingPoints: 4 });
      (service as any).guildLimiter = { consume };
      (service as any).userLimiter = { consume };

      const result = await service.checkLimits(undefined, 'user456');

      expect(result.allowed).toBe(true);
    });

    it('should handle empty string guildId', async () => {
      const redis = createMockRedis();
      const service = new RateLimiterService(redis as any, logger);

      const consume = vi.fn().mockResolvedValue({ remainingPoints: 99 });
      (service as any).guildLimiter = { consume };
      (service as any).userLimiter = { consume };

      // Empty string is falsy, so should skip guild check
      const result = await service.checkLimits('', 'user456');

      expect(result.allowed).toBe(true);
    });
  });

  describe('refund failure handling', () => {
    it('should not fail request if refund fails', async () => {
      const redis = createMockRedis();
      const service = new RateLimiterService(redis as any, logger);

      const consumeGuild = vi.fn().mockResolvedValue({ remainingPoints: 99 });
      const rewardGuild = vi.fn().mockRejectedValue(new Error('Redis error'));
      // Create actual RateLimiterRes instance
      const rateLimitRes = new RateLimiterRes(0, 500, 6, false);
      const consumeUser = vi.fn().mockRejectedValue(rateLimitRes);

      (service as any).guildLimiter = { consume: consumeGuild, reward: rewardGuild };
      (service as any).userLimiter = { consume: consumeUser };

      const result = await service.checkLimits('guild123', 'user456');

      // Should still return the user rate limit error
      expect(result.allowed).toBe(false);
      expect(result.type).toBe('user');
      // Refund was attempted
      expect(rewardGuild).toHaveBeenCalled();
    });
  });
});

// --------------------------------------------------------------------------
// Config Validation
// --------------------------------------------------------------------------

describe('RateLimiterService config', () => {
  it('should use default config values', () => {
    const redis = createMockRedis();
    const logger = createMockLogger();

    const service = new RateLimiterService(redis as any, logger);

    // Access private config for testing
    const config = (service as any).config;
    expect(config.guildLimit).toBe(100);
    expect(config.guildDuration).toBe(1);
    expect(config.userLimit).toBe(5);
    expect(config.userDuration).toBe(1);
  });

  it('should merge custom config with defaults', () => {
    const redis = createMockRedis();
    const logger = createMockLogger();

    const service = new RateLimiterService(redis as any, logger, {
      guildLimit: 200,
      // userLimit not provided, should use default
    });

    const config = (service as any).config;
    expect(config.guildLimit).toBe(200);
    expect(config.userLimit).toBe(5); // Default
  });
});
