/**
 * Protocol Conformance Test Suite — v7.11.0 (cycle-041)
 *
 * Loads all conformance vectors from @0xhoneyjar/loa-hounfour/vectors
 * and validates them against the protocol's JSON Schema definitions using ajv v8.
 * Vector loader uses recursive readdir for nested directory structure.
 *
 * AC-2.4.1: Vector loader updated: recursive readdir for nested categories
 * AC-2.4.2: All vectors load and parse successfully
 * AC-2.4.3: Test blocks for governance, reputation, liveness categories
 * AC-2.4.4: CONTRACT_VERSION assertion matches actual value
 * AC-2.4.5: Dual-accept test (v6.0.0 support) preserved
 * AC-2.4.6: All vectors pass
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { resolve, dirname, join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import Ajv from 'ajv';

// ---------------------------------------------------------------------------
// Resolve the hounfour package root using Node module resolution
// (topology-independent: works regardless of pnpm hoist settings)
// ---------------------------------------------------------------------------

const require = createRequire(import.meta.url);
const hounfourRoot = dirname(require.resolve('@0xhoneyjar/loa-hounfour/package.json'));

// ---------------------------------------------------------------------------
// Import protocol exports for validation
// ---------------------------------------------------------------------------

import {
  CONTRACT_VERSION,
  // JSON Schema objects for conformance category validation
  GovernanceProposalSchema,
  SanctionSchema,
  DisputeRecordSchema,
  ValidatedOutcomeSchema,
  PerformanceRecordSchema,
  ContributionRecordSchema,
  ReputationAggregateSchema,
  AggregateSnapshotSchema,
  ReputationTransitionSchema,
  ReputationScoreSchema,
  ReputationCredentialSchema,
  LivenessPropertySchema,
  ConservationPropertyRegistrySchema,
  EconomicBoundaryEvaluationResultSchema,
  AgentIdentitySchema,
  CapabilityScopedTrustSchema,
  CollectionGovernanceConfigSchema,
  CommunityEngagementSignalSchema,
  ConstraintLifecycleEventSchema,
  DelegationChainSchema,
  DelegationOutcomeSchema,
  DelegationQualityEventSchema,
  DelegationTreeSchema,
  EconomicPerformanceEventSchema,
  EnsembleRequestSchema,
  EventSubscriptionSchema,
  ExecutionCheckpointSchema,
  BridgeTransferSagaSchema,
  InterAgentTransactionAuditSchema,
  PersonalityAssignmentSchema,
  PolicyVersionSchema,
  PermissionBoundarySchema,
  RegistryBridgeSchema,
  ReputationEconomicImpactSchema,
  ReputationPortabilityRequestSchema,
  ReputationRoutingSignalSchema,
  ReservationEnforcementSchema,
  RoutingRebalanceEventSchema,
  ThinkingTraceSchema,
  ModelEconomicProfileSchema,
  MonetaryPolicySchema,
  MicroUSDCSchema,
  JwtBoundarySpecSchema,
  ProposalExecutionSchema,
  ProviderSummarySchema,
  // v7.10–v7.11 governance schemas (Sprint 354, Task 2.5)
  GovernanceTaskTypeSchema,
} from '@0xhoneyjar/loa-hounfour';

import {
  TaskTypeCohortSchema as GovTaskTypeCohortSchema,
  ScoringPathLogSchema as GovScoringPathLogSchema,
} from '@0xhoneyjar/loa-hounfour/governance';

// ---------------------------------------------------------------------------
// JSON Schema Validator (ajv)
// ---------------------------------------------------------------------------

// The hounfour schemas are JSON Schema objects (not Zod), so we use ajv v8.
// validateFormats: false is needed because v7.10+ governance schemas use format
// keywords (e.g., "date-time") that require ajv-formats to validate.
// Each compile call gets a fresh ajv instance to avoid $id collision errors.
const validatorCache = new Map<string, ReturnType<InstanceType<typeof Ajv>['compile']>>();

/** Validate data against a JSON Schema object. Returns { valid, errors }. */
function validateSchema(
  schema: Record<string, unknown>,
  data: unknown,
): { valid: boolean; errors: string | null } {
  const schemaId = (schema.$id as string) || JSON.stringify(schema).slice(0, 100);
  let validate = validatorCache.get(schemaId);
  if (!validate) {
    // Fresh ajv instance per schema to avoid $id collision
    // validateFormats: false skips format validation (e.g., "date-time")
    // that v7.10+ governance schemas introduce
    const localAjv = new Ajv({ allErrors: true, validateFormats: false });
    validate = localAjv.compile(schema);
    validatorCache.set(schemaId, validate);
  }
  const valid = validate(data) as boolean;
  return {
    valid,
    errors: valid ? null : (validate.errors ?? []).map((e: { message?: string; dataPath?: string }) => `${e.dataPath || ''} ${e.message || ''}`).join(', '),
  };
}

/** Validate against a schema entry (single or array). For arrays, passes if ANY schema matches. */
function validateSchemaEntry(
  entry: Record<string, unknown> | Record<string, unknown>[],
  data: unknown,
): { valid: boolean; errors: string | null } {
  if (Array.isArray(entry)) {
    const allErrors: string[] = [];
    for (const schema of entry) {
      const result = validateSchema(schema, data);
      if (result.valid) return result;
      if (result.errors) allErrors.push(result.errors);
    }
    return { valid: false, errors: allErrors.join(' | ') };
  }
  return validateSchema(entry, data);
}

// ---------------------------------------------------------------------------
// Vector Loader
// ---------------------------------------------------------------------------

interface ConformanceVector {
  vector_id: string;
  category: string;
  description: string;
  contract_version: string;
  input: Record<string, unknown>;
  expected_output: Record<string, unknown>;
  expected_valid: boolean;
  matching_rules?: {
    select_fields?: string[];
    numeric_tolerance?: number;
  };
  metadata?: Record<string, unknown>;
}

interface VectorFile {
  path: string;
  relativePath: string;
  category: string;
  data: ConformanceVector | Record<string, unknown>;
}

function loadAllVectors(): VectorFile[] {
  const vectorsDir = resolve(hounfourRoot, 'vectors');
  // Use Node 20+ recursive readdir for nested directory structure
  const allEntries = readdirSync(vectorsDir, { recursive: true, encoding: 'utf-8' });
  const files = (allEntries as string[]).filter((f) => f.endsWith('.json'));

  const vectors: VectorFile[] = [];
  for (const file of files) {
    const fullPath = resolve(vectorsDir, file);
    const raw = readFileSync(fullPath, 'utf-8');
    const data = JSON.parse(raw);
    const category = file.split(/[\\/]/)[0];
    vectors.push({
      path: fullPath,
      relativePath: file,
      category,
      data,
    });
  }

  return vectors.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function loadConformanceVectors(): VectorFile[] {
  return loadAllVectors().filter(
    (v) =>
      v.relativePath.startsWith('conformance/') &&
      'vector_id' in v.data &&
      'expected_valid' in v.data,
  );
}

// ---------------------------------------------------------------------------
// Schema Registry — maps conformance category to JSON Schema object
// Categories explicitly listed with `undefined` are validated structurally
// (no direct schema). Any NEW category not in this map will FAIL the test
// to prevent silent false-positive coverage gaps.
// ---------------------------------------------------------------------------

/** Categories intentionally skipped from schema validation */
const NO_SCHEMA_CATEGORIES = new Set([
  'access-policy',       // Validated via evaluateAccessPolicy function, not schema
  'pricing-calculation', // Complex multi-step — validated structurally
  'reputation-event',    // ReputationEventSchema has unresolvable internal $ref: "TaskType" in ajv
  'tool-call-roundtrip', // Complex multi-step — validated structurally
]);

/**
 * Categories where the vector `input` is a function argument, NOT the schema's
 * domain object. For example, `provider-normalization` vectors provide raw
 * provider API responses as input, while `ProviderSummarySchema` describes the
 * normalized output. Schema validation of `input` is not meaningful for these.
 * Valid vectors in these categories pass structural validation instead.
 *
 * Similarly, some categories have multiple vector sub-types (e.g., constraint
 * lifecycle events vs. constraint candidates) where only one sub-type matches
 * the schema. Vectors whose input shape diverges from the schema pass structurally.
 */
const FUNCTION_INPUT_CATEGORIES = new Set([
  'capability-scoped-trust',  // Input = full agent identity; schema = trust_scopes sub-object
  'conservation-properties',  // Input = registry data; schema = registry + coverage + liveness
  'constraint-lifecycle',     // Some vectors are constraint candidates, not lifecycle events
  'economic-boundary',        // Input = raw boundary request; schema = evaluation result
  'provider-normalization',   // Input = raw provider response; schema = normalized summary
  'reputation-portability',   // Some vectors are portability responses, not requests
  'task-type',                // GovernanceTaskTypeSchema is string-constant anyOf enum; vector inputs are object wrappers
]);

/**
 * Invalid vectors that are semantically invalid (business-rule violations) but
 * structurally valid JSON that conforms to the schema. JSON Schema cannot detect
 * these — they require cross-field validation, ordering checks, or domain rules.
 *
 * Examples: budget exceeding parent, self-transfers, depth limit violations,
 * conservation check failures, cold-state-with-score constraints, etc.
 *
 * These vectors are expected to PASS schema validation. The test verifies that
 * every invalid vector is either (a) rejected by schema, or (b) listed here
 * as a known semantic violation — preventing new categories from silently passing.
 */
const SEMANTIC_INVALID_VECTORS = new Set([
  'conformance-agent-identity-002',            // delegation-requires-trust cross-field
  'conformance-delegation-chain-0003',         // scope escalation (link grants unowned scope)
  'conformance-delegation-chain-0004',         // depth limit exceeded (5 links, max_depth=3)
  'conformance-delegation-outcome-0004',       // unanimous but has disagree vote
  'conformance-delegation-tree-0002',          // children budget exceeds parent
  'conformance-delegation-tree-0003',          // consensus strategy requires >= 3 children
  'conformance-inter-agent-transaction-0003',  // post-balances don't conserve amount
  'conformance-inter-agent-transaction-0004',  // self-transfer (same sender/receiver)
  'conformance-jwt-boundary-003',              // cryptographic step not blocking
  'conformance-monetary-policy-0002',          // collateral ratio below 100% minimum
  'conformance-monetary-policy-0003',          // zero conservation ceiling
  'conformance-policy-version-003',            // supersedes itself
  'conformance-proposal-execution-003',        // completed without completed_at timestamp
  'conformance-registry-bridge-0002',          // self-bridge (same source/target registry)
  'conformance-registry-bridge-0003',          // duplicate invariant IDs
  'conformance-reputation-aggregate-002',      // cold state with non-null personal_score
  'conformance-reputation-aggregate-005',      // authoritative transition weight < threshold
  'conformance-reputation-routing-003',        // expires_at before effective_at
  'conformance-routing-rebalance-003',         // before/after composition IDs identical
]);

// Some categories have vectors matching different schemas (e.g., flat aggregate
// vs snapshot wrapper). Use arrays for multi-schema categories — validation
// passes if ANY schema in the array matches.
type SchemaEntry = Record<string, unknown> | Record<string, unknown>[] | undefined;

const CATEGORY_SCHEMA_MAP: Record<string, SchemaEntry> = {
  'access-policy': undefined,
  'agent-identity': AgentIdentitySchema as Record<string, unknown>,
  'bridge-transfer-saga': BridgeTransferSagaSchema as Record<string, unknown>,
  'capability-scoped-trust': CapabilityScopedTrustSchema as Record<string, unknown>,
  'collection-governance-config': CollectionGovernanceConfigSchema as Record<string, unknown>,
  'community-engagement': CommunityEngagementSignalSchema as Record<string, unknown>,
  'conservation-properties': ConservationPropertyRegistrySchema as Record<string, unknown>,
  'constraint-lifecycle': ConstraintLifecycleEventSchema as Record<string, unknown>,
  'delegation-chain': DelegationChainSchema as Record<string, unknown>,
  'delegation-outcome': DelegationOutcomeSchema as Record<string, unknown>,
  'delegation-quality': DelegationQualityEventSchema as Record<string, unknown>,
  'delegation-tree': DelegationTreeSchema as Record<string, unknown>,
  'economic-boundary': EconomicBoundaryEvaluationResultSchema as Record<string, unknown>,
  'economic-performance': EconomicPerformanceEventSchema as Record<string, unknown>,
  'ensemble-position': EnsembleRequestSchema as Record<string, unknown>,
  'event-subscription': EventSubscriptionSchema as Record<string, unknown>,
  'execution-checkpoint': ExecutionCheckpointSchema as Record<string, unknown>,
  'governance-proposal': GovernanceProposalSchema as Record<string, unknown>,
  'inter-agent-transaction': InterAgentTransactionAuditSchema as Record<string, unknown>,
  'jwt-boundary': JwtBoundarySpecSchema as Record<string, unknown>,
  'liveness-properties': LivenessPropertySchema as Record<string, unknown>,
  'micro-usdc': MicroUSDCSchema as Record<string, unknown>,
  'model-economic-profile': ModelEconomicProfileSchema as Record<string, unknown>,
  'monetary-policy': MonetaryPolicySchema as Record<string, unknown>,
  'permission-boundary': PermissionBoundarySchema as Record<string, unknown>,
  'personality-assignment': PersonalityAssignmentSchema as Record<string, unknown>,
  'policy-version': PolicyVersionSchema as Record<string, unknown>,
  'pricing-calculation': undefined,
  'proposal-execution': ProposalExecutionSchema as Record<string, unknown>,
  'provider-normalization': ProviderSummarySchema as Record<string, unknown>,
  'registry-bridge': RegistryBridgeSchema as Record<string, unknown>,
  'reputation-aggregate': [
    ReputationAggregateSchema as Record<string, unknown>,
    AggregateSnapshotSchema as Record<string, unknown>,
    ReputationTransitionSchema as Record<string, unknown>,
  ],
  'reputation-credential': ReputationCredentialSchema as Record<string, unknown>,
  'reputation-economic-impact': ReputationEconomicImpactSchema as Record<string, unknown>,
  'reputation-portability': ReputationPortabilityRequestSchema as Record<string, unknown>,
  'reputation-event': undefined,  // Schema has unresolvable $ref — skipped via NO_SCHEMA_CATEGORIES
  'reputation-routing': ReputationRoutingSignalSchema as Record<string, unknown>,
  'reservation-enforcement': ReservationEnforcementSchema as Record<string, unknown>,
  'routing-rebalance': RoutingRebalanceEventSchema as Record<string, unknown>,
  'scoring-path-log': GovScoringPathLogSchema as Record<string, unknown>,
  'task-type': GovernanceTaskTypeSchema as Record<string, unknown>,
  'task-type-cohort': GovTaskTypeCohortSchema as Record<string, unknown>,
  'thinking-trace': ThinkingTraceSchema as Record<string, unknown>,
  'tool-call-roundtrip': undefined,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Protocol Conformance Suite (v7.11.0)', () => {
  let allVectors: VectorFile[];
  let conformanceVectors: VectorFile[];

  beforeAll(() => {
    allVectors = loadAllVectors();
    conformanceVectors = loadConformanceVectors();
  });

  // ─── AC-2.4.4: CONTRACT_VERSION ──────────────────────────────────────────

  describe('CONTRACT_VERSION', () => {
    it('should match the actual v7.11.0 protocol version', () => {
      expect(CONTRACT_VERSION).toBe('7.11.0');
    });

    it('should be a valid semver string', () => {
      expect(CONTRACT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  // ─── AC-2.4.1 & AC-2.4.2: Vector loading ─────────────────────────────────

  describe('Vector Loading', () => {
    it('should load all 236 vectors from nested directory structure', () => {
      expect(allVectors.length).toBe(236);
    });

    it('should load 194 conformance vectors', () => {
      expect(conformanceVectors.length).toBe(194);
    });

    it('should cover all 15 top-level categories with JSON files', () => {
      const categories = new Set(allVectors.map((v) => v.category));
      // 15 categories have JSON files (runners/ is empty, VERSION is a file)
      expect(categories.size).toBe(15);
      expect(categories).toContain('conformance');
      expect(categories).toContain('jwt');
      expect(categories).toContain('billing');
      expect(categories).toContain('reputation-score');
      expect(categories).toContain('economic-boundary-evaluation');
      expect(categories).toContain('agent');
      expect(categories).toContain('budget');
      expect(categories).toContain('discovery');
      expect(categories).toContain('health');
      expect(categories).toContain('transfer');
    });

    it('should parse all vector files as valid JSON', () => {
      for (const vec of allVectors) {
        expect(vec.data).toBeDefined();
        expect(typeof vec.data).toBe('object');
      }
    });

    it('every conformance vector has required fields', () => {
      for (const vec of conformanceVectors) {
        const data = vec.data as ConformanceVector;
        expect(data.vector_id, `Missing vector_id in ${vec.relativePath}`).toBeTruthy();
        expect(data.category, `Missing category in ${vec.relativePath}`).toBeTruthy();
        expect(data.description, `Missing description in ${vec.relativePath}`).toBeTruthy();
        expect(data.contract_version, `Missing contract_version in ${vec.relativePath}`).toBeTruthy();
        expect(data.input, `Missing input in ${vec.relativePath}`).toBeDefined();
        expect(typeof data.expected_valid, `expected_valid not boolean in ${vec.relativePath}`).toBe('boolean');
      }
    });
  });

  // ─── AC-2.4.5: Dual-Accept (v6.0.0 support) ─────────────────────────────

  describe('Dual-Accept Window (v6.0.0)', () => {
    it('should have vectors spanning v6.x and v7.x contract versions', () => {
      const versions = new Set(
        conformanceVectors.map((v) => (v.data as ConformanceVector).contract_version),
      );
      const hasMajor6 = [...versions].some((v) => v.startsWith('6.'));
      const hasMajor7 = [...versions].some((v) => v.startsWith('7.'));
      expect(hasMajor6).toBe(true);
      expect(hasMajor7).toBe(true);
    });

    it('should accept vectors with contract_version 6.0.0', () => {
      const v6vectors = conformanceVectors.filter(
        (v) => (v.data as ConformanceVector).contract_version === '6.0.0',
      );
      expect(v6vectors.length).toBeGreaterThan(0);
      for (const vec of v6vectors) {
        const data = vec.data as ConformanceVector;
        expect(data.contract_version).toBe('6.0.0');
        expect(data.vector_id).toBeTruthy();
      }
    });
  });

  // ─── AC-2.4.3: Governance vectors ────────────────────────────────────────

  describe('Governance Conformance Vectors', () => {
    it('should have governance-proposal vectors', () => {
      const govVectors = conformanceVectors.filter(
        (v) => (v.data as ConformanceVector).category === 'governance-proposal',
      );
      expect(govVectors.length).toBeGreaterThanOrEqual(2);
    });

    it('should validate governance-proposal valid vectors against schema', () => {
      const govVectors = conformanceVectors.filter(
        (v) =>
          (v.data as ConformanceVector).category === 'governance-proposal' &&
          (v.data as ConformanceVector).expected_valid === true,
      );
      for (const vec of govVectors) {
        const data = vec.data as ConformanceVector;
        const { valid, errors } = validateSchema(
          GovernanceProposalSchema as Record<string, unknown>,
          data.input,
        );
        expect(valid, `Vector ${data.vector_id} should be valid: ${errors}`).toBe(true);
      }
    });

    it('should reject governance-proposal invalid vectors', () => {
      const invalidGovVectors = conformanceVectors.filter(
        (v) =>
          (v.data as ConformanceVector).category === 'governance-proposal' &&
          (v.data as ConformanceVector).expected_valid === false,
      );
      for (const vec of invalidGovVectors) {
        const data = vec.data as ConformanceVector;
        const { valid } = validateSchema(
          GovernanceProposalSchema as Record<string, unknown>,
          data.input,
        );
        expect(valid, `Vector ${data.vector_id} should be invalid`).toBe(false);
      }
    });
  });

  // ─── AC-2.4.3: Reputation vectors ────────────────────────────────────────

  describe('Reputation Conformance Vectors', () => {
    it('should have reputation-aggregate vectors', () => {
      const repVectors = conformanceVectors.filter(
        (v) => (v.data as ConformanceVector).category === 'reputation-aggregate',
      );
      expect(repVectors.length).toBeGreaterThanOrEqual(5);
    });

    it('should validate reputation-aggregate valid vectors against schema', () => {
      const validRep = conformanceVectors.filter(
        (v) =>
          (v.data as ConformanceVector).category === 'reputation-aggregate' &&
          (v.data as ConformanceVector).expected_valid === true,
      );
      for (const vec of validRep) {
        const data = vec.data as ConformanceVector;
        const repSchemas = CATEGORY_SCHEMA_MAP['reputation-aggregate']!;
        const { valid, errors } = validateSchemaEntry(
          repSchemas as Record<string, unknown>[],
          data.input,
        );
        if (!valid) {
          // Computation vectors (e.g., blended-score-computation) test function
          // behavior with numeric inputs, not schema-conformant domain objects.
          const isComputation =
            data.matching_rules?.select_fields &&
            data.matching_rules.select_fields.length > 0 &&
            data.expected_output &&
            Object.keys(data.expected_output).length > 0;
          expect(
            isComputation,
            `Vector ${data.vector_id} failed schema and is not a computation vector: ${errors}`,
          ).toBe(true);
        }
      }
    });

    it('should have reputation-credential vectors', () => {
      const credVectors = conformanceVectors.filter(
        (v) => (v.data as ConformanceVector).category === 'reputation-credential',
      );
      expect(credVectors.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── AC-2.4.3: Liveness vectors ──────────────────────────────────────────

  describe('Liveness Conformance Vectors', () => {
    it('should have liveness-properties vectors', () => {
      const livenessVectors = conformanceVectors.filter(
        (v) => (v.data as ConformanceVector).category === 'liveness-properties',
      );
      expect(livenessVectors.length).toBeGreaterThanOrEqual(2);
    });

    it('should validate liveness valid vectors against schema', () => {
      const validLiveness = conformanceVectors.filter(
        (v) =>
          (v.data as ConformanceVector).category === 'liveness-properties' &&
          (v.data as ConformanceVector).expected_valid === true,
      );
      for (const vec of validLiveness) {
        const data = vec.data as ConformanceVector;
        const { valid, errors } = validateSchema(
          LivenessPropertySchema as Record<string, unknown>,
          data.input,
        );
        expect(valid, `Vector ${data.vector_id} should be valid: ${errors}`).toBe(true);
      }
    });

    it('should reject liveness invalid vectors', () => {
      const invalidLiveness = conformanceVectors.filter(
        (v) =>
          (v.data as ConformanceVector).category === 'liveness-properties' &&
          (v.data as ConformanceVector).expected_valid === false,
      );
      for (const vec of invalidLiveness) {
        const data = vec.data as ConformanceVector;
        const { valid } = validateSchema(
          LivenessPropertySchema as Record<string, unknown>,
          data.input,
        );
        expect(valid, `Vector ${data.vector_id} should be invalid`).toBe(false);
      }
    });
  });

  // ─── AC-2.4.6: All conformance vectors pass ──────────────────────────────

  describe('All Conformance Vectors (schema validation)', () => {
    it('should validate all valid conformance vectors against their category schema', () => {
      const validVectors = conformanceVectors.filter(
        (v) => (v.data as ConformanceVector).expected_valid === true,
      );

      const results: { vectorId: string; category: string; passed: boolean; error?: string }[] = [];

      for (const vec of validVectors) {
        const data = vec.data as ConformanceVector;
        const hasMapping = Object.prototype.hasOwnProperty.call(CATEGORY_SCHEMA_MAP, data.category);

        if (!hasMapping) {
          results.push({
            vectorId: data.vector_id,
            category: data.category,
            passed: false,
            error: `No schema mapping for category '${data.category}' — add it to CATEGORY_SCHEMA_MAP`,
          });
          continue;
        }

        const schema = CATEGORY_SCHEMA_MAP[data.category];
        if (schema === undefined) {
          if (!NO_SCHEMA_CATEGORIES.has(data.category)) {
            results.push({
              vectorId: data.vector_id,
              category: data.category,
              passed: false,
              error: `Schema mapping is undefined but category '${data.category}' not in NO_SCHEMA_CATEGORIES`,
            });
            continue;
          }
          // Explicitly skipped category — structural validation only
          results.push({ vectorId: data.vector_id, category: data.category, passed: true });
          continue;
        }

        const { valid, errors } = validateSchemaEntry(schema, data.input);
        if (valid) {
          results.push({ vectorId: data.vector_id, category: data.category, passed: true });
        } else {
          // Function-input categories: the vector input is a function argument
          // whose shape differs from the schema target. Validate structurally.
          if (FUNCTION_INPUT_CATEGORIES.has(data.category)) {
            // Structural: input exists, has keys, is an object
            const inputOk =
              data.input != null &&
              typeof data.input === 'object' &&
              Object.keys(data.input).length > 0;
            results.push({
              vectorId: data.vector_id,
              category: data.category,
              passed: inputOk,
              error: inputOk ? undefined : 'Function-input vector has empty/invalid input',
            });
            continue;
          }

          // Computation vectors (matching_rules.select_fields + non-empty
          // expected_output) test function behavior, not schema structure.
          const isComputation =
            data.matching_rules?.select_fields &&
            data.matching_rules.select_fields.length > 0 &&
            data.expected_output &&
            Object.keys(data.expected_output).length > 0;
          if (isComputation) {
            results.push({ vectorId: data.vector_id, category: data.category, passed: true });
          } else {
            results.push({
              vectorId: data.vector_id,
              category: data.category,
              passed: false,
              error: errors ?? 'unknown validation error',
            });
          }
        }
      }

      const failures = results.filter((r) => !r.passed);
      if (failures.length > 0) {
        const summary = failures
          .slice(0, 20) // Limit output for readability
          .map((f) => `  ${f.vectorId} (${f.category}): ${f.error}`)
          .join('\n');
        expect.fail(
          `${failures.length} valid vector(s) failed schema validation:\n${summary}` +
            (failures.length > 20 ? `\n  ... and ${failures.length - 20} more` : ''),
        );
      }
    });

    it('should reject structurally invalid vectors via schema and track semantic violations', () => {
      const invalidVectors = conformanceVectors.filter(
        (v) => (v.data as ConformanceVector).expected_valid === false,
      );

      let structuralRejects = 0;
      let semanticRejects = 0;
      const unexpectedAccepts: { vectorId: string; category: string }[] = [];

      for (const vec of invalidVectors) {
        const data = vec.data as ConformanceVector;
        const hasMapping = Object.prototype.hasOwnProperty.call(CATEGORY_SCHEMA_MAP, data.category);

        if (!hasMapping) {
          unexpectedAccepts.push({ vectorId: data.vector_id, category: data.category });
          continue;
        }

        const schema = CATEGORY_SCHEMA_MAP[data.category];
        if (schema === undefined) {
          if (!NO_SCHEMA_CATEGORIES.has(data.category)) {
            unexpectedAccepts.push({ vectorId: data.vector_id, category: data.category });
            continue;
          }
          // Skipped category — no schema to validate against
          continue;
        }

        const { valid } = validateSchemaEntry(schema, data.input);
        if (!valid) {
          // Schema correctly rejected this invalid vector
          structuralRejects++;
        } else if (SEMANTIC_INVALID_VECTORS.has(data.vector_id)) {
          // Known semantic violation — structurally valid but domain-invalid
          semanticRejects++;
        } else {
          // Unknown false-accept — not in SEMANTIC_INVALID_VECTORS
          unexpectedAccepts.push({ vectorId: data.vector_id, category: data.category });
        }
      }

      // At least some vectors should be rejected by schema alone
      expect(structuralRejects).toBeGreaterThan(0);
      // Semantic violations are tracked and accounted for
      expect(semanticRejects).toBe(SEMANTIC_INVALID_VECTORS.size);

      if (unexpectedAccepts.length > 0) {
        const summary = unexpectedAccepts
          .map((f) => `  ${f.vectorId} (${f.category})`)
          .join('\n');
        expect.fail(
          `${unexpectedAccepts.length} invalid vector(s) were unexpectedly accepted and ` +
            `not listed in SEMANTIC_INVALID_VECTORS:\n${summary}`,
        );
      }
    });
  });

  // ─── Non-conformance category vectors ─────────────────────────────────────

  describe('JWT Vectors', () => {
    it('should load JWT conformance vectors', () => {
      const jwtFiles = allVectors.filter((v) => v.category === 'jwt');
      expect(jwtFiles.length).toBeGreaterThanOrEqual(1);
    });

    it('should have valid JWT claims in vector data', () => {
      const jwtFiles = allVectors.filter((v) => v.category === 'jwt');
      for (const file of jwtFiles) {
        const data = file.data as { vectors?: Array<{ id: string; claims: unknown; expected: string }> };
        if (data.vectors) {
          for (const vec of data.vectors) {
            expect(vec.id).toBeTruthy();
            expect(vec.claims).toBeDefined();
            expect(['valid', 'invalid']).toContain(vec.expected);
          }
        }
      }
    });
  });

  describe('Billing Vectors', () => {
    it('should load billing allocation vectors', () => {
      const billingFiles = allVectors.filter((v) => v.category === 'billing');
      expect(billingFiles.length).toBeGreaterThanOrEqual(1);
    });

    it('should have valid allocation vectors', () => {
      const billingFiles = allVectors.filter((v) => v.category === 'billing');
      for (const file of billingFiles) {
        const data = file.data as { allocation_vectors?: Array<{ id: string; totalCostMicro: string; recipients: unknown[] }> };
        if (data.allocation_vectors) {
          for (const vec of data.allocation_vectors) {
            expect(vec.id).toBeTruthy();
            expect(vec.totalCostMicro).toBeDefined();
            expect(Array.isArray(vec.recipients)).toBe(true);
          }
        }
      }
    });
  });

  describe('Reputation Score Vectors', () => {
    it('should load reputation score vectors', () => {
      const repFiles = allVectors.filter((v) => v.category === 'reputation-score');
      expect(repFiles.length).toBeGreaterThanOrEqual(1);
    });

    it('should validate valid reputation scores against ReputationScoreSchema', () => {
      const repFiles = allVectors.filter((v) => v.category === 'reputation-score');
      for (const file of repFiles) {
        const data = file.data as { valid_scores?: Array<{ id: string; data: unknown }> };
        if (data.valid_scores) {
          for (const vec of data.valid_scores) {
            const { valid, errors } = validateSchema(
              ReputationScoreSchema as Record<string, unknown>,
              vec.data,
            );
            expect(valid, `Reputation score ${vec.id} should be valid: ${errors}`).toBe(true);
          }
        }
      }
    });

    it('should reject invalid reputation scores', () => {
      const repFiles = allVectors.filter((v) => v.category === 'reputation-score');
      for (const file of repFiles) {
        const data = file.data as { invalid_scores?: Array<{ id: string; data: unknown }> };
        if (data.invalid_scores) {
          for (const vec of data.invalid_scores) {
            const { valid } = validateSchema(
              ReputationScoreSchema as Record<string, unknown>,
              vec.data,
            );
            expect(valid, `Reputation score ${vec.id} should be invalid`).toBe(false);
          }
        }
      }
    });
  });

  describe('Economic Boundary Evaluation Vectors', () => {
    it('should load economic boundary evaluation vectors', () => {
      const ebeFiles = allVectors.filter((v) => v.category === 'economic-boundary-evaluation');
      expect(ebeFiles.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe('Budget Vectors', () => {
    it('should load budget vectors', () => {
      const budgetFiles = allVectors.filter((v) => v.category === 'budget');
      expect(budgetFiles.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Cross-Ecosystem Vectors', () => {
    it('should load cross-ecosystem vectors', () => {
      const crossFiles = allVectors.filter((v) => v.category === 'cross-ecosystem');
      expect(crossFiles.length).toBeGreaterThanOrEqual(5);
    });
  });

  // ─── VERSION file check ───────────────────────────────────────────────────

  describe('Vectors VERSION', () => {
    it('should have a VERSION file matching CONTRACT_VERSION', () => {
      const versionPath = resolve(hounfourRoot, 'vectors', 'VERSION');
      const versionContent = readFileSync(versionPath, 'utf-8').trim();
      expect(versionContent).toBe(CONTRACT_VERSION);
    });
  });
});
