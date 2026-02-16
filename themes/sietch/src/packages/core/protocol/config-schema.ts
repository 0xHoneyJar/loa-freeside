/**
 * Constitutional Parameter Schema Registry
 *
 * Every constitutional parameter has a strict typed schema defined here.
 * Proposals are validated against this schema BEFORE entering the governance
 * lifecycle, preventing runtime type errors in money-moving code paths.
 *
 * All durations are stored as integer seconds or days — no floating-point
 * values in value_json. No hours, no months.
 *
 * SDD refs: §3.4 Parameter Schema Registry
 * Sprint refs: Sprint 276, Task 2.3
 *
 * @module packages/core/protocol/config-schema
 */

// =============================================================================
// Schema Types
// =============================================================================

export interface ParamSchema {
  key: string;
  type: 'integer' | 'bigint_micro' | 'integer_seconds' | 'integer_percent' | 'real' | 'string_enum' | 'nullable';
  min?: number;
  max?: number;
  /** Valid values for string_enum type */
  enumValues?: string[];
  description: string;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

// =============================================================================
// Registry
// =============================================================================

export const CONFIG_SCHEMA: Record<string, ParamSchema> = {
  'kyc.basic_threshold_micro': {
    key: 'kyc.basic_threshold_micro',
    type: 'bigint_micro',
    min: 0,
    description: 'KYC basic tier threshold in micro-USD',
  },
  'kyc.enhanced_threshold_micro': {
    key: 'kyc.enhanced_threshold_micro',
    type: 'bigint_micro',
    min: 0,
    description: 'KYC enhanced tier threshold in micro-USD',
  },
  'settlement.hold_seconds': {
    key: 'settlement.hold_seconds',
    type: 'integer_seconds',
    min: 0,
    max: 604800,
    description: 'Settlement hold duration in seconds',
  },
  'payout.min_micro': {
    key: 'payout.min_micro',
    type: 'bigint_micro',
    min: 0,
    description: 'Minimum payout amount in micro-USD',
  },
  'payout.rate_limit_seconds': {
    key: 'payout.rate_limit_seconds',
    type: 'integer_seconds',
    min: 0,
    description: 'Minimum seconds between payouts per account',
  },
  'payout.fee_cap_percent': {
    key: 'payout.fee_cap_percent',
    type: 'integer_percent',
    min: 1,
    max: 100,
    description: 'Maximum fee as percentage of gross payout',
  },
  'revenue_rule.cooldown_seconds': {
    key: 'revenue_rule.cooldown_seconds',
    type: 'integer_seconds',
    min: 0,
    description: 'Revenue rule cooldown in seconds',
  },
  'fraud_rule.cooldown_seconds': {
    key: 'fraud_rule.cooldown_seconds',
    type: 'integer_seconds',
    min: 0,
    description: 'Fraud rule cooldown in seconds',
  },
  'reservation.default_ttl_seconds': {
    key: 'reservation.default_ttl_seconds',
    type: 'integer_seconds',
    min: 30,
    max: 3600,
    description: 'Default reservation TTL in seconds',
  },
  'referral.attribution_window_days': {
    key: 'referral.attribution_window_days',
    type: 'integer',
    min: 1,
    max: 730,
    description: 'Referral attribution window in days',
  },
  'agent.drip_recovery_pct': {
    key: 'agent.drip_recovery_pct',
    type: 'integer_percent',
    min: 1,
    max: 100,
    description: 'Percentage of each new agent earning applied to outstanding clawback receivable',
  },
  'transfer.max_single_micro': {
    key: 'transfer.max_single_micro',
    type: 'bigint_micro',
    min: 0,
    description: 'Maximum amount for a single peer transfer in micro-USD',
  },
  'transfer.daily_limit_micro': {
    key: 'transfer.daily_limit_micro',
    type: 'bigint_micro',
    min: 0,
    description: 'Maximum aggregate daily transfer volume per sender in micro-USD',
  },

  // =========================================================================
  // Agent Governance Parameters (Sprint 289, Task 6.2)
  // SDD refs: §3.3, §4.4.2b
  // =========================================================================

  'governance.agent_quorum_weight': {
    key: 'governance.agent_quorum_weight',
    type: 'real',
    min: 0,
    description: 'Minimum accumulated weight for agent proposal quorum',
  },
  'governance.agent_cooldown_seconds': {
    key: 'governance.agent_cooldown_seconds',
    type: 'integer_seconds',
    min: 0,
    max: 2_592_000, // 30 days max
    description: 'Cooldown period in seconds after agent proposal reaches quorum',
  },
  'governance.max_delegation_per_creator': {
    key: 'governance.max_delegation_per_creator',
    type: 'integer',
    min: 1,
    max: 100,
    description: 'Maximum number of agents a creator can delegate governance weight to',
  },
  'governance.agent_weight_source': {
    key: 'governance.agent_weight_source',
    type: 'string_enum',
    enumValues: ['delegation', 'earned_reputation', 'fixed_allocation'],
    description: 'Weight computation strategy for agent governance voting',
  },
  'governance.fixed_weight_per_agent': {
    key: 'governance.fixed_weight_per_agent',
    type: 'real',
    min: 0,
    description: 'Fixed governance weight per agent (used when agent_weight_source=fixed_allocation)',
  },
  'governance.reputation_window_seconds': {
    key: 'governance.reputation_window_seconds',
    type: 'integer_seconds',
    min: 0,
    max: 31_536_000, // 365 days max
    description: 'Time window for earned reputation weight computation',
  },
  'governance.reputation_scale_factor': {
    key: 'governance.reputation_scale_factor',
    type: 'real',
    min: 0,
    max: 100,
    description: 'Scale factor applied to earned reputation for weight computation',
  },
  'governance.max_weight_per_agent': {
    key: 'governance.max_weight_per_agent',
    type: 'real',
    min: 0,
    description: 'Maximum governance weight any single agent can have',
  },
};

// =============================================================================
// Compile-time Fallback Values
// =============================================================================

export const CONFIG_FALLBACKS: Record<string, number | string> = {
  'kyc.basic_threshold_micro': 100_000_000,
  'kyc.enhanced_threshold_micro': 600_000_000,
  'settlement.hold_seconds': 172_800,
  'payout.min_micro': 1_000_000,
  'payout.rate_limit_seconds': 86_400,
  'payout.fee_cap_percent': 20,
  'revenue_rule.cooldown_seconds': 172_800,
  'fraud_rule.cooldown_seconds': 604_800,
  'reservation.default_ttl_seconds': 300,
  'referral.attribution_window_days': 365,
  'agent.drip_recovery_pct': 50,
  'transfer.max_single_micro': 100_000_000,   // $100
  'transfer.daily_limit_micro': 500_000_000,  // $500

  // Agent Governance (Sprint 289)
  'governance.agent_quorum_weight': 10,              // 10.0 weight units for quorum
  'governance.agent_cooldown_seconds': 86_400,       // 24 hours
  'governance.max_delegation_per_creator': 5,        // max 5 agents per creator
  'governance.agent_weight_source': 'delegation',    // default weight source
  'governance.fixed_weight_per_agent': 1,            // 1.0 weight per agent
  'governance.reputation_window_seconds': 2_592_000, // 30 days
  'governance.reputation_scale_factor': 1,           // 1.0x scaling
  'governance.max_weight_per_agent': 10,             // cap at 10.0
};

// =============================================================================
// Validation
// =============================================================================

/**
 * Validate a proposed config value against its schema.
 * Returns { valid: true } or { valid: false, error: '...' }.
 */
export function validateConfigValue(key: string, value: unknown): ValidationResult {
  const schema = CONFIG_SCHEMA[key];
  if (!schema) {
    return { valid: false, error: `Unknown parameter key: '${key}'` };
  }

  if (schema.type === 'nullable' && value === null) {
    return { valid: true };
  }

  // String enum: validate against allowed values
  if (schema.type === 'string_enum') {
    if (typeof value !== 'string') {
      return { valid: false, error: `Parameter '${key}' requires a string value, got: ${typeof value}` };
    }
    if (!schema.enumValues || schema.enumValues.length === 0) {
      return { valid: false, error: `Parameter '${key}' has no enumValues defined in schema` };
    }
    if (!schema.enumValues.includes(value)) {
      return { valid: false, error: `Parameter '${key}' value '${value}' not in allowed values: ${schema.enumValues.join(', ')}` };
    }
    return { valid: true };
  }

  // All numeric types (integer, bigint_micro, integer_seconds, integer_percent, real)
  const numValue = typeof value === 'string' ? Number(value) : (typeof value === 'number' ? value : NaN);

  if (!Number.isFinite(numValue)) {
    return { valid: false, error: `Parameter '${key}' requires a numeric value, got: ${typeof value}` };
  }

  // Real type allows non-integer values; all others require integers
  if (schema.type !== 'real' && !Number.isInteger(numValue)) {
    return { valid: false, error: `Parameter '${key}' requires an integer value, got: ${numValue}` };
  }

  if (schema.min !== undefined && numValue < schema.min) {
    return { valid: false, error: `Parameter '${key}' value ${numValue} is below minimum ${schema.min}` };
  }

  if (schema.max !== undefined && numValue > schema.max) {
    return { valid: false, error: `Parameter '${key}' value ${numValue} exceeds maximum ${schema.max}` };
  }

  return { valid: true };
}
