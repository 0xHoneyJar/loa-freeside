/**
 * Agent Gateway Port Interface
 * Sprint S1-T1: IAgentGateway Port (Hounfour Phase 4 — Spice Gate)
 *
 * Defines the contract for AI agent access gated through token-gated communities.
 * Follows the hexagonal architecture pattern established by IChainProvider.
 *
 * @see SDD §4.1 Port Interface: IAgentGateway
 */

// --------------------------------------------------------------------------
// Access & Model Types
// --------------------------------------------------------------------------

/** Community subscription tier mapped to access level */
export type AccessLevel = 'free' | 'pro' | 'enterprise';

/** Model alias abstraction — maps to provider-specific model IDs in loa-finn */
export type ModelAlias = 'cheap' | 'fast-code' | 'reviewer' | 'reasoning' | 'native';

/** Platform where the agent request originated */
export type AgentPlatform = 'discord' | 'telegram';

// --------------------------------------------------------------------------
// Request Context
// --------------------------------------------------------------------------

/** Full context for an agent request, assembled at the boundary */
export interface AgentRequestContext {
  /** Community ID (tenant identifier) */
  tenantId: string;
  /** Wallet address of the requesting user */
  userId: string;
  /** NFT token ID or null if not applicable */
  nftId: string | null;
  /** Community tier (1-9) */
  tier: number;
  /** Derived access level from tier */
  accessLevel: AccessLevel;
  /** Model aliases allowed for this tier */
  allowedModelAliases: ModelAlias[];
  /** Originating platform */
  platform: AgentPlatform;
  /** Channel where the request was made */
  channelId: string;
  /** Caller-generated idempotency key, scoped to user intent */
  idempotencyKey: string;
  /** UUIDv4 generated once per invocation for end-to-end correlation */
  traceId: string;
}

// --------------------------------------------------------------------------
// Messages
// --------------------------------------------------------------------------

/** A single message in the conversation context */
export interface AgentMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// --------------------------------------------------------------------------
// Request Types
// --------------------------------------------------------------------------

/** Request payload for agent invocation (sync or stream) */
export interface AgentInvokeRequest {
  /** Full request context */
  context: AgentRequestContext;
  /** Agent identifier */
  agent: string;
  /** Conversation messages (complete context per request — Phase 4 is stateless) */
  messages: AgentMessage[];
  /** Optional model alias; loa-finn uses default if omitted */
  modelAlias?: ModelAlias;
  /** Tool names to enable */
  tools?: string[];
  /** Arbitrary metadata passed through to loa-finn */
  metadata?: Record<string, unknown>;
}

// --------------------------------------------------------------------------
// Response Types
// --------------------------------------------------------------------------

/** Tool call returned by the agent */
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** Token usage and cost information */
export interface UsageInfo {
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
}

/** Response from a synchronous agent invocation */
export interface AgentInvokeResponse {
  content: string;
  thinking?: string;
  toolCalls?: ToolCall[];
  usage: UsageInfo;
  metadata?: Record<string, unknown>;
}

// --------------------------------------------------------------------------
// Stream Event Types (Discriminated Union)
// --------------------------------------------------------------------------

/**
 * Discriminated union for SSE stream events.
 * Validated with zod at the SSE parse boundary.
 *
 * @see SDD §4.1 AgentStreamEvent
 */
export type AgentStreamEvent =
  | { type: 'content'; data: { text: string }; id?: string }
  | { type: 'thinking'; data: { text: string }; id?: string }
  | { type: 'tool_call'; data: { name: string; args: Record<string, unknown> }; id?: string }
  | { type: 'usage'; data: UsageInfo; id?: string }
  | { type: 'done'; data: null; id?: string }
  | { type: 'error'; data: { code: string; message: string }; id?: string };

// --------------------------------------------------------------------------
// Status Types
// --------------------------------------------------------------------------

/** Community budget status from Redis counters */
export interface BudgetStatus {
  communityId: string;
  monthlyLimitCents: number;
  currentSpendCents: number;
  remainingCents: number;
  percentUsed: number;
  warningThresholdReached: boolean;
}

/** Health check result for downstream dependencies */
export interface AgentHealthStatus {
  loaFinn: { healthy: boolean; latencyMs: number };
  redis: { healthy: boolean; latencyMs: number };
}

// --------------------------------------------------------------------------
// Agent Gateway Interface
// --------------------------------------------------------------------------

/**
 * Agent Gateway Port Interface
 *
 * Full request lifecycle: rate limit → budget reserve → JWT → forward → finalize.
 * Implementations should handle circuit breaking, retry, and graceful degradation.
 *
 * @see SDD §4.1 for detailed component interaction
 */
export interface IAgentGateway {
  /**
   * Synchronous agent invocation.
   * Full request lifecycle: rate limit → budget reserve → JWT → forward → finalize.
   *
   * @param request - Agent invocation request with full context
   * @returns Agent response with content and usage
   */
  invoke(request: AgentInvokeRequest): Promise<AgentInvokeResponse>;

  /**
   * Streaming agent invocation.
   * Returns an async iterable of SSE events.
   * Budget finalized on 'usage' event.
   *
   * @param request - Agent invocation request with full context
   * @returns Async iterable of typed stream events
   */
  stream(request: AgentInvokeRequest): AsyncIterable<AgentStreamEvent>;

  /**
   * List available model aliases for the given access level.
   * Resolved locally from tier→access mapping config.
   *
   * @param accessLevel - The access level to query
   * @returns Array of available model aliases
   */
  getAvailableModels(accessLevel: AccessLevel): ModelAlias[];

  /**
   * Get community budget status from Redis counters.
   *
   * @param communityId - Community to check
   * @returns Current budget status
   */
  getBudgetStatus(communityId: string): Promise<BudgetStatus>;

  /**
   * Health check for loa-finn and Redis.
   *
   * @returns Health status of downstream dependencies
   */
  getHealth(): Promise<AgentHealthStatus>;
}

// --------------------------------------------------------------------------
// Factory Types
// --------------------------------------------------------------------------

/** Options for creating an agent gateway */
export interface AgentGatewayOptions {
  /** loa-finn base URL */
  loaFinnUrl: string;
  /** Redis connection URL */
  redisUrl: string;
  /** JWT service configuration */
  jwt: {
    /** AWS Secrets Manager secret ID for the signing key */
    secretId: string;
    /** Key ID (kid) for JWKS */
    keyId: string;
    /** Token expiry in seconds (default: 120) */
    expirySec?: number;
  };
  /** Request timeout in milliseconds */
  timeoutMs?: number;
}
