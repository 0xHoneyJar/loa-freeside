/**
 * Risk Scoring System for Infrastructure Changes
 *
 * Calculates a risk score (0-100) based on multiple factors:
 * - Resource type (database > compute > storage)
 * - Operation type (delete > update > create)
 * - Cost impact (higher cost = higher risk)
 * - Blast radius (number of resources affected)
 */

import type { TerraformPlan, TerraformResourceChange, RiskScore, InfracostEstimate } from './types.js';

/**
 * Risk weights for different factors (sum to 1.0)
 */
const RISK_WEIGHTS = {
  resourceType: 0.35,
  operationType: 0.30,
  costImpact: 0.20,
  blastRadius: 0.15,
} as const;

/**
 * Resource type risk scores (0-100)
 * Higher scores = more risky
 */
const RESOURCE_TYPE_RISK: Record<string, number> = {
  // Critical infrastructure (90-100)
  'aws_db_instance': 95,
  'aws_rds_cluster': 95,
  'aws_rds_cluster_instance': 95,
  'postgresql_database': 100,
  'kubernetes_persistent_volume': 100,
  'kubernetes_persistent_volume_claim': 90,

  // Security-sensitive (70-90)
  'aws_iam_role': 85,
  'aws_iam_policy': 85,
  'kubernetes_role': 80,
  'kubernetes_role_binding': 80,
  'vault_policy': 90,

  // Production services (60-80)
  'aws_eks_cluster': 80,
  'aws_instance': 70,
  'kubernetes_namespace': 75,
  'kubernetes_deployment': 65,
  'kubernetes_service': 60,

  // Networking (50-70)
  'aws_vpc': 70,
  'aws_subnet': 65,
  'aws_security_group': 60,
  'aws_nat_gateway': 55,
  'aws_lb': 60,

  // Low-risk (0-50)
  'aws_s3_bucket': 40,
  'kubernetes_config_map': 30,
  'kubernetes_secret': 50,
  'aws_cloudwatch_log_group': 20,
};

/**
 * Operation type risk scores (0-100)
 */
const OPERATION_RISK: Record<string, number> = {
  delete: 100,
  'delete-then-create': 90, // Replace operations
  update: 50,
  create: 20,
  'no-op': 0,
  read: 0,
} as const;

/**
 * Calculate risk score for infrastructure changes
 */
export class RiskScorer {
  /**
   * Calculate overall risk score for Terraform plan
   *
   * @param terraformPlan - Terraform plan JSON
   * @param costEstimate - Optional Infracost estimate
   * @returns Risk score with breakdown
   */
  calculateRiskScore(terraformPlan: TerraformPlan, costEstimate?: InfracostEstimate): RiskScore {
    const resourceChanges = terraformPlan.resource_changes || [];

    // Calculate individual risk factors
    const resourceTypeRisk = this.calculateResourceTypeRisk(resourceChanges);
    const operationTypeRisk = this.calculateOperationTypeRisk(resourceChanges);
    const costImpactRisk = this.calculateCostImpactRisk(costEstimate);
    const blastRadiusRisk = this.calculateBlastRadiusRisk(resourceChanges);

    // Weighted sum
    const score =
      resourceTypeRisk * RISK_WEIGHTS.resourceType +
      operationTypeRisk * RISK_WEIGHTS.operationType +
      costImpactRisk * RISK_WEIGHTS.costImpact +
      blastRadiusRisk * RISK_WEIGHTS.blastRadius;

    const level = this.getRiskLevel(score);
    const explanation = this.generateExplanation(
      score,
      resourceTypeRisk,
      operationTypeRisk,
      costImpactRisk,
      blastRadiusRisk,
      resourceChanges
    );

    return {
      score: Math.round(score),
      level,
      factors: {
        resourceTypeRisk: Math.round(resourceTypeRisk),
        operationTypeRisk: Math.round(operationTypeRisk),
        costImpactRisk: Math.round(costImpactRisk),
        blastRadiusRisk: Math.round(blastRadiusRisk),
      },
      explanation,
    };
  }

  /**
   * Calculate risk based on resource types being changed
   */
  private calculateResourceTypeRisk(changes: TerraformResourceChange[]): number {
    if (changes.length === 0) return 0;

    // Take the maximum risk from all resources
    let maxRisk = 0;

    for (const change of changes) {
      const baseRisk = RESOURCE_TYPE_RISK[change.type] || 30; // Default medium risk
      maxRisk = Math.max(maxRisk, baseRisk);
    }

    return maxRisk;
  }

  /**
   * Calculate risk based on operation types (create, update, delete)
   */
  private calculateOperationTypeRisk(changes: TerraformResourceChange[]): number {
    if (changes.length === 0) return 0;

    let maxRisk = 0;

    for (const change of changes) {
      const actions = change.change.actions;

      // Determine operation type
      let opRisk = 0;
      if (actions.includes('delete') && actions.includes('create')) {
        opRisk = OPERATION_RISK['delete-then-create'];
      } else if (actions.includes('delete')) {
        opRisk = OPERATION_RISK.delete;
      } else if (actions.includes('update')) {
        opRisk = OPERATION_RISK.update;
      } else if (actions.includes('create')) {
        opRisk = OPERATION_RISK.create;
      } else {
        opRisk = OPERATION_RISK['no-op'];
      }

      maxRisk = Math.max(maxRisk, opRisk);
    }

    return maxRisk;
  }

  /**
   * Calculate risk based on cost impact
   */
  private calculateCostImpactRisk(costEstimate?: InfracostEstimate): number {
    if (!costEstimate) return 0;

    const diff = Math.abs(costEstimate.totalMonthlyCostDiff);

    // Risk thresholds
    if (diff >= 5000) return 100; // >$5k/mo = critical
    if (diff >= 2000) return 80; // >$2k/mo = high
    if (diff >= 1000) return 60; // >$1k/mo = medium
    if (diff >= 500) return 40; // >$500/mo = low-medium
    if (diff >= 100) return 20; // >$100/mo = low

    return 0; // <$100/mo = negligible
  }

  /**
   * Calculate risk based on number of resources affected (blast radius)
   */
  private calculateBlastRadiusRisk(changes: TerraformResourceChange[]): number {
    const count = changes.length;

    // Logarithmic scale for blast radius
    if (count >= 50) return 100;
    if (count >= 20) return 80;
    if (count >= 10) return 60;
    if (count >= 5) return 40;
    if (count >= 2) return 20;
    if (count === 1) return 10;

    return 0;
  }

  /**
   * Get risk level category from score
   */
  private getRiskLevel(score: number): 'low' | 'medium' | 'high' | 'critical' {
    if (score >= 80) return 'critical';
    if (score >= 60) return 'high';
    if (score >= 40) return 'medium';
    return 'low';
  }

  /**
   * Generate human-readable explanation of risk score
   */
  private generateExplanation(
    score: number,
    resourceTypeRisk: number,
    operationTypeRisk: number,
    costImpactRisk: number,
    blastRadiusRisk: number,
    changes: TerraformResourceChange[]
  ): string {
    const level = this.getRiskLevel(score);
    const parts: string[] = [
      `Risk Level: ${level.toUpperCase()} (Score: ${Math.round(score)}/100)`,
      '',
    ];

    // Explain key risk factors
    const factors: string[] = [];

    if (resourceTypeRisk >= 70) {
      const criticalResources = changes
        .filter((c) => (RESOURCE_TYPE_RISK[c.type] || 0) >= 70)
        .map((c) => c.type);
      factors.push(
        `Critical resources affected: ${[...new Set(criticalResources)].join(', ')}`
      );
    }

    if (operationTypeRisk >= 80) {
      const deleteOps = changes.filter((c) => c.change.actions.includes('delete'));
      factors.push(`Destructive operations detected: ${deleteOps.length} resource(s) being deleted`);
    }

    if (costImpactRisk >= 60) {
      factors.push('High cost impact (>$1k/month differential)');
    }

    if (blastRadiusRisk >= 60) {
      factors.push(`Large blast radius: ${changes.length} resource(s) affected`);
    }

    if (factors.length > 0) {
      parts.push('Key Risk Factors:');
      factors.forEach((f) => parts.push(`  • ${f}`));
    } else {
      parts.push('This change appears relatively safe with minimal risk factors.');
    }

    return parts.join('\n');
  }

  /**
   * Check if risk score requires human review
   *
   * @param score - Risk score (0-100)
   * @param threshold - Threshold above which human review is required
   * @returns True if human review required
   */
  requiresHumanReview(score: RiskScore, threshold: number): boolean {
    return score.score >= threshold;
  }
}
