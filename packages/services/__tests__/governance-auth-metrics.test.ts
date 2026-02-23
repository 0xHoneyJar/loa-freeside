/**
 * Governance Auth — rate limit metrics tests (F-4)
 *
 * AC-2.4.3: Verify metric emission call with expected name and value.
 */
import { describe, it, expect, vi } from 'vitest';

describe('createGovernanceRateLimiter metrics (F-4)', () => {
  it('emits governance_rate_limit_key_count metric on allowed request', async () => {
    const { createGovernanceRateLimiter } = await import('../governance-auth.js');

    // Mock Redis with Lua eval support
    const mockRedis = {
      eval: vi.fn().mockResolvedValue([1, 60]),
    };

    const mockMetrics = {
      putMetric: vi.fn(),
    };

    const limiter = createGovernanceRateLimiter(mockRedis as any, mockMetrics);

    const result = await limiter.checkRateLimit({
      id: 'actor-1',
      role: 'member',
      community_id: 'community-abc',
    });

    expect(result.allowed).toBe(true);

    // F-4: Verify metric emission
    expect(mockMetrics.putMetric).toHaveBeenCalledWith(
      'governance_rate_limit_key_count',
      expect.any(Number),
    );

    // Should have checked 2 keys: burst + daily role
    const metricCall = mockMetrics.putMetric.mock.calls.find(
      (c: any[]) => c[0] === 'governance_rate_limit_key_count'
    );
    expect(metricCall).toBeDefined();
    expect(metricCall![1]).toBe(2); // burst key + role daily key
  });

  it('emits metric even when rate limited', async () => {
    const { createGovernanceRateLimiter } = await import('../governance-auth.js');

    let callCount = 0;
    const mockRedis = {
      eval: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // Burst check: under limit
          return Promise.resolve([1, 60]);
        }
        // Daily check: over limit (6 > 5 for member)
        return Promise.resolve([6, 86000]);
      }),
    };

    const mockMetrics = {
      putMetric: vi.fn(),
    };

    const limiter = createGovernanceRateLimiter(mockRedis as any, mockMetrics);

    const result = await limiter.checkRateLimit({
      id: 'actor-1',
      role: 'member',
      community_id: 'community-abc',
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Daily governance rate limit exceeded');

    // Metric should still be emitted
    expect(mockMetrics.putMetric).toHaveBeenCalledWith(
      'governance_rate_limit_key_count',
      expect.any(Number),
    );
  });

  it('works without metricsPort (backward compatible)', async () => {
    const { createGovernanceRateLimiter } = await import('../governance-auth.js');

    const mockRedis = {
      eval: vi.fn().mockResolvedValue([1, 60]),
    };

    // No metrics port provided
    const limiter = createGovernanceRateLimiter(mockRedis as any);

    const result = await limiter.checkRateLimit({
      id: 'actor-1',
      role: 'admin',
      community_id: 'community-abc',
    });

    // Should work without error even without metrics
    expect(result.allowed).toBe(true);
  });
});
