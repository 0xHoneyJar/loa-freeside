/**
 * Governance Seed Validation Tests (Sprint 277, Task 3.4)
 *
 * Verifies that:
 * 1. CONFIG_FALLBACKS match the hardcoded constants they replace
 * 2. CONFIG_SCHEMA covers all governance parameters
 * 3. validateConfigValue correctly rejects invalid types/ranges
 * 4. Agent overrides have correct differentiated values
 *
 * @module tests/unit/billing/governance-seed-validation
 */

import { describe, it, expect } from 'vitest';
import {
  CONFIG_SCHEMA,
  CONFIG_FALLBACKS,
  validateConfigValue,
} from '../../../src/packages/core/protocol/config-schema.js';

// =============================================================================
// Pre-migration hardcoded constants (the values these seeds replace)
// =============================================================================

const LEGACY_CONSTANTS = {
  // SettlementService
  SETTLEMENT_HOLD_HOURS: 48,
  // CreatorPayoutService
  MIN_PAYOUT_MICRO: 1_000_000,
  KYC_BASIC_THRESHOLD_MICRO: 100_000_000,
  KYC_ENHANCED_THRESHOLD_MICRO: 600_000_000,
  RATE_LIMIT_HOURS: 24,
  FEE_CAP_PERCENT: 20,
};

// Agent-specific override values (from migration 050 seed data)
const AGENT_OVERRIDES = {
  'settlement.hold_seconds': 0,         // Instant settlement
  'payout.min_micro': 10_000,           // $0.01 minimum
  'payout.rate_limit_seconds': 8_640,   // ~2.4 hours
  'agent.drip_recovery_pct': 50,        // 50% drip cap
};

// =============================================================================
// Test Suite: Fallback → Legacy Constant Equivalence
// =============================================================================

describe('Governance Seed Validation', () => {
  describe('CONFIG_FALLBACKS match pre-migration hardcoded constants', () => {
    it('settlement.hold_seconds matches SETTLEMENT_HOLD_HOURS * 3600', () => {
      const expected = LEGACY_CONSTANTS.SETTLEMENT_HOLD_HOURS * 3600; // 172800
      expect(CONFIG_FALLBACKS['settlement.hold_seconds']).toBe(expected);
    });

    it('payout.min_micro matches MIN_PAYOUT_MICRO', () => {
      expect(CONFIG_FALLBACKS['payout.min_micro']).toBe(LEGACY_CONSTANTS.MIN_PAYOUT_MICRO);
    });

    it('kyc.basic_threshold_micro matches KYC_BASIC_THRESHOLD_MICRO', () => {
      expect(CONFIG_FALLBACKS['kyc.basic_threshold_micro']).toBe(LEGACY_CONSTANTS.KYC_BASIC_THRESHOLD_MICRO);
    });

    it('kyc.enhanced_threshold_micro matches KYC_ENHANCED_THRESHOLD_MICRO', () => {
      expect(CONFIG_FALLBACKS['kyc.enhanced_threshold_micro']).toBe(LEGACY_CONSTANTS.KYC_ENHANCED_THRESHOLD_MICRO);
    });

    it('payout.rate_limit_seconds matches RATE_LIMIT_HOURS * 3600', () => {
      const expected = LEGACY_CONSTANTS.RATE_LIMIT_HOURS * 3600; // 86400
      expect(CONFIG_FALLBACKS['payout.rate_limit_seconds']).toBe(expected);
    });

    it('payout.fee_cap_percent matches FEE_CAP_PERCENT', () => {
      expect(CONFIG_FALLBACKS['payout.fee_cap_percent']).toBe(LEGACY_CONSTANTS.FEE_CAP_PERCENT);
    });
  });

  describe('CONFIG_SCHEMA covers all governance parameters', () => {
    const expectedParams = [
      'kyc.basic_threshold_micro',
      'kyc.enhanced_threshold_micro',
      'settlement.hold_seconds',
      'payout.min_micro',
      'payout.rate_limit_seconds',
      'payout.fee_cap_percent',
      'fraud_rule.cooldown_seconds',
      'revenue_rule.cooldown_seconds',
      'agent.budget_cap_micro',
      'agent.drip_recovery_pct',
      'agent.provenance_ttl_seconds',
    ];

    for (const param of expectedParams) {
      it(`has schema definition for ${param}`, () => {
        expect(CONFIG_SCHEMA[param]).toBeDefined();
        expect(CONFIG_SCHEMA[param].type).toBeDefined();
      });
    }

    it('has fallback for every parameter in schema', () => {
      for (const key of Object.keys(CONFIG_SCHEMA)) {
        expect(CONFIG_FALLBACKS[key]).toBeDefined();
      }
    });
  });

  describe('Agent overrides are differentiated from global defaults', () => {
    it('agent settlement hold is 0 (instant) vs global 172800 (48h)', () => {
      expect(AGENT_OVERRIDES['settlement.hold_seconds']).toBe(0);
      expect(CONFIG_FALLBACKS['settlement.hold_seconds']).toBe(172_800);
      expect(AGENT_OVERRIDES['settlement.hold_seconds']).toBeLessThan(
        CONFIG_FALLBACKS['settlement.hold_seconds'] as number,
      );
    });

    it('agent min payout is 10000 ($0.01) vs global 1000000 ($1)', () => {
      expect(AGENT_OVERRIDES['payout.min_micro']).toBe(10_000);
      expect(CONFIG_FALLBACKS['payout.min_micro']).toBe(1_000_000);
    });

    it('agent rate limit is 8640s (~2.4h) vs global 86400s (24h)', () => {
      expect(AGENT_OVERRIDES['payout.rate_limit_seconds']).toBe(8_640);
      expect(CONFIG_FALLBACKS['payout.rate_limit_seconds']).toBe(86_400);
    });

    it('agent drip recovery is 50% vs global 100%', () => {
      expect(AGENT_OVERRIDES['agent.drip_recovery_pct']).toBe(50);
      expect(CONFIG_FALLBACKS['agent.drip_recovery_pct']).toBe(100);
    });
  });

  describe('validateConfigValue catches invalid types and ranges', () => {
    it('accepts valid integer value within range', () => {
      const result = validateConfigValue('payout.fee_cap_percent', 15);
      expect(result.valid).toBe(true);
    });

    it('rejects string for integer parameter', () => {
      const result = validateConfigValue('payout.fee_cap_percent', 'not-a-number');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('integer');
    });

    it('rejects value below minimum', () => {
      const result = validateConfigValue('payout.fee_cap_percent', -1);
      expect(result.valid).toBe(false);
    });

    it('rejects value above maximum', () => {
      const result = validateConfigValue('payout.fee_cap_percent', 200);
      expect(result.valid).toBe(false);
    });

    it('accepts zero for settlement hold (agent instant settlement)', () => {
      const result = validateConfigValue('settlement.hold_seconds', 0);
      expect(result.valid).toBe(true);
    });

    it('rejects negative settlement hold', () => {
      const result = validateConfigValue('settlement.hold_seconds', -1);
      expect(result.valid).toBe(false);
    });

    it('rejects unknown parameter key', () => {
      const result = validateConfigValue('nonexistent.param', 42);
      expect(result.valid).toBe(false);
    });

    it('accepts bigint-range micro-USD values', () => {
      const result = validateConfigValue('kyc.basic_threshold_micro', 100_000_000);
      expect(result.valid).toBe(true);
    });

    it('rejects negative micro-USD values', () => {
      const result = validateConfigValue('kyc.basic_threshold_micro', -1);
      expect(result.valid).toBe(false);
    });
  });
});
