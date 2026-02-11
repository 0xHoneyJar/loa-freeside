/**
 * Agent Gateway Configuration
 * Sprint S1-T4: Config loader with env vars and sensible defaults
 *
 * Reads agent gateway configuration from environment variables.
 * All env vars documented: LOA_FINN_BASE_URL, AGENT_ENABLED, AGENT_JWT_SECRET_ID, etc.
 *
 * @see SDD §4.8 Factory Function
 */

import { z } from 'zod';
import { MODEL_ALIAS_VALUES } from '@arrakis/core/ports';
import type { JwtServiceConfig } from './jwt-service.js';
import type { S2SJwtValidatorConfig } from './s2s-jwt-validator.js';
import type { TierMappingConfig } from './tier-access-mapper.js';
import { DEFAULT_TIER_MAP } from './tier-access-mapper.js';

// --------------------------------------------------------------------------
// Budget Constants (Flatline IMP-002)
// --------------------------------------------------------------------------

// 300_000ms (5min): Matches max expected loa-finn response time (30s timeout * 3 retries)
// + reconciliation delay (30s) + buffer. See SDD §8.2 Reservation TTL.
export const RESERVATION_TTL_MS = 300_000;

// 86_400s (24h): Prevents double-finalization across reaper cycles and retries.
// Must exceed max retry window + max reconciliation delay. See SDD §8.3.
export const FINALIZED_MARKER_TTL_S = 86_400;

// 0.80 (80%): Industry standard warning threshold (AWS Budgets default).
// Gives communities ~20% runway to react before hard cutoff.
export const BUDGET_WARNING_THRESHOLD = 0.80;

// --------------------------------------------------------------------------
// Redis Connection Defaults (S1-T1: Bridgebuilder Finding #8)
// --------------------------------------------------------------------------

// 500ms: p99 Redis latency is ~2ms; 500ms allows for GC pauses and network jitter
// without blocking the Node.js event loop indefinitely. See SDD §4.4.
export const REDIS_COMMAND_TIMEOUT_MS = 500;

// 5000ms: Initial connection timeout. Generous to handle cold starts and DNS resolution.
export const REDIS_CONNECT_TIMEOUT_MS = 5_000;

// 1: Fail fast on Redis errors. In the request path, retrying slows all concurrent
// requests. The circuit breaker handles repeated failures at a higher level.
export const REDIS_MAX_RETRIES_PER_REQUEST = 1;

// --------------------------------------------------------------------------
// Configuration Types
// --------------------------------------------------------------------------

/** loa-finn client configuration */
export interface LoaFinnConfig {
  /** Base URL for loa-finn API */
  baseUrl: string;
  /** Request timeout in milliseconds */
  timeoutMs: number;
  /** Circuit breaker failure threshold */
  circuitBreakerThreshold: number;
  /** Circuit breaker reset timeout in milliseconds */
  circuitBreakerResetMs: number;
}

/** Budget manager configuration */
export interface BudgetConfig {
  /** Reservation TTL in milliseconds */
  reservationTtlMs: number;
  /** Finalized marker TTL in seconds */
  finalizedMarkerTtlS: number;
  /** Warning threshold (0-1) */
  warningThreshold: number;
}

/** Rate limit configuration */
export interface RateLimitConfig {
  /** Per-IP pre-auth rate limit (requests/minute) */
  preAuthPerMinute: number;
  /** Per-user sliding window (requests/minute) */
  userPerMinute: number;
  /** Per-community sliding window (requests/minute) */
  communityPerMinute: number;
  /** Per-channel sliding window (requests/minute) */
  channelPerMinute: number;
  /** Burst limit (tokens) */
  burstLimit: number;
}

/** S2S JWT validation configuration (inbound loa-finn → arrakis) */
export interface S2SValidationConfig {
  /** loa-finn base URL for JWKS fetch */
  loaFinnBaseUrl: string;
  /** Expected JWT issuer (default: "loa-finn") */
  expectedIssuer: string;
  /** Expected JWT audience (default: "arrakis") */
  expectedAudience: string;
  /** JWKS cache TTL in ms (default: 3,600,000 = 1h) */
  jwksCacheTtlMs: number;
  /** Max stale-if-error TTL in ms (default: 259,200,000 = 72h) */
  jwksStaleMaxMs: number;
  /** Min interval between JWKS refreshes in ms (default: 60,000 = 60s) */
  jwksRefreshCooldownMs: number;
  /** Clock-skew leeway in seconds for exp/nbf/iat (default: 30) */
  clockToleranceSec: number;
}

/** Pool claim enforcement mode — @see Bridgebuilder F-14 */
export type PoolClaimEnforcement = 'warn' | 'reject';

/** Usage receiver configuration (inbound usage reports from loa-finn) */
export interface UsageReceiverConfig {
  /** Maximum cost per report in micro-USD (safety cap, default: 100B = $100K) */
  maxCostMicroUsd: bigint;
  /** Maximum report_id length (default: 256) */
  maxReportIdLength: number;
  /** Pool claim enforcement mode: 'warn' (default) or 'reject' — @see Bridgebuilder F-14 */
  poolClaimEnforcement: PoolClaimEnforcement;
}

/** BYOK configuration */
export interface BYOKConfig {
  /** Whether BYOK is enabled (BYOK_ENABLED, default: false) */
  enabled: boolean;
  /** Daily request quota per community (BYOK_DAILY_QUOTA, default: 10_000) */
  dailyQuota: number;
}

/** Full agent gateway configuration */
export interface AgentGatewayConfig {
  /** Whether agent gateway is enabled */
  enabled: boolean;
  /** Whether ensemble orchestration is enabled (ENSEMBLE_ENABLED, default: false) */
  ensembleEnabled: boolean;
  /** AWS Secrets Manager secret ID for JWT signing key (used by factory to create KeyLoader) */
  jwtSecretId: string;
  /** JWT service configuration */
  jwt: JwtServiceConfig;
  /** Tier→access mapping */
  tierMapping: TierMappingConfig;
  /** loa-finn client */
  loaFinn: LoaFinnConfig;
  /** Budget manager */
  budget: BudgetConfig;
  /** Rate limits */
  rateLimits: RateLimitConfig;
  /** S2S JWT validation (inbound from loa-finn) */
  s2sValidation: S2SValidationConfig;
  /** Usage receiver */
  usageReceiver: UsageReceiverConfig;
  /** BYOK (Bring Your Own Key) configuration — FR-4 */
  byok: BYOKConfig;
}

// --------------------------------------------------------------------------
// Environment Variables
// --------------------------------------------------------------------------

const ENV_VARS = {
  AGENT_ENABLED: 'AGENT_ENABLED',
  ENSEMBLE_ENABLED: 'ENSEMBLE_ENABLED',
  LOA_FINN_BASE_URL: 'LOA_FINN_BASE_URL',
  LOA_FINN_TIMEOUT_MS: 'LOA_FINN_TIMEOUT_MS',
  AGENT_JWT_SECRET_ID: 'AGENT_JWT_SECRET_ID',
  AGENT_JWT_KEY_ID: 'AGENT_JWT_KEY_ID',
  AGENT_JWT_EXPIRY_SEC: 'AGENT_JWT_EXPIRY_SEC',
  AGENT_RATE_LIMIT_USER_PER_MIN: 'AGENT_RATE_LIMIT_USER_PER_MIN',
  AGENT_RATE_LIMIT_COMMUNITY_PER_MIN: 'AGENT_RATE_LIMIT_COMMUNITY_PER_MIN',
  AGENT_RATE_LIMIT_CHANNEL_PER_MIN: 'AGENT_RATE_LIMIT_CHANNEL_PER_MIN',
  AGENT_RATE_LIMIT_BURST: 'AGENT_RATE_LIMIT_BURST',
  AGENT_PREAUTH_RATE_LIMIT_PER_MIN: 'AGENT_PREAUTH_RATE_LIMIT_PER_MIN',
  // S2S validation (inbound from loa-finn)
  S2S_EXPECTED_ISSUER: 'S2S_EXPECTED_ISSUER',
  S2S_EXPECTED_AUDIENCE: 'S2S_EXPECTED_AUDIENCE',
  S2S_JWKS_CACHE_TTL_MS: 'S2S_JWKS_CACHE_TTL_MS',
  S2S_JWKS_STALE_MAX_MS: 'S2S_JWKS_STALE_MAX_MS',
  S2S_JWKS_REFRESH_COOLDOWN_MS: 'S2S_JWKS_REFRESH_COOLDOWN_MS',
  S2S_CLOCK_SKEW_LEEWAY_SEC: 'S2S_CLOCK_SKEW_LEEWAY_SEC',
  // Usage receiver
  USAGE_MAX_COST_MICRO_USD: 'USAGE_MAX_COST_MICRO_USD',
  USAGE_MAX_REPORT_ID_LENGTH: 'USAGE_MAX_REPORT_ID_LENGTH',
  // Pool claim enforcement (F-14)
  AGENT_POOL_CLAIM_ENFORCEMENT: 'AGENT_POOL_CLAIM_ENFORCEMENT',
  // BYOK (FR-4)
  BYOK_ENABLED: 'BYOK_ENABLED',
  BYOK_DAILY_QUOTA: 'BYOK_DAILY_QUOTA',
} as const;

// --------------------------------------------------------------------------
// Defaults
// --------------------------------------------------------------------------

const DEFAULTS = {
  enabled: false,
  loaFinnBaseUrl: 'http://loa-finn:3000',
  loaFinnTimeoutMs: 30_000,
  circuitBreakerThreshold: 5,
  circuitBreakerResetMs: 30_000,
  jwtExpirySec: 120,
  preAuthPerMinute: 100,
  userPerMinute: 20,
  communityPerMinute: 200,
  channelPerMinute: 60,
  burstLimit: 5,
  // S2S validation defaults (SDD §3.1)
  s2sExpectedIssuer: 'loa-finn',
  s2sExpectedAudience: 'arrakis',
  s2sJwksCacheTtlMs: 3_600_000,        // 1h
  s2sJwksStaleMaxMs: 259_200_000,       // 72h
  s2sJwksRefreshCooldownMs: 60_000,     // 60s
  s2sClockToleranceSec: 30,             // 30s leeway
  // Usage receiver defaults
  usageMaxCostMicroUsd: 100_000_000_000n, // $100K (PRD cap)
  usageMaxReportIdLength: 256,
  poolClaimEnforcement: 'reject' as PoolClaimEnforcement,
  // BYOK defaults (FR-4)
  byokEnabled: false,
  byokDailyQuota: 10_000,
};

// --------------------------------------------------------------------------
// Env Parsing Helpers
// --------------------------------------------------------------------------

function parseBoolEnv(value: string | undefined, fallback: boolean): boolean {
  if (value == null) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function parseIntEnv(value: string | undefined, fallback: number): number {
  if (value == null || value.trim() === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

const VALID_POOL_CLAIM_ENFORCEMENT = new Set<string>(['warn', 'reject']);

/** Strip trailing slashes without polynomial regex (CodeQL js/polynomial-redos). */
function stripTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === '/') end--;
  return url.slice(0, end);
}

function parsePoolClaimEnforcement(value: string | undefined): PoolClaimEnforcement {
  if (value != null && VALID_POOL_CLAIM_ENFORCEMENT.has(value)) {
    return value as PoolClaimEnforcement;
  }
  return DEFAULTS.poolClaimEnforcement;
}

// --------------------------------------------------------------------------
// Input Validation Constants (SDD §7.4)
// --------------------------------------------------------------------------

/** Maximum request body size for agent endpoints */
export const AGENT_BODY_LIMIT = '128kb';

/** Maximum messages per request */
export const AGENT_MAX_MESSAGES = 50;

/** Maximum content length per message (chars) */
export const AGENT_MAX_CONTENT_LENGTH = 32_000;

/** Maximum model alias length (chars) */
export const AGENT_MAX_MODEL_ALIAS_LENGTH = 64;

/** Maximum tools per request */
export const AGENT_MAX_TOOLS = 20;

/** Maximum idempotency key length (chars) */
export const AGENT_MAX_IDEMPOTENCY_KEY_LENGTH = 128;

// --------------------------------------------------------------------------
// Zod Schemas for Request Validation (SDD §7.4)
// --------------------------------------------------------------------------

/** Printable ASCII pattern for idempotency keys (0x20-0x7E) */
const PRINTABLE_ASCII = /^[\x20-\x7e]+$/;

/**
 * Known model aliases — derived from MODEL_ALIAS_VALUES (single source of truth in core ports).
 * Data-driven for Hounfour multi-model extensibility.
 * Add new aliases in MODEL_ALIAS_VALUES (packages/core/ports/agent-gateway.ts).
 */
export const KNOWN_MODEL_ALIASES: ReadonlySet<string> = new Set<string>(MODEL_ALIAS_VALUES);

/** Ensemble request schema — FR-3 multi-model orchestration */
export const ensembleRequestSchema = z.object({
  strategy: z.enum(['best_of_n', 'consensus', 'fallback']),
  models: z.array(z.string().min(1).max(256)).max(5).optional(),
  n: z.number().int().min(2).max(10).optional(),
  quorum: z.number().int().min(2).max(10).optional(),
});

/** Schema for agent invoke request body — limits per SDD §7.4 */
export const agentInvokeRequestSchema = z.object({
  agent: z.string().min(1).max(256),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string().min(1).max(AGENT_MAX_CONTENT_LENGTH),
  })).min(1).max(AGENT_MAX_MESSAGES),
  modelAlias: z.string().min(1).max(AGENT_MAX_MODEL_ALIAS_LENGTH).refine(
    (v) => KNOWN_MODEL_ALIASES.has(v),
    { message: 'Unknown model alias' },
  ).optional(),
  tools: z.array(z.string().min(1).max(256)).max(AGENT_MAX_TOOLS).optional(),
  metadata: z.record(z.unknown()).optional(),
  idempotencyKey: z.string().min(1).max(AGENT_MAX_IDEMPOTENCY_KEY_LENGTH).regex(PRINTABLE_ASCII).optional(),
  ensemble: ensembleRequestSchema.optional(),
});

export type AgentInvokeRequestBody = z.infer<typeof agentInvokeRequestSchema>;

// --------------------------------------------------------------------------
// Config Loader
// --------------------------------------------------------------------------

/**
 * Load agent gateway configuration from environment variables with defaults.
 * Throws if required AGENT_JWT_SECRET_ID is missing when gateway is enabled.
 *
 * @param overrides - Partial config overrides (for testing)
 * @returns Full agent gateway configuration
 */
export function loadAgentGatewayConfig(
  overrides?: Partial<AgentGatewayConfig>,
): AgentGatewayConfig {
  const env = process.env;

  const enabled = parseBoolEnv(env[ENV_VARS.AGENT_ENABLED], DEFAULTS.enabled);
  const ensembleEnabled = parseBoolEnv(env[ENV_VARS.ENSEMBLE_ENABLED], false);
  const jwtSecretId = env[ENV_VARS.AGENT_JWT_SECRET_ID] ?? overrides?.jwtSecretId ?? '';

  if (enabled && !jwtSecretId) {
    throw new Error(
      'Missing required env var AGENT_JWT_SECRET_ID. ' +
      'Set it to the AWS Secrets Manager secret ID for the JWT signing key.',
    );
  }

  const config: AgentGatewayConfig = {
    enabled,
    ensembleEnabled,
    jwtSecretId,

    jwt: {
      keyId: env[ENV_VARS.AGENT_JWT_KEY_ID] ?? 'arrakis-key-1',
      expirySec: parseIntEnv(env[ENV_VARS.AGENT_JWT_EXPIRY_SEC], DEFAULTS.jwtExpirySec),
      ...overrides?.jwt,
    },

    tierMapping: overrides?.tierMapping ?? DEFAULT_TIER_MAP,

    loaFinn: {
      baseUrl: env[ENV_VARS.LOA_FINN_BASE_URL] ?? DEFAULTS.loaFinnBaseUrl,
      timeoutMs: parseIntEnv(env[ENV_VARS.LOA_FINN_TIMEOUT_MS], DEFAULTS.loaFinnTimeoutMs),
      circuitBreakerThreshold: DEFAULTS.circuitBreakerThreshold,
      circuitBreakerResetMs: DEFAULTS.circuitBreakerResetMs,
      ...overrides?.loaFinn,
    },

    budget: {
      reservationTtlMs: RESERVATION_TTL_MS,
      finalizedMarkerTtlS: FINALIZED_MARKER_TTL_S,
      warningThreshold: BUDGET_WARNING_THRESHOLD,
      ...overrides?.budget,
    },

    rateLimits: {
      preAuthPerMinute: parseIntEnv(env[ENV_VARS.AGENT_PREAUTH_RATE_LIMIT_PER_MIN], DEFAULTS.preAuthPerMinute),
      userPerMinute: parseIntEnv(env[ENV_VARS.AGENT_RATE_LIMIT_USER_PER_MIN], DEFAULTS.userPerMinute),
      communityPerMinute: parseIntEnv(env[ENV_VARS.AGENT_RATE_LIMIT_COMMUNITY_PER_MIN], DEFAULTS.communityPerMinute),
      channelPerMinute: parseIntEnv(env[ENV_VARS.AGENT_RATE_LIMIT_CHANNEL_PER_MIN], DEFAULTS.channelPerMinute),
      burstLimit: parseIntEnv(env[ENV_VARS.AGENT_RATE_LIMIT_BURST], DEFAULTS.burstLimit),
      ...overrides?.rateLimits,
    },

    s2sValidation: {
      loaFinnBaseUrl: env[ENV_VARS.LOA_FINN_BASE_URL] ?? DEFAULTS.loaFinnBaseUrl,
      expectedIssuer: env[ENV_VARS.S2S_EXPECTED_ISSUER] ?? DEFAULTS.s2sExpectedIssuer,
      expectedAudience: env[ENV_VARS.S2S_EXPECTED_AUDIENCE] ?? DEFAULTS.s2sExpectedAudience,
      jwksCacheTtlMs: parseIntEnv(env[ENV_VARS.S2S_JWKS_CACHE_TTL_MS], DEFAULTS.s2sJwksCacheTtlMs),
      jwksStaleMaxMs: parseIntEnv(env[ENV_VARS.S2S_JWKS_STALE_MAX_MS], DEFAULTS.s2sJwksStaleMaxMs),
      jwksRefreshCooldownMs: parseIntEnv(env[ENV_VARS.S2S_JWKS_REFRESH_COOLDOWN_MS], DEFAULTS.s2sJwksRefreshCooldownMs),
      clockToleranceSec: parseIntEnv(env[ENV_VARS.S2S_CLOCK_SKEW_LEEWAY_SEC], DEFAULTS.s2sClockToleranceSec),
      ...overrides?.s2sValidation,
    },

    usageReceiver: {
      maxCostMicroUsd: DEFAULTS.usageMaxCostMicroUsd,
      maxReportIdLength: parseIntEnv(env[ENV_VARS.USAGE_MAX_REPORT_ID_LENGTH], DEFAULTS.usageMaxReportIdLength),
      poolClaimEnforcement: parsePoolClaimEnforcement(env[ENV_VARS.AGENT_POOL_CLAIM_ENFORCEMENT]),
      ...overrides?.usageReceiver,
    },

    byok: {
      enabled: parseBoolEnv(env[ENV_VARS.BYOK_ENABLED], DEFAULTS.byokEnabled),
      dailyQuota: parseIntEnv(env[ENV_VARS.BYOK_DAILY_QUOTA], DEFAULTS.byokDailyQuota),
      ...overrides?.byok,
    },
  };

  return config;
}

/**
 * Build S2SJwtValidatorConfig from the S2SValidationConfig section.
 * Computes the JWKS URL from the base URL.
 */
export function buildS2SJwtValidatorConfig(s2s: S2SValidationConfig): S2SJwtValidatorConfig {
  return {
    jwksUrl: `${stripTrailingSlashes(s2s.loaFinnBaseUrl)}/.well-known/jwks.json`,
    expectedIssuer: s2s.expectedIssuer,
    expectedAudience: s2s.expectedAudience,
    jwksCacheTtlMs: s2s.jwksCacheTtlMs,
    jwksStaleMaxMs: s2s.jwksStaleMaxMs,
    jwksRefreshCooldownMs: s2s.jwksRefreshCooldownMs,
    clockToleranceSec: s2s.clockToleranceSec,
  };
}
