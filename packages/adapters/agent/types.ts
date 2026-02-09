/**
 * Shared Adapter Types
 * Sprint S1-T4: Types shared across agent adapter components
 *
 * @see SDD §4.8 Factory Function
 */

import type { IAgentGateway, AgentHealthStatus } from '@arrakis/core/ports';
import type { JWK } from 'jose';

// --------------------------------------------------------------------------
// Factory Result
// --------------------------------------------------------------------------

/** Result of creating an agent gateway via the factory */
export interface AgentGatewayResult {
  /** The gateway instance implementing IAgentGateway */
  gateway: IAgentGateway;
  /** Health check shorthand */
  health: () => Promise<AgentHealthStatus>;
  /** JWKS shorthand for Express route */
  jwks: () => { keys: JWK[] };
}

// --------------------------------------------------------------------------
// Error Codes
// --------------------------------------------------------------------------

/** Standardized error codes for agent gateway responses */
export type AgentErrorCode =
  | 'RATE_LIMITED'
  | 'BUDGET_EXCEEDED'
  | 'MODEL_FORBIDDEN'
  | 'SERVICE_UNAVAILABLE'
  | 'INVALID_REQUEST'
  | 'INTERNAL_ERROR';

/** Structured error response matching SDD §6.2 */
export interface AgentErrorResponse {
  error: {
    code: AgentErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}
