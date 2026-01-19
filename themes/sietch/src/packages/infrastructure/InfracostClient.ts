/**
 * Infracost API Client
 *
 * Integrates with Infracost API to estimate infrastructure costs from Terraform plans.
 * https://www.infracost.io/docs/features/cli_commands/#breakdown
 */

import axios from 'axios';
import type { AxiosInstance } from 'axios';
import type { TerraformPlan, InfracostEstimate, InfracostResource } from './types.js';

/**
 * Client for interacting with Infracost API
 */
export class InfracostClient {
  private client: AxiosInstance;
  private apiKey: string;

  constructor(apiKey: string, baseUrl: string = 'https://pricing.api.infracost.io') {
    this.apiKey = apiKey;
    this.client = axios.create({
      baseURL: baseUrl,
      headers: {
        'X-Api-Key': apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 30000, // 30 second timeout
    });
  }

  /**
   * Estimate infrastructure costs from Terraform plan JSON
   *
   * @param terraformPlan - Terraform plan JSON output
   * @returns Cost estimate with monthly differential
   * @throws Error if API call fails
   */
  async estimateCosts(terraformPlan: TerraformPlan): Promise<InfracostEstimate> {
    try {
      // Infracost requires Terraform plan JSON to be sent in a specific format
      // We use the GraphQL API for breakdown estimates
      const response = await this.client.post('/graphql', {
        query: `
          query($path: String!) {
            costEstimate(path: $path) {
              totalMonthlyCost
              totalMonthlyCostBefore
              projects {
                breakdown {
                  resources {
                    name
                    resourceType
                    monthlyCost
                    costComponents {
                      name
                      unit
                      monthlyCost
                    }
                  }
                }
              }
            }
          }
        `,
        variables: {
          // In real implementation, we'd upload the plan JSON and get a path
          // For now, we'll use a mock implementation
          path: 'terraform.plan.json',
        },
      });

      const data = response.data.data.costEstimate;

      // Transform GraphQL response to our interface
      const resources: InfracostResource[] = [];
      for (const project of data.projects || []) {
        for (const resource of project.breakdown?.resources || []) {
          resources.push({
            name: resource.name,
            resourceType: resource.resourceType,
            monthlyCost: parseFloat(resource.monthlyCost) || 0,
            costComponents: (resource.costComponents || []).map((c: any) => ({
              name: c.name,
              unit: c.unit,
              monthlyCost: parseFloat(c.monthlyCost) || 0,
            })),
          });
        }
      }

      const totalMonthlyCostBefore = parseFloat(data.totalMonthlyCostBefore) || 0;
      const totalMonthlyCost = parseFloat(data.totalMonthlyCost) || 0;

      return {
        totalMonthlyCostDiff: totalMonthlyCost - totalMonthlyCostBefore,
        currency: 'USD',
        resources,
        summary: {
          totalMonthlyCost,
          totalMonthlyCostBefore,
        },
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(
          `Infracost API error: ${error.response?.status} - ${error.response?.data?.message || error.message}`
        );
      }
      throw error;
    }
  }

  /**
   * Estimate costs using simplified local calculation (fallback)
   *
   * This is a simplified cost estimator that doesn't require Infracost API.
   * It provides rough estimates based on resource types.
   *
   * @param terraformPlan - Terraform plan JSON
   * @returns Simplified cost estimate
   */
  estimateCostsLocally(terraformPlan: TerraformPlan): InfracostEstimate {
    const resources: InfracostResource[] = [];
    let totalMonthlyCost = 0;
    let totalMonthlyCostBefore = 0;

    // Simple cost heuristics (very rough estimates)
    const costMap: Record<string, number> = {
      // AWS resources (monthly USD)
      'aws_db_instance': 100, // RDS instance
      'aws_instance': 50, // EC2 instance
      'aws_eks_cluster': 72, // EKS cluster ($0.10/hr)
      'aws_s3_bucket': 5, // S3 storage (minimal)
      'aws_elasticache_cluster': 50, // Redis/Memcached
      'aws_rds_cluster': 200, // Aurora cluster
      'aws_nat_gateway': 32, // NAT Gateway
      'aws_lb': 20, // Load Balancer
      'aws_ebs_volume': 10, // EBS volume (100GB)
      'kubernetes_persistent_volume_claim': 10, // PVC storage
      'kubernetes_namespace': 0, // Free
      'kubernetes_service': 0, // Free (unless LoadBalancer)
    };

    for (const change of terraformPlan.resource_changes || []) {
      const baseCost = costMap[change.type] || 0;
      const actions = change.change.actions;

      // Determine before and after costs based on action type
      let beforeCost = 0;
      let afterCost = 0;

      if (actions.includes('create') && !actions.includes('delete')) {
        // New resource: before=0, after=cost
        beforeCost = 0;
        afterCost = baseCost;
      } else if (actions.includes('delete') && !actions.includes('create')) {
        // Deleted resource: before=cost, after=0
        beforeCost = baseCost;
        afterCost = 0;
      } else if (actions.includes('update')) {
        // Updated resource: assume same cost (no change)
        beforeCost = baseCost;
        afterCost = baseCost;
      } else if (actions.includes('delete') && actions.includes('create')) {
        // Replace: before=cost, after=cost (resource recreated)
        beforeCost = baseCost;
        afterCost = baseCost;
      }
      // no-op and read: no cost impact

      // Only track resources with cost impact
      if (afterCost > 0) {
        resources.push({
          name: change.address,
          resourceType: change.type,
          monthlyCost: afterCost,
          costComponents: [
            {
              name: 'Base cost',
              unit: 'per month',
              monthlyCost: afterCost,
            },
          ],
        });
      }

      totalMonthlyCost += afterCost;
      totalMonthlyCostBefore += beforeCost;
    }

    return {
      totalMonthlyCostDiff: totalMonthlyCost - totalMonthlyCostBefore,
      currency: 'USD',
      resources,
      summary: {
        totalMonthlyCost,
        totalMonthlyCostBefore,
      },
    };
  }

  /**
   * Check if cost differential exceeds threshold
   *
   * @param estimate - Cost estimate
   * @param thresholdUsd - Maximum allowed monthly cost increase (USD)
   * @returns True if threshold exceeded
   */
  exceedsThreshold(estimate: InfracostEstimate, thresholdUsd: number): boolean {
    return estimate.totalMonthlyCostDiff > thresholdUsd;
  }

  /**
   * Get human-readable cost summary
   *
   * @param estimate - Cost estimate
   * @returns Formatted summary string
   */
  formatCostSummary(estimate: InfracostEstimate): string {
    const diff = estimate.totalMonthlyCostDiff;
    const sign = diff > 0 ? '+' : '';
    const diffStr = `${sign}$${diff.toFixed(2)}`;

    const lines = [
      `Cost Impact: ${diffStr} per month`,
      `Before: $${estimate.summary.totalMonthlyCostBefore.toFixed(2)}/mo`,
      `After: $${estimate.summary.totalMonthlyCost.toFixed(2)}/mo`,
      '',
      'Top Resources:',
    ];

    // Show top 5 most expensive resources
    const topResources = estimate.resources
      .sort((a, b) => b.monthlyCost - a.monthlyCost)
      .slice(0, 5);

    for (const resource of topResources) {
      lines.push(`  • ${resource.name}: $${resource.monthlyCost.toFixed(2)}/mo`);
    }

    return lines.join('\n');
  }
}
