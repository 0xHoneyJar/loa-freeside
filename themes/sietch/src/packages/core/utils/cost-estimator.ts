/**
 * Cost Estimation & Pricing Configuration
 *
 * Provides the pricing table and cost estimation logic that reserve() needs
 * to calculate amountMicro. Sprint 3 billing middleware depends on this.
 *
 * Pricing data loaded from BILLING_PRICING_JSON env var.
 * Sprint 3 switches to billing_config table for dynamic pricing.
 *
 * SDD refs: §1.4 CreditLedgerService (reserve dependency)
 * Sprint refs: Task 1.4b
 */

import { assertMicroUSD } from '../protocol/arithmetic.js';

// =============================================================================
// Pricing Types
// =============================================================================

export interface ModelPricing {
  /** Price per 1,000 input tokens in micro-USD */
  pricePer1kInputMicro: bigint;
  /** Price per 1,000 output tokens in micro-USD */
  pricePer1kOutputMicro: bigint;
}

export interface CostEstimate {
  /** Estimated cost in micro-USD (after safety multiplier, rounded up) */
  estimatedMicro: bigint;
  /** Safety multiplier applied (e.g., 1.2) */
  safetyMultiplier: number;
}

// =============================================================================
// Default Pricing Table
// =============================================================================

/**
 * Default per-model token rates.
 * Values in micro-USD per 1,000 tokens.
 *
 * Sources (as of 2026-02):
 * - GPT-4o: $2.50/1M input, $10.00/1M output
 * - Claude Sonnet 4.5: $3.00/1M input, $15.00/1M output
 * - Claude Opus 4.5: $15.00/1M input, $75.00/1M output
 */
const DEFAULT_PRICING: Record<string, ModelPricing> = {
  'gpt-4o': {
    pricePer1kInputMicro: 2_500n,   // $2.50/1M = $0.0025/1K = 2,500 micro-USD/1K
    pricePer1kOutputMicro: 10_000n,  // $10.00/1M = $0.010/1K = 10,000 micro-USD/1K
  },
  'claude-sonnet-4-5': {
    pricePer1kInputMicro: 3_000n,   // $3.00/1M
    pricePer1kOutputMicro: 15_000n,  // $15.00/1M
  },
  'claude-opus-4-5': {
    pricePer1kInputMicro: 15_000n,  // $15.00/1M
    pricePer1kOutputMicro: 75_000n,  // $75.00/1M
  },
};

/** Default safety multiplier: 1.2x ensures reserve covers worst-case token usage */
const DEFAULT_SAFETY_MULTIPLIER = 1.2;

// =============================================================================
// Pricing Loader
// =============================================================================

let cachedPricing: Record<string, ModelPricing> | null = null;

/**
 * Load pricing configuration.
 * Priority: BILLING_PRICING_JSON env var → default table.
 * Sprint 3 adds billing_config table override (not implemented here).
 */
function loadPricing(): Record<string, ModelPricing> {
  if (cachedPricing) return cachedPricing;

  const envPricing = process.env.BILLING_PRICING_JSON;
  if (envPricing) {
    try {
      const parsed = JSON.parse(envPricing) as Record<string, {
        pricePer1kInputMicro: string | number;
        pricePer1kOutputMicro: string | number;
      }>;
      const result: Record<string, ModelPricing> = {};
      for (const [model, prices] of Object.entries(parsed)) {
        result[model] = {
          pricePer1kInputMicro: BigInt(prices.pricePer1kInputMicro),
          pricePer1kOutputMicro: BigInt(prices.pricePer1kOutputMicro),
        };
      }
      cachedPricing = result;
      return cachedPricing;
    } catch {
      // Invalid JSON — fall through to defaults
    }
  }

  cachedPricing = DEFAULT_PRICING;
  return cachedPricing;
}

/**
 * Clear cached pricing (for testing).
 */
export function resetPricingCache(): void {
  cachedPricing = null;
}

// =============================================================================
// Cost Estimation
// =============================================================================

/**
 * Estimate the cost for an inference call.
 *
 * Uses worst-case assumption: maxTokens applies to BOTH input and output.
 * Applies safety multiplier and rounds up (ceil) to never under-reserve.
 *
 * @param model - Model identifier (e.g., 'gpt-4o', 'claude-sonnet-4-5')
 * @param maxTokens - Maximum tokens for the call (applied to both input and output for worst-case)
 * @param poolId - Optional pool for pool-specific pricing (future)
 * @returns Cost estimate with safety multiplier
 * @throws {Error} if model has no pricing configured
 */
export function estimateCost(
  model: string,
  maxTokens: number,
  _poolId?: string,
): CostEstimate {
  const pricing = loadPricing();
  const modelPricing = pricing[model];

  if (!modelPricing) {
    throw new Error(
      `No pricing configured for model "${model}". ` +
      `Available models: ${Object.keys(pricing).join(', ')}`
    );
  }

  const safetyMultiplier = DEFAULT_SAFETY_MULTIPLIER;

  // Calculate cost for maxTokens of input + maxTokens of output (worst case)
  // Formula: (maxTokens / 1000) * pricePerK for each direction
  // Use BigInt ceiling division: (a + b - 1) / b
  const tokensK = BigInt(maxTokens);
  const inputCostMicro = ceilDiv(modelPricing.pricePer1kInputMicro * tokensK, 1000n);
  const outputCostMicro = ceilDiv(modelPricing.pricePer1kOutputMicro * tokensK, 1000n);
  const baseCostMicro = inputCostMicro + outputCostMicro;

  // Apply safety multiplier using integer arithmetic
  // Multiply by (safetyMultiplier * 1000), then ceil divide by 1000
  const multiplierScaled = BigInt(Math.ceil(safetyMultiplier * 1000));
  const estimatedMicro = ceilDiv(baseCostMicro * multiplierScaled, 1000n);

  assertMicroUSD(estimatedMicro);

  return { estimatedMicro, safetyMultiplier };
}

/**
 * Get the pricing entry for a model.
 * Returns null if model has no pricing configured.
 */
export function getModelPricing(model: string): ModelPricing | null {
  const pricing = loadPricing();
  return pricing[model] ?? null;
}

/**
 * List all configured model identifiers.
 */
export function listPricedModels(): string[] {
  return Object.keys(loadPricing());
}

// =============================================================================
// BigInt Math Helpers
// =============================================================================

/**
 * Ceiling division for BigInt: ceil(a / b).
 * Always rounds up to never under-reserve.
 */
function ceilDiv(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new RangeError('Division by zero');
  if (a === 0n) return 0n;
  return (a + b - 1n) / b;
}
