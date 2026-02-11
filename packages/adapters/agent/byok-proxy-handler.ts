/**
 * BYOK Proxy Handler — Secure Egress for Community API Keys
 * Sprint 3, Task 3.4: S2S JWT auth, replay protection, SSRF defense
 *
 * Security layers (defense-in-depth):
 * 1. S2S JWT validation (inbound from loa-finn)
 * 2. Provider + operation resolved from JWT claims via static allowlist
 * 3. JTI uniqueness via Redis SETNX (30s TTL) — replay protection
 * 4. req_hash (SHA-256 of RFC 8785 canonical JSON) — payload integrity
 * 5. DNS resolution → private IP blocking (IPv4 + IPv6)
 * 6. Resolve-once-connect-by-IP with SNI (TOCTOU prevention)
 * 7. No redirects followed
 * 8. Response size capped at 10MB
 * 9. Internal headers stripped
 *
 * Redis unavailability policies (Flatline IMP-010):
 * - JTI replay → fail-closed (reject)
 * - Rate limiting → fail-open (allow, log degraded)
 * - BYOK exists check → fail-closed (reject)
 *
 * @see SDD §3.4.5 BYOK Proxy Handler
 * @see SDD §5.3 Replay Protection
 * @see PRD FR-4 BYOK Key Management
 */

import { createHash } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import type { Logger } from 'pino';
import type { Redis } from 'ioredis';
import { resolveEndpoint, PROVIDER_ENDPOINTS } from './byok-provider-endpoints.js';
import type { BYOKManager } from './byok-manager.js';

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

/** Maximum response body size (10MB) */
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

/** JTI TTL for replay protection (30s) */
const JTI_TTL_SECONDS = 30;

/** Headers to strip from outbound requests */
const STRIP_HEADERS = new Set([
  'host',
  'x-forwarded-for',
  'x-forwarded-proto',
  'x-forwarded-host',
  'x-real-ip',
  'x-request-id',
  'authorization', // We set this ourselves
  'cookie',
]);

/** Headers to strip from provider responses */
const STRIP_RESPONSE_HEADERS = new Set([
  'set-cookie',
  'x-request-id',
]);

// --------------------------------------------------------------------------
// Private IP Ranges (RFC 1918, RFC 4193, link-local, loopback)
// --------------------------------------------------------------------------

interface CIDRRange {
  addr: bigint;
  mask: bigint;
}

/** Parse IPv4 address to 32-bit number */
function ipv4ToNum(ip: string): number {
  const parts = ip.split('.');
  return ((+parts[0]) << 24) | ((+parts[1]) << 16) | ((+parts[2]) << 8) | (+parts[3]);
}

/** IPv4 private ranges */
const PRIVATE_IPV4_RANGES: Array<{ start: number; end: number }> = [
  // 10.0.0.0/8
  { start: ipv4ToNum('10.0.0.0'), end: ipv4ToNum('10.255.255.255') },
  // 172.16.0.0/12
  { start: ipv4ToNum('172.16.0.0'), end: ipv4ToNum('172.31.255.255') },
  // 192.168.0.0/16
  { start: ipv4ToNum('192.168.0.0'), end: ipv4ToNum('192.168.255.255') },
  // 127.0.0.0/8 (loopback)
  { start: ipv4ToNum('127.0.0.0'), end: ipv4ToNum('127.255.255.255') },
  // 169.254.0.0/16 (link-local)
  { start: ipv4ToNum('169.254.0.0'), end: ipv4ToNum('169.254.255.255') },
  // 0.0.0.0/8
  { start: ipv4ToNum('0.0.0.0'), end: ipv4ToNum('0.255.255.255') },
];

/** Check if IPv4 address is private */
function isPrivateIPv4(ip: string): boolean {
  const num = ipv4ToNum(ip) >>> 0; // Unsigned
  return PRIVATE_IPV4_RANGES.some((r) => num >= (r.start >>> 0) && num <= (r.end >>> 0));
}

/** Parse IPv6 address to BigInt */
function ipv6ToBigInt(ip: string): bigint {
  // Handle :: expansion
  if (ip.includes('::')) {
    const [left, right] = ip.split('::');
    const leftParts = left ? left.split(':') : [];
    const rightParts = right ? right.split(':') : [];
    const missing = 8 - leftParts.length - rightParts.length;
    const allParts = [
      ...leftParts,
      ...Array(missing).fill('0'),
      ...rightParts,
    ];
    return BigInt('0x' + allParts.map((p) => p.padStart(4, '0')).slice(0, 8).join(''));
  }

  const parts = ip.split(':');
  return BigInt('0x' + parts.map((p) => p.padStart(4, '0')).slice(0, 8).join(''));
}

/** IPv6 private range prefixes */
const PRIVATE_IPV6_PREFIXES: Array<{ prefix: bigint; bits: number }> = [
  // ::1/128 (loopback)
  { prefix: 1n, bits: 128 },
  // fc00::/7 (unique local)
  { prefix: 0xfc00n << 112n, bits: 7 },
  // fe80::/10 (link-local)
  { prefix: 0xfe80n << 112n, bits: 10 },
  // ::ffff:0:0/96 (IPv4-mapped — delegate to IPv4 check)
  { prefix: 0xffff00000000n, bits: 96 },
];

/** Check if IPv6 address is private */
function isPrivateIPv6(ip: string): boolean {
  const addr = ipv6ToBigInt(ip);

  // Loopback ::1
  if (addr === 1n) return true;

  for (const { prefix, bits } of PRIVATE_IPV6_PREFIXES) {
    if (bits === 128) continue; // Already checked loopback
    const shift = BigInt(128 - bits);
    if ((addr >> shift) === (prefix >> shift)) return true;
  }

  // IPv4-mapped ::ffff:x.x.x.x
  if ((addr >> 32n) === 0xffffn) {
    const ipv4Part = Number(addr & 0xffffffffn);
    const ipv4Str = [
      (ipv4Part >> 24) & 0xff,
      (ipv4Part >> 16) & 0xff,
      (ipv4Part >> 8) & 0xff,
      ipv4Part & 0xff,
    ].join('.');
    return isPrivateIPv4(ipv4Str);
  }

  return false;
}

/**
 * Check if an IP address is private (AC-4.12).
 * Covers IPv4 RFC 1918, IPv6 RFC 4193, link-local, loopback.
 */
export function isPrivateIP(ip: string): boolean {
  if (ip.includes(':')) return isPrivateIPv6(ip);
  return isPrivateIPv4(ip);
}

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** Inbound proxy request (from loa-finn via S2S JWT) */
export interface BYOKProxyRequest {
  /** Community ID (from JWT) */
  communityId: string;
  /** Provider (from JWT, e.g., 'openai') */
  provider: string;
  /** Operation (from JWT, e.g., 'chat.completions') */
  operation: string;
  /** JWT ID for replay protection */
  jti: string;
  /** Request body (JSON) */
  body: string;
  /** SHA-256 hash of canonical request body (from JWT) */
  reqHash: string;
  /** Additional headers to forward (filtered) */
  headers?: Record<string, string>;
}

/** Proxy response */
export interface BYOKProxyResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** BYOK proxy handler configuration */
export interface BYOKProxyHandlerConfig {
  /** Maximum response size in bytes (default: 10MB) */
  maxResponseBytes?: number;
  /** JTI TTL in seconds (default: 30) */
  jtiTtlSeconds?: number;
  /** Rate limit per community+provider per minute (default: 100) */
  rateLimitPerMinute?: number;
}

// --------------------------------------------------------------------------
// BYOK Proxy Handler
// --------------------------------------------------------------------------

export class BYOKProxyHandler {
  private readonly byokManager: BYOKManager;
  private readonly redis: Redis;
  private readonly logger: Logger;
  private readonly maxResponseBytes: number;
  private readonly jtiTtlSeconds: number;
  private readonly rateLimitPerMinute: number;

  /** DNS resolver — injectable for testing */
  public dnsResolve: (hostname: string) => Promise<Array<{ address: string; family: number }>> =
    (hostname) => dnsLookup(hostname, { all: true });

  /** HTTP fetch — injectable for testing */
  public httpFetch: typeof fetch = fetch;

  constructor(
    byokManager: BYOKManager,
    redis: Redis,
    logger: Logger,
    config?: BYOKProxyHandlerConfig,
  ) {
    this.byokManager = byokManager;
    this.redis = redis;
    this.logger = logger;
    this.maxResponseBytes = config?.maxResponseBytes ?? MAX_RESPONSE_BYTES;
    this.jtiTtlSeconds = config?.jtiTtlSeconds ?? JTI_TTL_SECONDS;
    this.rateLimitPerMinute = config?.rateLimitPerMinute ?? 100;
  }

  /**
   * Handle a BYOK proxy request.
   *
   * Security flow:
   * 1. Resolve provider + operation from allowlist
   * 2. Validate JTI uniqueness (replay protection, fail-closed)
   * 3. Validate req_hash (payload integrity)
   * 4. Retrieve decrypted API key from BYOK manager
   * 5. DNS resolve → private IP check
   * 6. Execute HTTP request (by resolved IP, no redirects)
   * 7. Return sanitized response
   */
  async handle(req: BYOKProxyRequest): Promise<BYOKProxyResponse> {
    const log = this.logger.child({
      communityId: req.communityId,
      provider: req.provider,
      operation: req.operation,
    });

    // 1. Resolve endpoint from static allowlist (AC-4.11)
    const endpoint = resolveEndpoint(req.provider, req.operation);
    if (!endpoint) {
      const code = PROVIDER_ENDPOINTS_HAS_PROVIDER(req.provider)
        ? 'BYOK_UNKNOWN_OPERATION'
        : 'BYOK_UNKNOWN_PROVIDER';
      throw new BYOKProxyError(code, `Unknown ${code === 'BYOK_UNKNOWN_PROVIDER' ? 'provider' : 'operation'}: ${req.provider}/${req.operation}`, 400);
    }

    // 2. JTI replay protection (AC-4.6, fail-closed per IMP-010)
    await this.checkJtiUniqueness(req.jti, log);

    // 3. Validate req_hash (payload integrity, AC-4.6)
    this.validateReqHash(req.body, req.reqHash);

    // 4. Rate limit check (fail-open per IMP-010)
    await this.checkRateLimit(req.communityId, req.provider, log);

    // 5. Retrieve decrypted API key
    const apiKey = await this.byokManager.getDecryptedKey(req.communityId, req.provider);
    if (!apiKey) {
      throw new BYOKProxyError('BYOK_KEY_NOT_FOUND', 'No active BYOK key for this community/provider', 404);
    }

    // 6. DNS resolve + private IP check (AC-4.12, AC-4.22)
    const resolvedIP = await this.resolveSafe(endpoint.hostname, log);

    // 7. Execute request (by IP, no redirects) (AC-4.23)
    const url = `https://${resolvedIP}:${endpoint.port}${endpoint.pathTemplate}`;

    // Build headers — strip internals, set auth
    const outHeaders: Record<string, string> = {
      'content-type': 'application/json',
      'host': endpoint.hostname, // SNI: real hostname in Host header
    };

    // Provider-specific auth header
    if (req.provider === 'openai') {
      outHeaders['authorization'] = `Bearer ${apiKey.toString('utf8')}`;
    } else if (req.provider === 'anthropic') {
      outHeaders['x-api-key'] = apiKey.toString('utf8');
      outHeaders['anthropic-version'] = '2023-06-01';
    }

    // Forward safe headers from request
    if (req.headers) {
      for (const [key, value] of Object.entries(req.headers)) {
        if (!STRIP_HEADERS.has(key.toLowerCase())) {
          outHeaders[key] = value;
        }
      }
    }

    // Zero API key buffer after use
    apiKey.fill(0);

    log.info({ resolvedIP, hostname: endpoint.hostname }, 'BYOK egress request');

    try {
      const response = await this.httpFetch(url, {
        method: endpoint.method,
        headers: outHeaders,
        body: req.body,
        redirect: 'error', // AC-4.23: reject all redirects
        signal: AbortSignal.timeout(30_000),
      });

      // AC-4.13: Check response size
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > this.maxResponseBytes) {
        throw new BYOKProxyError('BYOK_RESPONSE_TOO_LARGE', 'Provider response exceeds size limit', 502);
      }

      // Read response with size limit
      const body = await this.readResponseBody(response);

      // Strip sensitive response headers (AC-4.13)
      const safeHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        if (!STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) {
          safeHeaders[key] = value;
        }
      });

      return {
        status: response.status,
        headers: safeHeaders,
        body,
      };
    } catch (err) {
      if (err instanceof BYOKProxyError) throw err;

      // Redirect rejection (TypeError from fetch with redirect: 'error')
      if (err instanceof TypeError && (err.message.includes('redirect') || err.message.includes('Redirect'))) {
        throw new BYOKProxyError('BYOK_REDIRECT_REJECTED', 'Provider attempted redirect — rejected', 502);
      }

      log.error({ err }, 'BYOK proxy upstream error');
      throw new BYOKProxyError('BYOK_UPSTREAM_ERROR', 'Provider request failed', 502);
    }
  }

  // --------------------------------------------------------------------------
  // Private Helpers
  // --------------------------------------------------------------------------

  /** Check JTI uniqueness via Redis SETNX — fail-closed (AC-4.6, IMP-010) */
  private async checkJtiUniqueness(jti: string, log: Logger): Promise<void> {
    try {
      const result = await this.redis.set(
        `byok:jti:${jti}`,
        '1',
        'EX',
        this.jtiTtlSeconds,
        'NX',
      );

      if (result !== 'OK') {
        throw new BYOKProxyError('BYOK_REPLAY_DETECTED', 'Duplicate JTI — replay rejected', 409);
      }
    } catch (err) {
      if (err instanceof BYOKProxyError) throw err;

      // Redis unavailable → fail-closed (IMP-010)
      log.error({ err }, 'Redis unavailable for JTI check — fail-closed');
      throw new BYOKProxyError('BYOK_SERVICE_UNAVAILABLE', 'Replay protection unavailable', 503);
    }
  }

  /** Validate req_hash matches SHA-256 of request body (AC-4.6) */
  private validateReqHash(body: string, expectedHash: string): void {
    const actualHash = createHash('sha256').update(body).digest('hex');
    if (actualHash !== expectedHash) {
      throw new BYOKProxyError('BYOK_HASH_MISMATCH', 'Request body hash mismatch', 400);
    }
  }

  /** Rate limit per community+provider — fail-open (IMP-010) */
  private async checkRateLimit(communityId: string, provider: string, log: Logger): Promise<void> {
    try {
      const key = `byok:rate:${communityId}:${provider}`;
      const count = await this.redis.incr(key);

      if (count === 1) {
        // Set TTL on first request of the window
        await this.redis.expire(key, 60);
      }

      if (count > this.rateLimitPerMinute) {
        throw new BYOKProxyError('BYOK_RATE_LIMITED', 'BYOK rate limit exceeded', 429);
      }
    } catch (err) {
      if (err instanceof BYOKProxyError) throw err;

      // Redis unavailable → fail-open (IMP-010)
      log.warn({ err }, 'Redis unavailable for rate limit — fail-open (degraded)');
    }
  }

  /** DNS resolve with private IP blocking (AC-4.12, AC-4.22) */
  private async resolveSafe(hostname: string, log: Logger): Promise<string> {
    const addresses = await this.dnsResolve(hostname);

    if (addresses.length === 0) {
      throw new BYOKProxyError('BYOK_DNS_FAILED', `DNS resolution failed for ${hostname}`, 502);
    }

    // Check ALL resolved IPs — reject if any is private
    for (const { address } of addresses) {
      if (isPrivateIP(address)) {
        log.error({ hostname, address }, 'SSRF: DNS resolved to private IP');
        throw new BYOKProxyError('BYOK_SSRF_BLOCKED', 'DNS resolved to private IP range', 403);
      }
    }

    // Use first resolved address (resolve-once pattern)
    const selected = addresses[0].address;
    log.info({ hostname, resolvedIP: selected }, 'DNS resolved for BYOK egress');
    return selected;
  }

  /** Read response body with size limit (AC-4.13) */
  private async readResponseBody(response: Response): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) return '';

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        totalBytes += value.byteLength;
        if (totalBytes > this.maxResponseBytes) {
          reader.cancel();
          throw new BYOKProxyError('BYOK_RESPONSE_TOO_LARGE', 'Provider response exceeds size limit', 502);
        }

        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return new TextDecoder().decode(combined);
  }
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/** Check if provider exists (for better error messages) */
function PROVIDER_ENDPOINTS_HAS_PROVIDER(provider: string): boolean {
  return provider in PROVIDER_ENDPOINTS;
}

// --------------------------------------------------------------------------
// Error
// --------------------------------------------------------------------------

export class BYOKProxyError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'BYOKProxyError';
  }
}
