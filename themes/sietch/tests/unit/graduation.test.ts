/**
 * Graduation Criteria — Unit Tests
 *
 * Tests for evaluateGraduation() covering all threshold combinations
 * per Sprint 1, Tasks 1.2–1.3 (cycle-040 FR-1).
 *
 * Coverage:
 *   - Divergence rate exceeds threshold → ready: false
 *   - Observation window insufficient → ready: false
 *   - Would-reject within consecutive window → ready: false
 *   - All three criteria met → ready: true
 *   - BigInt precision preserved for large counter values (AC-1.5)
 *   - Zero-traffic rule: divergence vacuously met, time gates still apply
 *   - Would-reject recovery: graduation allowed after consecutive-clean window elapses
 *
 * @see grimoires/loa/sdd.md §3.1
 * @see grimoires/loa/sprint.md Sprint 1, Task 1.3
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateGraduation,
  DEFAULT_GRADUATION_CRITERIA,
  type GraduationCounters,
  type BoundaryGraduationCriteria,
} from '../../src/packages/core/protocol/graduation.js';
import type { BoundaryContext } from '../../src/packages/core/protocol/parse-boundary-micro-usd.js';

// ---------------------------------------------------------------------------
// Test Constants
// ---------------------------------------------------------------------------

const SEVEN_DAYS_MS = 604_800_000;
const SEVENTY_TWO_HOURS_MS = 259_200_000;
const ONE_HOUR_MS = 3_600_000;

/** Base timestamp: 2026-01-01T00:00:00Z */
const BASE_TIME = new Date('2026-01-01T00:00:00Z').getTime();

/** Deploy time: 8 days before "now" (exceeds 7-day observation window) */
const DEPLOY_TIME = BASE_TIME - (8 * 24 * 60 * 60 * 1000);

/** "Now" for tests — fixed for determinism */
const NOW = BASE_TIME;

const CTX: BoundaryContext = 'http';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCounters(overrides: Partial<GraduationCounters> = {}): GraduationCounters {
  return {
    shadowTotal: 10000n,
    wouldRejectTotal: 0n,
    divergenceTotal: 0n,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('evaluateGraduation', () => {
  describe('returns ready: true when all criteria met', () => {
    it('should return ready when divergence is low, observation window met, and no would-rejects', () => {
      const result = evaluateGraduation(
        CTX,
        makeCounters({ shadowTotal: 100000n, divergenceTotal: 50n }), // 50/100000 = 500 PPM = 0.05% < 0.1%
        DEPLOY_TIME,
        0, // no would-reject ever
        DEFAULT_GRADUATION_CRITERIA,
        NOW,
      );

      expect(result.ready).toBe(true);
      expect(result.criteria.divergenceRate.met).toBe(true);
      expect(result.criteria.observationWindow.met).toBe(true);
      expect(result.criteria.wouldRejectClean.met).toBe(true);
    });

    it('should return ready when divergence is exactly at threshold (0.1% = 1000 PPM)', () => {
      // 1000 divergences out of 1_000_000 total = exactly 1000 PPM = 0.1%
      const result = evaluateGraduation(
        CTX,
        makeCounters({ shadowTotal: 1_000_000n, divergenceTotal: 1000n }),
        DEPLOY_TIME,
        0,
        DEFAULT_GRADUATION_CRITERIA,
        NOW,
      );

      expect(result.ready).toBe(true);
      expect(result.criteria.divergenceRate.met).toBe(true);
      expect(result.criteria.divergenceRate.currentPpm).toBe(1000n);
    });
  });

  describe('returns ready: false when divergence rate exceeds threshold', () => {
    it('should fail when divergence exceeds 0.1%', () => {
      // 1001 divergences out of 1_000_000 total = 1001 PPM > 1000 PPM threshold
      const result = evaluateGraduation(
        CTX,
        makeCounters({ shadowTotal: 1_000_000n, divergenceTotal: 1001n }),
        DEPLOY_TIME,
        0,
        DEFAULT_GRADUATION_CRITERIA,
        NOW,
      );

      expect(result.ready).toBe(false);
      expect(result.criteria.divergenceRate.met).toBe(false);
      expect(result.criteria.divergenceRate.currentPpm).toBe(1001n);
    });

    it('should fail with high divergence rate', () => {
      // 10% divergence
      const result = evaluateGraduation(
        CTX,
        makeCounters({ shadowTotal: 1000n, divergenceTotal: 100n }),
        DEPLOY_TIME,
        0,
        DEFAULT_GRADUATION_CRITERIA,
        NOW,
      );

      expect(result.ready).toBe(false);
      expect(result.criteria.divergenceRate.met).toBe(false);
      expect(result.criteria.divergenceRate.currentPpm).toBe(100000n); // 10% = 100,000 PPM
    });
  });

  describe('returns ready: false when observation window insufficient', () => {
    it('should fail when deployed less than 7 days ago', () => {
      const recentDeploy = NOW - (6 * 24 * 60 * 60 * 1000); // 6 days ago

      const result = evaluateGraduation(
        CTX,
        makeCounters(),
        recentDeploy,
        0,
        DEFAULT_GRADUATION_CRITERIA,
        NOW,
      );

      expect(result.ready).toBe(false);
      expect(result.criteria.observationWindow.met).toBe(false);
      expect(result.criteria.observationWindow.currentMs).toBeLessThan(SEVEN_DAYS_MS);
    });

    it('should fail when deployed just now', () => {
      const result = evaluateGraduation(
        CTX,
        makeCounters(),
        NOW, // deployed right now
        0,
        DEFAULT_GRADUATION_CRITERIA,
        NOW,
      );

      expect(result.ready).toBe(false);
      expect(result.criteria.observationWindow.met).toBe(false);
      expect(result.criteria.observationWindow.currentMs).toBe(0);
    });
  });

  describe('returns ready: false when would-reject within consecutive window', () => {
    it('should fail when would-reject occurred recently (within 72h)', () => {
      const recentReject = NOW - ONE_HOUR_MS; // 1 hour ago

      const result = evaluateGraduation(
        CTX,
        makeCounters({ wouldRejectTotal: 5n }),
        DEPLOY_TIME,
        recentReject,
        DEFAULT_GRADUATION_CRITERIA,
        NOW,
      );

      expect(result.ready).toBe(false);
      expect(result.criteria.wouldRejectClean.met).toBe(false);
      expect(result.criteria.wouldRejectClean.consecutiveCleanMs).toBe(ONE_HOUR_MS);
    });
  });

  describe('would-reject recovery: graduation allowed after consecutive-clean window', () => {
    it('should return ready when last would-reject was more than 72h ago', () => {
      const oldReject = NOW - SEVENTY_TWO_HOURS_MS - ONE_HOUR_MS; // 73 hours ago

      const result = evaluateGraduation(
        CTX,
        makeCounters({ wouldRejectTotal: 5n }),
        DEPLOY_TIME,
        oldReject,
        DEFAULT_GRADUATION_CRITERIA,
        NOW,
      );

      expect(result.ready).toBe(true);
      expect(result.criteria.wouldRejectClean.met).toBe(true);
      expect(result.criteria.wouldRejectClean.consecutiveCleanMs).toBeGreaterThan(SEVENTY_TWO_HOURS_MS);
    });

    it('should fail when last would-reject was exactly at 72h boundary', () => {
      // Exactly 72h ago — consecutiveCleanMs === threshold, should pass (>=)
      const exactBoundary = NOW - SEVENTY_TWO_HOURS_MS;

      const result = evaluateGraduation(
        CTX,
        makeCounters({ wouldRejectTotal: 1n }),
        DEPLOY_TIME,
        exactBoundary,
        DEFAULT_GRADUATION_CRITERIA,
        NOW,
      );

      expect(result.ready).toBe(true);
      expect(result.criteria.wouldRejectClean.met).toBe(true);
      expect(result.criteria.wouldRejectClean.consecutiveCleanMs).toBe(SEVENTY_TWO_HOURS_MS);
    });
  });

  describe('BigInt precision preserved for large counter values (AC-1.5)', () => {
    it('should handle counter values exceeding Number.MAX_SAFE_INTEGER', () => {
      // Values larger than 2^53 - 1 = 9_007_199_254_740_991
      const largeShadow = 10_000_000_000_000_000n; // 10 quadrillion
      const largeDivergence = 9_000_000_000_000n;  // 9 trillion (0.09% = 900 PPM)

      const result = evaluateGraduation(
        CTX,
        makeCounters({ shadowTotal: largeShadow, divergenceTotal: largeDivergence }),
        DEPLOY_TIME,
        0,
        DEFAULT_GRADUATION_CRITERIA,
        NOW,
      );

      expect(result.ready).toBe(true);
      expect(result.criteria.divergenceRate.met).toBe(true);
      expect(result.criteria.divergenceRate.currentPpm).toBe(900n); // 0.09% = 900 PPM
    });

    it('should correctly detect threshold breach at large scale', () => {
      const largeShadow = 10_000_000_000_000_000n;
      const largeDivergence = 11_000_000_000_000n; // 11 trillion (0.11% = 1100 PPM > 1000 PPM)

      const result = evaluateGraduation(
        CTX,
        makeCounters({ shadowTotal: largeShadow, divergenceTotal: largeDivergence }),
        DEPLOY_TIME,
        0,
        DEFAULT_GRADUATION_CRITERIA,
        NOW,
      );

      expect(result.ready).toBe(false);
      expect(result.criteria.divergenceRate.met).toBe(false);
      expect(result.criteria.divergenceRate.currentPpm).toBe(1100n);
    });
  });

  describe('zero-traffic rule', () => {
    it('should vacuously meet divergence when shadowTotal === 0n', () => {
      const result = evaluateGraduation(
        CTX,
        makeCounters({ shadowTotal: 0n, divergenceTotal: 0n }),
        DEPLOY_TIME,
        0,
        DEFAULT_GRADUATION_CRITERIA,
        NOW,
      );

      expect(result.criteria.divergenceRate.met).toBe(true);
      expect(result.criteria.divergenceRate.currentPpm).toBe(0n);
    });

    it('should still require observation window even with zero traffic', () => {
      const recentDeploy = NOW - ONE_HOUR_MS; // 1 hour ago

      const result = evaluateGraduation(
        CTX,
        makeCounters({ shadowTotal: 0n }),
        recentDeploy,
        0,
        DEFAULT_GRADUATION_CRITERIA,
        NOW,
      );

      expect(result.ready).toBe(false);
      expect(result.criteria.divergenceRate.met).toBe(true); // vacuously met
      expect(result.criteria.observationWindow.met).toBe(false); // time must elapse
    });

    it('should still require consecutive-clean window even with zero traffic', () => {
      // Deploy 2 days ago — observation window not met (< 7 days),
      // consecutive-clean window not met (< 72h)
      const twoDaysAgo = NOW - (2 * 24 * 60 * 60 * 1000);

      const result = evaluateGraduation(
        CTX,
        makeCounters({ shadowTotal: 0n }),
        twoDaysAgo,
        0,
        DEFAULT_GRADUATION_CRITERIA,
        NOW,
      );

      expect(result.ready).toBe(false);
      expect(result.criteria.divergenceRate.met).toBe(true); // vacuously met
      expect(result.criteria.wouldRejectClean.met).toBe(false); // 48h < 72h threshold
    });

    it('should return ready with zero traffic after all time windows elapsed', () => {
      const result = evaluateGraduation(
        CTX,
        makeCounters({ shadowTotal: 0n }),
        DEPLOY_TIME, // 8 days ago — exceeds both 7-day and 72h windows
        0,
        DEFAULT_GRADUATION_CRITERIA,
        NOW,
      );

      expect(result.ready).toBe(true);
    });
  });

  describe('clock skew protection', () => {
    it('should clamp observation window to 0 when deploy timestamp is in the future', () => {
      const futureTimestamp = NOW + ONE_HOUR_MS;

      const result = evaluateGraduation(
        CTX,
        makeCounters(),
        futureTimestamp,
        0,
        DEFAULT_GRADUATION_CRITERIA,
        NOW,
      );

      expect(result.ready).toBe(false);
      expect(result.criteria.observationWindow.currentMs).toBe(0);
    });

    it('should clamp consecutive-clean to 0 when lastWouldRejectTimestamp is in the future', () => {
      const futureReject = NOW + ONE_HOUR_MS;

      const result = evaluateGraduation(
        CTX,
        makeCounters({ wouldRejectTotal: 1n }),
        DEPLOY_TIME,
        futureReject,
        DEFAULT_GRADUATION_CRITERIA,
        NOW,
      );

      expect(result.ready).toBe(false);
      expect(result.criteria.wouldRejectClean.consecutiveCleanMs).toBe(0);
    });
  });

  describe('output structure', () => {
    it('should include context and evaluatedAt in ISO 8601 format', () => {
      const result = evaluateGraduation(
        'jwt',
        makeCounters(),
        DEPLOY_TIME,
        0,
        DEFAULT_GRADUATION_CRITERIA,
        NOW,
      );

      expect(result.context).toBe('jwt');
      expect(result.evaluatedAt).toBe(new Date(NOW).toISOString());
    });

    it('should report threshold values in criteria', () => {
      const result = evaluateGraduation(
        CTX,
        makeCounters(),
        DEPLOY_TIME,
        0,
        DEFAULT_GRADUATION_CRITERIA,
        NOW,
      );

      expect(result.criteria.divergenceRate.thresholdPpm).toBe(1000n);
      expect(result.criteria.observationWindow.thresholdMs).toBe(SEVEN_DAYS_MS);
      expect(result.criteria.wouldRejectClean.thresholdMs).toBe(SEVENTY_TWO_HOURS_MS);
    });
  });

  describe('custom criteria', () => {
    it('should respect custom thresholds', () => {
      const strict: BoundaryGraduationCriteria = {
        maxDivergenceRatePpm: 100n, // 0.01%
        minObservationWindowMs: 14 * 24 * 60 * 60 * 1000, // 14 days
        wouldRejectConsecutiveWindowMs: 7 * 24 * 60 * 60 * 1000, // 7 days
      };

      // 500 PPM would pass default (1000) but fail strict (100)
      const result = evaluateGraduation(
        CTX,
        makeCounters({ shadowTotal: 10000n, divergenceTotal: 5n }), // 500 PPM
        DEPLOY_TIME, // 8 days ago < 14 days
        0,
        strict,
        NOW,
      );

      expect(result.ready).toBe(false);
      expect(result.criteria.divergenceRate.met).toBe(false);
      expect(result.criteria.observationWindow.met).toBe(false);
    });
  });
});
