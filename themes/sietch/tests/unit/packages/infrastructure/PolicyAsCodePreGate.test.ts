/**
 * Unit tests for PolicyAsCodePreGate
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PolicyAsCodePreGate } from '../../../../src/packages/infrastructure/PolicyAsCodePreGate.js';
import type {
  TerraformPlan,
  PreGateConfig,
} from '../../../../src/packages/infrastructure/types.js';
import { promises as fs } from 'fs';
import path from 'path';

// Mock fs for policy file reading
vi.mock('fs', () => ({
  promises: {
    readFile: vi.fn(),
  },
}));

const mockedFs = vi.mocked(fs);

describe('PolicyAsCodePreGate', () => {
  let preGate: PolicyAsCodePreGate;
  let config: PreGateConfig;
  const mockPolicyContent = `
    package terraform.arrakis
    default allow := false
    allow if { count(hard_blocks) == 0 }
  `;

  beforeEach(async () => {
    vi.clearAllMocks();

    config = {
      policyPath: '/path/to/arrakis-terraform.rego',
      budgetThresholdUsd: 5000,
      riskScoreThreshold: 70,
      evaluationTimeoutMs: 10000,
    };

    mockedFs.readFile.mockResolvedValue(mockPolicyContent);

    preGate = new PolicyAsCodePreGate(config);
    await preGate.initialize();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initialization', () => {
    it('should initialize successfully with valid config', async () => {
      expect(preGate).toBeDefined();
    });

    it('should load policy file during initialization', async () => {
      expect(mockedFs.readFile).toHaveBeenCalledWith(config.policyPath, 'utf-8');
    });

    it('should throw error if policy file cannot be read', async () => {
      mockedFs.readFile.mockRejectedValueOnce(new Error('File not found'));

      const newPreGate = new PolicyAsCodePreGate(config);

      await expect(newPreGate.initialize()).rejects.toThrow('Failed to load OPA policy');
    });
  });

  describe('evaluate - APPROVE verdict', () => {
    it('should approve safe S3 bucket creation', async () => {
      const plan: TerraformPlan = {
        format_version: '1.0',
        terraform_version: '1.5.0',
        resource_changes: [
          {
            address: 'aws_s3_bucket.assets',
            mode: 'managed',
            type: 'aws_s3_bucket',
            name: 'assets',
            provider_name: 'aws',
            change: {
              actions: ['create'],
              before: null,
              after: { bucket: 'my-assets' },
            },
          },
        ],
      };

      const decision = await preGate.evaluate(plan);

      expect(decision.verdict).toBe('APPROVE');
      expect(decision.policyEvaluation.allowed).toBe(true);
      expect(decision.policyEvaluation.hardBlocks).toHaveLength(0);
      expect(decision.riskScore.level).toBe('low');
    });

    it('should approve ConfigMap creation', async () => {
      const plan: TerraformPlan = {
        format_version: '1.0',
        terraform_version: '1.5.0',
        resource_changes: [
          {
            address: 'kubernetes_config_map.app',
            mode: 'managed',
            type: 'kubernetes_config_map',
            name: 'app',
            provider_name: 'kubernetes',
            change: {
              actions: ['create'],
              before: null,
              after: { data: {} },
            },
          },
        ],
      };

      const decision = await preGate.evaluate(plan);

      expect(decision.verdict).toBe('APPROVE');
      expect(decision.policyEvaluation.hardBlocks).toHaveLength(0);
    });
  });

  describe('evaluate - REJECT verdict (hard blocks)', () => {
    it('should reject PersistentVolume deletion', async () => {
      const plan: TerraformPlan = {
        format_version: '1.0',
        terraform_version: '1.5.0',
        resource_changes: [
          {
            address: 'kubernetes_persistent_volume.data',
            mode: 'managed',
            type: 'kubernetes_persistent_volume',
            name: 'data',
            provider_name: 'kubernetes',
            change: {
              actions: ['delete'],
              before: { spec: {} },
              after: null,
            },
          },
        ],
      };

      const decision = await preGate.evaluate(plan);

      expect(decision.verdict).toBe('REJECT');
      expect(decision.policyEvaluation.allowed).toBe(false);
      expect(decision.policyEvaluation.hardBlocks).toHaveLength(1);
      expect(decision.policyEvaluation.hardBlocks[0].code).toBe('HARD_BLOCK_DELETE_PV');
      expect(decision.policyEvaluation.hardBlocks[0].canOverride).toBe(false);
      expect(decision.reason).toContain('HARD_BLOCK_DELETE_PV');
    });

    it('should reject database deletion', async () => {
      const plan: TerraformPlan = {
        format_version: '1.0',
        terraform_version: '1.5.0',
        resource_changes: [
          {
            address: 'aws_db_instance.main',
            mode: 'managed',
            type: 'aws_db_instance',
            name: 'main',
            provider_name: 'aws',
            change: {
              actions: ['delete'],
              before: { engine: 'postgres' },
              after: null,
            },
          },
        ],
      };

      const decision = await preGate.evaluate(plan);

      expect(decision.verdict).toBe('REJECT');
      expect(decision.policyEvaluation.hardBlocks).toHaveLength(1);
      expect(decision.policyEvaluation.hardBlocks[0].code).toBe('HARD_BLOCK_DELETE_DATABASE');
    });

    it('should reject RDS cluster deletion', async () => {
      const plan: TerraformPlan = {
        format_version: '1.0',
        terraform_version: '1.5.0',
        resource_changes: [
          {
            address: 'aws_rds_cluster.main',
            mode: 'managed',
            type: 'aws_rds_cluster',
            name: 'main',
            provider_name: 'aws',
            change: {
              actions: ['delete'],
              before: { engine: 'aurora-postgresql' },
              after: null,
            },
          },
        ],
      };

      const decision = await preGate.evaluate(plan);

      expect(decision.verdict).toBe('REJECT');
      expect(decision.policyEvaluation.hardBlocks[0].code).toBe('HARD_BLOCK_DELETE_DATABASE');
    });

    it('should reject disabling RLS', async () => {
      const plan: TerraformPlan = {
        format_version: '1.0',
        terraform_version: '1.5.0',
        resource_changes: [
          {
            address: 'postgresql_table.users',
            mode: 'managed',
            type: 'postgresql_table',
            name: 'users',
            provider_name: 'postgresql',
            change: {
              actions: ['update'],
              before: { row_security_enabled: true },
              after: { row_security_enabled: false },
            },
          },
        ],
      };

      const decision = await preGate.evaluate(plan);

      expect(decision.verdict).toBe('REJECT');
      expect(decision.policyEvaluation.hardBlocks[0].code).toBe('HARD_BLOCK_DISABLE_RLS');
      expect(decision.policyEvaluation.hardBlocks[0].details?.reason).toContain(
        'multi-tenant data isolation'
      );
    });

    it('should reject production namespace deletion', async () => {
      const plan: TerraformPlan = {
        format_version: '1.0',
        terraform_version: '1.5.0',
        resource_changes: [
          {
            address: 'kubernetes_namespace.production',
            mode: 'managed',
            type: 'kubernetes_namespace',
            name: 'production',
            provider_name: 'kubernetes',
            change: {
              actions: ['delete'],
              before: { metadata: [{ name: 'production' }] },
              after: null,
            },
          },
        ],
      };

      const decision = await preGate.evaluate(plan);

      expect(decision.verdict).toBe('REJECT');
      expect(decision.policyEvaluation.hardBlocks[0].code).toBe(
        'HARD_BLOCK_DELETE_PROD_NAMESPACE'
      );
    });
  });

  describe('evaluate - REJECT verdict (budget)', () => {
    it('should reject if cost exceeds budget threshold', async () => {
      const configWithInfracost: PreGateConfig = {
        ...config,
        infracostApiKey: 'test-key',
        // Set a lower threshold for testing
        budgetThresholdUsd: 500,
      };

      const preGateWithCost = new PolicyAsCodePreGate(configWithInfracost);
      await preGateWithCost.initialize();

      // Create plan with high-cost resources
      // With fixed estimator: creates have before=0, after=cost
      // 6 databases * $100/ea = $600 diff (exceeds $500 threshold)
      const plan: TerraformPlan = {
        format_version: '1.0',
        terraform_version: '1.5.0',
        resource_changes: Array.from({ length: 6 }, (_, i) => ({
          address: `aws_db_instance.db${i}`,
          mode: 'managed' as const,
          type: 'aws_db_instance',
          name: `db${i}`,
          provider_name: 'aws',
          change: {
            actions: ['create' as const],
            before: null,
            after: {},
          },
        })),
      };

      const decision = await preGateWithCost.evaluate(plan);

      // 6 databases * $100/mo = $600 diff (before=0, after=$600)
      // $600 > $500 threshold = should reject
      expect(decision.verdict).toBe('REJECT');
      expect(decision.reason).toContain('Budget threshold exceeded');
      expect(decision.costEstimate?.totalMonthlyCostDiff).toBeGreaterThan(500);
    });
  });

  describe('evaluate - REVIEW_REQUIRED verdict', () => {
    it('should require review for high-risk resource updates', async () => {
      const plan: TerraformPlan = {
        format_version: '1.0',
        terraform_version: '1.5.0',
        resource_changes: [
          {
            address: 'aws_eks_cluster.main',
            mode: 'managed',
            type: 'aws_eks_cluster',
            name: 'main',
            provider_name: 'aws',
            change: {
              actions: ['update'],
              before: { version: '1.27' },
              after: { version: '1.28' },
            },
          },
        ],
      };

      const decision = await preGate.evaluate(plan);

      expect(decision.verdict).toBe('REVIEW_REQUIRED');
      expect(decision.policyEvaluation.warnings).toHaveLength(1);
      expect(decision.policyEvaluation.warnings[0].code).toBe('WARN_HIGH_RISK_UPDATE');
    });

    it('should require review for large blast radius', async () => {
      const changes = Array.from({ length: 15 }, (_, i) => ({
        address: `aws_instance.web${i}`,
        mode: 'managed' as const,
        type: 'aws_instance',
        name: `web${i}`,
        provider_name: 'aws',
        change: {
          actions: ['create' as const],
          before: null,
          after: {},
        },
      }));

      const plan: TerraformPlan = {
        format_version: '1.0',
        terraform_version: '1.5.0',
        resource_changes: changes,
      };

      const decision = await preGate.evaluate(plan);

      expect(decision.verdict).toBe('REVIEW_REQUIRED');
      expect(decision.policyEvaluation.warnings.some((w) => w.code === 'WARN_LARGE_BLAST_RADIUS')).toBe(true);
      expect(decision.riskScore.factors.blastRadiusRisk).toBeGreaterThan(40);
    });

    it('should require review for resource replacement', async () => {
      const plan: TerraformPlan = {
        format_version: '1.0',
        terraform_version: '1.5.0',
        resource_changes: [
          {
            address: 'aws_instance.web',
            mode: 'managed',
            type: 'aws_instance',
            name: 'web',
            provider_name: 'aws',
            change: {
              actions: ['delete', 'create'],
              before: { instance_type: 't2.micro' },
              after: { instance_type: 't2.small' },
            },
          },
        ],
      };

      const decision = await preGate.evaluate(plan);

      expect(decision.verdict).toBe('REVIEW_REQUIRED');
      expect(decision.policyEvaluation.warnings.some((w) => w.code === 'WARN_RESOURCE_REPLACEMENT')).toBe(true);
    });

    it('should require review for high risk score', async () => {
      const plan: TerraformPlan = {
        format_version: '1.0',
        terraform_version: '1.5.0',
        resource_changes: [
          {
            address: 'aws_iam_policy.admin',
            mode: 'managed',
            type: 'aws_iam_policy',
            name: 'admin',
            provider_name: 'aws',
            change: {
              actions: ['update'],
              before: { policy: '{}' },
              after: { policy: '{"Statement":[{"Effect":"Allow","Action":"*"}]}' },
            },
          },
        ],
      };

      const decision = await preGate.evaluate(plan);

      expect(decision.verdict).toBe('REVIEW_REQUIRED');
      expect(decision.riskScore.score).toBeGreaterThan(40);
    });
  });

  describe('formatDecision', () => {
    it('should format APPROVE decision', async () => {
      const plan: TerraformPlan = {
        format_version: '1.0',
        terraform_version: '1.5.0',
        resource_changes: [
          {
            address: 'aws_s3_bucket.assets',
            mode: 'managed',
            type: 'aws_s3_bucket',
            name: 'assets',
            provider_name: 'aws',
            change: {
              actions: ['create'],
              before: null,
              after: {},
            },
          },
        ],
      };

      const decision = await preGate.evaluate(plan);
      const formatted = preGate.formatDecision(decision);

      expect(formatted).toContain('POLICY-AS-CODE PRE-GATE DECISION');
      expect(formatted).toContain('Verdict: APPROVE');
      expect(formatted).toContain('RISK ASSESSMENT');
      expect(formatted).toContain('RECOMMENDATIONS');
    });

    it('should format REJECT decision with violations', async () => {
      const plan: TerraformPlan = {
        format_version: '1.0',
        terraform_version: '1.5.0',
        resource_changes: [
          {
            address: 'aws_db_instance.main',
            mode: 'managed',
            type: 'aws_db_instance',
            name: 'main',
            provider_name: 'aws',
            change: {
              actions: ['delete'],
              before: {},
              after: null,
            },
          },
        ],
      };

      const decision = await preGate.evaluate(plan);
      const formatted = preGate.formatDecision(decision);

      expect(formatted).toContain('Verdict: REJECT');
      expect(formatted).toContain('HARD BLOCKS');
      expect(formatted).toContain('HARD_BLOCK_DELETE_DATABASE');
      expect(formatted).toContain('aws_db_instance.main');
    });

    it('should show cost estimate in formatted output', async () => {
      const configWithCost: PreGateConfig = {
        ...config,
        infracostApiKey: 'test-key',
      };

      const preGateWithCost = new PolicyAsCodePreGate(configWithCost);
      await preGateWithCost.initialize();

      const plan: TerraformPlan = {
        format_version: '1.0',
        terraform_version: '1.5.0',
        resource_changes: [
          {
            address: 'aws_db_instance.main',
            mode: 'managed',
            type: 'aws_db_instance',
            name: 'main',
            provider_name: 'aws',
            change: {
              actions: ['create'],
              before: null,
              after: {},
            },
          },
        ],
      };

      const decision = await preGateWithCost.evaluate(plan);
      const formatted = preGateWithCost.formatDecision(decision);

      expect(formatted).toContain('COST IMPACT');
      expect(formatted).toContain('Monthly Differential');
    });
  });

  describe('performance', () => {
    it('should complete evaluation within timeout', async () => {
      const plan: TerraformPlan = {
        format_version: '1.0',
        terraform_version: '1.5.0',
        resource_changes: Array.from({ length: 100 }, (_, i) => ({
          address: `aws_instance.web${i}`,
          mode: 'managed' as const,
          type: 'aws_instance',
          name: `web${i}`,
          provider_name: 'aws',
          change: {
            actions: ['create' as const],
            before: null,
            after: {},
          },
        })),
      };

      const startTime = Date.now();
      const decision = await preGate.evaluate(plan);
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(config.evaluationTimeoutMs);
      expect(decision.policyEvaluation.metadata.evaluationTimeMs).toBeLessThan(10000);
    });
  });
});
