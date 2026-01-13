/**
 * MfaRouterService Tests
 *
 * Sprint 68: MFA Hardening & Observability
 *
 * Tests for tier-based MFA routing
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  MfaRouterService,
  createMfaRouter,
  getRiskTierFromScore,
  type RiskTier,
  type MfaMethod,
  type TieredMfaRequest,
} from '../../../../../src/packages/security/mfa/MfaRouterService.js';
import type { MFAService } from '../../../../../src/packages/security/MFAService.js';
import type { DuoMfaVerifier } from '../../../../../src/packages/security/mfa/DuoMfaVerifier.js';

describe('MfaRouterService', () => {
  let mockTotpVerifier: MFAService;
  let mockDuoVerifier: DuoMfaVerifier;

  beforeEach(() => {
    // Create mock TOTP verifier
    mockTotpVerifier = {
      verifyTOTP: vi.fn(),
      verify: vi.fn(),
      setupTOTP: vi.fn(),
      verifyBackupCode: vi.fn(),
      getConfig: vi.fn(),
      disable: vi.fn(),
    } as unknown as MFAService;

    // Create mock Duo verifier
    mockDuoVerifier = {
      verify: vi.fn(),
      generateSignedRequest: vi.fn(),
      verifySignedResponse: vi.fn(),
    } as unknown as DuoMfaVerifier;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // Constructor Tests
  // ===========================================================================

  describe('constructor', () => {
    it('should create instance with TOTP verifier only', () => {
      const router = new MfaRouterService({
        totpVerifier: mockTotpVerifier,
      });
      expect(router).toBeInstanceOf(MfaRouterService);
      expect(router.isDuoAvailable()).toBe(false);
    });

    it('should create instance with both verifiers', () => {
      const router = new MfaRouterService({
        totpVerifier: mockTotpVerifier,
        duoVerifier: mockDuoVerifier,
      });
      expect(router).toBeInstanceOf(MfaRouterService);
      expect(router.isDuoAvailable()).toBe(true);
    });

    it('should accept custom tier routing', () => {
      const customRouting: Record<RiskTier, MfaMethod[]> = {
        LOW: ['none'],
        MEDIUM: ['none', 'totp'],
        HIGH: ['totp'],
        CRITICAL: ['totp', 'duo'],
      };

      const router = new MfaRouterService({
        totpVerifier: mockTotpVerifier,
        tierRouting: customRouting,
      });

      expect(router.getAllowedMethods('MEDIUM')).toEqual(['none', 'totp']);
    });
  });

  // ===========================================================================
  // Tier Routing Tests
  // ===========================================================================

  describe('tier routing', () => {
    describe('LOW tier', () => {
      it('should not require MFA for LOW tier', async () => {
        const router = new MfaRouterService({
          totpVerifier: mockTotpVerifier,
        });

        const result = await router.verifyWithTier({
          userId: 'user@example.com',
          riskTier: 'LOW',
          code: '',
        });

        expect(result.valid).toBe(true);
        expect(result.methodUsed).toBe('none');
        expect(result.riskTier).toBe('LOW');
        expect(mockTotpVerifier.verifyTOTP).not.toHaveBeenCalled();
      });
    });

    describe('MEDIUM tier', () => {
      it('should use TOTP for MEDIUM tier', async () => {
        (mockTotpVerifier.verifyTOTP as ReturnType<typeof vi.fn>).mockResolvedValue({
          valid: true,
        });

        const router = new MfaRouterService({
          totpVerifier: mockTotpVerifier,
        });

        const result = await router.verifyWithTier({
          userId: 'user@example.com',
          riskTier: 'MEDIUM',
          code: '123456',
        });

        expect(result.valid).toBe(true);
        expect(result.methodUsed).toBe('totp');
        expect(mockTotpVerifier.verifyTOTP).toHaveBeenCalledWith('user@example.com', '123456');
      });

      it('should return invalid for wrong TOTP code', async () => {
        (mockTotpVerifier.verifyTOTP as ReturnType<typeof vi.fn>).mockResolvedValue({
          valid: false,
        });

        const router = new MfaRouterService({
          totpVerifier: mockTotpVerifier,
        });

        const result = await router.verifyWithTier({
          userId: 'user@example.com',
          riskTier: 'MEDIUM',
          code: '000000',
        });

        expect(result.valid).toBe(false);
        expect(result.methodUsed).toBe('totp');
        expect(result.error).toBe('Invalid verification code');
      });
    });

    describe('HIGH tier', () => {
      it('should allow TOTP for HIGH tier', async () => {
        (mockTotpVerifier.verifyTOTP as ReturnType<typeof vi.fn>).mockResolvedValue({
          valid: true,
        });

        const router = new MfaRouterService({
          totpVerifier: mockTotpVerifier,
          duoVerifier: mockDuoVerifier,
        });

        const result = await router.verifyWithTier({
          userId: 'user@example.com',
          riskTier: 'HIGH',
          code: '123456',
        });

        expect(result.valid).toBe(true);
        expect(result.methodUsed).toBe('totp');
      });

      it('should allow Duo for HIGH tier', async () => {
        (mockDuoVerifier.verify as ReturnType<typeof vi.fn>).mockResolvedValue(true);

        const router = new MfaRouterService({
          totpVerifier: mockTotpVerifier,
          duoVerifier: mockDuoVerifier,
        });

        const result = await router.verifyWithTier({
          userId: 'user@example.com',
          riskTier: 'HIGH',
          code: 'push',
        });

        expect(result.valid).toBe(true);
        expect(result.methodUsed).toBe('duo');
        expect(mockDuoVerifier.verify).toHaveBeenCalledWith('user@example.com', 'push');
      });
    });

    describe('CRITICAL tier', () => {
      it('should require Duo for CRITICAL tier', async () => {
        (mockDuoVerifier.verify as ReturnType<typeof vi.fn>).mockResolvedValue(true);

        const router = new MfaRouterService({
          totpVerifier: mockTotpVerifier,
          duoVerifier: mockDuoVerifier,
        });

        const result = await router.verifyWithTier({
          userId: 'user@example.com',
          riskTier: 'CRITICAL',
          code: 'push',
        });

        expect(result.valid).toBe(true);
        expect(result.methodUsed).toBe('duo');
        expect(result.duoRequired).toBe(true);
      });

      it('should fail CRITICAL tier if Duo not configured', async () => {
        const router = new MfaRouterService({
          totpVerifier: mockTotpVerifier,
          // No duoVerifier
        });

        const result = await router.verifyWithTier({
          userId: 'user@example.com',
          riskTier: 'CRITICAL',
          code: 'push',
        });

        expect(result.valid).toBe(false);
        expect(result.duoRequired).toBe(true);
        expect(result.error).toContain('Hardware MFA (Duo) is required');
      });

      it('should not fallback to TOTP for CRITICAL tier', async () => {
        (mockTotpVerifier.verifyTOTP as ReturnType<typeof vi.fn>).mockResolvedValue({
          valid: true,
        });

        const router = new MfaRouterService({
          totpVerifier: mockTotpVerifier,
          // No duoVerifier
        });

        const result = await router.verifyWithTier({
          userId: 'user@example.com',
          riskTier: 'CRITICAL',
          code: '123456', // TOTP code
        });

        expect(result.valid).toBe(false);
        expect(result.duoRequired).toBe(true);
        expect(mockTotpVerifier.verifyTOTP).not.toHaveBeenCalled();
      });
    });
  });

  // ===========================================================================
  // Fallback Tests
  // ===========================================================================

  describe('fallback behavior', () => {
    it('should fallback to TOTP for HIGH tier when Duo unavailable', async () => {
      (mockTotpVerifier.verifyTOTP as ReturnType<typeof vi.fn>).mockResolvedValue({
        valid: true,
      });

      const router = new MfaRouterService({
        totpVerifier: mockTotpVerifier,
        // No duoVerifier
      });

      const result = await router.verifyWithTier({
        userId: 'user@example.com',
        riskTier: 'HIGH',
        code: '123456',
        preferredMethod: 'duo', // Requested Duo but not available
      });

      expect(result.valid).toBe(true);
      expect(result.methodUsed).toBe('totp');
    });

    it('should track fallback count', async () => {
      (mockTotpVerifier.verifyTOTP as ReturnType<typeof vi.fn>).mockResolvedValue({
        valid: true,
      });

      const router = new MfaRouterService({
        totpVerifier: mockTotpVerifier,
        // No duoVerifier
      });

      await router.verifyWithTier({
        userId: 'user@example.com',
        riskTier: 'HIGH',
        code: '123456',
        preferredMethod: 'duo',
      });

      const metrics = router.getMetrics();
      expect(metrics.fallbackCount).toBe(1);
    });
  });

  // ===========================================================================
  // IMfaVerifier Interface Tests
  // ===========================================================================

  describe('verify() interface', () => {
    it('should use MEDIUM tier by default', async () => {
      (mockTotpVerifier.verifyTOTP as ReturnType<typeof vi.fn>).mockResolvedValue({
        valid: true,
      });

      const router = new MfaRouterService({
        totpVerifier: mockTotpVerifier,
      });

      const result = await router.verify('user@example.com', '123456');

      expect(result).toBe(true);
      expect(mockTotpVerifier.verifyTOTP).toHaveBeenCalledWith('user@example.com', '123456');
    });
  });

  // ===========================================================================
  // Code Type Detection Tests
  // ===========================================================================

  describe('code type detection', () => {
    it('should detect 6-digit code as TOTP', async () => {
      (mockTotpVerifier.verifyTOTP as ReturnType<typeof vi.fn>).mockResolvedValue({
        valid: true,
      });

      const router = new MfaRouterService({
        totpVerifier: mockTotpVerifier,
        duoVerifier: mockDuoVerifier,
      });

      const result = await router.verifyWithTier({
        userId: 'user@example.com',
        riskTier: 'HIGH',
        code: '123456',
      });

      expect(result.methodUsed).toBe('totp');
    });

    it('should detect 8-digit code as Duo hardware token', async () => {
      (mockDuoVerifier.verify as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      const router = new MfaRouterService({
        totpVerifier: mockTotpVerifier,
        duoVerifier: mockDuoVerifier,
      });

      const result = await router.verifyWithTier({
        userId: 'user@example.com',
        riskTier: 'HIGH',
        code: '12345678',
      });

      expect(result.methodUsed).toBe('duo');
    });

    it('should detect "push" as Duo push notification', async () => {
      (mockDuoVerifier.verify as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      const router = new MfaRouterService({
        totpVerifier: mockTotpVerifier,
        duoVerifier: mockDuoVerifier,
      });

      const result = await router.verifyWithTier({
        userId: 'user@example.com',
        riskTier: 'HIGH',
        code: 'PUSH', // Case insensitive
      });

      expect(result.methodUsed).toBe('duo');
    });
  });

  // ===========================================================================
  // Metrics Tests
  // ===========================================================================

  describe('metrics', () => {
    it('should track attempt count', async () => {
      (mockTotpVerifier.verifyTOTP as ReturnType<typeof vi.fn>).mockResolvedValue({
        valid: true,
      });

      const router = new MfaRouterService({
        totpVerifier: mockTotpVerifier,
      });

      await router.verifyWithTier({
        userId: 'user@example.com',
        riskTier: 'MEDIUM',
        code: '123456',
      });
      await router.verifyWithTier({
        userId: 'user@example.com',
        riskTier: 'MEDIUM',
        code: '654321',
      });

      const metrics = router.getMetrics();
      expect(metrics.attemptCount).toBe(2);
    });

    it('should track success count', async () => {
      (mockTotpVerifier.verifyTOTP as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ valid: true })
        .mockResolvedValueOnce({ valid: false });

      const router = new MfaRouterService({
        totpVerifier: mockTotpVerifier,
      });

      await router.verifyWithTier({
        userId: 'user@example.com',
        riskTier: 'MEDIUM',
        code: '123456',
      });
      await router.verifyWithTier({
        userId: 'user@example.com',
        riskTier: 'MEDIUM',
        code: '000000',
      });

      const metrics = router.getMetrics();
      expect(metrics.successCount).toBe(1);
      expect(metrics.successRate).toBe(50);
    });

    it('should track timeout count', async () => {
      (mockTotpVerifier.verifyTOTP as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Request timeout')
      );

      const router = new MfaRouterService({
        totpVerifier: mockTotpVerifier,
      });

      await router.verifyWithTier({
        userId: 'user@example.com',
        riskTier: 'MEDIUM',
        code: '123456',
      });

      const metrics = router.getMetrics();
      expect(metrics.timeoutCount).toBe(1);
    });

    it('should reset metrics', async () => {
      (mockTotpVerifier.verifyTOTP as ReturnType<typeof vi.fn>).mockResolvedValue({
        valid: true,
      });

      const router = new MfaRouterService({
        totpVerifier: mockTotpVerifier,
      });

      await router.verifyWithTier({
        userId: 'user@example.com',
        riskTier: 'MEDIUM',
        code: '123456',
      });

      router.resetMetrics();

      const metrics = router.getMetrics();
      expect(metrics.attemptCount).toBe(0);
      expect(metrics.successCount).toBe(0);
    });
  });

  // ===========================================================================
  // Helper Function Tests
  // ===========================================================================

  describe('helper functions', () => {
    describe('getAllowedMethods()', () => {
      it('should return allowed methods for each tier', () => {
        const router = new MfaRouterService({
          totpVerifier: mockTotpVerifier,
        });

        expect(router.getAllowedMethods('LOW')).toEqual(['none']);
        expect(router.getAllowedMethods('MEDIUM')).toEqual(['totp']);
        expect(router.getAllowedMethods('HIGH')).toEqual(['totp', 'duo']);
        expect(router.getAllowedMethods('CRITICAL')).toEqual(['duo']);
      });
    });

    describe('isMfaRequired()', () => {
      it('should return false for LOW tier', () => {
        const router = new MfaRouterService({
          totpVerifier: mockTotpVerifier,
        });
        expect(router.isMfaRequired('LOW')).toBe(false);
      });

      it('should return true for other tiers', () => {
        const router = new MfaRouterService({
          totpVerifier: mockTotpVerifier,
        });
        expect(router.isMfaRequired('MEDIUM')).toBe(true);
        expect(router.isMfaRequired('HIGH')).toBe(true);
        expect(router.isMfaRequired('CRITICAL')).toBe(true);
      });
    });
  });

  // ===========================================================================
  // Factory Function Tests
  // ===========================================================================

  describe('createMfaRouter()', () => {
    it('should create router instance', () => {
      const router = createMfaRouter({
        totpVerifier: mockTotpVerifier,
      });
      expect(router).toBeInstanceOf(MfaRouterService);
    });
  });

  describe('getRiskTierFromScore()', () => {
    it('should return CRITICAL for score >= 90', () => {
      expect(getRiskTierFromScore(90)).toBe('CRITICAL');
      expect(getRiskTierFromScore(100)).toBe('CRITICAL');
    });

    it('should return HIGH for score >= 70', () => {
      expect(getRiskTierFromScore(70)).toBe('HIGH');
      expect(getRiskTierFromScore(89)).toBe('HIGH');
    });

    it('should return MEDIUM for score >= 40', () => {
      expect(getRiskTierFromScore(40)).toBe('MEDIUM');
      expect(getRiskTierFromScore(69)).toBe('MEDIUM');
    });

    it('should return LOW for score < 40', () => {
      expect(getRiskTierFromScore(0)).toBe('LOW');
      expect(getRiskTierFromScore(39)).toBe('LOW');
    });
  });
});
