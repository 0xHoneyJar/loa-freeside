/**
 * JWKS Test Server
 * Sprint 2, Task 2.2: Local HTTP server for deterministic JWKS rotation and timeout simulation
 *
 * Provides a controllable JWKS endpoint for JWT conformance testing.
 * Supports key rotation, fault injection (blocking, delay), and reset.
 *
 * @see SDD §3.6 JWKS Test Server
 */

import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import {
  generateKeyPair,
  exportJWK,
  SignJWT,
  type JWK,
  type KeyLike,
} from 'jose';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export interface KeyEntry {
  kid: string;
  privateKey: KeyLike;
  publicJwk: JWK;
}

// --------------------------------------------------------------------------
// JWKS Test Server
// --------------------------------------------------------------------------

export class JwksTestServer {
  private server: Server | null = null;
  private port = 0;
  private keys: Map<string, KeyEntry> = new Map();

  // Fault injection
  private blocked = false;
  private delayMs = 0;

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        this.handleRequest(req, res).catch(() => {
          res.writeHead(500);
          res.end();
        });
      });
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

  getJwksUri(): string {
    return `http://127.0.0.1:${this.port}/.well-known/jwks.json`;
  }

  getPort(): number {
    return this.port;
  }

  // --------------------------------------------------------------------------
  // Key Management
  // --------------------------------------------------------------------------

  /** Generate ES256 keypair and add to JWKS */
  async addKey(kid: string): Promise<KeyEntry> {
    const { privateKey, publicKey } = await generateKeyPair('ES256');
    const publicJwk = await exportJWK(publicKey);

    const entry: KeyEntry = { kid, privateKey, publicJwk };
    this.keys.set(kid, entry);
    return entry;
  }

  /** Remove key from JWKS response */
  removeKey(kid: string): boolean {
    return this.keys.delete(kid);
  }

  /** Get current JWK array */
  getKeys(): JWK[] {
    return Array.from(this.keys.values()).map((entry) => ({
      ...entry.publicJwk,
      kid: entry.kid,
      use: 'sig',
      alg: 'ES256',
      kty: 'EC',
      crv: 'P-256',
    }));
  }

  /** Get a key entry for signing */
  getKeyEntry(kid: string): KeyEntry | undefined {
    return this.keys.get(kid);
  }

  // --------------------------------------------------------------------------
  // Token Signing Helper
  // --------------------------------------------------------------------------

  /** Sign a JWT with a specific key from this server */
  async signJwt(
    kid: string,
    claims: Record<string, unknown>,
  ): Promise<string> {
    const entry = this.keys.get(kid);
    if (!entry) {
      throw new Error(`Key '${kid}' not found in JWKS test server`);
    }

    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'ES256', kid, typ: 'JWT' })
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(entry.privateKey);
  }

  /** Sign a JWT with explicit iat/exp from vector claims */
  async signJwtWithClaims(
    kid: string,
    claims: Record<string, unknown>,
  ): Promise<string> {
    const entry = this.keys.get(kid);
    if (!entry) {
      throw new Error(`Key '${kid}' not found in JWKS test server`);
    }

    // Use claims as-is — don't override iat/exp
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'ES256', kid, typ: 'JWT' })
      .sign(entry.privateKey);
  }

  // --------------------------------------------------------------------------
  // Fault Injection
  // --------------------------------------------------------------------------

  /** Make endpoint return 503 */
  setBlocked(blocked: boolean): void {
    this.blocked = blocked;
  }

  /** Add artificial latency before response */
  setDelay(ms: number): void {
    this.delayMs = ms;
  }

  /** Clear all fault injection */
  resetFaults(): void {
    this.blocked = false;
    this.delayMs = 0;
  }

  // --------------------------------------------------------------------------
  // Request Handler
  // --------------------------------------------------------------------------

  private async handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${this.port}`);

    if (url.pathname === '/.well-known/jwks.json') {
      // Fault: blocked
      if (this.blocked) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'SERVICE_UNAVAILABLE' }));
        return;
      }

      // Fault: delay
      if (this.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.delayMs));
      }

      // Serve JWKS
      const jwks = { keys: this.getKeys() };
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600',
      });
      res.end(JSON.stringify(jwks));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'NOT_FOUND' }));
    }
  }
}
