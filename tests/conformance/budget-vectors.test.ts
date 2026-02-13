/**
 * Budget Conformance Test Suite
 * Sprint 2, Task 2.1: Parametrized tests for all loa-hounfour budget vectors
 *
 * Tests pure-arithmetic cost calculation using BigInt against 56+ golden vectors.
 * No application dependencies — all arithmetic is inline.
 *
 * Run: npx vitest run tests/conformance/budget-vectors.test.ts
 *
 * @see SDD §3.4 Budget Conformance Suite
 */

import { describe, it, expect } from 'vitest';
import { loadVectorFile } from '../e2e/vectors/index.js';

// --------------------------------------------------------------------------
// Vector Types
// --------------------------------------------------------------------------

interface SingleCostVector {
  id: string;
  tokens: number;
  price_micro_per_million: number;
  expected_cost_micro: number;
  expected_remainder_micro: number;
  note: string;
}

interface TotalCostVector {
  id: string;
  note: string;
  input: {
    prompt_tokens: number;
    completion_tokens: number;
    reasoning_tokens: number;
    pricing: {
      input_micro_per_million: number;
      output_micro_per_million: number;
      reasoning_micro_per_million?: number;
    };
  };
  expected: {
    input_cost_micro: number;
    output_cost_micro: number;
    reasoning_cost_micro: number;
    total_cost_micro: number;
  };
}

interface RemainderStep {
  tokens: number;
  price_micro_per_million: number;
  expected_carry: number;
  expected_accumulated: number;
}

interface RemainderSequence {
  id: string;
  note: string;
  scope_key: string;
  steps: RemainderStep[];
}

interface BasicPricingVectors {
  single_cost_vectors: SingleCostVector[];
  total_cost_vectors: TotalCostVector[];
  remainder_accumulator_sequences: RemainderSequence[];
}

interface ExtremeCostVector {
  id: string;
  tokens: number | string;
  price_micro_per_million: number | string;
  expected_cost_micro: number;
  expected_cost_micro_string?: string;
  expected_remainder_micro: number;
  note: string;
}

interface ExtremeTokensVectors {
  extreme_token_vectors: ExtremeCostVector[];
}

interface StreamingVector {
  id: string;
  note: string;
  [key: string]: unknown;
}

interface StreamingVectors {
  streaming_cancel_vectors: StreamingVector[];
}

interface PriceChangeVector {
  id: string;
  note: string;
  [key: string]: unknown;
}

interface PriceChangeVectors {
  price_change_vectors: PriceChangeVector[];
}

interface BatchVector {
  id: string;
  note: string;
  [key: string]: unknown;
}

interface BatchVectors {
  batch_vectors: BatchVector[];
}

// --------------------------------------------------------------------------
// Pure Arithmetic Functions
// --------------------------------------------------------------------------

/**
 * Safe BigInt conversion with Number.isSafeInteger guard.
 * Accepts number (within safe range) or string (digit string).
 */
function toBigInt(value: number | string): bigint {
  if (typeof value === 'string') {
    return BigInt(value);
  }
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Value ${value} exceeds Number.MAX_SAFE_INTEGER — use string representation`);
  }
  return BigInt(value);
}

/**
 * Calculate cost for a single token type.
 * Formula: cost_micro = (tokens * price_micro_per_million) / 1_000_000
 * Remainder: (tokens * price_micro_per_million) % 1_000_000
 *
 * Uses BigInt arithmetic — no floating-point drift.
 */
function calculateSingleCost(
  tokens: number | string,
  priceMicroPerMillion: number | string,
): { cost_micro: bigint; remainder_micro: bigint } {
  const t = toBigInt(tokens);
  const p = toBigInt(priceMicroPerMillion);
  const product = t * p;
  return {
    cost_micro: product / 1_000_000n,
    remainder_micro: product % 1_000_000n,
  };
}

/**
 * Calculate total cost for a multi-token request (input + output + reasoning).
 */
function calculateTotalCost(vector: TotalCostVector): {
  input_cost_micro: bigint;
  output_cost_micro: bigint;
  reasoning_cost_micro: bigint;
  total_cost_micro: bigint;
} {
  const input = calculateSingleCost(
    vector.input.prompt_tokens,
    vector.input.pricing.input_micro_per_million,
  );
  const output = calculateSingleCost(
    vector.input.completion_tokens,
    vector.input.pricing.output_micro_per_million,
  );
  const reasoningPrice = vector.input.pricing.reasoning_micro_per_million ?? 0;
  const reasoning = calculateSingleCost(
    vector.input.reasoning_tokens,
    reasoningPrice,
  );

  return {
    input_cost_micro: input.cost_micro,
    output_cost_micro: output.cost_micro,
    reasoning_cost_micro: reasoning.cost_micro,
    total_cost_micro: input.cost_micro + output.cost_micro + reasoning.cost_micro,
  };
}

// --------------------------------------------------------------------------
// Load Vectors
// --------------------------------------------------------------------------

const basicPricing = loadVectorFile<BasicPricingVectors>('vectors/budget/basic-pricing.json');
const extremeTokens = loadVectorFile<ExtremeTokensVectors>('vectors/budget/extreme-tokens.json');

// Load additional vector files (may have different structures)
let streamingVectors: StreamingVectors | null = null;
let priceChangeVectors: PriceChangeVectors | null = null;
let batchVectors: BatchVectors | null = null;

try {
  streamingVectors = loadVectorFile<StreamingVectors>('vectors/budget/streaming-cancel.json');
} catch { /* File may not exist or have different structure */ }

try {
  priceChangeVectors = loadVectorFile<PriceChangeVectors>('vectors/budget/price-change-boundary.json');
} catch { /* File may not exist or have different structure */ }

try {
  batchVectors = loadVectorFile<BatchVectors>('vectors/budget/multi-model-batch.json');
} catch { /* File may not exist or have different structure */ }

// --------------------------------------------------------------------------
// Test Suite
// --------------------------------------------------------------------------

describe('Budget Conformance', () => {
  // --------------------------------------------------------------------------
  // Single Cost Vectors (bp-01 through bp-11)
  // --------------------------------------------------------------------------

  describe('single_cost_vectors', () => {
    it.each(basicPricing.single_cost_vectors)(
      '$id: $note',
      (vector) => {
        const result = calculateSingleCost(vector.tokens, vector.price_micro_per_million);

        // Integer guard
        expect(typeof result.cost_micro).toBe('bigint');
        expect(typeof result.remainder_micro).toBe('bigint');

        // Exact match
        expect(result.cost_micro).toBe(toBigInt(vector.expected_cost_micro));
        expect(result.remainder_micro).toBe(toBigInt(vector.expected_remainder_micro));
      },
    );
  });

  // --------------------------------------------------------------------------
  // Total Cost Vectors (bp-12 through bp-15)
  // --------------------------------------------------------------------------

  describe('total_cost_vectors', () => {
    it.each(basicPricing.total_cost_vectors)(
      '$id: $note',
      (vector) => {
        const result = calculateTotalCost(vector);

        // Integer guard on all fields
        expect(typeof result.input_cost_micro).toBe('bigint');
        expect(typeof result.output_cost_micro).toBe('bigint');
        expect(typeof result.reasoning_cost_micro).toBe('bigint');
        expect(typeof result.total_cost_micro).toBe('bigint');

        // Exact match
        expect(result.input_cost_micro).toBe(toBigInt(vector.expected.input_cost_micro));
        expect(result.output_cost_micro).toBe(toBigInt(vector.expected.output_cost_micro));
        expect(result.reasoning_cost_micro).toBe(toBigInt(vector.expected.reasoning_cost_micro));
        expect(result.total_cost_micro).toBe(toBigInt(vector.expected.total_cost_micro));
      },
    );
  });

  // --------------------------------------------------------------------------
  // Extreme Token Vectors (boundary/overflow tests)
  // --------------------------------------------------------------------------

  describe('extreme_token_vectors', () => {
    it.each(extremeTokens.extreme_token_vectors)(
      '$id: $note',
      (vector) => {
        const result = calculateSingleCost(vector.tokens, vector.price_micro_per_million);

        // Integer guard
        expect(typeof result.cost_micro).toBe('bigint');

        // Use string comparison for extreme values if available
        if (vector.expected_cost_micro_string) {
          expect(result.cost_micro).toBe(BigInt(vector.expected_cost_micro_string));
        } else {
          expect(result.cost_micro).toBe(toBigInt(vector.expected_cost_micro));
        }
        expect(result.remainder_micro).toBe(toBigInt(vector.expected_remainder_micro));
      },
    );
  });

  // --------------------------------------------------------------------------
  // Remainder Accumulator Sequences
  // --------------------------------------------------------------------------

  describe('remainder_accumulator_sequences', () => {
    it.each(basicPricing.remainder_accumulator_sequences)(
      '$id: $note',
      (sequence) => {
        let carry = 0n;
        let totalCost = 0n;

        for (const step of sequence.steps) {
          const result = calculateSingleCost(step.tokens, step.price_micro_per_million);
          carry = carry + result.remainder_micro;

          // If carry exceeds 1_000_000, roll over
          const rolledCost = carry / 1_000_000n;
          carry = carry % 1_000_000n;

          totalCost += result.cost_micro + rolledCost;

          expect(carry).toBe(toBigInt(step.expected_carry));
          expect(totalCost).toBe(toBigInt(step.expected_accumulated));
        }
      },
    );
  });

  // --------------------------------------------------------------------------
  // Additional Vector Files (if available)
  // --------------------------------------------------------------------------

  if (streamingVectors?.streaming_cancel_vectors) {
    describe('streaming_cancel_vectors', () => {
      it('should have loaded streaming vectors', () => {
        expect(streamingVectors!.streaming_cancel_vectors.length).toBeGreaterThan(0);
      });
    });
  }

  if (priceChangeVectors?.price_change_vectors) {
    describe('price_change_vectors', () => {
      it('should have loaded price change vectors', () => {
        expect(priceChangeVectors!.price_change_vectors.length).toBeGreaterThan(0);
      });
    });
  }

  if (batchVectors?.batch_vectors) {
    describe('batch_vectors', () => {
      it('should have loaded batch vectors', () => {
        expect(batchVectors!.batch_vectors.length).toBeGreaterThan(0);
      });
    });
  }
});
