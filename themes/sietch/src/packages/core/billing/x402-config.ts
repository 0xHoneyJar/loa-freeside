/**
 * x402 Payment Configuration
 *
 * Configuration for the x402 Payment Required flow.
 * When enabled, insufficient credit responses include payment instructions.
 *
 * Sprint refs: Task 5.4
 *
 * @module packages/core/billing/x402-config
 */

// =============================================================================
// Types
// =============================================================================

export interface X402Config {
  /** Whether x402 payment flow is enabled */
  enabled: boolean;
  /** Recipient address for USDC payments (required when enabled) */
  recipient_address: string;
  /** Supported currencies (default: ['USDC']) */
  supported_currencies: string[];
  /** Nonce TTL in seconds (default: 300 = 5 minutes) */
  nonce_ttl_seconds: number;
}

// =============================================================================
// Defaults
// =============================================================================

export const DEFAULT_X402_CONFIG: X402Config = {
  enabled: false,
  recipient_address: '',
  supported_currencies: ['USDC'],
  nonce_ttl_seconds: 300,
};

// =============================================================================
// Validation
// =============================================================================

/**
 * Validate x402 configuration. Throws if enabled without recipient address.
 */
export function validateX402Config(config: X402Config): void {
  if (config.enabled && !config.recipient_address.trim()) {
    throw new Error(
      'x402 configuration error: recipient_address is required when x402 is enabled',
    );
  }
  if (config.nonce_ttl_seconds <= 0) {
    throw new Error(
      'x402 configuration error: nonce_ttl_seconds must be positive',
    );
  }
}

// =============================================================================
// Nonce Cache — Short-lived replay prevention
// =============================================================================
//
// LIMITATION (Bridge Review, strategic finding medium-1):
// This cache is in-memory and does not survive process restarts. A client
// that received a 402 response with a nonce before a restart will have that
// nonce rejected after restart. With a 5-minute TTL this creates a small
// window for payment failures during deploys.
//
// Path to v2: Replace Map with Redis SETEX (key=nonce, value=accountId,
// TTL=nonce_ttl_seconds). The IAtomicCounterBackend pattern from
// protocol/atomic-counter.ts could be adapted: INonceCacheBackend with
// InMemory, Redis implementations behind the same interface.
// =============================================================================

export class NonceCache {
  private readonly cache = new Map<string, { accountId: string; expiresAt: number }>();
  private readonly ttlMs: number;

  constructor(ttlSeconds: number = 300) {
    if (ttlSeconds <= 0 || !Number.isFinite(ttlSeconds)) {
      throw new Error('NonceCache ttlSeconds must be a positive finite number');
    }
    this.ttlMs = ttlSeconds * 1000;
  }

  /** Store a nonce for an account with TTL */
  set(nonce: string, accountId: string): void {
    this.cleanup();
    this.cache.set(nonce, {
      accountId,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  /**
   * Validate and consume a nonce. Returns true if valid (exists, not expired,
   * matches account). Consumes the nonce on success (single-use).
   */
  consume(nonce: string, accountId: string): boolean {
    this.cleanup();
    const entry = this.cache.get(nonce);
    if (!entry) return false;
    if (entry.expiresAt <= Date.now()) {
      this.cache.delete(nonce);
      return false;
    }
    if (entry.accountId !== accountId) return false;

    // Consume: delete so it can't be reused
    this.cache.delete(nonce);
    return true;
  }

  /** Check if nonce exists without consuming */
  has(nonce: string): boolean {
    this.cleanup();
    const entry = this.cache.get(nonce);
    if (!entry) return false;
    if (entry.expiresAt <= Date.now()) {
      this.cache.delete(nonce);
      return false;
    }
    return true;
  }

  /** Remove expired entries */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, value] of this.cache) {
      if (value.expiresAt <= now) {
        this.cache.delete(key);
      }
    }
  }

  /** Current cache size (for testing) */
  get size(): number {
    this.cleanup();
    return this.cache.size;
  }
}
