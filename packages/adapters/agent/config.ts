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
import type { JwtServiceConfig } from './jwt-service.js';
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

/** Full agent gateway configuration */
export interface AgentGatewayConfig {
  /** Whether agent gateway is enabled */
  enabled: boolean;
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
}

// --------------------------------------------------------------------------
// Environment Variables
// --------------------------------------------------------------------------

const ENV_VARS = {
  AGENT_ENABLED: 'AGENT_ENABLED',
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

// --------------------------------------------------------------------------
// Zod Schemas for Request Validation
// --------------------------------------------------------------------------

/** Schema for agent invoke request body */
export const agentInvokeRequestSchema = z.object({
  agent: z.string().min(1).max(256),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string().min(1).max(100_000),
  })).min(1).max(100),
  modelAlias: z.enum(['cheap', 'fast-code', 'reviewer', 'reasoning', 'native']).optional(),
  tools: z.array(z.string().min(1).max(256)).max(50).optional(),
  metadata: z.record(z.unknown()).optional(),
  idempotencyKey: z.string().uuid().optional(),
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
  const jwtSecretId = env[ENV_VARS.AGENT_JWT_SECRET_ID] ?? overrides?.jwtSecretId ?? '';

  if (enabled && !jwtSecretId) {
    throw new Error(
      'Missing required env var AGENT_JWT_SECRET_ID. ' +
      'Set it to the AWS Secrets Manager secret ID for the JWT signing key.',
    );
  }

  const config: AgentGatewayConfig = {
    enabled,
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
  };

  return config;
}
