/**
 * host_fp — the salted data-store CORRELATION fingerprint (datastore-legibility
 * SDD C-2 / PRD §7.5 SKP-001).
 *
 * Answers "do two cells share a database?" — NOT a secrecy measure (a database
 * host is not a credential). It is salted so a viewer can't casually correlate
 * or brute-force a low-entropy internal hostname. **Credentials (user/password)
 * are NEVER in the preimage** — only engine + host + port + db, normalized. A
 * connection string never leaves the process; only this 16-hex fingerprint does.
 */

import { createHmac } from 'node:crypto';

export interface ConnectionParts {
  engine: string;
  host: string;
  port: string;
  db: string;
}

/** Postgres dialects normalize to one engine token; default ports are elided. */
const ENGINE_ALIASES: Record<string, string> = { postgresql: 'postgres', postgres: 'postgres' };
const DEFAULT_PORTS: Record<string, string> = { postgres: '5432', mysql: '3306' };

/**
 * Parse a connection URL into fingerprint parts, EXCLUDING credentials. Returns
 * null if the URL is empty or unparseable (the caller reports `reachable:false`
 * / absent-store rather than fabricating a fingerprint).
 */
export function parseConnectionParts(url: string): ConnectionParts | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const rawEngine = u.protocol.replace(/:$/, '').toLowerCase();
  const engine = ENGINE_ALIASES[rawEngine] ?? rawEngine;
  const host = u.hostname.toLowerCase();
  if (!host) return null;
  // Default-port elision so `host` and `host:5432` fingerprint identically.
  const port = u.port && u.port !== DEFAULT_PORTS[engine] ? u.port : '';
  const db = decodeURIComponent(u.pathname.replace(/^\//, '')).toLowerCase();
  return { engine, host, port, db };
}

/**
 * The salted correlation fingerprint: `HMAC_SHA256(salt, engine://host:port/db)`
 * truncated to 16 hex chars. Deterministic; identical (engine,host,port,db) →
 * identical fp regardless of credentials.
 */
export function hostFp(parts: ConnectionParts, salt: string): string {
  const preimage = `${parts.engine}://${parts.host}:${parts.port}/${parts.db}`.toLowerCase();
  return createHmac('sha256', salt).update(preimage).digest('hex').slice(0, 16);
}

/** Parse a URL and fingerprint it in one step. Null on an unparseable URL. */
export function hostFpFromUrl(url: string, salt: string): string | null {
  const parts = parseConnectionParts(url);
  return parts ? hostFp(parts, salt) : null;
}

/**
 * Read `CLUSTER_FP_SALT` — the single non-secret-rotating cluster constant that
 * makes fingerprints comparable across cells. FAIL-CLOSED in a deployed context
 * (a random per-process salt would make every cell's fp incomparable, silently
 * defeating the correlation). Local/dev falls back to a fixed dev salt (fps are
 * intentionally not comparable to prod).
 */
export function clusterFpSalt(env: NodeJS.ProcessEnv = process.env): string {
  const salt = env.CLUSTER_FP_SALT?.trim();
  if (salt) return salt;
  const deployed = Boolean(env.RAILWAY_ENVIRONMENT) || env.NODE_ENV === 'production';
  if (deployed) {
    throw new Error('CLUSTER_FP_SALT is required in a deployed context (host_fp correlation is meaningless without a shared salt)');
  }
  return 'dev-unsalted-fp';
}
