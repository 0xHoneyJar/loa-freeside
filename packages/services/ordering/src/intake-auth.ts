import type { MiddlewareHandler } from 'hono';

/** Hono env the middleware contributes: the authenticated operator id, available via `c.get('operatorId')`. */
export type OperatorAuthEnv = { Variables: { operatorId: string } };

/**
 * S4-T2 / H-6 — intake authn/authz + replay protection + audit log.
 *
 * "Internal-only" is not an auth design. This middleware requires an authenticated operator
 * identity, an authz decision, and nonce + timestamp replay protection, and writes an intake audit
 * entry for EVERY attempt (accepted or rejected). Credential verification is injected (`authenticate`)
 * — a token map for the MVP, an ed25519 request signature later — so the policy is swappable.
 *
 * Request carries: `x-operator-id`, `x-credential`, `x-nonce`, `x-timestamp` (unix ms).
 * Rejections: 401 unauthenticated / stale / replayed · 403 unauthorized. All logged.
 */
export interface NonceStore {
  seen(nonce: string): boolean;
  remember(nonce: string): void;
}

/** In-memory nonce store (MVP). A shared/TTL store (Redis) swaps in behind this interface at deploy. */
export class InMemoryNonceStore implements NonceStore {
  private readonly used = new Set<string>();
  seen(nonce: string): boolean {
    return this.used.has(nonce);
  }
  remember(nonce: string): void {
    this.used.add(nonce);
  }
}

export interface IntakeAuditEntry {
  ok: boolean;
  operator_id?: string;
  reason?: string;
  nonce?: string;
  at_unix_ms: number;
}

export interface IntakeAuthDeps {
  /** Verify the operator's credential (token / signature). */
  authenticate: (operatorId: string, credential: string) => boolean;
  /** Authz policy: may this operator place orders? */
  authorize: (operatorId: string) => boolean;
  nonces: NonceStore;
  /** Injected clock, unix MILLIseconds. */
  now: () => number;
  /** Max allowed |now - timestamp| before a request is stale. Default 60s. */
  maxSkewMs?: number;
  /** Intake audit log — every attempt is recorded (never the credential itself). */
  audit: (entry: IntakeAuditEntry) => void;
}

const DEFAULT_SKEW_MS = 60_000;

export function requireOperatorAuth(deps: IntakeAuthDeps): MiddlewareHandler<OperatorAuthEnv> {
  const maxSkew = deps.maxSkewMs ?? DEFAULT_SKEW_MS;

  return async (c, next) => {
    const now = deps.now();
    const operatorId = c.req.header('x-operator-id');
    const credential = c.req.header('x-credential');
    const nonce = c.req.header('x-nonce');
    const tsRaw = c.req.header('x-timestamp');

    const reject = (status: 401 | 403, reason: string) => {
      deps.audit({ ok: false, operator_id: operatorId, reason, nonce, at_unix_ms: now });
      return c.json({ error: reason }, status);
    };

    if (!operatorId || !credential || !nonce || !tsRaw) return reject(401, 'missing auth headers');
    if (!deps.authenticate(operatorId, credential)) return reject(401, 'authentication failed');
    if (!deps.authorize(operatorId)) return reject(403, 'not authorized to place orders');

    const ts = Number(tsRaw);
    if (!Number.isFinite(ts) || Math.abs(now - ts) > maxSkew) return reject(401, 'stale or invalid timestamp');

    if (deps.nonces.seen(nonce)) return reject(401, 'replayed nonce');
    deps.nonces.remember(nonce);

    deps.audit({ ok: true, operator_id: operatorId, nonce, at_unix_ms: now });
    c.set('operatorId', operatorId);
    await next();
  };
}
