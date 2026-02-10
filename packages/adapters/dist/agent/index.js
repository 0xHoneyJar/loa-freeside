/**
 * Agent Gateway Adapter
 * Hounfour Phase 4 — Spice Gate
 *
 * Exports all agent adapter components for the gateway system.
 */
// Clock (shared time interface — S13-T2)
export { REAL_CLOCK } from './clock.js';
// JWT Service
export { JwtService } from './jwt-service.js';
// Tier→Access Mapper
export { TierAccessMapper, DEFAULT_TIER_MAP } from './tier-access-mapper.js';
// Configuration
export { loadAgentGatewayConfig, agentInvokeRequestSchema, RESERVATION_TTL_MS, FINALIZED_MARKER_TTL_S, BUDGET_WARNING_THRESHOLD, AGENT_BODY_LIMIT, AGENT_MAX_MESSAGES, AGENT_MAX_CONTENT_LENGTH, AGENT_MAX_MODEL_ALIAS_LENGTH, AGENT_MAX_TOOLS, AGENT_MAX_IDEMPOTENCY_KEY_LENGTH, KNOWN_MODEL_ALIASES, } from './config.js';
// Error Messages
export { AGENT_ERROR_MESSAGES, formatErrorMessage } from './error-messages.js';
// Rate Limiting
export { AgentRateLimiter, parseRateLimitResult, TIER_LIMITS, } from './agent-rate-limiter.js';
// Pre-Auth IP Rate Limiting
export { IpRateLimiter } from './ip-rate-limiter.js';
// loa-finn Client
export { LoaFinnClient, LoaFinnError } from './loa-finn-client.js';
// Budget Manager
export { BudgetManager, parseBudgetResult, parseFinalizeResult, parseReaperResult, getCurrentMonth, } from './budget-manager.js';
// Stream Reconciliation Worker
export { StreamReconciliationWorker } from './stream-reconciliation-worker.js';
// Budget Reaper Job
export { BudgetReaperJob, REAPER_JOB_CONFIG, } from './budget-reaper-job.js';
// Budget Config Provider
export { BudgetConfigProvider, BUDGET_SYNC_JOB_CONFIG, BUDGET_MONTHLY_RESET_JOB_CONFIG, } from './budget-config-provider.js';
// Budget Drift Monitor
export { BudgetDriftMonitor, DRIFT_THRESHOLD_MICRO_CENTS, DRIFT_MONITOR_JOB_CONFIG, } from './budget-drift-monitor.js';
// Request Hash
export { computeReqHash } from './req-hash.js';
// Agent Gateway Facade
export { AgentGateway, AgentGatewayError } from './agent-gateway.js';
// Auth Middleware
export { requireAgentAuth, buildAgentRequestContext, } from './agent-auth-middleware.js';
// Gateway Factory
export { createAgentGateway } from './factory.js';
// Observability
export { createAgentLogger, hashWallet, logAgentRequest, LogMetricEmitter, NoopMetricEmitter, AGENT_METRICS, AGENT_REDACTION_PATHS, } from './observability.js';
//# sourceMappingURL=index.js.map