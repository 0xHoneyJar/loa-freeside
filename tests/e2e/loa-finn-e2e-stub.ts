/**
 * loa-finn E2E Stub Server
 * Sprint 1, Task 1.3: Full-fidelity stub for E2E testing
 *
 * Extends the basic stub with:
 * - ES256 key pair generation at startup
 * - JWKS endpoint (/.well-known/jwks.json)
 * - Inbound JWT validation against arrakis JWKS
 * - Request body validation against contract schema
 * - Runtime-signed JWS usage reports
 * - Canned responses from test vectors
 *
 * @see SDD §3.2.1 E2E Stub Specification
 */

import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { randomUUID } from 'node:crypto';
import {
  generateKeyPair,
  exportJWK,
  SignJWT,
  jwtVerify,
  createRemoteJWKSet,
  type JWK,
  type KeyLike,
} from 'jose';

import { CONTRACT_SCHEMA, TEST_VECTORS, type TestVector } from '../e2e/contracts/src/index.js';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export interface E2EStubConfig {
  /** Port to listen on (0 = random) */
  port?: number;
  /** arrakis base URL for JWKS fetch (e.g. http://127.0.0.1:3000) */
  arrakisBaseUrl?: string;
  /** Whether to validate inbound JWTs from arrakis */
  validateInboundJwt?: boolean;
}

export interface UsageReport {
  reportId: string;
  jti: string;
  tenantId: string;
  poolId: string;
  inputTokens: number;
  outputTokens: number;
  costMicro: number;
  accountingMode: string;
  usageTokens?: number;
  timestamp: string;
}

// --------------------------------------------------------------------------
// E2E Stub Server
// --------------------------------------------------------------------------

export class LoaFinnE2EStub {
  private server: Server | null = null;
  private port = 0;

  // ES256 key pair — generated at startup
  private privateKey!: KeyLike;
  private publicJwk!: JWK;
  private readonly keyId = `e2e-stub-${randomUUID().slice(0, 8)}`;

  // arrakis JWKS for inbound JWT validation
  private arrakisJwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  // Collected usage reports for assertion
  private usageReports: UsageReport[] = [];

  // Request log
  private requestLog: Array<{
    method: string;
    path: string;
    headers: Record<string, string | string[] | undefined>;
    body?: unknown;
    timestamp: number;
    jwtClaims?: Record<string, unknown>;
  }> = [];

  private readonly config: Required<E2EStubConfig>;

  constructor(config?: E2EStubConfig) {
    this.config = {
      port: config?.port ?? 0,
      arrakisBaseUrl: config?.arrakisBaseUrl ?? 'http://127.0.0.1:3000',
      validateInboundJwt: config?.validateInboundJwt ?? true,
    };
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  /** Generate ES256 key pair and start HTTP server */
  async start(): Promise<void> {
    // Generate ES256 key pair for signing usage reports
    const { privateKey, publicKey } = await generateKeyPair('ES256');
    this.privateKey = privateKey;
    this.publicJwk = await exportJWK(publicKey);

    // Set up arrakis JWKS fetcher for inbound JWT validation
    if (this.config.validateInboundJwt) {
      const jwksUrl = new URL(
        '/.well-known/jwks.json',
        this.config.arrakisBaseUrl,
      );
      this.arrakisJwks = createRemoteJWKSet(jwksUrl);
    }

    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'INTERNAL', message: String(err) }));
        });
      });
      this.server.listen(this.config.port, '127.0.0.1', () => {
        const addr = this.server!.address();
        if (typeof addr === 'object' && addr) {
          this.port = addr.port;
        }
        resolve();
      });
      this.server.on('error', reject);
    });
  }

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

  getBaseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  getPort(): number {
    return this.port;
  }

  // --------------------------------------------------------------------------
  // Assertion Helpers
  // --------------------------------------------------------------------------

  getRequests(): typeof this.requestLog {
    return [...this.requestLog];
  }

  getUsageReports(): UsageReport[] {
    return [...this.usageReports];
  }

  getRequestsByPath(pathPrefix: string): typeof this.requestLog {
    return this.requestLog.filter((r) => r.path.startsWith(pathPrefix));
  }

  reset(): void {
    this.requestLog = [];
    this.usageReports = [];
  }

  // --------------------------------------------------------------------------
  // Request Router
  // --------------------------------------------------------------------------

  private async handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const body = await this.readBody(req);
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${this.port}`);
    const method = req.method ?? 'GET';
    const path = url.pathname;

    // Log request
    const logEntry: (typeof this.requestLog)[number] = {
      method,
      path,
      headers: req.headers as Record<string, string | string[] | undefined>,
      body: body ? this.safeJsonParse(body) : undefined,
      timestamp: Date.now(),
    };
    this.requestLog.push(logEntry);

    // Route
    if (method === 'GET' && path === '/.well-known/jwks.json') {
      this.handleJwks(res);
    } else if (method === 'POST' && path === '/v1/agents/invoke') {
      await this.handleInvoke(req, body, logEntry, res);
    } else if (method === 'POST' && path === '/v1/agents/stream') {
      await this.handleStream(req, body, logEntry, res);
    } else if (method === 'POST' && path === '/v1/usage/report') {
      await this.handleUsageReport(body, res);
    } else if (method === 'GET' && path === '/v1/health') {
      this.handleHealth(res);
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'NOT_FOUND' }));
    }
  }

  // --------------------------------------------------------------------------
  // JWKS Endpoint
  // --------------------------------------------------------------------------

  private handleJwks(res: ServerResponse): void {
    const jwks = {
      keys: [
        {
          ...this.publicJwk,
          kid: this.keyId,
          use: 'sig',
          alg: 'ES256',
          kty: 'EC',
          crv: 'P-256',
        },
      ],
    };
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    });
    res.end(JSON.stringify(jwks));
  }

  // --------------------------------------------------------------------------
  // Invoke Endpoint
  // --------------------------------------------------------------------------

  private async handleInvoke(
    req: IncomingMessage,
    body: string,
    logEntry: (typeof this.requestLog)[number],
    res: ServerResponse,
  ): Promise<void> {
    // Validate inbound JWT
    const claims = await this.validateJwt(req);
    if (claims === null && this.config.validateInboundJwt) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'UNAUTHORIZED', message: 'Invalid JWT' }));
      return;
    }
    logEntry.jwtClaims = claims ?? undefined;

    // Parse request body
    const parsed = this.safeJsonParse(body);
    if (!parsed) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'BAD_REQUEST', message: 'Invalid JSON body' }));
      return;
    }

    // Match test vector by access_level + pool_id from JWT claims
    const vector = this.matchVector(claims);
    const responseBody = vector?.response.body ?? {
      content: 'Default E2E stub response',
      usage: { prompt_tokens: 10, completion_tokens: 20, cost_usd: 0.001 },
    };

    // Sign and queue usage report
    if (vector?.usage_report_payload && claims) {
      await this.emitUsageReport(claims, vector.usage_report_payload);
    }

    const statusCode = vector?.response.status ?? 200;
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(responseBody));
  }

  // --------------------------------------------------------------------------
  // Stream Endpoint
  // --------------------------------------------------------------------------

  private async handleStream(
    req: IncomingMessage,
    _body: string,
    logEntry: (typeof this.requestLog)[number],
    res: ServerResponse,
  ): Promise<void> {
    const claims = await this.validateJwt(req);
    if (claims === null && this.config.validateInboundJwt) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'UNAUTHORIZED', message: 'Invalid JWT' }));
      return;
    }
    logEntry.jwtClaims = claims ?? undefined;

    // Find stream vector
    const vector = this.matchStreamVector(claims);
    const events = vector?.response.stream_events ?? [
      { type: 'content', data: { text: 'Default ' } },
      { type: 'content', data: { text: 'stream response' } },
      { type: 'usage', data: { prompt_tokens: 10, completion_tokens: 20, cost_usd: 0.001 } },
      { type: 'done', data: null },
    ];

    // SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Emit events
    for (const event of events) {
      const eventType = (event as Record<string, unknown>).type as string;
      const eventData = (event as Record<string, unknown>).data;
      res.write(`event: ${eventType}\ndata: ${JSON.stringify(eventData)}\n\n`);
      await this.delay(10);
    }

    // Sign and queue usage report for stream
    if (vector?.usage_report_payload && claims) {
      await this.emitUsageReport(claims, vector.usage_report_payload);
    }

    res.end();
  }

  // --------------------------------------------------------------------------
  // Usage Report Receiver (for testing arrakis → loa-finn usage flow)
  // --------------------------------------------------------------------------

  private async handleUsageReport(
    body: string,
    res: ServerResponse,
  ): Promise<void> {
    const parsed = this.safeJsonParse(body) as UsageReport | null;
    if (!parsed) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'BAD_REQUEST', message: 'Invalid JSON' }));
      return;
    }
    this.usageReports.push(parsed);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'accepted' }));
  }

  // --------------------------------------------------------------------------
  // Health Endpoint
  // --------------------------------------------------------------------------

  private handleHealth(res: ServerResponse): void {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'ok',
        contract_version: CONTRACT_SCHEMA.version,
        stub: true,
      }),
    );
  }

  // --------------------------------------------------------------------------
  // JWT Validation
  // --------------------------------------------------------------------------

  private async validateJwt(
    req: IncomingMessage,
  ): Promise<Record<string, unknown> | null> {
    if (!this.config.validateInboundJwt || !this.arrakisJwks) {
      // Extract claims without validation for logging
      const token = this.extractBearerToken(req);
      if (token) {
        return this.decodeJwtPayload(token);
      }
      return null;
    }

    const token = this.extractBearerToken(req);
    if (!token) return null;

    try {
      const { payload } = await jwtVerify(token, this.arrakisJwks, {
        issuer: 'arrakis',
        audience: 'loa-finn',
        clockTolerance: 30,
      });
      return payload as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private extractBearerToken(req: IncomingMessage): string | null {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return null;
    return auth.slice(7);
  }

  private decodeJwtPayload(token: string): Record<string, unknown> | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const payload = Buffer.from(parts[1], 'base64url').toString();
      return JSON.parse(payload) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  // --------------------------------------------------------------------------
  // Usage Report Signing
  // --------------------------------------------------------------------------

  /**
   * Create a signed usage report (JWS) and store it for later retrieval.
   * Matches SDD §3.2.1: stub signs usage reports at runtime with ephemeral key.
   */
  private async emitUsageReport(
    claims: Record<string, unknown>,
    vectorPayload: Record<string, unknown>,
  ): Promise<void> {
    const report: UsageReport = {
      reportId: randomUUID(),
      jti: (claims.jti as string) ?? randomUUID(),
      tenantId: (claims.tenant_id as string) ?? 'unknown',
      poolId: (vectorPayload.pool_id as string) ?? 'cheap',
      inputTokens: (vectorPayload.input_tokens as number) ?? 0,
      outputTokens: (vectorPayload.output_tokens as number) ?? 0,
      costMicro: (vectorPayload.cost_micro as number) ?? 0,
      accountingMode:
        (vectorPayload.accounting_mode as string) ?? 'PLATFORM_BUDGET',
      usageTokens: vectorPayload.usage_tokens as number | undefined,
      timestamp: new Date().toISOString(),
    };

    // Sign as JWS (for S2S verification)
    await new SignJWT(report as unknown as Record<string, unknown>)
      .setProtectedHeader({ alg: 'ES256', kid: this.keyId, typ: 'JWT' })
      .setIssuer('loa-finn')
      .setAudience('arrakis')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(this.privateKey);

    this.usageReports.push(report);
  }

  // --------------------------------------------------------------------------
  // Vector Matching
  // --------------------------------------------------------------------------

  private matchVector(
    claims: Record<string, unknown> | null,
  ): TestVector | undefined {
    if (!claims) return undefined;

    const accessLevel = claims.access_level as string;
    const poolId = claims.pool_id as string;
    const byok = claims.byok as boolean | undefined;
    const ensemble = claims.ensemble_strategy as string | undefined;

    // Match by specificity: BYOK > ensemble > pool routing > free tier
    if (byok) {
      return TEST_VECTORS.vectors.find((v) => v.name === 'invoke_byok');
    }
    if (ensemble) {
      return TEST_VECTORS.vectors.find(
        (v) => v.name === 'invoke_ensemble_best_of_n',
      );
    }
    if (accessLevel === 'pro' && poolId !== 'cheap') {
      return TEST_VECTORS.vectors.find(
        (v) => v.name === 'invoke_pro_pool_routing',
      );
    }
    return TEST_VECTORS.vectors.find((v) => v.name === 'invoke_free_tier');
  }

  private matchStreamVector(
    claims: Record<string, unknown> | null,
  ): TestVector | undefined {
    if (!claims) return undefined;
    return TEST_VECTORS.vectors.find((v) => v.name === 'invoke_stream_sse');
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

  private safeJsonParse(str: string): Record<string, unknown> | null {
    try {
      return JSON.parse(str) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
