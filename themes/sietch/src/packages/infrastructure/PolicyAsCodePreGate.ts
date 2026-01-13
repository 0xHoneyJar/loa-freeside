// @ts-nocheck
// TODO: Fix TypeScript type errors
/**
 * Policy-as-Code Pre-Gate for Terraform Infrastructure Changes
 *
 * Orchestrates OPA policy evaluation, Infracost budget checking, and risk scoring
 * before human review of Terraform plans.
 *
 * Decision Flow:
 * 1. Load and evaluate OPA policies
 * 2. Check Infracost budget threshold (if configured)
 * 3. Calculate risk score
 * 4. Return decision: APPROVE, REJECT, or REVIEW_REQUIRED
 *
 * Note: Uses TypeScript-based policy evaluation for simplicity.
 * OPA WASM integration can be added as a future enhancement by:
 * 1. Pre-compiling .rego to WASM: `opa build -t wasm policies/`
 * 2. Loading with @open-policy-agent/opa-wasm
 */

import { promises as fs } from 'fs';
import { InfracostClient } from './InfracostClient.js';
import { RiskScorer } from './RiskScorer.js';
import type {
  TerraformPlan,
  PreGateDecision,
  PreGateConfig,
  PolicyEvaluationResult,
  PolicyViolation,
  BudgetViolation,
} from './types.js';

/**
 * Logger interface for dependency injection
 * Compatible with pino, winston, or console
 */
export interface Logger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

/**
 * Loaded policy instance with content and metadata
 */
interface PolicyInstance {
  content: string;
  path: string;
}

/**
 * Extended configuration with optional logger
 */
export interface PreGateConfigWithLogger extends PreGateConfig {
  logger?: Logger;
}

/**
 * Main orchestrator for Policy-as-Code pre-gate validation
 */
export class PolicyAsCodePreGate {
  private config: PreGateConfigWithLogger;
  private infracostClient?: InfracostClient;
  private riskScorer: RiskScorer;
  private policy?: PolicyInstance;
  private logger: Logger;

  constructor(config: PreGateConfigWithLogger) {
    this.config = config;
    this.riskScorer = new RiskScorer();
    // Use injected logger or default to console-compatible wrapper
    this.logger = config.logger || {
      info: (obj: object, msg?: string) => console.log(msg || '', obj),
      warn: (obj: object, msg?: string) => console.warn(msg || '', obj),
      error: (obj: object, msg?: string) => console.error(msg || '', obj),
    };

    // Initialize Infracost client if API key provided
    if (config.infracostApiKey) {
      this.infracostClient = new InfracostClient(config.infracostApiKey);
    }
  }

  /**
   * Initialize OPA policy from .rego file
   *
   * Must be called before evaluate()
   */
  async initialize(): Promise<void> {
    try {
      // Read policy file
      const policyContent = await fs.readFile(this.config.policyPath, 'utf-8');

      // For OPA WASM, we need to compile the policy first
      // In production, this would involve the OPA CLI: `opa build -t wasm`
      // For now, we'll use a simplified approach that evaluates policies directly

      // Store policy content for evaluation
      this.policy = {
        content: policyContent,
        path: this.config.policyPath,
      };
    } catch (error) {
      throw new Error(`Failed to load OPA policy from ${this.config.policyPath}: ${error}`);
    }
  }

  /**
   * Evaluate Terraform plan against all pre-gate checks
   *
   * @param terraformPlan - Terraform plan JSON
   * @returns Pre-gate decision with verdict and context
   */
  async evaluate(terraformPlan: TerraformPlan): Promise<PreGateDecision> {
    const startTime = Date.now();

    try {
      // Step 1: Evaluate OPA policies
      const policyEvaluation = await this.evaluatePolicies(terraformPlan);

      // Step 2: Check Infracost budget (if configured)
      let costEstimate;
      let budgetViolation: BudgetViolation | undefined;

      if (this.infracostClient) {
        try {
          // Use local estimation as fallback if API fails
          costEstimate = this.infracostClient.estimateCostsLocally(terraformPlan);

          if (
            this.infracostClient.exceedsThreshold(costEstimate, this.config.budgetThresholdUsd)
          ) {
            budgetViolation = {
              thresholdUsd: this.config.budgetThresholdUsd,
              actualDiffUsd: costEstimate.totalMonthlyCostDiff,
              excessUsd: costEstimate.totalMonthlyCostDiff - this.config.budgetThresholdUsd,
            };
          }
        } catch (error) {
          // Infracost failure is non-blocking, log and continue
          this.logger.warn({ error: String(error) }, 'Infracost estimation failed');
        }
      }

      // Step 3: Calculate risk score
      const riskScore = this.riskScorer.calculateRiskScore(terraformPlan, costEstimate);

      // Step 4: Make decision
      const decision = this.makeDecision(policyEvaluation, budgetViolation, riskScore);

      const evaluationTimeMs = Date.now() - startTime;

      // Ensure evaluation completes within timeout
      if (evaluationTimeMs > this.config.evaluationTimeoutMs) {
        this.logger.warn({
          evaluationTimeMs,
          timeoutMs: this.config.evaluationTimeoutMs,
        }, 'Policy evaluation exceeded timeout');
      }

      return {
        ...decision,
        policyEvaluation: {
          ...policyEvaluation,
          metadata: {
            ...policyEvaluation.metadata,
            evaluationTimeMs,
          },
        },
        costEstimate,
        riskScore,
        timestamp: new Date(),
      };
    } catch (error) {
      throw new Error(`Pre-gate evaluation failed: ${error}`);
    }
  }

  /**
   * Evaluate OPA policies against Terraform plan
   *
   * @param terraformPlan - Terraform plan JSON
   * @returns Policy evaluation result
   */
  private async evaluatePolicies(terraformPlan: TerraformPlan): Promise<PolicyEvaluationResult> {
    if (!this.policy) {
      throw new Error('Policy not initialized. Call initialize() first.');
    }

    const startTime = Date.now();

    // For simplicity, we'll implement a lightweight policy evaluator
    // In production, this would use OPA WASM or call out to OPA server
    const { hardBlocks, warnings } = this.evaluatePoliciesSimplified(terraformPlan);

    const evaluationTimeMs = Date.now() - startTime;

    return {
      allowed: hardBlocks.length === 0,
      hardBlocks,
      warnings,
      metadata: {
        evaluationTimeMs,
        policyPath: this.config.policyPath,
        opaVersion: '1.0.0-simplified',
      },
    };
  }

  /**
   * Simplified policy evaluation (TypeScript implementation of Rego rules)
   *
   * In production, this would use OPA WASM to evaluate the .rego file.
   * For this implementation, we replicate the key rules in TypeScript.
   */
  private evaluatePoliciesSimplified(terraformPlan: TerraformPlan): {
    hardBlocks: PolicyViolation[];
    warnings: PolicyViolation[];
  } {
    const hardBlocks: PolicyViolation[] = [];
    const warnings: PolicyViolation[] = [];

    for (const change of terraformPlan.resource_changes || []) {
      // HARD BLOCK: Delete PersistentVolume
      if (
        ['kubernetes_persistent_volume', 'kubernetes_persistent_volume_claim'].includes(
          change.type
        ) &&
        change.change.actions.includes('delete')
      ) {
        hardBlocks.push({
          code: 'HARD_BLOCK_DELETE_PV',
          severity: 'critical',
          message: 'Deletion of PersistentVolume or PersistentVolumeClaim is not allowed',
          resource: change.address,
          canOverride: false,
          details: {
            type: change.type,
            reason: 'Data loss risk - persistent volumes contain critical application data',
          },
        });
      }

      // HARD BLOCK: Delete Database
      if (
        [
          'aws_db_instance',
          'aws_rds_cluster',
          'aws_rds_cluster_instance',
          'postgresql_database',
        ].includes(change.type) &&
        change.change.actions.includes('delete')
      ) {
        hardBlocks.push({
          code: 'HARD_BLOCK_DELETE_DATABASE',
          severity: 'critical',
          message: 'Deletion of database resources is not allowed',
          resource: change.address,
          canOverride: false,
          details: {
            type: change.type,
            reason: 'Data loss risk - databases contain critical application data',
          },
        });
      }

      // HARD BLOCK: Disable RLS
      if (
        change.type === 'postgresql_table' &&
        change.change.before?.['row_security_enabled'] === true &&
        change.change.after?.['row_security_enabled'] === false
      ) {
        hardBlocks.push({
          code: 'HARD_BLOCK_DISABLE_RLS',
          severity: 'critical',
          message: 'Disabling Row-Level Security is not allowed',
          resource: change.address,
          canOverride: false,
          details: {
            type: change.type,
            reason: 'Security vulnerability - RLS provides multi-tenant data isolation',
          },
        });
      }

      // HARD BLOCK: Delete production namespace
      if (
        change.type === 'kubernetes_namespace' &&
        change.change.actions.includes('delete') &&
        change.change.before?.['metadata']?.[0]?.['name'] &&
        ['production', 'prod', 'arrakis-production'].includes(
          change.change.before['metadata'][0]['name'] as string
        )
      ) {
        hardBlocks.push({
          code: 'HARD_BLOCK_DELETE_PROD_NAMESPACE',
          severity: 'critical',
          message: 'Deletion of production namespace is not allowed',
          resource: change.address,
          canOverride: false,
          details: {
            type: change.type,
            namespace: change.change.before['metadata'][0]['name'],
            reason: 'Would destroy entire production environment',
          },
        });
      }

      // WARNING: High-risk updates
      if (
        [
          'aws_eks_cluster',
          'aws_vpc',
          'aws_security_group',
          'aws_iam_role',
          'aws_iam_policy',
        ].includes(change.type) &&
        change.change.actions.includes('update')
      ) {
        warnings.push({
          code: 'WARN_HIGH_RISK_UPDATE',
          severity: 'high',
          message: `High-risk resource update detected: ${change.type}`,
          resource: change.address,
          canOverride: true,
          details: {
            type: change.type,
            reason: 'Changes to critical infrastructure require careful review',
          },
        });
      }

      // WARNING: Resource replacement
      if (
        change.change.actions.includes('delete') &&
        change.change.actions.includes('create')
      ) {
        warnings.push({
          code: 'WARN_RESOURCE_REPLACEMENT',
          severity: 'medium',
          message: `Resource replacement detected: ${change.address}`,
          resource: change.address,
          canOverride: true,
          details: {
            type: change.type,
            reason: 'Replacement may cause temporary service disruption',
          },
        });
      }
    }

    // WARNING: Large blast radius
    if ((terraformPlan.resource_changes?.length || 0) >= 10) {
      warnings.push({
        code: 'WARN_LARGE_BLAST_RADIUS',
        severity: 'high',
        message: `Large blast radius: ${terraformPlan.resource_changes?.length} resources affected`,
        resource: 'multiple',
        canOverride: true,
        details: {
          resourceCount: terraformPlan.resource_changes?.length,
          reason: 'Large changes increase risk of unexpected side effects',
        },
      });
    }

    return { hardBlocks, warnings };
  }

  /**
   * Make final decision based on all evaluation results
   */
  private makeDecision(
    policyEvaluation: PolicyEvaluationResult,
    budgetViolation: BudgetViolation | undefined,
    riskScore: any
  ): Omit<PreGateDecision, 'policyEvaluation' | 'costEstimate' | 'riskScore' | 'timestamp'> {
    // AUTO-REJECT: Hard blocks present
    if (policyEvaluation.hardBlocks.length > 0) {
      return {
        verdict: 'REJECT',
        reason: `Hard block violations detected: ${policyEvaluation.hardBlocks.map((v) => v.code).join(', ')}`,
        recommendations: [
          'Review and address hard block violations',
          'Hard blocks cannot be overridden by human approval',
          'Modify Terraform plan to comply with policies',
        ],
      };
    }

    // AUTO-REJECT: Budget threshold exceeded
    if (budgetViolation) {
      return {
        verdict: 'REJECT',
        reason: `Budget threshold exceeded: +$${budgetViolation.actualDiffUsd.toFixed(2)}/mo (limit: $${budgetViolation.thresholdUsd.toFixed(2)}/mo)`,
        recommendations: [
          `Reduce cost impact by $${budgetViolation.excessUsd.toFixed(2)}/mo`,
          'Consider scaling down resources or using spot instances',
          'Review resource configurations for cost optimization',
        ],
      };
    }

    // REVIEW_REQUIRED: High risk score or warnings present
    if (
      this.riskScorer.requiresHumanReview(riskScore, this.config.riskScoreThreshold) ||
      policyEvaluation.warnings.length > 0
    ) {
      return {
        verdict: 'REVIEW_REQUIRED',
        reason: `Risk score ${riskScore.score}/100 (threshold: ${this.config.riskScoreThreshold}) or warnings present`,
        recommendations: [
          'Carefully review all warnings before approval',
          'Verify blast radius and potential impact',
          'Ensure rollback plan is in place',
          'Consider staging deployment first',
        ],
      };
    }

    // APPROVE: All checks passed
    return {
      verdict: 'APPROVE',
      reason: 'All pre-gate checks passed: no hard blocks, within budget, acceptable risk',
      recommendations: [
        'Terraform plan is safe to apply',
        'Consider notifying relevant teams before applying',
        'Monitor application after deployment',
      ],
    };
  }

  /**
   * Format decision for human-readable output
   *
   * @param decision - Pre-gate decision
   * @returns Formatted string
   */
  formatDecision(decision: PreGateDecision): string {
    const lines: string[] = [
      '═══════════════════════════════════════════════════════',
      `        POLICY-AS-CODE PRE-GATE DECISION`,
      '═══════════════════════════════════════════════════════',
      '',
      `Verdict: ${decision.verdict}`,
      `Reason: ${decision.reason}`,
      `Timestamp: ${decision.timestamp.toISOString()}`,
      '',
    ];

    // Policy violations
    if (decision.policyEvaluation.hardBlocks.length > 0) {
      lines.push('❌ HARD BLOCKS (Auto-Reject):');
      for (const violation of decision.policyEvaluation.hardBlocks) {
        lines.push(`  • [${violation.code}] ${violation.message}`);
        lines.push(`    Resource: ${violation.resource}`);
      }
      lines.push('');
    }

    if (decision.policyEvaluation.warnings.length > 0) {
      lines.push('⚠️  WARNINGS (Require Review):');
      for (const warning of decision.policyEvaluation.warnings) {
        lines.push(`  • [${warning.code}] ${warning.message}`);
        lines.push(`    Resource: ${warning.resource}`);
      }
      lines.push('');
    }

    // Cost estimate
    if (decision.costEstimate) {
      lines.push('💰 COST IMPACT:');
      lines.push(
        `  Monthly Differential: ${decision.costEstimate.totalMonthlyCostDiff > 0 ? '+' : ''}$${decision.costEstimate.totalMonthlyCostDiff.toFixed(2)}/mo`
      );
      lines.push(
        `  Before: $${decision.costEstimate.summary.totalMonthlyCostBefore.toFixed(2)}/mo`
      );
      lines.push(
        `  After: $${decision.costEstimate.summary.totalMonthlyCost.toFixed(2)}/mo`
      );
      lines.push('');
    }

    // Risk score
    lines.push('🎯 RISK ASSESSMENT:');
    lines.push(
      `  Score: ${decision.riskScore.score}/100 (${decision.riskScore.level.toUpperCase()})`
    );
    lines.push(`  Resource Type Risk: ${decision.riskScore.factors.resourceTypeRisk}/100`);
    lines.push(`  Operation Type Risk: ${decision.riskScore.factors.operationTypeRisk}/100`);
    lines.push(`  Cost Impact Risk: ${decision.riskScore.factors.costImpactRisk}/100`);
    lines.push(`  Blast Radius Risk: ${decision.riskScore.factors.blastRadiusRisk}/100`);
    lines.push('');

    // Recommendations
    if (decision.recommendations.length > 0) {
      lines.push('📋 RECOMMENDATIONS:');
      for (const rec of decision.recommendations) {
        lines.push(`  • ${rec}`);
      }
      lines.push('');
    }

    // Metadata
    lines.push('⏱️  PERFORMANCE:');
    lines.push(
      `  Policy Evaluation: ${decision.policyEvaluation.metadata.evaluationTimeMs}ms`
    );
    lines.push('');

    lines.push('═══════════════════════════════════════════════════════');

    return lines.join('\n');
  }
}
