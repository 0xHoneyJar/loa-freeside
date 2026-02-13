/**
 * @arrakis/loa-finn-contract
 *
 * Contract artifacts for arrakis ↔ loa-finn integration.
 * Provides typed access to JSON Schema definitions and test vectors.
 *
 * Version is the single source of truth for pool_mapping_version JWT claim.
 *
 * @see SDD §3.2.3 Contract Artifact Package
 * @see Sprint 1, Task 1.4
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// --------------------------------------------------------------------------
// Version — single source of truth for pool_mapping_version JWT claim
// --------------------------------------------------------------------------

const pkg = require('../package.json') as { version: string };

/** Contract artifact version — used as pool_mapping_version JWT claim value */
export const CONTRACT_VERSION: string = pkg.version;

// --------------------------------------------------------------------------
// Schema
// --------------------------------------------------------------------------

export interface TierPoolMapping {
  default: string;
  allowed: string[];
}

export interface ContractSchema {
  version: string;
  description: string;
  schemas: {
    jwt_claims: Record<string, unknown>;
    invoke_response: Record<string, unknown>;
    usage_report: Record<string, unknown>;
    stream_events: Record<string, unknown>;
  };
  tier_pool_mapping: Record<string, TierPoolMapping>;
}

/** Full contract schema with JSON Schema definitions and tier pool mapping */
export const CONTRACT_SCHEMA: ContractSchema =
  require('../schema/loa-finn-contract.json') as ContractSchema;

// --------------------------------------------------------------------------
// Test Vectors
// --------------------------------------------------------------------------

// --------------------------------------------------------------------------
// Per-Model Breakdown Types (contract v1.1.0, cycle-019 BB6 Finding #6)
// --------------------------------------------------------------------------

/** Per-model cost entry in usage report model_breakdown array */
export interface ModelBreakdownEntry {
  model_id: string;
  provider: 'openai' | 'anthropic';
  succeeded: boolean;
  input_tokens?: number;
  output_tokens?: number;
  cost_micro: number;
  accounting_mode: 'PLATFORM_BUDGET' | 'BYOK_NO_BUDGET';
  latency_ms?: number;
  error_code?: string;
}

/** Aggregate ensemble accounting in usage reports */
export interface EnsembleAccountingSummary {
  strategy: 'best_of_n' | 'consensus' | 'fallback';
  n_requested: number;
  n_succeeded: number;
  n_failed: number;
  total_cost_micro: number;
  platform_cost_micro: number;
  byok_cost_micro: number;
  reserved_cost_micro: number;
  savings_micro: number;
}

// --------------------------------------------------------------------------
// Test Vector Types
// --------------------------------------------------------------------------

export interface TestVectorUsageReport {
  pool_id: string;
  input_tokens: number;
  output_tokens: number;
  cost_micro: number;
  accounting_mode?: string;
  usage_tokens?: number;
  model_breakdown?: ModelBreakdownEntry[];
  ensemble_accounting?: EnsembleAccountingSummary;
}

export interface TestVector {
  name: string;
  description: string;
  request: {
    jwt_claims: Record<string, unknown>;
    body: Record<string, unknown>;
  };
  response: {
    status: number;
    headers?: Record<string, string>;
    body?: Record<string, unknown>;
    stream_events?: Array<Record<string, unknown>>;
    abort_after_events?: number;
    expect_reconciliation?: boolean;
  };
  usage_report_payload: TestVectorUsageReport | null;
}

export interface TestVectors {
  version: string;
  description: string;
  vectors: TestVector[];
}

/** Test vectors for E2E scenarios — decoded payload templates, NOT pre-signed JWS */
export const TEST_VECTORS: TestVectors =
  require('../vectors/loa-finn-test-vectors.json') as TestVectors;

/**
 * Get a test vector by name.
 * @throws Error if vector not found
 */
export function getVector(name: string): TestVector {
  const vector = TEST_VECTORS.vectors.find((v) => v.name === name);
  if (!vector) {
    throw new Error(
      `Test vector '${name}' not found. Available: ${TEST_VECTORS.vectors.map((v) => v.name).join(', ')}`,
    );
  }
  return vector;
}
