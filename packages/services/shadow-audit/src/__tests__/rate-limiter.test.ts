import { describe, it, expect } from 'vitest';
import { FixedWindowRateLimiter } from '../rate-limiter.js';

describe('FixedWindowRateLimiter (AC-6)', () => {
  it('allows up to the limit, then blocks with a retry hint', () => {
    let t = 0;
    const rl = new FixedWindowRateLimiter({ limit: 3, windowMs: 1000, now: () => t });
    expect(rl.check('ip1').allowed).toBe(true);
    expect(rl.check('ip1').allowed).toBe(true);
    expect(rl.check('ip1').allowed).toBe(true);
    const blocked = rl.check('ip1');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it('keys are independent', () => {
    let t = 0;
    const rl = new FixedWindowRateLimiter({ limit: 1, windowMs: 1000, now: () => t });
    expect(rl.check('ip1').allowed).toBe(true);
    expect(rl.check('ip1').allowed).toBe(false);
    expect(rl.check('ip2').allowed).toBe(true); // separate bucket
  });

  it('resets after the window elapses', () => {
    let t = 0;
    const rl = new FixedWindowRateLimiter({ limit: 1, windowMs: 1000, now: () => t });
    expect(rl.check('ip1').allowed).toBe(true);
    expect(rl.check('ip1').allowed).toBe(false);
    t = 1000;
    expect(rl.check('ip1').allowed).toBe(true);
  });
});
