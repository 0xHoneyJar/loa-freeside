/**
 * Unit tests for EnhancedHITLApprovalGate
 *
 * Tests the Human-in-the-Loop approval workflow including:
 * - Approval request creation and lifecycle
 * - Slack and Discord notification building
 * - MFA verification flow
 * - 24-hour timeout and expiration
 * - Audit trail logging
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  EnhancedHITLApprovalGate,
  HttpClient,
  MfaVerifier,
  ApprovalStorage,
  HITLConfigWithDeps,
} from '../../../../src/packages/infrastructure/EnhancedHITLApprovalGate.js';
import type {
  TerraformPlan,
  PreGateDecision,
  ApprovalRequest,
  ApprovalRequester,
} from '../../../../src/packages/infrastructure/types.js';

// Mock implementations
const createMockHttpClient = (): HttpClient => ({
  post: vi.fn().mockImplementation(async (url: string) => {
    // Slack returns 'ok' string, Discord returns message object with id
    if (url.includes('slack')) {
      return { status: 200, data: 'ok' };
    }
    // Discord returns 200 with message object containing id
    return { status: 200, data: { id: 'discord-message-123' } };
  }),
});

const createMockMfaVerifier = (shouldPass: boolean = true): MfaVerifier => ({
  verify: vi.fn().mockResolvedValue(shouldPass),
});

const createMockStorage = (): ApprovalStorage & {
  _store: Map<string, ApprovalRequest>;
} => {
  const store = new Map<string, ApprovalRequest>();
  return {
    _store: store,
    save: vi.fn().mockImplementation(async (request: ApprovalRequest) => {
      store.set(request.id, { ...request });
    }),
    get: vi.fn().mockImplementation(async (id: string) => {
      const request = store.get(id);
      return request ? { ...request } : null;
    }),
    update: vi.fn().mockImplementation(async (request: ApprovalRequest) => {
      store.set(request.id, { ...request });
    }),
    findExpired: vi.fn().mockImplementation(async () => {
      const now = new Date();
      return Array.from(store.values()).filter(
        (r) => r.status === 'pending' && r.expiresAt < now
      );
    }),
  };
};

// Test fixtures
const createTerraformPlan = (
  resourceCount: number = 2
): TerraformPlan => ({
  format_version: '1.0',
  terraform_version: '1.5.0',
  resource_changes: Array.from({ length: resourceCount }, (_, i) => ({
    address: `aws_instance.test_${i}`,
    mode: 'managed' as const,
    type: 'aws_instance',
    name: `test_${i}`,
    provider_name: 'aws',
    change: {
      actions: ['update'] as const,
      before: { instance_type: 't3.small' },
      after: { instance_type: 't3.medium' },
    },
  })),
});

const createPreGateDecision = (
  verdict: 'APPROVE' | 'REVIEW_REQUIRED' | 'REJECT' = 'REVIEW_REQUIRED',
  riskScore: number = 50
): PreGateDecision => ({
  verdict,
  reason: 'Test decision',
  recommendations: ['Test recommendation'],
  policyEvaluation: {
    allowed: verdict !== 'REJECT',
    hardBlocks: [],
    warnings:
      verdict === 'REVIEW_REQUIRED'
        ? [
            {
              code: 'WARN_TEST',
              severity: 'medium',
              message: 'Test warning',
              resource: 'test',
              canOverride: true,
            },
          ]
        : [],
    metadata: {
      evaluationTimeMs: 100,
      policyPath: '/test/policy.rego',
    },
  },
  riskScore: {
    score: riskScore,
    level: riskScore >= 80 ? 'critical' : riskScore >= 60 ? 'high' : riskScore >= 40 ? 'medium' : 'low',
    factors: {
      resourceTypeRisk: 25,
      operationTypeRisk: 25,
      costImpactRisk: 25,
      blastRadiusRisk: 25,
    },
    explanation: 'Test risk assessment',
  },
  timestamp: new Date(),
});

const createRequester = (): ApprovalRequester => ({
  userId: 'user-123',
  displayName: 'Test User',
  email: 'test@example.com',
  source: 'terraform-cli',
});

// Test audit signing key (32+ chars for HMAC security)
const TEST_AUDIT_SIGNING_KEY = 'test-signing-key-for-hmac-security-32chars';

const createConfig = (
  overrides: Partial<HITLConfigWithDeps> = {}
): HITLConfigWithDeps => ({
  slackWebhookUrl: 'https://hooks.slack.com/test',
  slackChannelId: 'C123456',
  discordWebhookUrl: 'https://discord.com/api/webhooks/test',
  approvalTimeoutMs: 24 * 60 * 60 * 1000, // 24 hours
  mfaRiskThreshold: 70,
  alwaysRequireMfa: false,
  notificationChannel: 'both',
  reminderIntervals: [3600000], // 1 hour
  httpClient: createMockHttpClient(),
  mfaVerifier: createMockMfaVerifier(),
  storage: createMockStorage(),
  auditSigningKey: TEST_AUDIT_SIGNING_KEY,
  ...overrides,
});

describe('EnhancedHITLApprovalGate', () => {
  describe('constructor', () => {
    it('should create instance with valid config', () => {
      const config = createConfig();
      const gate = new EnhancedHITLApprovalGate(config);
      expect(gate).toBeInstanceOf(EnhancedHITLApprovalGate);
    });

    it('should throw error when MFA enabled without verifier', () => {
      const config = createConfig({
        alwaysRequireMfa: true,
        mfaVerifier: undefined,
      });

      expect(() => new EnhancedHITLApprovalGate(config)).toThrow(
        'MFA verifier is required when MFA is enabled'
      );
    });

    it('should throw error when MFA threshold set without verifier', () => {
      const config = createConfig({
        mfaRiskThreshold: 50,
        mfaVerifier: undefined,
      });

      expect(() => new EnhancedHITLApprovalGate(config)).toThrow(
        'MFA verifier is required when MFA is enabled'
      );
    });

    it('should use default timeout when not specified', () => {
      const config = createConfig({ approvalTimeoutMs: undefined as any });
      const gate = new EnhancedHITLApprovalGate(config);
      expect(gate).toBeInstanceOf(EnhancedHITLApprovalGate);
    });

    // Security tests (HIGH-001, MED-004)
    it('should reject invalid Slack webhook URL', () => {
      const config = createConfig({
        slackWebhookUrl: 'https://attacker.com/steal-data',
      });

      expect(() => new EnhancedHITLApprovalGate(config)).toThrow(
        'slack webhook domain not allowed'
      );
    });

    it('should reject invalid Discord webhook URL', () => {
      const config = createConfig({
        discordWebhookUrl: 'https://malicious.site/webhook',
      });

      expect(() => new EnhancedHITLApprovalGate(config)).toThrow(
        'discord webhook domain not allowed'
      );
    });

    it('should reject non-HTTPS webhook URLs', () => {
      const config = createConfig({
        slackWebhookUrl: 'http://hooks.slack.com/test',
      });

      expect(() => new EnhancedHITLApprovalGate(config)).toThrow(
        'must use HTTPS'
      );
    });

    it('should reject short audit signing key', () => {
      const config = createConfig({
        auditSigningKey: 'too-short',
      });

      expect(() => new EnhancedHITLApprovalGate(config)).toThrow(
        'Audit signing key must be at least 32 characters'
      );
    });

    it('should accept valid webhook domains', () => {
      const config = createConfig({
        slackWebhookUrl: 'https://hooks.slack.com/services/TTEST/BTEST/testwebhooktoken',
        discordWebhookUrl: 'https://discord.com/api/webhooks/1234567890/abcdef',
      });

      const gate = new EnhancedHITLApprovalGate(config);
      expect(gate).toBeInstanceOf(EnhancedHITLApprovalGate);
    });
  });

  describe('createApprovalRequest', () => {
    let gate: EnhancedHITLApprovalGate;
    let storage: ReturnType<typeof createMockStorage>;

    beforeEach(() => {
      storage = createMockStorage();
      gate = new EnhancedHITLApprovalGate(createConfig({ storage }));
    });

    it('should create approval request for REVIEW_REQUIRED verdict', async () => {
      const plan = createTerraformPlan();
      const decision = createPreGateDecision('REVIEW_REQUIRED');
      const requester = createRequester();

      const request = await gate.createApprovalRequest(
        plan,
        decision,
        requester
      );

      expect(request.id).toBeDefined();
      expect(request.status).toBe('pending');
      expect(request.terraformPlan).toEqual(plan);
      expect(request.preGateDecision).toEqual(decision);
      expect(request.requester).toEqual(requester);
      expect(request.auditTrail).toHaveLength(1);
      expect(request.auditTrail[0].action).toBe('request_created');
    });

    it('should create approval request for APPROVE verdict', async () => {
      const plan = createTerraformPlan();
      const decision = createPreGateDecision('APPROVE', 30);
      const requester = createRequester();

      const request = await gate.createApprovalRequest(
        plan,
        decision,
        requester
      );

      expect(request.status).toBe('pending');
      expect(request.requiresMfa).toBe(false);
    });

    it('should throw error for REJECT verdict', async () => {
      const plan = createTerraformPlan();
      const decision = createPreGateDecision('REJECT');
      const requester = createRequester();

      await expect(
        gate.createApprovalRequest(plan, decision, requester)
      ).rejects.toThrow('Pre-gate rejected change');
    });

    it('should set MFA required when risk score exceeds threshold', async () => {
      const plan = createTerraformPlan();
      const decision = createPreGateDecision('REVIEW_REQUIRED', 80); // Above default threshold of 70
      const requester = createRequester();

      const request = await gate.createApprovalRequest(
        plan,
        decision,
        requester
      );

      expect(request.requiresMfa).toBe(true);
    });

    it('should set MFA required when alwaysRequireMfa is true', async () => {
      storage = createMockStorage();
      gate = new EnhancedHITLApprovalGate(
        createConfig({ storage, alwaysRequireMfa: true })
      );

      const plan = createTerraformPlan();
      const decision = createPreGateDecision('REVIEW_REQUIRED', 30); // Low risk
      const requester = createRequester();

      const request = await gate.createApprovalRequest(
        plan,
        decision,
        requester
      );

      expect(request.requiresMfa).toBe(true);
    });

    it('should set correct expiration time', async () => {
      const timeoutMs = 60 * 60 * 1000; // 1 hour
      storage = createMockStorage();
      gate = new EnhancedHITLApprovalGate(
        createConfig({ storage, approvalTimeoutMs: timeoutMs })
      );

      const before = Date.now();
      const request = await gate.createApprovalRequest(
        createTerraformPlan(),
        createPreGateDecision(),
        createRequester()
      );
      const after = Date.now();

      const expectedExpires = request.createdAt.getTime() + timeoutMs;
      expect(request.expiresAt.getTime()).toBeGreaterThanOrEqual(
        before + timeoutMs
      );
      expect(request.expiresAt.getTime()).toBeLessThanOrEqual(
        after + timeoutMs
      );
    });

    it('should save request to storage', async () => {
      const request = await gate.createApprovalRequest(
        createTerraformPlan(),
        createPreGateDecision(),
        createRequester()
      );

      expect(storage.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: request.id })
      );
    });
  });

  describe('sendNotification', () => {
    let gate: EnhancedHITLApprovalGate;
    let httpClient: HttpClient;
    let storage: ReturnType<typeof createMockStorage>;

    beforeEach(async () => {
      httpClient = createMockHttpClient();
      storage = createMockStorage();
      gate = new EnhancedHITLApprovalGate(
        createConfig({ httpClient, storage })
      );
    });

    it('should send Slack notification', async () => {
      gate = new EnhancedHITLApprovalGate(
        createConfig({
          httpClient,
          storage,
          notificationChannel: 'slack',
        })
      );

      const request = await gate.createApprovalRequest(
        createTerraformPlan(),
        createPreGateDecision(),
        createRequester()
      );

      const updated = await gate.sendNotification(request);

      expect(httpClient.post).toHaveBeenCalledWith(
        'https://hooks.slack.com/test',
        expect.objectContaining({
          blocks: expect.any(Array),
        }),
        expect.any(Object)
      );
      expect(updated.notificationMessageIds.slack).toBeDefined();
    });

    it('should send Discord notification', async () => {
      gate = new EnhancedHITLApprovalGate(
        createConfig({
          httpClient,
          storage,
          notificationChannel: 'discord',
        })
      );

      const request = await gate.createApprovalRequest(
        createTerraformPlan(),
        createPreGateDecision(),
        createRequester()
      );

      (httpClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({
        status: 204,
        data: '',
      });

      const updated = await gate.sendNotification(request);

      expect(httpClient.post).toHaveBeenCalledWith(
        'https://discord.com/api/webhooks/test',
        expect.objectContaining({
          embeds: expect.any(Array),
          components: expect.any(Array),
        }),
        expect.any(Object)
      );
      expect(updated.notificationMessageIds.discord).toBeDefined();
    });

    it('should send both notifications when channel is both', async () => {
      const request = await gate.createApprovalRequest(
        createTerraformPlan(),
        createPreGateDecision(),
        createRequester()
      );

      const updated = await gate.sendNotification(request);

      expect(httpClient.post).toHaveBeenCalledTimes(2);
      expect(updated.notificationMessageIds.slack).toBeDefined();
      expect(updated.notificationMessageIds.discord).toBeDefined();
    });

    it('should add audit trail entry on notification success', async () => {
      const request = await gate.createApprovalRequest(
        createTerraformPlan(),
        createPreGateDecision(),
        createRequester()
      );

      const updated = await gate.sendNotification(request);

      const sentEntries = updated.auditTrail.filter(
        (e) => e.action === 'notification_sent'
      );
      expect(sentEntries.length).toBeGreaterThan(0);
    });

    it('should add audit trail entry on notification failure', async () => {
      (httpClient.post as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Network error')
      );

      const request = await gate.createApprovalRequest(
        createTerraformPlan(),
        createPreGateDecision(),
        createRequester()
      );

      await expect(gate.sendNotification(request)).rejects.toThrow();

      const storedRequest = await storage.get(request.id);
      const failedEntries = storedRequest!.auditTrail.filter(
        (e) => e.action === 'notification_failed'
      );
      expect(failedEntries).toHaveLength(1);
    });
  });

  describe('processApproval', () => {
    let gate: EnhancedHITLApprovalGate;
    let mfaVerifier: MfaVerifier;
    let storage: ReturnType<typeof createMockStorage>;

    beforeEach(async () => {
      mfaVerifier = createMockMfaVerifier(true);
      storage = createMockStorage();
      gate = new EnhancedHITLApprovalGate(
        createConfig({ mfaVerifier, storage })
      );
    });

    it('should approve request without MFA when not required', async () => {
      const request = await gate.createApprovalRequest(
        createTerraformPlan(),
        createPreGateDecision('REVIEW_REQUIRED', 30), // Low risk
        createRequester()
      );

      const result = await gate.processApproval(
        request.id,
        {
          userId: 'approver-1',
          displayName: 'Approver',
          action: 'approved',
        },
        'approved'
      );

      expect(result.approved).toBe(true);
      expect(result.canProceed).toBe(true);
      expect(result.request.status).toBe('approved');
      expect(result.request.resolver?.mfaVerified).toBe(false);
    });

    it('should reject request without MFA', async () => {
      const request = await gate.createApprovalRequest(
        createTerraformPlan(),
        createPreGateDecision(),
        createRequester()
      );

      const result = await gate.processApproval(
        request.id,
        {
          userId: 'approver-1',
          displayName: 'Approver',
          action: 'rejected',
          reason: 'Not needed',
        },
        'rejected'
      );

      expect(result.approved).toBe(false);
      expect(result.canProceed).toBe(false);
      expect(result.request.status).toBe('rejected');
    });

    it('should require MFA for high-risk approval', async () => {
      const request = await gate.createApprovalRequest(
        createTerraformPlan(),
        createPreGateDecision('REVIEW_REQUIRED', 80), // High risk
        createRequester()
      );

      await expect(
        gate.processApproval(
          request.id,
          {
            userId: 'approver-1',
            displayName: 'Approver',
            action: 'approved',
          },
          'approved'
          // No MFA code provided
        )
      ).rejects.toThrow('MFA verification required');
    });

    it('should approve with valid MFA code', async () => {
      const request = await gate.createApprovalRequest(
        createTerraformPlan(),
        createPreGateDecision('REVIEW_REQUIRED', 80),
        createRequester()
      );

      const result = await gate.processApproval(
        request.id,
        {
          userId: 'approver-1',
          displayName: 'Approver',
          action: 'approved',
        },
        'approved',
        '123456' // MFA code
      );

      expect(result.approved).toBe(true);
      expect(result.request.resolver?.mfaVerified).toBe(true);
      expect(mfaVerifier.verify).toHaveBeenCalledWith('approver-1', '123456');
    });

    it('should fail with invalid MFA code', async () => {
      mfaVerifier = createMockMfaVerifier(false);
      gate = new EnhancedHITLApprovalGate(
        createConfig({ mfaVerifier, storage })
      );

      const request = await gate.createApprovalRequest(
        createTerraformPlan(),
        createPreGateDecision('REVIEW_REQUIRED', 80),
        createRequester()
      );

      await expect(
        gate.processApproval(
          request.id,
          {
            userId: 'approver-1',
            displayName: 'Approver',
            action: 'approved',
          },
          'approved',
          'invalid-code'
        )
      ).rejects.toThrow('MFA verification failed');
    });

    it('should throw for non-existent request', async () => {
      await expect(
        gate.processApproval(
          'non-existent-id',
          {
            userId: 'approver-1',
            displayName: 'Approver',
            action: 'approved',
          },
          'approved'
        )
      ).rejects.toThrow('Approval request not found');
    });

    it('should throw for already resolved request', async () => {
      const request = await gate.createApprovalRequest(
        createTerraformPlan(),
        createPreGateDecision('REVIEW_REQUIRED', 30),
        createRequester()
      );

      // First approval
      await gate.processApproval(
        request.id,
        {
          userId: 'approver-1',
          displayName: 'Approver',
          action: 'approved',
        },
        'approved'
      );

      // Second attempt should fail
      await expect(
        gate.processApproval(
          request.id,
          {
            userId: 'approver-2',
            displayName: 'Another Approver',
            action: 'approved',
          },
          'approved'
        )
      ).rejects.toThrow('Approval request already resolved');
    });

    it('should add audit trail entries for MFA flow', async () => {
      const request = await gate.createApprovalRequest(
        createTerraformPlan(),
        createPreGateDecision('REVIEW_REQUIRED', 80),
        createRequester()
      );

      const result = await gate.processApproval(
        request.id,
        {
          userId: 'approver-1',
          displayName: 'Approver',
          action: 'approved',
        },
        'approved',
        '123456'
      );

      const auditActions = result.request.auditTrail.map((e) => e.action);
      expect(auditActions).toContain('mfa_verified');
      expect(auditActions).toContain('approved');
    });
  });

  describe('processExpiredRequests', () => {
    let gate: EnhancedHITLApprovalGate;
    let storage: ReturnType<typeof createMockStorage>;

    beforeEach(() => {
      storage = createMockStorage();
      gate = new EnhancedHITLApprovalGate(
        createConfig({
          storage,
          approvalTimeoutMs: 1000, // 1 second for testing
        })
      );
    });

    it('should expire pending requests past timeout', async () => {
      const request = await gate.createApprovalRequest(
        createTerraformPlan(),
        createPreGateDecision(),
        createRequester()
      );

      // Manually modify expiration for testing
      const storedRequest = await storage.get(request.id);
      storedRequest!.expiresAt = new Date(Date.now() - 1000); // Expired
      await storage.update(storedRequest!);

      const expired = await gate.processExpiredRequests();

      expect(expired).toHaveLength(1);
      expect(expired[0].id).toBe(request.id);

      const updated = await gate.getRequest(request.id);
      expect(updated?.status).toBe('expired');
    });

    it('should not expire pending requests within timeout', async () => {
      await gate.createApprovalRequest(
        createTerraformPlan(),
        createPreGateDecision(),
        createRequester()
      );

      const expired = await gate.processExpiredRequests();
      expect(expired).toHaveLength(0);
    });

    it('should add audit trail entry on expiration', async () => {
      const request = await gate.createApprovalRequest(
        createTerraformPlan(),
        createPreGateDecision(),
        createRequester()
      );

      // Manually modify expiration for testing
      const storedRequest = await storage.get(request.id);
      storedRequest!.expiresAt = new Date(Date.now() - 1000);
      await storage.update(storedRequest!);

      await gate.processExpiredRequests();

      const updated = await gate.getRequest(request.id);
      const expiredEntry = updated!.auditTrail.find(
        (e) => e.action === 'expired'
      );
      expect(expiredEntry).toBeDefined();
      expect(expiredEntry!.actor).toBe('system');
    });
  });

  describe('cancelRequest', () => {
    let gate: EnhancedHITLApprovalGate;
    let storage: ReturnType<typeof createMockStorage>;

    beforeEach(() => {
      storage = createMockStorage();
      gate = new EnhancedHITLApprovalGate(createConfig({ storage }));
    });

    it('should cancel pending request', async () => {
      const request = await gate.createApprovalRequest(
        createTerraformPlan(),
        createPreGateDecision(),
        createRequester()
      );

      const cancelled = await gate.cancelRequest(
        request.id,
        'admin',
        'Plan superseded'
      );

      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.resolvedAt).toBeDefined();
    });

    it('should throw for non-existent request', async () => {
      await expect(
        gate.cancelRequest('non-existent', 'admin')
      ).rejects.toThrow('Approval request not found');
    });

    it('should throw for already resolved request', async () => {
      const request = await gate.createApprovalRequest(
        createTerraformPlan(),
        createPreGateDecision('REVIEW_REQUIRED', 30),
        createRequester()
      );

      await gate.processApproval(
        request.id,
        {
          userId: 'approver-1',
          displayName: 'Approver',
          action: 'approved',
        },
        'approved'
      );

      await expect(
        gate.cancelRequest(request.id, 'admin')
      ).rejects.toThrow('Cannot cancel request with status');
    });

    it('should add audit trail entry', async () => {
      const request = await gate.createApprovalRequest(
        createTerraformPlan(),
        createPreGateDecision(),
        createRequester()
      );

      const cancelled = await gate.cancelRequest(
        request.id,
        'admin',
        'Test cancellation'
      );

      const cancelEntry = cancelled.auditTrail.find(
        (e) => e.action === 'cancelled'
      );
      expect(cancelEntry).toBeDefined();
      expect(cancelEntry!.actor).toBe('admin');
      expect(cancelEntry!.details?.reason).toBe('Test cancellation');
    });
  });

  describe('formatRequest', () => {
    let gate: EnhancedHITLApprovalGate;

    beforeEach(() => {
      gate = new EnhancedHITLApprovalGate(createConfig());
    });

    it('should format pending request', async () => {
      const request = await gate.createApprovalRequest(
        createTerraformPlan(3),
        createPreGateDecision('REVIEW_REQUIRED', 60),
        createRequester()
      );

      const formatted = gate.formatRequest(request);

      expect(formatted).toContain('HITL APPROVAL REQUEST');
      expect(formatted).toContain(request.id);
      expect(formatted).toContain('PENDING');
      expect(formatted).toContain('Test User');
      expect(formatted).toContain('HIGH'); // Risk level
      expect(formatted).toContain('request_created');
    });

    it('should format resolved request', async () => {
      const request = await gate.createApprovalRequest(
        createTerraformPlan(),
        createPreGateDecision('REVIEW_REQUIRED', 30),
        createRequester()
      );

      const result = await gate.processApproval(
        request.id,
        {
          userId: 'approver-1',
          displayName: 'Approver',
          action: 'approved',
        },
        'approved'
      );

      const formatted = gate.formatRequest(result.request);

      expect(formatted).toContain('RESOLUTION');
      expect(formatted).toContain('Approver');
      expect(formatted).toContain('APPROVED');
    });

    it('should show warnings in formatted output', async () => {
      const decision = createPreGateDecision('REVIEW_REQUIRED');
      const request = await gate.createApprovalRequest(
        createTerraformPlan(),
        decision,
        createRequester()
      );

      const formatted = gate.formatRequest(request);

      expect(formatted).toContain('WARNINGS');
      expect(formatted).toContain('WARN_TEST');
    });
  });

  describe('Slack message building', () => {
    let gate: EnhancedHITLApprovalGate;

    beforeEach(() => {
      gate = new EnhancedHITLApprovalGate(
        createConfig({ notificationChannel: 'slack' })
      );
    });

    it('should build Slack message with header', async () => {
      const request = await gate.createApprovalRequest(
        createTerraformPlan(),
        createPreGateDecision(),
        createRequester()
      );

      // Access the private method through sendNotification
      const httpClient = createMockHttpClient();
      gate = new EnhancedHITLApprovalGate(
        createConfig({
          httpClient,
          notificationChannel: 'slack',
        })
      );

      const newRequest = await gate.createApprovalRequest(
        createTerraformPlan(),
        createPreGateDecision(),
        createRequester()
      );

      await gate.sendNotification(newRequest);

      const callArg = (httpClient.post as ReturnType<typeof vi.fn>).mock
        .calls[0][1];
      expect(callArg.blocks).toBeDefined();
      expect(callArg.blocks[0].type).toBe('header');
    });

    it('should include action buttons in Slack message', async () => {
      const httpClient = createMockHttpClient();
      gate = new EnhancedHITLApprovalGate(
        createConfig({
          httpClient,
          notificationChannel: 'slack',
        })
      );

      const request = await gate.createApprovalRequest(
        createTerraformPlan(),
        createPreGateDecision(),
        createRequester()
      );

      await gate.sendNotification(request);

      const callArg = (httpClient.post as ReturnType<typeof vi.fn>).mock
        .calls[0][1];
      const actionsBlock = callArg.blocks.find(
        (b: any) => b.type === 'actions'
      );
      expect(actionsBlock).toBeDefined();
      expect(actionsBlock.elements).toHaveLength(2);
    });

    it('should show MFA notice when required', async () => {
      const httpClient = createMockHttpClient();
      gate = new EnhancedHITLApprovalGate(
        createConfig({
          httpClient,
          notificationChannel: 'slack',
          alwaysRequireMfa: true,
        })
      );

      const request = await gate.createApprovalRequest(
        createTerraformPlan(),
        createPreGateDecision('REVIEW_REQUIRED', 30),
        createRequester()
      );

      await gate.sendNotification(request);

      const callArg = (httpClient.post as ReturnType<typeof vi.fn>).mock
        .calls[0][1];
      const contextBlock = callArg.blocks.find(
        (b: any) => b.type === 'context'
      );
      expect(contextBlock).toBeDefined();
    });
  });

  describe('Discord message building', () => {
    let gate: EnhancedHITLApprovalGate;

    beforeEach(() => {
      gate = new EnhancedHITLApprovalGate(
        createConfig({ notificationChannel: 'discord' })
      );
    });

    it('should build Discord message with embed', async () => {
      const httpClient = createMockHttpClient();
      (httpClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({
        status: 204,
        data: '',
      });

      gate = new EnhancedHITLApprovalGate(
        createConfig({
          httpClient,
          notificationChannel: 'discord',
        })
      );

      const request = await gate.createApprovalRequest(
        createTerraformPlan(),
        createPreGateDecision(),
        createRequester()
      );

      await gate.sendNotification(request);

      const callArg = (httpClient.post as ReturnType<typeof vi.fn>).mock
        .calls[0][1];
      expect(callArg.embeds).toBeDefined();
      expect(callArg.embeds).toHaveLength(1);
      expect(callArg.embeds[0].title).toContain('Infrastructure Change');
    });

    it('should include action buttons in Discord message', async () => {
      const httpClient = createMockHttpClient();
      (httpClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({
        status: 204,
        data: '',
      });

      gate = new EnhancedHITLApprovalGate(
        createConfig({
          httpClient,
          notificationChannel: 'discord',
        })
      );

      const request = await gate.createApprovalRequest(
        createTerraformPlan(),
        createPreGateDecision(),
        createRequester()
      );

      await gate.sendNotification(request);

      const callArg = (httpClient.post as ReturnType<typeof vi.fn>).mock
        .calls[0][1];
      expect(callArg.components).toBeDefined();
      expect(callArg.components[0].type).toBe(1); // Action Row
      expect(callArg.components[0].components).toHaveLength(2);
    });

    it('should use correct color for risk level', async () => {
      const httpClient = createMockHttpClient();
      (httpClient.post as ReturnType<typeof vi.fn>).mockResolvedValue({
        status: 204,
        data: '',
      });

      // Test critical risk
      gate = new EnhancedHITLApprovalGate(
        createConfig({
          httpClient,
          notificationChannel: 'discord',
        })
      );

      const request = await gate.createApprovalRequest(
        createTerraformPlan(),
        createPreGateDecision('REVIEW_REQUIRED', 90), // Critical
        createRequester()
      );

      await gate.sendNotification(request);

      const callArg = (httpClient.post as ReturnType<typeof vi.fn>).mock
        .calls[0][1];
      expect(callArg.embeds[0].color).toBe(0xff0000); // Red
    });
  });

  describe('sendReminder', () => {
    let gate: EnhancedHITLApprovalGate;
    let httpClient: HttpClient;
    let storage: ReturnType<typeof createMockStorage>;

    beforeEach(() => {
      httpClient = createMockHttpClient();
      storage = createMockStorage();
      gate = new EnhancedHITLApprovalGate(
        createConfig({ httpClient, storage, notificationChannel: 'slack' })
      );
    });

    it('should send reminder for pending request', async () => {
      const request = await gate.createApprovalRequest(
        createTerraformPlan(),
        createPreGateDecision(),
        createRequester()
      );

      // Clear the mock calls from initial notification
      (httpClient.post as ReturnType<typeof vi.fn>).mockClear();

      await gate.sendReminder(request.id);

      expect(httpClient.post).toHaveBeenCalled();
    });

    it('should not send reminder for non-pending request', async () => {
      const request = await gate.createApprovalRequest(
        createTerraformPlan(),
        createPreGateDecision('REVIEW_REQUIRED', 30),
        createRequester()
      );

      await gate.processApproval(
        request.id,
        {
          userId: 'approver',
          displayName: 'Approver',
          action: 'approved',
        },
        'approved'
      );

      (httpClient.post as ReturnType<typeof vi.fn>).mockClear();

      await gate.sendReminder(request.id);

      expect(httpClient.post).not.toHaveBeenCalled();
    });

    it('should add audit trail entry for reminder', async () => {
      const request = await gate.createApprovalRequest(
        createTerraformPlan(),
        createPreGateDecision(),
        createRequester()
      );

      await gate.sendReminder(request.id);

      const updated = await gate.getRequest(request.id);
      const reminderEntry = updated!.auditTrail.find(
        (e) => e.action === 'reminder_sent'
      );
      expect(reminderEntry).toBeDefined();
    });
  });

  describe('edge cases', () => {
    it('should handle Terraform plan with no resource changes', async () => {
      const gate = new EnhancedHITLApprovalGate(createConfig());
      const plan: TerraformPlan = {
        format_version: '1.0',
        terraform_version: '1.5.0',
        resource_changes: [],
      };

      const request = await gate.createApprovalRequest(
        plan,
        createPreGateDecision(),
        createRequester()
      );

      expect(request.terraformPlan.resource_changes).toHaveLength(0);
    });

    it('should handle large number of resource changes', async () => {
      const gate = new EnhancedHITLApprovalGate(createConfig());
      const plan = createTerraformPlan(100);

      const request = await gate.createApprovalRequest(
        plan,
        createPreGateDecision(),
        createRequester()
      );

      const formatted = gate.formatRequest(request);
      expect(formatted).toContain('and 90 more'); // 10 shown, 90 remaining
    });

    it('should handle expired request during approval', async () => {
      const storage = createMockStorage();
      const gate = new EnhancedHITLApprovalGate(
        createConfig({ storage, approvalTimeoutMs: 1 }) // 1ms timeout
      );

      const request = await gate.createApprovalRequest(
        createTerraformPlan(),
        createPreGateDecision(),
        createRequester()
      );

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 10));

      await expect(
        gate.processApproval(
          request.id,
          {
            userId: 'approver',
            displayName: 'Approver',
            action: 'approved',
          },
          'approved'
        )
      ).rejects.toThrow('expired');
    });
  });

  describe('security features', () => {
    // MED-002: Reason sanitization tests
    it('should sanitize XSS payload in resolver reason', async () => {
      const storage = createMockStorage();
      const gate = new EnhancedHITLApprovalGate(createConfig({ storage }));

      const request = await gate.createApprovalRequest(
        createTerraformPlan(),
        createPreGateDecision(),
        createRequester()
      );

      await gate.sendNotification(request);

      const xssPayload = '<script>alert("xss")</script>';
      await gate.processApproval(
        request.id,
        {
          userId: 'rejector',
          displayName: 'Rejector',
          action: 'rejected',
          reason: xssPayload,
        },
        'rejected'
      );

      const updatedRequest = await storage.get(request.id);
      expect(updatedRequest?.resolver?.reason).not.toContain('<script>');
      expect(updatedRequest?.resolver?.reason).toContain('&lt;script&gt;');
    });

    it('should truncate long resolver reasons', async () => {
      const storage = createMockStorage();
      const gate = new EnhancedHITLApprovalGate(createConfig({ storage }));

      const request = await gate.createApprovalRequest(
        createTerraformPlan(),
        createPreGateDecision(),
        createRequester()
      );

      await gate.sendNotification(request);

      const longReason = 'a'.repeat(1000);
      await gate.processApproval(
        request.id,
        {
          userId: 'rejector',
          displayName: 'Rejector',
          action: 'rejected',
          reason: longReason,
        },
        'rejected'
      );

      const updatedRequest = await storage.get(request.id);
      expect(updatedRequest?.resolver?.reason?.length).toBeLessThanOrEqual(500);
    });

    it('should remove control characters from reason', async () => {
      const storage = createMockStorage();
      const gate = new EnhancedHITLApprovalGate(createConfig({ storage }));

      const request = await gate.createApprovalRequest(
        createTerraformPlan(),
        createPreGateDecision(),
        createRequester()
      );

      await gate.sendNotification(request);

      const logInjection = 'Line1\nFAKE_LOG_ENTRY\n\tTab';
      await gate.processApproval(
        request.id,
        {
          userId: 'rejector',
          displayName: 'Rejector',
          action: 'rejected',
          reason: logInjection,
        },
        'rejected'
      );

      const updatedRequest = await storage.get(request.id);
      expect(updatedRequest?.resolver?.reason).not.toContain('\n');
      expect(updatedRequest?.resolver?.reason).not.toContain('\t');
    });

    // MED-004: Audit trail signature tests
    it('should add signature to audit trail entries', async () => {
      const storage = createMockStorage();
      const gate = new EnhancedHITLApprovalGate(createConfig({ storage }));

      const request = await gate.createApprovalRequest(
        createTerraformPlan(),
        createPreGateDecision(),
        createRequester()
      );

      expect(request.auditTrail[0].signature).toBeDefined();
      expect(request.auditTrail[0].signature).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex
    });

    it('should verify valid audit trail', async () => {
      const storage = createMockStorage();
      const gate = new EnhancedHITLApprovalGate(createConfig({ storage }));

      const request = await gate.createApprovalRequest(
        createTerraformPlan(),
        createPreGateDecision(),
        createRequester()
      );

      const isValid = gate.verifyAuditTrail(request);
      expect(isValid).toBe(true);
    });

    it('should detect tampered audit trail', async () => {
      const storage = createMockStorage();
      const gate = new EnhancedHITLApprovalGate(createConfig({ storage }));

      const request = await gate.createApprovalRequest(
        createTerraformPlan(),
        createPreGateDecision(),
        createRequester()
      );

      // Tamper with the audit trail
      request.auditTrail[0].actor = 'attacker';

      const isValid = gate.verifyAuditTrail(request);
      expect(isValid).toBe(false);
    });

    // MED-003: Webhook response validation tests
    it('should reject Slack response without ok', async () => {
      const httpClient: HttpClient = {
        post: vi.fn().mockResolvedValue({ status: 200, data: 'not_ok' }),
      };
      const gate = new EnhancedHITLApprovalGate(
        createConfig({
          httpClient,
          notificationChannel: 'slack',
        })
      );

      const request = await gate.createApprovalRequest(
        createTerraformPlan(),
        createPreGateDecision(),
        createRequester()
      );

      await expect(gate.sendNotification(request)).rejects.toThrow(
        'unexpected response'
      );
    });

    it('should reject Discord response without message ID', async () => {
      const httpClient: HttpClient = {
        post: vi.fn().mockResolvedValue({ status: 200, data: {} }),
      };
      const gate = new EnhancedHITLApprovalGate(
        createConfig({
          httpClient,
          notificationChannel: 'discord',
          slackWebhookUrl: undefined,
        })
      );

      const request = await gate.createApprovalRequest(
        createTerraformPlan(),
        createPreGateDecision(),
        createRequester()
      );

      await expect(gate.sendNotification(request)).rejects.toThrow(
        'message ID'
      );
    });
  });
});
