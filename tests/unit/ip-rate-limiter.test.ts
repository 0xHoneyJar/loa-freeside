/**
 * IP Rate Limiter Unit Tests
 * Sprint S0-T1: Validates extractIp() handles spoofing, loopback, and edge cases
 *
 * @see SDD §4.5 Pre-Auth IP Rate Limiter
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { extractIp, IpRateLimiter } from '../../packages/adapters/agent/ip-rate-limiter.js';
import type { Request } from 'express';

// --------------------------------------------------------------------------
// extractIp() Tests
// --------------------------------------------------------------------------

/**
 * Create a minimal Express-like Request object for testing.
 * In production, Express sets req.ip from X-Forwarded-For when trust proxy is enabled.
 */
function mockRequest(opts: { ip?: string; remoteAddress?: string }): Request {
  return {
    ip: opts.ip,
    socket: { remoteAddress: opts.remoteAddress },
  } as unknown as Request;
}

describe('extractIp', () => {
  it('returns req.ip when available (trust proxy configured)', () => {
    const req = mockRequest({ ip: '203.0.113.42' });
    expect(extractIp(req)).toBe('203.0.113.42');
  });

  it('falls back to socket.remoteAddress when req.ip is undefined', () => {
    const req = mockRequest({ remoteAddress: '198.51.100.7' });
    expect(extractIp(req)).toBe('198.51.100.7');
  });

  it('normalizes IPv4-mapped IPv6 addresses', () => {
    const req = mockRequest({ ip: '::ffff:10.0.0.1' });
    expect(extractIp(req)).toBe('10.0.0.1');
  });

  it('returns __loopback__ for 127.0.0.1 (health check traffic)', () => {
    const req = mockRequest({ ip: '127.0.0.1' });
    expect(extractIp(req)).toBe('__loopback__');
  });

  it('returns __loopback__ for ::1 (IPv6 loopback)', () => {
    const req = mockRequest({ ip: '::1' });
    expect(extractIp(req)).toBe('__loopback__');
  });

  it('returns __loopback__ for ::ffff:127.0.0.1', () => {
    const req = mockRequest({ ip: '::ffff:127.0.0.1' });
    expect(extractIp(req)).toBe('__loopback__');
  });

  it('returns __unidentified__ when no IP is present', () => {
    const req = mockRequest({});
    expect(extractIp(req)).toBe('__unidentified__');
  });

  it('returns __unidentified__ for invalid IP strings (spoofing attempt)', () => {
    const req = mockRequest({ ip: 'not-an-ip' });
    expect(extractIp(req)).toBe('__unidentified__');
  });

  it('returns __unidentified__ for empty string', () => {
    const req = mockRequest({ ip: '' });
    expect(extractIp(req)).toBe('__unidentified__');
  });

  it('accepts valid IPv6 addresses', () => {
    const req = mockRequest({ ip: '2001:db8::1' });
    expect(extractIp(req)).toBe('2001:db8::1');
  });

  it('spoofed X-Forwarded-For header does not bypass rate limit (trust proxy=1)', () => {
    // With trust proxy = 1, Express parses only the rightmost proxy IP.
    // If an attacker sends X-Forwarded-For: fake, the ALB appends the real IP.
    // req.ip reflects the real client IP (rightmost untrusted hop).
    // This test validates that extractIp accepts what Express provides.
    const req = mockRequest({ ip: '192.168.1.1' });
    expect(extractIp(req)).toBe('192.168.1.1');

    // If trust proxy is misconfigured and passes through garbage:
    const spoofed = mockRequest({ ip: 'x]malicious' });
    expect(extractIp(spoofed)).toBe('__unidentified__');
  });
});

// --------------------------------------------------------------------------
// IpRateLimiter.middleware() Integration
// --------------------------------------------------------------------------

describe('IpRateLimiter', () => {
  let limiter: IpRateLimiter;

  const mockLogger = {
    warn: () => {},
    info: () => {},
    error: () => {},
    debug: () => {},
    child: () => mockLogger,
  } as any;

  beforeEach(() => {
    limiter = new IpRateLimiter(mockLogger, {
      maxPerWindow: 5,
      windowMs: 60_000,
      burstCapacity: 3,
      maxEntries: 100,
    });
  });

  afterEach(() => {
    limiter.stop();
  });

  it('requests without IP are rate-limited (not given infinite budget)', () => {
    // __unidentified__ bucket should be shared and rate-limited
    for (let i = 0; i < 3; i++) {
      const result = limiter.check('__unidentified__');
      expect(result.allowed).toBe(true);
    }
    const result = limiter.check('__unidentified__');
    expect(result.allowed).toBe(false);
  });

  it('loopback traffic is isolated from client traffic', () => {
    // Exhaust loopback bucket
    for (let i = 0; i < 3; i++) {
      limiter.check('__loopback__');
    }
    const loopbackResult = limiter.check('__loopback__');
    expect(loopbackResult.allowed).toBe(false);

    // Client traffic should be unaffected
    const clientResult = limiter.check('203.0.113.42');
    expect(clientResult.allowed).toBe(true);
  });

  it('different client IPs have separate buckets', () => {
    // Exhaust one client IP
    for (let i = 0; i < 3; i++) {
      limiter.check('10.0.0.1');
    }
    expect(limiter.check('10.0.0.1').allowed).toBe(false);

    // Another IP should still be allowed
    expect(limiter.check('10.0.0.2').allowed).toBe(true);
  });
});
