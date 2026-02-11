/**
 * BYOK Provider Endpoints — Static Allowlist
 * Sprint 3, Task 3.4: Capability-based URL resolution for BYOK proxy
 *
 * Defines allowed provider hostnames, operations, and URL templates.
 * Unknown provider/operation → 400 reject (SSRF defense).
 *
 * @see SDD §3.4.5 BYOK Proxy Handler
 * @see PRD FR-4 BYOK Key Management
 */

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** A single provider endpoint configuration */
export interface ProviderEndpoint {
  /** Exact hostname (no wildcards) */
  hostname: string;
  /** TLS port (always 443) */
  port: 443;
  /** URL path template — {operation} replaced at runtime */
  pathTemplate: string;
  /** HTTP method */
  method: 'POST';
}

/** Map of operation name → endpoint config */
export type OperationMap = Record<string, ProviderEndpoint>;

/** Map of provider name → operations */
export type ProviderEndpoints = Record<string, OperationMap>;

// --------------------------------------------------------------------------
// Static Allowlist
// --------------------------------------------------------------------------

/**
 * PROVIDER_ENDPOINTS: exhaustive static map of allowed BYOK proxy targets.
 *
 * Security invariants:
 * - Exact hostnames only (no wildcards, no user-supplied URLs)
 * - Port 443 only (TLS enforced)
 * - POST only (no GET/PUT/DELETE to avoid unintended side effects)
 * - Unknown provider → 400 BYOK_UNKNOWN_PROVIDER
 * - Unknown operation → 400 BYOK_UNKNOWN_OPERATION
 */
export const PROVIDER_ENDPOINTS: ProviderEndpoints = {
  openai: {
    'chat.completions': {
      hostname: 'api.openai.com',
      port: 443,
      pathTemplate: '/v1/chat/completions',
      method: 'POST',
    },
    'completions': {
      hostname: 'api.openai.com',
      port: 443,
      pathTemplate: '/v1/completions',
      method: 'POST',
    },
    'embeddings': {
      hostname: 'api.openai.com',
      port: 443,
      pathTemplate: '/v1/embeddings',
      method: 'POST',
    },
  },
  anthropic: {
    'messages': {
      hostname: 'api.anthropic.com',
      port: 443,
      pathTemplate: '/v1/messages',
      method: 'POST',
    },
  },
} as const;

// --------------------------------------------------------------------------
// Lookup
// --------------------------------------------------------------------------

/**
 * Resolve a provider + operation to an endpoint configuration.
 * Returns null if provider or operation is unknown.
 */
export function resolveEndpoint(
  provider: string,
  operation: string,
): ProviderEndpoint | null {
  const ops = PROVIDER_ENDPOINTS[provider];
  if (!ops) return null;

  const endpoint = ops[operation];
  if (!endpoint) return null;

  return endpoint;
}

/**
 * Get all allowed hostnames across all providers (for Network Firewall allowlist).
 */
export function getAllowedHostnames(): string[] {
  const hostnames = new Set<string>();
  for (const ops of Object.values(PROVIDER_ENDPOINTS)) {
    for (const endpoint of Object.values(ops)) {
      hostnames.add(endpoint.hostname);
    }
  }
  return [...hostnames];
}
