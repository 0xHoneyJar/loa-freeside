/**
 * loa-finn Client
 * Sprint S2-T4: HTTP client for loa-finn invoke/stream/health/usage endpoints
 *
 * Features:
 * - Circuit breaker via opossum (timeout 120s, errorThreshold 50%, resetTimeout 30s)
 * - Retry on 502/503/504: exponential backoff (1s, 2s, 4s), max 3 retries
 * - New JWT per retry, same idempotencyKey (FR-4.5)
 * - No auto-retry on SSE stream drop (FR-4.7)
 * - SSE contract enforcement (Flatline SKP-003):
 *   - Validate event ordering (content* → usage → done)
 *   - Bounded read buffer (64KB max per event)
 *   - Handle partial SSE frames (incomplete data: lines across chunks)
 *
 * @see SDD §4.6 loa-finn Client
 */

import CircuitBreaker from 'opossum';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type {
  AgentInvokeRequest,
  AgentInvokeResponse,
  AgentStreamEvent,
  UsageInfo,
} from '@arrakis/core/ports';
import type { LoaFinnConfig } from './config.js';
import { CONTRACT_VERSION, validateContractCompatibility } from './contract-version.js';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** Function to mint a fresh JWT for a request (new jti per call) */
export type JwtMinter = (request: AgentInvokeRequest, rawBody: string) => Promise<string>;

/** loa-finn client dependencies */
export interface LoaFinnClientDeps {
  config: LoaFinnConfig;
  logger: Logger;
  mintJwt: JwtMinter;
}

// --------------------------------------------------------------------------
// Zod Schemas for SSE event validation (parse boundary)
// --------------------------------------------------------------------------

const usageInfoSchema = z.object({
  promptTokens: z.number(),
  completionTokens: z.number(),
  costUsd: z.number(),
});

const streamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('content'), data: z.object({ text: z.string() }), id: z.string().optional() }),
  z.object({ type: z.literal('thinking'), data: z.object({ text: z.string() }), id: z.string().optional() }),
  z.object({ type: z.literal('tool_call'), data: z.object({ name: z.string(), args: z.record(z.unknown()) }), id: z.string().optional() }),
  z.object({ type: z.literal('usage'), data: usageInfoSchema, id: z.string().optional() }),
  z.object({ type: z.literal('done'), data: z.null(), id: z.string().optional() }),
  z.object({ type: z.literal('error'), data: z.object({ code: z.string(), message: z.string() }), id: z.string().optional() }),
]);

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

/** Retryable HTTP status codes */
const RETRYABLE_STATUS_CODES = new Set([502, 503, 504]);

// [1s, 2s, 4s]: Exponential backoff with 3 retries. Total worst-case wait = 7s.
// Covers transient ALB 502s and brief loa-finn restarts without excessive delay.
// Max 3 retries: beyond that, the issue is systemic (circuit breaker handles it).
const RETRY_DELAYS_MS = [1000, 2000, 4000];

/** Maximum SSE event data size (64KB) — Flatline SKP-003 */
const MAX_SSE_EVENT_BYTES = 64 * 1024;

/** Health check timeout */
const HEALTH_TIMEOUT_MS = 5000;

// --------------------------------------------------------------------------
// SSE State Machine — enforces event ordering (Flatline SKP-003)
// --------------------------------------------------------------------------

type SseState = 'streaming' | 'usage_received' | 'done';

const VALID_TRANSITIONS: Record<SseState, Set<string>> = {
  streaming: new Set(['content', 'thinking', 'tool_call', 'usage', 'error']),
  usage_received: new Set(['done', 'error']),
  done: new Set(), // terminal
};

// --------------------------------------------------------------------------
// loa-finn Client
// --------------------------------------------------------------------------

export class LoaFinnClient {
  private readonly log: Logger;
  private readonly config: LoaFinnConfig;
  private readonly mintJwt: JwtMinter;
  private readonly breaker: CircuitBreaker<[() => Promise<Response>], Response>;

  constructor(deps: LoaFinnClientDeps) {
    this.log = deps.logger.child({ component: 'LoaFinnClient' });
    this.config = deps.config;
    this.mintJwt = deps.mintJwt;

    // Circuit breaker wraps the raw fetch call
    this.breaker = new CircuitBreaker(
      async (fn: () => Promise<Response>): Promise<Response> => fn(),
      {
        // 120s: loa-finn streams can run long (multi-turn agent conversations).
        // Must exceed max expected response time. See SDD §4.6.
        timeout: this.config.timeoutMs || 120_000,
        // 50%: Standard circuit breaker threshold. Opens after half of requests
        // in the volume window fail, preventing cascading failures.
        errorThresholdPercentage: 50,
        // 30s: Half-open probe interval after circuit opens. Allows loa-finn
        // time to recover from transient overload before resuming traffic.
        resetTimeout: this.config.circuitBreakerResetMs || 30_000,
        // 5: Minimum requests before circuit breaker evaluates error rate.
        // Prevents premature tripping on low-volume startup traffic.
        volumeThreshold: this.config.circuitBreakerThreshold || 5,
      },
    );

    this.breaker.on('open', () => this.log.warn('loa-finn circuit breaker OPEN'));
    this.breaker.on('halfOpen', () => this.log.info('loa-finn circuit breaker HALF-OPEN'));
    this.breaker.on('close', () => this.log.info('loa-finn circuit breaker CLOSED'));
  }

  // --------------------------------------------------------------------------
  // invoke() — synchronous invocation with retry
  // --------------------------------------------------------------------------

  async invoke(request: AgentInvokeRequest): Promise<AgentInvokeResponse> {
    const url = `${this.config.baseUrl}/v1/agents/invoke`;
    const body = this.buildRequestBody(request);
    const rawBody = JSON.stringify(body);

    return this.withRetry(request, rawBody, async (jwt: string) => {
      const response = await this.breaker.fire(async () =>
        fetch(url, {
          method: 'POST',
          headers: this.buildHeaders(jwt, request),
          body: rawBody,
          signal: AbortSignal.timeout(this.config.timeoutMs || 120_000),
        }),
      );

      if (!response.ok) {
        await this.throwOnError(response);
      }

      // AC-2.21: fail-fast contract version negotiation
      this.validatePeerContractVersion(response);

      return (await response.json()) as AgentInvokeResponse;
    });
  }

  // --------------------------------------------------------------------------
  // stream() — SSE streaming with contract enforcement (no auto-retry)
  // --------------------------------------------------------------------------

  async *stream(
    request: AgentInvokeRequest,
    options?: { signal?: AbortSignal; lastEventId?: string },
  ): AsyncGenerator<AgentStreamEvent> {
    const url = `${this.config.baseUrl}/v1/agents/stream`;
    const body = this.buildRequestBody(request);
    const rawBody = JSON.stringify(body);
    const jwt = await this.mintJwt(request, rawBody);

    // Compose downstream abort signal with timeout (SDD §4.7 — abort propagation)
    const timeoutSignal = AbortSignal.timeout(this.config.timeoutMs || 120_000);
    const signal = options?.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;

    const headers = this.buildHeaders(jwt, request);
    // Forward Last-Event-ID for SSE resume (S11-T1, SDD §4.6.1)
    if (options?.lastEventId) {
      headers['Last-Event-ID'] = options.lastEventId;
    }

    // No circuit breaker on streams — no auto-retry per FR-4.7
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: rawBody,
      signal,
    });

    if (!response.ok) {
      await this.throwOnError(response);
    }

    // AC-2.21: fail-fast contract version negotiation
    this.validatePeerContractVersion(response);

    if (!response.body) {
      throw new LoaFinnError('Stream response has no body', 'STREAM_ERROR');
    }

    yield* this.parseSSE(response.body);
  }

  // --------------------------------------------------------------------------
  // getUsage() — reconciliation endpoint
  // --------------------------------------------------------------------------

  async getUsage(idempotencyKey: string): Promise<UsageInfo | null> {
    const url = `${this.config.baseUrl}/v1/usage/${encodeURIComponent(idempotencyKey)}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(this.config.timeoutMs || 30_000),
    });

    if (response.status === 404) return null;
    if (response.status === 202) return null; // still in progress

    if (!response.ok) {
      await this.throwOnError(response);
    }

    const data = await response.json();
    return usageInfoSchema.parse(data);
  }

  // --------------------------------------------------------------------------
  // healthCheck()
  // --------------------------------------------------------------------------

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
    const start = Date.now();
    try {
      const response = await fetch(`${this.config.baseUrl}/v1/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      const latencyMs = Date.now() - start;
      return { healthy: response.ok, latencyMs };
    } catch {
      return { healthy: false, latencyMs: Date.now() - start };
    }
  }

  // --------------------------------------------------------------------------
  // SSE Parser — handles partial frames and enforces contract (Flatline SKP-003)
  // --------------------------------------------------------------------------

  private async *parseSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<AgentStreamEvent> {
    const decoder = new TextDecoder();
    let buffer = '';
    let eventType = '';
    let eventData = '';
    let eventId = '';
    let state: SseState = 'streaming';

    for await (const chunk of this.readStream(body)) {
      buffer += decoder.decode(chunk, { stream: true });

      // Process complete lines (SSE uses \n or \r\n as delimiters)
      let lineEnd: number;
      while ((lineEnd = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, lineEnd).replace(/\r$/, '');
        buffer = buffer.slice(lineEnd + 1);

        // Bounded buffer check (Flatline SKP-003) — byte-accurate for multibyte UTF-8
        if (Buffer.byteLength(eventData, 'utf8') > MAX_SSE_EVENT_BYTES) {
          throw new LoaFinnError(
            `SSE event data exceeds ${MAX_SSE_EVENT_BYTES} byte limit`,
            'SSE_OVERFLOW',
          );
        }

        if (line === '') {
          // Empty line = event dispatch
          if (eventData) {
            const event = this.parseEvent(eventType || 'content', eventData, eventId);
            if (event) {
              // Validate state transition (Flatline SKP-003)
              if (!VALID_TRANSITIONS[state]?.has(event.type)) {
                this.log.warn(
                  { currentState: state, eventType: event.type },
                  'SSE contract violation: unexpected event in current state',
                );
                throw new LoaFinnError(
                  `SSE contract violation: unexpected '${event.type}' in state '${state}'`,
                  'SSE_CONTRACT',
                );
              }

              // Advance state machine
              if (event.type === 'usage') state = 'usage_received';
              else if (event.type === 'done') state = 'done';
              else if (event.type === 'error') state = 'done';

              yield event;
            }
          }
          // Reset event fields
          eventType = '';
          eventData = '';
          eventId = '';
        } else if (line.startsWith('event:')) {
          eventType = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          eventData += (eventData ? '\n' : '') + line.slice(5).trim();
        } else if (line.startsWith('id:')) {
          eventId = line.slice(3).trim();
        }
        // Ignore comments (lines starting with ':') and unknown fields
      }

      // Check remaining buffer size (partial frame protection) — byte-accurate
      if (Buffer.byteLength(buffer, 'utf8') > MAX_SSE_EVENT_BYTES) {
        throw new LoaFinnError(
          `SSE buffer exceeds ${MAX_SSE_EVENT_BYTES} byte limit (no newline found)`,
          'SSE_OVERFLOW',
        );
      }
    }
  }

  /** Convert ReadableStream to async iterable */
  private async *readStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) yield value;
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        // ignore cancel errors (stream may already be closed)
      }
      reader.releaseLock();
    }
  }

  /** Parse a single SSE event, validating with zod */
  private parseEvent(type: string, data: string, id: string): AgentStreamEvent | null {
    try {
      const parsed = JSON.parse(data);
      const envelope = {
        type,
        data: parsed,
        ...(id ? { id } : {}),
      };
      return streamEventSchema.parse(envelope);
    } catch (err) {
      this.log.warn({ type, err }, 'Failed to parse SSE event — skipping');
      return null;
    }
  }

  // --------------------------------------------------------------------------
  // Retry Logic — exponential backoff on 502/503/504
  // --------------------------------------------------------------------------

  private async withRetry<T>(
    request: AgentInvokeRequest,
    rawBody: string,
    fn: (jwt: string) => Promise<T>,
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        // Mint fresh JWT per attempt (new jti, same idempotencyKey) — FR-4.5
        // rawBody is the exact bytes forwarded to loa-finn, used for req_hash binding
        const jwt = await this.mintJwt(request, rawBody);
        return await fn(jwt);
      } catch (err) {
        lastError = err;

        // STREAM_RESUME_LOST: never retry — caller must mint new idempotency key (S11-T1)
        if (err instanceof StreamResumeLostError) {
          throw err;
        }

        // JTI replay (409 without STREAM_RESUME_LOST): re-mint JWT and retry immediately (S11-T1)
        if (err instanceof JtiReplayError) {
          if (attempt < RETRY_DELAYS_MS.length) {
            this.log.info(
              { attempt: attempt + 1 },
              'loa-finn jti replay — re-minting JWT',
            );
            continue; // no backoff needed — just needs fresh jti
          }
          throw err;
        }

        if (err instanceof LoaFinnError && RETRYABLE_STATUS_CODES.has(err.statusCode ?? 0)) {
          if (attempt < RETRY_DELAYS_MS.length) {
            const delay = RETRY_DELAYS_MS[attempt]!;
            this.log.warn(
              { attempt: attempt + 1, delayMs: delay, status: err.statusCode },
              'loa-finn retryable error — backing off',
            );
            await sleep(delay);
            continue;
          }
        }

        // Non-retryable or exhausted retries
        throw err;
      }
    }

    throw lastError;
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private buildRequestBody(request: AgentInvokeRequest): Record<string, unknown> {
    return {
      agent: request.agent,
      messages: request.messages,
      ...(request.modelAlias ? { model_alias: request.modelAlias } : {}),
      ...(request.tools ? { tools: request.tools } : {}),
      ...(request.metadata ? { metadata: request.metadata } : {}),
    };
  }

  private buildHeaders(jwt: string, request: AgentInvokeRequest): Record<string, string> {
    return {
      'Authorization': `Bearer ${jwt}`,
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
      'X-Idempotency-Key': request.context.idempotencyKey,
      'X-Trace-ID': request.context.traceId || randomUUID(),
    };
  }

  /**
   * Validate peer contract version from response header (AC-2.21).
   * Fail-fast: if loa-finn declares an incompatible contract version,
   * throw immediately rather than processing a potentially malformed response.
   *
   * Missing header is tolerated (backward compat with older loa-finn).
   */
  private validatePeerContractVersion(response: Response): void {
    const peerVersion = response.headers.get('x-contract-version');
    if (!peerVersion) return; // Header absent — older loa-finn, tolerate

    const result = validateContractCompatibility(CONTRACT_VERSION, peerVersion);
    if (!result.compatible) {
      this.log.error(
        { ourVersion: CONTRACT_VERSION, peerVersion, reason: result.reason },
        'CONTRACT_VERSION_MISMATCH: incompatible loa-finn contract version',
      );
      throw new ContractVersionMismatchError(
        `Contract version mismatch: ours=${CONTRACT_VERSION}, peer=${peerVersion} — ${result.reason}`,
        CONTRACT_VERSION,
        peerVersion,
      );
    }
  }

  private async throwOnError(response: Response): Promise<never> {
    let body = '';
    try {
      body = await response.text();
    } catch { /* ignore */ }

    // 400 REQ_HASH_MISMATCH — wire bytes don't match req_hash claim (S11-T3)
    if (response.status === 400 && body.includes('REQ_HASH_MISMATCH')) {
      this.log.warn(
        { traceId: response.headers.get('x-trace-id'), bodyPrefix: body.slice(0, 200) },
        'req_hash mismatch detected',
      );
      throw new ReqHashMismatchError(
        `loa-finn req_hash mismatch: ${body.slice(0, 500)}`,
      );
    }

    // 409 Conflict — differentiate STREAM_RESUME_LOST from jti replay (S11-T1)
    if (response.status === 409) {
      if (body.includes('STREAM_RESUME_LOST')) {
        throw new StreamResumeLostError(
          `loa-finn stream context expired: ${body.slice(0, 500)}`,
        );
      }
      throw new JtiReplayError(
        `loa-finn jti replay detected: ${body.slice(0, 500)}`,
      );
    }

    throw new LoaFinnError(
      `loa-finn responded with ${response.status}: ${body.slice(0, 500)}`,
      'UPSTREAM_ERROR',
      response.status,
    );
  }
}

// --------------------------------------------------------------------------
// Error Class
// --------------------------------------------------------------------------

export class LoaFinnError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'LoaFinnError';
  }
}

/**
 * 400 with REQ_HASH_MISMATCH — wire bytes don't match req_hash JWT claim.
 * Non-retryable — indicates serialization divergence or proxy tampering.
 */
export class ReqHashMismatchError extends LoaFinnError {
  constructor(message: string) {
    super(message, 'REQ_HASH_MISMATCH', 400);
    this.name = 'ReqHashMismatchError';
  }
}

/**
 * 409 with STREAM_RESUME_LOST in body — loa-finn stream context expired.
 * Caller must mint a NEW idempotency key for fresh execution (S11-T0 state machine).
 * NOT retryable — propagates to caller.
 */
export class StreamResumeLostError extends LoaFinnError {
  constructor(message: string) {
    super(message, 'STREAM_RESUME_LOST', 409);
    this.name = 'StreamResumeLostError';
  }
}

/**
 * 409 without STREAM_RESUME_LOST — jti replay detected.
 * Retryable by minting a new JWT with fresh jti (same idempotency key).
 */
export class JtiReplayError extends LoaFinnError {
  constructor(message: string) {
    super(message, 'JTI_REPLAY', 409);
    this.name = 'JtiReplayError';
  }
}

/**
 * Contract version mismatch — arrakis and loa-finn have incompatible contract versions.
 * Non-retryable. Requires deployment coordination to resolve.
 * @see AC-2.21 — fail-fast version negotiation
 */
export class ContractVersionMismatchError extends LoaFinnError {
  constructor(
    message: string,
    public readonly ourVersion: string,
    public readonly peerVersion: string,
  ) {
    super(message, 'CONTRACT_VERSION_MISMATCH', 409);
    this.name = 'ContractVersionMismatchError';
  }
}

// --------------------------------------------------------------------------
// Utilities
// --------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
