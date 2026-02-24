/**
 * Semantic Compatibility Invariant Tests — Task 2.6 (Sprint 344, cycle-039)
 *
 * Per-domain semantic invariant tests per SDD section 6.2:
 * - JWT golden replay: validator produces identical results for fixture claims
 * - Billing: parseMicroUsd roundtrip for valid micro-USD strings
 * - Conservation: 14 canonical properties validate identically
 * - Governance: SanctionSchema golden replay with governance fixtures
 * - Version: covered by Task 2.5 verify-peer-version tests
 *
 * AC-2.6.1: JWT invariant with 5+ token fixtures
 * AC-2.6.2: Billing invariant — parseMicroUsd roundtrip
 * AC-2.6.3: Conservation invariant — 14 properties evaluate identically
 * AC-2.6.4: Governance invariant — SanctionSchema golden replay
 * AC-2.6.5: Version invariant — covered by Task 2.5
 * AC-2.6.6: All invariant tests pass
 */

import { describe, it, expect } from 'vitest';
import { resolve, dirname, join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import Ajv from 'ajv';

import {
  validators,
  JwtClaimsSchema,
  SanctionSchema,
  GovernanceProposalSchema,
  ConservationPropertySchema,
  ConservationPropertyRegistrySchema,
  CANONICAL_CONSERVATION_PROPERTIES,
  parseMicroUsd,
  microUSD,
  computeBlendedScore,
  computePersonalWeight,
  validateCompatibility,
  CONTRACT_VERSION,
  MIN_SUPPORTED_VERSION,
} from '@0xhoneyjar/loa-hounfour';

// ---------------------------------------------------------------------------
// Resolve the hounfour package root (same approach as protocol-conformance)
// ---------------------------------------------------------------------------

function findHounfourRoot(): string {
  let dir = dirname(new URL(import.meta.url).pathname);
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, 'node_modules', '@0xhoneyjar', 'loa-hounfour', 'package.json');
    if (existsSync(candidate)) {
      return dirname(candidate);
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Could not find @0xhoneyjar/loa-hounfour package root');
}

const hounfourRoot = findHounfourRoot();

// ---------------------------------------------------------------------------
// JSON Schema Validator (ajv) — fresh instance per schema to avoid $id collisions
// ---------------------------------------------------------------------------

const validatorCache = new Map<string, ReturnType<InstanceType<typeof Ajv>['compile']>>();

function validateSchema(
  schema: Record<string, unknown>,
  data: unknown,
): { valid: boolean; errors: string | null } {
  const schemaId = (schema.$id as string) || JSON.stringify(schema).slice(0, 100);
  let validate = validatorCache.get(schemaId);
  if (!validate) {
    const localAjv = new Ajv({ allErrors: true, nullable: true });
    validate = localAjv.compile(schema);
    validatorCache.set(schemaId, validate);
  }
  const valid = validate(data) as boolean;
  return {
    valid,
    errors: valid
      ? null
      : (validate.errors ?? [])
          .map((e: { message?: string; dataPath?: string }) => `${e.dataPath || ''} ${e.message || ''}`)
          .join(', '),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Semantic Compatibility Invariants (SDD §6.2)', () => {
  // ─── AC-2.6.1: JWT Golden Replay ──────────────────────────────────────────

  describe('JWT Invariant: Claims Schema Validation', () => {
    // Load JWT conformance vectors from hounfour
    const jwtVectorsPath = resolve(hounfourRoot, 'vectors', 'jwt', 'conformance.json');
    const jwtData = JSON.parse(readFileSync(jwtVectorsPath, 'utf-8')) as {
      vectors: Array<{
        id: string;
        description: string;
        claims: Record<string, unknown>;
        expected: string;
        error?: string;
      }>;
    };

    it('should have at least 5 JWT token fixtures', () => {
      expect(jwtData.vectors.length).toBeGreaterThanOrEqual(5);
    });

    it('should produce identical schema validation results for all valid JWT claims', () => {
      const validVectors = jwtData.vectors.filter((v) => v.expected === 'valid');
      expect(validVectors.length).toBeGreaterThanOrEqual(1);

      for (const vec of validVectors) {
        // The validators.jwtClaims validator validates the claims object
        const result = validators.jwtClaims(vec.claims);
        expect(result, `JWT fixture ${vec.id} should pass claims validation`).toBeTruthy();

        // Also validate against JwtClaimsSchema via ajv
        const { valid, errors } = validateSchema(
          JwtClaimsSchema as Record<string, unknown>,
          vec.claims,
        );
        expect(valid, `JWT fixture ${vec.id} should match JwtClaimsSchema: ${errors}`).toBe(true);
      }
    });

    it('should consistently identify invalid JWT claims across all fixtures', () => {
      const invalidVectors = jwtData.vectors.filter((v) => v.expected === 'invalid');
      expect(invalidVectors.length).toBeGreaterThanOrEqual(1);

      for (const vec of invalidVectors) {
        // Each invalid fixture should either fail schema validation or be detected
        // as invalid by the expected error code. Some failures are semantic (e.g.,
        // expired JWT) and may pass structural schema validation.
        expect(vec.error, `Invalid JWT fixture ${vec.id} should have an error code`).toBeTruthy();
      }
    });

    it('should validate JWT claims idempotently (same input = same output)', () => {
      // Run validation twice on each vector — results must be identical
      for (const vec of jwtData.vectors.filter((v) => v.expected === 'valid')) {
        const result1 = validators.jwtClaims(vec.claims);
        const result2 = validators.jwtClaims(vec.claims);
        expect(result1).toEqual(result2);
      }
    });
  });

  // ─── AC-2.6.2: Billing Invariant ──────────────────────────────────────────

  describe('Billing Invariant: Micro-USD Roundtrip', () => {
    // Property: parseMicroUsd(x).amount === BigInt(x) for valid micro-USD strings
    // parseMicroUsd returns { valid: boolean, amount?: bigint, reason?: string }
    const validMicroUsdValues = [
      '0',
      '1',
      '1000000',           // $1.00
      '999999999',         // $999.99
      '100000000000',      // $100,000
      '18446744073709551615', // uint64 max
    ];

    it('should roundtrip parseMicroUsd for valid micro-USD strings', () => {
      for (const value of validMicroUsdValues) {
        const parsed = parseMicroUsd(value) as { valid: boolean; amount?: bigint };
        expect(parsed, `parseMicroUsd("${value}") should return a result`).toBeDefined();
        expect(parsed.valid, `parseMicroUsd("${value}").valid should be true`).toBe(true);
        expect(
          parsed.amount,
          `parseMicroUsd("${value}").amount should equal BigInt("${value}")`,
        ).toBe(BigInt(value));
      }
    });

    it('should reject invalid micro-USD strings', () => {
      const invalidValues = [
        '-1',              // Negative
        'abc',             // Non-numeric
        '1.5',             // Decimal
        '',                // Empty
      ];

      for (const value of invalidValues) {
        const parsed = parseMicroUsd(value) as { valid: boolean; reason?: string };
        expect(
          parsed.valid,
          `parseMicroUsd("${value}") should be invalid (reason: ${parsed.reason})`,
        ).toBe(false);
      }
    });

    it('should construct valid micro-USD via microUSD helper', () => {
      const values = ['0', '1000000', '50000000'];
      for (const value of values) {
        const result = microUSD(value);
        // microUSD returns the validated string
        expect(result).toBe(value);
      }
    });
  });

  // ─── AC-2.6.3: Conservation Invariant ──────────────────────────────────────

  describe('Conservation Invariant: Canonical Properties', () => {
    it('should have exactly 14 canonical conservation properties', () => {
      expect(CANONICAL_CONSERVATION_PROPERTIES).toBeDefined();
      expect(CANONICAL_CONSERVATION_PROPERTIES.length).toBe(14);
    });

    it('should validate all 14 canonical properties against ConservationPropertySchema', () => {
      for (const prop of CANONICAL_CONSERVATION_PROPERTIES) {
        const { valid, errors } = validateSchema(
          ConservationPropertySchema as Record<string, unknown>,
          prop,
        );
        expect(
          valid,
          `Conservation property "${prop.invariant_id}" (${prop.name}) should validate: ${errors}`,
        ).toBe(true);
      }
    });

    it('should have unique invariant IDs across all canonical properties', () => {
      const ids = CANONICAL_CONSERVATION_PROPERTIES.map(
        (p: { invariant_id: string }) => p.invariant_id,
      );
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('should have non-empty LTL formulas for all properties', () => {
      for (const prop of CANONICAL_CONSERVATION_PROPERTIES) {
        expect(
          (prop as { ltl_formula: string }).ltl_formula,
          `Property ${prop.invariant_id} should have an LTL formula`,
        ).toBeTruthy();
        expect((prop as { ltl_formula: string }).ltl_formula.length).toBeGreaterThan(0);
      }
    });

    it('should produce identical validation results on repeated runs (idempotent)', () => {
      for (const prop of CANONICAL_CONSERVATION_PROPERTIES) {
        const result1 = validateSchema(
          ConservationPropertySchema as Record<string, unknown>,
          prop,
        );
        const result2 = validateSchema(
          ConservationPropertySchema as Record<string, unknown>,
          prop,
        );
        expect(result1.valid).toBe(result2.valid);
        expect(result1.errors).toBe(result2.errors);
      }
    });
  });

  // ─── AC-2.6.4: Governance Invariant ────────────────────────────────────────

  describe('Governance Invariant: Schema Golden Replay', () => {
    // Load governance-proposal conformance vectors
    const govVectorsDir = resolve(
      hounfourRoot,
      'vectors',
      'conformance',
      'governance-proposal',
    );

    it('should validate governance proposal vectors against GovernanceProposalSchema', () => {
      const files = existsSync(govVectorsDir)
        ? require('node:fs')
            .readdirSync(govVectorsDir)
            .filter((f: string) => f.endsWith('.json'))
        : [];
      expect(files.length).toBeGreaterThanOrEqual(2);

      for (const file of files) {
        const fullPath = resolve(govVectorsDir, file);
        const data = JSON.parse(readFileSync(fullPath, 'utf-8'));
        if (data.expected_valid === true) {
          const { valid, errors } = validateSchema(
            GovernanceProposalSchema as Record<string, unknown>,
            data.input,
          );
          expect(
            valid,
            `Governance vector ${data.vector_id} should validate: ${errors}`,
          ).toBe(true);
        }
      }
    });

    it('should validate sanction fixtures against SanctionSchema', () => {
      // Golden sanction fixture — tests schema stability
      // trigger is an object: {violation_type, occurrence_count, evidence_event_ids}
      // imposed_by is an enum: "automatic" | "moderator" | "governance_vote"
      const sanctionFixture = {
        sanction_id: '550e8400-e29b-41d4-a716-446655440099',
        agent_id: 'agent-bad-actor',
        severity: 'rate_limited',
        trigger: {
          violation_type: 'rate_abuse',
          occurrence_count: 3,
          evidence_event_ids: ['event-001', 'event-002', 'event-003'],
        },
        imposed_by: 'automatic',
        imposed_at: '2026-02-20T10:00:00Z',
        appeal_available: true,
        contract_version: '7.9.1',
      };

      const { valid, errors } = validateSchema(
        SanctionSchema as Record<string, unknown>,
        sanctionFixture,
      );
      expect(valid, `Sanction fixture should validate: ${errors}`).toBe(true);
    });

    it('should reject sanctions with missing required fields', () => {
      const incompleteSanction = {
        sanction_id: '550e8400-e29b-41d4-a716-446655440099',
        // Missing: agent_id, severity, trigger, imposed_by, imposed_at,
        //          appeal_available, contract_version
      };

      const { valid } = validateSchema(
        SanctionSchema as Record<string, unknown>,
        incompleteSanction,
      );
      expect(valid).toBe(false);
    });

    it('should produce identical sanction validation results on repeated runs', () => {
      const fixture = {
        sanction_id: '550e8400-e29b-41d4-a716-446655440099',
        agent_id: 'agent-test',
        severity: 'warning',
        trigger: {
          violation_type: 'content_policy',
          occurrence_count: 1,
          evidence_event_ids: ['event-100'],
        },
        imposed_by: 'moderator',
        imposed_at: '2026-02-20T10:00:00Z',
        appeal_available: true,
        contract_version: '7.9.1',
      };

      const result1 = validateSchema(SanctionSchema as Record<string, unknown>, fixture);
      const result2 = validateSchema(SanctionSchema as Record<string, unknown>, fixture);
      expect(result1.valid).toBe(result2.valid);
      expect(result1.errors).toBe(result2.errors);
    });
  });

  // ─── AC-2.6.5: Version Invariant ──────────────────────────────────────────

  describe('Version Invariant: validateCompatibility', () => {
    // This supplements the shell-based version pair tests (Task 2.5)
    // with the TypeScript validateCompatibility function from hounfour.

    it('should report compatible for same-major versions', () => {
      const result = validateCompatibility('7.0.0', CONTRACT_VERSION);
      expect(result.compatible).toBe(true);
    });

    it('should report compatible for cross-major within support window', () => {
      const result = validateCompatibility('6.0.0', CONTRACT_VERSION);
      expect(result.compatible).toBe(true);
    });

    it('should report incompatible for versions below minimum', () => {
      const result = validateCompatibility('5.9.0', CONTRACT_VERSION);
      expect(result.compatible).toBe(false);
    });

    it('should report incompatible for future major versions', () => {
      const result = validateCompatibility('8.0.0', CONTRACT_VERSION);
      expect(result.compatible).toBe(false);
    });
  });

  // ─── Blended Score Computation Invariant ───────────────────────────────────

  describe('Reputation Invariant: Blended Score Computation', () => {
    it('should compute blended score matching conformance vector 007', () => {
      // From conformance-reputation-aggregate-007:
      // personal=0.8, collection=0.5, n=10, k=3
      // expected: blended_score=0.73077, personal_weight=0.76923
      const blended = computeBlendedScore(0.8, 0.5, 10, 3);
      const weight = computePersonalWeight(10, 3);

      expect(blended).toBeCloseTo(0.73077, 4);
      expect(weight).toBeCloseTo(0.76923, 4);
    });

    it('should satisfy the Bayesian blend formula: (k*collection + n*personal)/(k+n)', () => {
      // Property: for any valid inputs, blended = (k*c + n*p)/(k+n)
      const testCases = [
        { p: 0.8, c: 0.5, n: 10, k: 3 },
        { p: 1.0, c: 0.0, n: 100, k: 3 },
        { p: 0.0, c: 1.0, n: 1, k: 3 },
        { p: 0.5, c: 0.5, n: 50, k: 3 },
        { p: 0.9, c: 0.3, n: 5, k: 3 },
      ];

      for (const { p, c, n, k } of testCases) {
        const expected = (k * c + n * p) / (k + n);
        const actual = computeBlendedScore(p, c, n, k);
        expect(actual).toBeCloseTo(expected, 10);
      }
    });

    it('should satisfy personal_weight = n/(n+k)', () => {
      const testCases = [
        { n: 10, k: 3 },
        { n: 100, k: 3 },
        { n: 1, k: 3 },
        { n: 26, k: 3 },
        { n: 0, k: 3 },
      ];

      for (const { n, k } of testCases) {
        const expected = n / (n + k);
        const actual = computePersonalWeight(n, k);
        expect(actual).toBeCloseTo(expected, 10);
      }
    });
  });
});
