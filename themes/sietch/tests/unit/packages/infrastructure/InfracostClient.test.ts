/**
 * Unit tests for InfracostClient
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InfracostClient } from '../../../../src/packages/infrastructure/InfracostClient.js';
import type { TerraformPlan } from '../../../../src/packages/infrastructure/types.js';
import axios from 'axios';

// Mock axios
vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

describe('InfracostClient', () => {
  let client: InfracostClient;
  const mockApiKey = 'test-api-key-123';

  beforeEach(() => {
    vi.clearAllMocks();
    client = new InfracostClient(mockApiKey);
  });

  describe('constructor', () => {
    it('should initialize with API key', () => {
      expect(client).toBeDefined();
    });

    it('should accept custom base URL', () => {
      const customClient = new InfracostClient(mockApiKey, 'https://custom.infracost.io');
      expect(customClient).toBeDefined();
    });
  });

  describe('estimateCostsLocally', () => {
    it('should estimate costs for database creation', () => {
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
              after: { engine: 'postgres' },
            },
          },
        ],
      };

      const estimate = client.estimateCostsLocally(plan);

      expect(estimate.resources).toHaveLength(1);
      expect(estimate.resources[0].resourceType).toBe('aws_db_instance');
      expect(estimate.resources[0].monthlyCost).toBe(100);
      expect(estimate.totalMonthlyCostDiff).toBeGreaterThan(0);
    });

    it('should estimate costs for multiple resources', () => {
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
          {
            address: 'aws_instance.web',
            mode: 'managed',
            type: 'aws_instance',
            name: 'web',
            provider_name: 'aws',
            change: {
              actions: ['create'],
              before: null,
              after: {},
            },
          },
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

      const estimate = client.estimateCostsLocally(plan);

      expect(estimate.resources).toHaveLength(3);
      expect(estimate.summary.totalMonthlyCost).toBe(155); // 100 + 50 + 5
    });

    it('should calculate negative cost for deleted resources', () => {
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

      const estimate = client.estimateCostsLocally(plan);

      // Deleted resources: before=$100, after=$0, diff=-$100 (cost savings)
      expect(estimate.resources).toHaveLength(0); // No after-cost resources
      expect(estimate.summary.totalMonthlyCost).toBe(0);
      expect(estimate.summary.totalMonthlyCostBefore).toBe(100); // Had a database
      expect(estimate.totalMonthlyCostDiff).toBe(-100); // Saving $100/mo
    });

    it('should handle unknown resource types with default cost', () => {
      const plan: TerraformPlan = {
        format_version: '1.0',
        terraform_version: '1.5.0',
        resource_changes: [
          {
            address: 'unknown_provider.resource',
            mode: 'managed',
            type: 'unknown_provider_type',
            name: 'resource',
            provider_name: 'unknown',
            change: {
              actions: ['create'],
              before: null,
              after: {},
            },
          },
        ],
      };

      const estimate = client.estimateCostsLocally(plan);

      // Unknown resources default to $0 cost and are not tracked in resources array
      // This is correct - we don't need to track zero-cost resources
      expect(estimate.resources).toHaveLength(0);
      expect(estimate.totalMonthlyCostDiff).toBe(0);
      expect(estimate.summary.totalMonthlyCost).toBe(0);
    });

    it('should handle EKS cluster costs', () => {
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
              actions: ['create'],
              before: null,
              after: {},
            },
          },
        ],
      };

      const estimate = client.estimateCostsLocally(plan);

      expect(estimate.resources[0].monthlyCost).toBe(72); // $0.10/hr * 720hr/mo
    });
  });

  describe('exceedsThreshold', () => {
    it('should return true if cost exceeds threshold', () => {
      const estimate = {
        totalMonthlyCostDiff: 6000,
        currency: 'USD',
        resources: [],
        summary: {
          totalMonthlyCost: 6000,
          totalMonthlyCostBefore: 0,
        },
      };

      expect(client.exceedsThreshold(estimate, 5000)).toBe(true);
    });

    it('should return false if cost is below threshold', () => {
      const estimate = {
        totalMonthlyCostDiff: 3000,
        currency: 'USD',
        resources: [],
        summary: {
          totalMonthlyCost: 3000,
          totalMonthlyCostBefore: 0,
        },
      };

      expect(client.exceedsThreshold(estimate, 5000)).toBe(false);
    });

    it('should return false if cost equals threshold', () => {
      const estimate = {
        totalMonthlyCostDiff: 5000,
        currency: 'USD',
        resources: [],
        summary: {
          totalMonthlyCost: 5000,
          totalMonthlyCostBefore: 0,
        },
      };

      expect(client.exceedsThreshold(estimate, 5000)).toBe(false);
    });

    it('should handle negative cost differential', () => {
      const estimate = {
        totalMonthlyCostDiff: -1000, // Cost reduction
        currency: 'USD',
        resources: [],
        summary: {
          totalMonthlyCost: 4000,
          totalMonthlyCostBefore: 5000,
        },
      };

      expect(client.exceedsThreshold(estimate, 5000)).toBe(false);
    });
  });

  describe('formatCostSummary', () => {
    it('should format cost increase summary', () => {
      const estimate = {
        totalMonthlyCostDiff: 150.5,
        currency: 'USD',
        resources: [
          {
            name: 'aws_db_instance.main',
            resourceType: 'aws_db_instance',
            monthlyCost: 100,
            costComponents: [],
          },
          {
            name: 'aws_instance.web',
            resourceType: 'aws_instance',
            monthlyCost: 50,
            costComponents: [],
          },
        ],
        summary: {
          totalMonthlyCost: 300.5,
          totalMonthlyCostBefore: 150,
        },
      };

      const summary = client.formatCostSummary(estimate);

      expect(summary).toContain('+$150.50');
      expect(summary).toContain('Before: $150.00/mo');
      expect(summary).toContain('After: $300.50/mo');
      expect(summary).toContain('Top Resources:');
      expect(summary).toContain('aws_db_instance.main: $100.00/mo');
    });

    it('should format cost decrease summary', () => {
      const estimate = {
        totalMonthlyCostDiff: -50,
        currency: 'USD',
        resources: [],
        summary: {
          totalMonthlyCost: 100,
          totalMonthlyCostBefore: 150,
        },
      };

      const summary = client.formatCostSummary(estimate);

      // Format is "$-50.00" not "-$50.00" (sign is inside the dollar amount)
      expect(summary).toContain('$-50.00');
    });

    it('should show top 5 resources', () => {
      const estimate = {
        totalMonthlyCostDiff: 600,
        currency: 'USD',
        resources: [
          { name: 'resource1', resourceType: 'type1', monthlyCost: 100, costComponents: [] },
          { name: 'resource2', resourceType: 'type2', monthlyCost: 200, costComponents: [] },
          { name: 'resource3', resourceType: 'type3', monthlyCost: 50, costComponents: [] },
          { name: 'resource4', resourceType: 'type4', monthlyCost: 150, costComponents: [] },
          { name: 'resource5', resourceType: 'type5', monthlyCost: 75, costComponents: [] },
          { name: 'resource6', resourceType: 'type6', monthlyCost: 25, costComponents: [] },
        ],
        summary: {
          totalMonthlyCost: 600,
          totalMonthlyCostBefore: 0,
        },
      };

      const summary = client.formatCostSummary(estimate);

      // Should show top 5 (sorted by cost)
      expect(summary).toContain('resource2'); // $200
      expect(summary).toContain('resource4'); // $150
      expect(summary).toContain('resource1'); // $100
      expect(summary).toContain('resource5'); // $75
      expect(summary).toContain('resource3'); // $50
      expect(summary).not.toContain('resource6'); // $25 - excluded
    });
  });
});
