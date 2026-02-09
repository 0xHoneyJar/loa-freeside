/**
 * Agent Gateway Adapter
 * Hounfour Phase 4 — Spice Gate
 *
 * Exports all agent adapter components for the gateway system.
 */

// JWT Service
export { JwtService, type JwtServiceConfig, type PreviousKeyConfig, type KeyLoader } from './jwt-service.js';

// Tier→Access Mapper
export { TierAccessMapper, DEFAULT_TIER_MAP, type TierMappingConfig, type TierMapping } from './tier-access-mapper.js';

// Configuration
export {
  loadAgentGatewayConfig,
  agentInvokeRequestSchema,
  RESERVATION_TTL_MS,
  FINALIZED_MARKER_TTL_S,
  BUDGET_WARNING_THRESHOLD,
  type AgentGatewayConfig,
  type AgentInvokeRequestBody,
  type LoaFinnConfig,
  type BudgetConfig,
  type RateLimitConfig,
} from './config.js';

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
} from './observability.js';
