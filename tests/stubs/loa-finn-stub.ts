/**
 * loa-finn Test Stub Server
 * Sprint S5-T8: Local HTTP server simulating loa-finn behavior
 *
 * Provides deterministic, scriptable responses for all loa-finn endpoints.
 * Used by integration tests (S5-T5) and load tests (S5-T6).
 *
 * @see SDD §7.1 Test Infrastructure
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AgentStreamEvent, UsageInfo } from '@arrakis/core/ports';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** Scripted response for POST /v1/agents/invoke */
export interface ScriptedInvokeResponse {
  content: string;
  usage: UsageInfo;
  /** Simulated latency in ms (default: 10) */
  latencyMs?: number;
  /** Return this HTTP status code (default: 200) */
  statusCode?: number;
}

/** Scripted behavior for POST /v1/agents/stream */
export interface ScriptedStreamBehavior {
  /** Content events to emit */
  events: Array<{ text: string }>;
  /** Usage info sent as the usage event */
  usage: UsageInfo;
  /** Delay between events in ms (default: 10) */
  intervalMs?: number;
  /** Drop connection after N events (no usage/done events) */
  dropAfterEvents?: number;
  /** Emit error event after N content events */
  errorAfterEvents?: number;
  /** Error details for error event */
  errorDetails?: { code: string; message: string };
  /** Return this HTTP status code instead of streaming (default: undefined → stream) */
  statusCode?: number;
}

/** Scripted usage lookup result */
export interface ScriptedUsageResult {
  usage: UsageInfo | null;
}

/** Stub server configuration */
export interface StubConfig {
  /** Minimum contract_version reported by health endpoint (default: 1) */
  contractVersion?: number;
  /** If true, validate incoming JWT Bearer tokens */
  validateJwt?: boolean;
  /** JWKS keys for JWT validation (required if validateJwt=true) */
  jwksKeys?: Array<Record<string, unknown>>;
}

// --------------------------------------------------------------------------
// Stub Server
// --------------------------------------------------------------------------

export class LoaFinnStub {
  private server: Server | null = null;
  private port = 0;

  // Scripted behaviors
  private invokeResponse: ScriptedInvokeResponse = {
    content: 'Hello from loa-finn stub',
    usage: { promptTokens: 10, completionTokens: 20, costUsd: 0.001 },
  };
  private streamBehavior: ScriptedStreamBehavior = {
    events: [{ text: 'Hello ' }, { text: 'world' }],
    usage: { promptTokens: 10, completionTokens: 20, costUsd: 0.001 },
  };
  private usageResults = new Map<string, UsageInfo>();
  private healthOverride: { statusCode: number; body: Record<string, unknown> } | null = null;
  private forceStatusCode: number | null = null;

  private config: Required<StubConfig> = {
    contractVersion: 1,
    validateJwt: false,
    jwksKeys: [],
  };

  // Request log for assertions
  private requestLog: Array<{
    method: string;
    path: string;
    headers: Record<string, string | string[] | undefined>;
    body?: unknown;
    timestamp: number;
  }> = [];

  constructor(config?: StubConfig) {
    if (config) {
      this.config = { ...this.config, ...config };
    }
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  /** Start server on a random available port */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => this.handleRequest(req, res));
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address();
        if (typeof addr === 'object' && addr) {
          this.port = addr.port;
        }
        resolve();
      });
      this.server.on('error', reject);
    });
  }

  /** Stop server and clean up */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => {
        this.server = null;
        resolve();
      });
    });
  }

  /** Get the base URL (e.g. http://127.0.0.1:12345) */
  getBaseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  // --------------------------------------------------------------------------
  // Scripting API
  // --------------------------------------------------------------------------

  /** Set the response for POST /v1/agents/invoke */
  setInvokeResponse(response: ScriptedInvokeResponse): void {
    this.invokeResponse = response;
  }

  /** Set the behavior for POST /v1/agents/stream */
  setStreamBehavior(behavior: ScriptedStreamBehavior): void {
    this.streamBehavior = behavior;
  }

  /** Set a usage result for GET /v1/usage/:idempotencyKey */
  setUsageResult(idempotencyKey: string, usage: UsageInfo): void {
    this.usageResults.set(idempotencyKey, usage);
  }

  /** Override health endpoint response */
  setHealthOverride(statusCode: number, body: Record<string, unknown>): void {
    this.healthOverride = { statusCode, body };
  }

  /** Force all responses to return this status code (for circuit breaker testing) */
  setForceStatusCode(statusCode: number | null): void {
    this.forceStatusCode = statusCode;
  }

  /** Set contract version for health endpoint */
  setContractVersion(version: number): void {
    this.config.contractVersion = version;
  }

  /** Reset all scripted behaviors to defaults */
  reset(): void {
    this.invokeResponse = {
      content: 'Hello from loa-finn stub',
      usage: { promptTokens: 10, completionTokens: 20, costUsd: 0.001 },
    };
    this.streamBehavior = {
      events: [{ text: 'Hello ' }, { text: 'world' }],
      usage: { promptTokens: 10, completionTokens: 20, costUsd: 0.001 },
    };
    this.usageResults.clear();
    this.healthOverride = null;
    this.forceStatusCode = null;
    this.requestLog = [];
    this.config.contractVersion = 1;
  }

  /** Get logged requests for assertions */
  getRequests(): typeof this.requestLog {
    return [...this.requestLog];
  }

  /** Get requests filtered by path */
  getRequestsByPath(path: string): typeof this.requestLog {
    return this.requestLog.filter((r) => r.path.startsWith(path));
  }

  // --------------------------------------------------------------------------
  // Request Handler
  // --------------------------------------------------------------------------

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readBody(req);
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${this.port}`);

    // Log request
    this.requestLog.push({
      method: req.method ?? 'GET',
      path: url.pathname,
      headers: req.headers as Record<string, string | string[] | undefined>,
      body: body ? JSON.parse(body) : undefined,
      timestamp: Date.now(),
    });

    // Force status code (circuit breaker testing)
    if (this.forceStatusCode) {
      res.writeHead(this.forceStatusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'FORCED_ERROR', message: 'Stub forced error' }));
      return;
    }

    // Route
    const method = req.method ?? 'GET';
    const path = url.pathname;

    if (method === 'POST' && path === '/v1/agents/invoke') {
      await this.handleInvoke(body, res);
    } else if (method === 'POST' && path === '/v1/agents/stream') {
      await this.handleStream(res);
    } else if (method === 'GET' && path.startsWith('/v1/usage/')) {
      this.handleUsage(path, res);
    } else if (method === 'GET' && path === '/v1/health') {
      this.handleHealth(res);
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'NOT_FOUND' }));
    }
  }

  // --------------------------------------------------------------------------
  // Endpoint Handlers
  // --------------------------------------------------------------------------

  private async handleInvoke(_body: string, res: ServerResponse): Promise<void> {
    const statusCode = this.invokeResponse.statusCode ?? 200;
    const latency = this.invokeResponse.latencyMs ?? 10;

    if (latency > 0) {
      await this.delay(latency);
    }

    if (statusCode !== 200) {
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'INVOKE_ERROR', message: 'Scripted error' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: randomUUID(),
      content: this.invokeResponse.content,
      usage: this.invokeResponse.usage,
    }));
  }

  private async handleStream(res: ServerResponse): Promise<void> {
    const behavior = this.streamBehavior;

    // Non-streaming error response
    if (behavior.statusCode) {
      res.writeHead(behavior.statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'STREAM_ERROR', message: 'Scripted error' }));
      return;
    }

    // SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const interval = behavior.intervalMs ?? 10;

    // Emit content events
    for (let i = 0; i < behavior.events.length; i++) {
      // Drop after N events (simulates connection drop)
      if (behavior.dropAfterEvents != null && i >= behavior.dropAfterEvents) {
        res.destroy();
        return;
      }

      // Error after N events
      if (behavior.errorAfterEvents != null && i >= behavior.errorAfterEvents) {
        const errorEvent: AgentStreamEvent = {
          type: 'error',
          data: behavior.errorDetails ?? { code: 'STREAM_ERROR', message: 'Scripted error' },
        };
        res.write(`event: error\ndata: ${JSON.stringify(errorEvent.data)}\n\n`);
        res.end();
        return;
      }

      const event: AgentStreamEvent = {
        type: 'content',
        data: { text: behavior.events[i].text },
      };
      res.write(`event: content\ndata: ${JSON.stringify(event.data)}\n\n`);

      if (interval > 0) {
        await this.delay(interval);
      }
    }

    // Usage event
    const usageEvent: AgentStreamEvent = {
      type: 'usage',
      data: behavior.usage,
    };
    res.write(`event: usage\ndata: ${JSON.stringify(usageEvent.data)}\n\n`);

    // Done event
    res.write(`event: done\ndata: null\n\n`);
    res.end();
  }

  private handleUsage(path: string, res: ServerResponse): void {
    const idempotencyKey = path.replace('/v1/usage/', '');
    const usage = this.usageResults.get(idempotencyKey);

    if (!usage) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'NOT_FOUND' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(usage));
  }

  private handleHealth(res: ServerResponse): void {
    if (this.healthOverride) {
      res.writeHead(this.healthOverride.statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(this.healthOverride.body));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      contract_version: this.config.contractVersion,
    }));
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks).toString()));
      req.on('error', reject);
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
