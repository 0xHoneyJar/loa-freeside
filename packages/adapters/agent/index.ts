/**
 * Agent Gateway Adapter
 * Hounfour Phase 4 — Spice Gate
 *
 * Exports all agent adapter components for the gateway system.
 */

// Clock (shared time interface — S13-T2)
export { REAL_CLOCK, type Clock } from './clock.js';

// JWT Service
export { JwtService, type JwtServiceConfig, type PreviousKeyConfig, type KeyLoader } from './jwt-service.js';

// Tier→Access Mapper
export { TierAccessMapper, DEFAULT_TIER_MAP, type TierMappingConfig, type TierMapping } from './tier-access-mapper.js';

// Configuration
export {
  loadAgentGatewayConfig,
  buildS2SJwtValidatorConfig,
  agentInvokeRequestSchema,
  RESERVATION_TTL_MS,
  FINALIZED_MARKER_TTL_S,
  BUDGET_WARNING_THRESHOLD,
  AGENT_BODY_LIMIT,
  AGENT_MAX_MESSAGES,
  AGENT_MAX_CONTENT_LENGTH,
  AGENT_MAX_MODEL_ALIAS_LENGTH,
  AGENT_MAX_TOOLS,
  AGENT_MAX_IDEMPOTENCY_KEY_LENGTH,
  KNOWN_MODEL_ALIASES,
  type AgentGatewayConfig,
  type AgentInvokeRequestBody,
  type LoaFinnConfig,
  type BudgetConfig,
  type RateLimitConfig,
  type S2SValidationConfig,
  type UsageReceiverConfig,
  type PoolClaimEnforcement,
} from './config.js';

// Budget Unit Bridge (micro-USD ↔ micro-cents)
export {
  microUsdToMicroCents,
  microCentsToMicroUsd,
  parseMicroUnit,
  CONVERSION_FACTOR,
  MAX_MICRO_USD,
  MAX_MICRO_CENTS,
} from './budget-unit-bridge.js';

// S2S JWT Validator (inbound loa-finn → arrakis)
export {
  S2SJwtValidator,
  type S2SJwtValidatorConfig,
  type S2SJwtPayload,
} from './s2s-jwt-validator.js';

// S2S Auth Middleware (Express middleware for loa-finn Bearer tokens)
export {
  createS2SAuthMiddleware,
  type S2SAuthenticatedRequest,
  type S2SAuthMiddlewareDeps,
} from './s2s-auth-middleware.js';

// Usage Receiver (inbound usage reports from loa-finn)
export {
  UsageReceiver,
  UsageReceiverError,
  type UsageReceiverDeps,
  type UsageReceiverResult,
  type UsageReport,
} from './usage-receiver.js';

// Types
export { type AgentGatewayResult, type AgentErrorCode, type AgentErrorResponse } from './types.js';

// Error Messages
export { AGENT_ERROR_MESSAGES, formatErrorMessage, type ErrorMessageEntry } from './error-messages.js';

// Rate Limiting
export {
  AgentRateLimiter,
  parseRateLimitResult,
  TIER_LIMITS,
  type RateLimitResult,
  type RateLimitDimension,
  type TierLimits,
} from './agent-rate-limiter.js';

// Pre-Auth IP Rate Limiting
export { IpRateLimiter, type IpRateLimitConfig } from './ip-rate-limiter.js';

// Redis Circuit Breaker (fleet-wide shared state — Sprint 3 Task 3.3)
export {
  RedisCircuitBreaker,
  type CircuitState,
  type RedisCircuitBreakerConfig,
} from './redis-circuit-breaker.js';

// loa-finn Client
export { LoaFinnClient, LoaFinnError, type JwtMinter, type LoaFinnClientDeps } from './loa-finn-client.js';

// Budget Manager
export {
  BudgetManager,
  parseBudgetResult,
  parseFinalizeResult,
  parseReaperResult,
  getCurrentMonth,
  type BudgetResult,
  type FinalizeResult,
  type ReaperResult,
  type AuditLogEntry,
} from './budget-manager.js';

// Stream Reconciliation Worker
export { StreamReconciliationWorker, type StreamReconciliationJob } from './stream-reconciliation-worker.js';

// Budget Reaper Job
export {
  BudgetReaperJob,
  REAPER_JOB_CONFIG,
  type ActiveCommunityProvider,
  type ReaperJobResult,
} from './budget-reaper-job.js';

// Budget Config Provider
export {
  BudgetConfigProvider,
  BUDGET_SYNC_JOB_CONFIG,
  BUDGET_MONTHLY_RESET_JOB_CONFIG,
  type BudgetConfigSource,
  type CommunityBudgetConfig,
  type BudgetSyncResult,
  type MonthlyResetResult,
} from './budget-config-provider.js';

// Tier Override Types (re-export from mapper)
export { type TierOverrideProvider } from './tier-access-mapper.js';

// Pool Mapping (tier-aware pool resolution — Sprint 3)
export {
  resolvePoolId,
  validatePoolClaims,
  ACCESS_LEVEL_POOLS,
  POOL_IDS,
  VALID_POOL_IDS,
  ALIAS_TO_POOL,
  isAccessLevel,
  type PoolId,
  type PoolResolution,
  type PoolClaimValidation,
} from './pool-mapping.js';

// Request Hash (single source of truth — used by JwtService and tests)
export { computeReqHash } from './req-hash.js';

// Agent Gateway Facade
export { AgentGateway, AgentGatewayError, type AgentGatewayDeps } from './agent-gateway.js';

// Auth Middleware
export {
  requireAgentAuth,
  buildAgentRequestContext,
  type AgentAuthDeps,
  type AgentAuthenticatedRequest,
  type SessionContext,
  type ConvictionScorer,
  type SessionExtractor,
} from './agent-auth-middleware.js';

// Gateway Factory
export { createAgentGateway, type CreateAgentGatewayOptions } from './factory.js';

// Budget Drift Monitor
export {
  BudgetDriftMonitor,
  DRIFT_THRESHOLD_MICRO_CENTS,
  DRIFT_LAG_FACTOR_SECONDS,
  DRIFT_MAX_THRESHOLD_MICRO_CENTS,
  DRIFT_MONITOR_JOB_CONFIG,
  type DriftActiveCommunityProvider,
  type BudgetUsageQueryProvider,
  type DriftMonitorResult,
  type CommunityDrift,
} from './budget-drift-monitor.js';

// SSE Event ID Generators (S14-T1: Distributed SSE)
export {
  createEventIdGenerator,
  parseLastEventId,
  MonotonicEventIdGenerator,
  CompositeEventIdGenerator,
  type SseEventIdGenerator,
  type ParsedEventId,
} from './sse-event-id.js';

// Observability
export {
  createAgentLogger,
  hashWallet,
  logAgentRequest,
  LogMetricEmitter,
  NoopMetricEmitter,
  AGENT_METRICS,
  AGENT_REDACTION_PATHS,
  type MetricEmitter,
  type MetricUnit,
  type MetricDimensions,
  type AgentRequestLog,
  type PoolClaimValidationLog,
} from './observability.js';

// Agent Metrics (EMF — CloudWatch)
export { AgentMetrics, type RequestMetrics, type BudgetMetrics, type CircuitBreakerMetrics, type PoolClaimMetrics } from './agent-metrics.js';

// Capability Audit Log (cycle-019 Sprint 4 — observability)
export {
  CapabilityAuditLogger,
  type CapabilityAuditEvent,
  type CapabilityEventType,
} from './capability-audit.js';

// Ensemble Accounting (cycle-019 BB6 Finding #6 — per-model cost attribution)
export {
  computeEnsembleAccounting,
  computeHybridMultiplier,
  type ModelInvocationResult,
  type EnsembleAccountingResult,
  type AccountingMode,
} from './ensemble-accounting.js';

// Token Estimator (cycle-019 BB6 Finding #7 — calibration harness)
export {
  TokenEstimator,
  type TokenEstimatorConfig,
  type CalibrationStats,
} from './token-estimator.js';

// Request Lifecycle (cycle-019 BB6 Finding #1 — state machine extraction)
export {
  RequestLifecycle,
  LifecycleError,
  type LifecycleState,
  type LifecycleEvent,
} from './request-lifecycle.js';

// Contract Version + Compatibility (cycle-019 BB6 Finding #2)
export { CONTRACT_VERSION, validateContractCompatibility } from './contract-version.js';

// Contract Version Mismatch Error (cycle-019 AC-2.21)
export { ContractVersionMismatchError } from './loa-finn-client.js';
