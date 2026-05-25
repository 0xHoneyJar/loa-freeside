/**
 * identity-api-link.ts — Sietch's binding to identity-api's
 * POST /v1/link/verified-wallet endpoint (T4.2 · bead arrakis-zedx).
 *
 * Purpose (per SDD §5.5 + §8.2): when Sietch's verify flow completes,
 * Sietch needs to record the verified linkage somewhere durable. The
 * pre-cycle-c path wrote directly to the local `userIdentities` /
 * `identityWallets` PG tables via UserRegistryService. T4.2 replaces
 * that direct write with an HTTP call to identity-api, which owns the
 * canonical resolution spine.
 *
 * T4.2 scope (this file):
 *   - Minimal HTTP client (`IdentityApiClient`) — just the
 *     /v1/link/verified-wallet endpoint for now. Pure fetch; no SDK
 *     dependency (npm package not published yet per repo context).
 *   - `IdentityApiIdentityLink` — service wrapper exposing the single
 *     `recordVerifiedWalletLink` operation Sietch's verify path needs.
 *
 * T4.3 wires this into the actual VerificationService.onWalletLink
 * callback at src/api/server.ts — a separate change kept small so the
 * cutover strategy can be operator-led (feature flag vs replace vs
 * parallel-write). This file ships ready for T4.3 to consume.
 *
 * Failure isolation (cycle-c NFR-3): NONE of these calls bubble
 * errors that should roll back Sietch's verify. Callers wrap in
 * try/catch and log; the VerificationService.ts:495 catch is the
 * authoritative isolation gate. This service exposes typed errors so
 * the caller can distinguish transient (retry) from terminal (audit
 * only, do not retry) failure modes.
 */

import { logger } from '../utils/logger.js';

// ─── public types ──────────────────────────────────────────────────────────

export interface IdentityApiClientOptions {
  /** Base URL for the identity-api service (no trailing slash). */
  baseUrl: string;
  /** Service-to-service token; sent as `X-Service-Token` header. */
  serviceToken: string;
  /** Optional fetch override for testing. */
  fetchImpl?: typeof fetch;
  /** Request timeout in ms (default 5000). */
  timeoutMs?: number;
}

export interface VerifiedWalletLinkInput {
  readonly worldSlug: string;
  readonly discordId: string;
  readonly walletAddress: string;
  readonly dynamicUserId?: string;
}

export interface VerifiedWalletLinkResult {
  readonly ok: true;
  readonly userId: string;
  readonly walletAddress: string;
  readonly idempotent: boolean;
  readonly conflictResolved: 'wallet_rebound' | 'discord_rebound' | null;
}

// ─── typed errors ──────────────────────────────────────────────────────────

/**
 * Hard-fail returned by identity-api when the wallet + discord pair
 * belong to two different existing users. Per SDD §8.2 / D8. Callers
 * MUST audit but MUST NOT retry — the conflict is policy, not transient.
 */
export class IdentityApiCrossUserCollisionError extends Error {
  readonly kind = 'cross_user_collision' as const;
  constructor(message: string) {
    super(message);
    this.name = 'IdentityApiCrossUserCollisionError';
  }
}

/** Transient — retry candidate (network, 5xx, timeout). */
export class IdentityApiTransientError extends Error {
  readonly kind = 'transient' as const;
  readonly statusCode?: number;
  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'IdentityApiTransientError';
    if (statusCode !== undefined) this.statusCode = statusCode;
  }
}

/** Service misconfiguration — caller must surface to ops; do not retry. */
export class IdentityApiConfigError extends Error {
  readonly kind = 'config' as const;
  constructor(message: string) {
    super(message);
    this.name = 'IdentityApiConfigError';
  }
}

// ─── HTTP client ───────────────────────────────────────────────────────────

/**
 * Minimal identity-api HTTP client. Just enough surface for T4.2's
 * verify-link write; extend as more endpoints get used.
 */
export class IdentityApiClient {
  private readonly baseUrl: string;
  private readonly serviceToken: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: IdentityApiClientOptions) {
    if (!opts.baseUrl) throw new Error('IdentityApiClient: baseUrl is required');
    if (!opts.serviceToken) throw new Error('IdentityApiClient: serviceToken is required');
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.serviceToken = opts.serviceToken;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 5000;
  }

  /**
   * POST /v1/link/verified-wallet. Throws typed errors per the SDD §8.2
   * envelope: 401/503 → config, 409 → cross_user_collision, 5xx/network
   * → transient.
   */
  async linkVerifiedWallet(input: VerifiedWalletLinkInput): Promise<VerifiedWalletLinkResult> {
    const url = `${this.baseUrl}/v1/link/verified-wallet`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-service-token': this.serviceToken,
        },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
    } catch (err) {
      // Network errors + AbortError both surface as transient.
      throw new IdentityApiTransientError(`network: ${String(err)}`);
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 200) {
      // identity-api returns snake_case wire shape per protocol/api/link.ts
      // LinkVerifiedWalletRespSchema. Map to camelCase result type so callers
      // can read result.userId etc. without surprises. FAGAN iter-1 fix:
      // the previous `as VerifiedWalletLinkResult` cast left callers reading
      // `undefined` for every camelCase field.
      const wireBody = (await res.json()) as {
        ok: true;
        user_id: string;
        wallet_address: string;
        idempotent: boolean;
        conflict_resolved: 'wallet_rebound' | 'discord_rebound' | null;
      };
      return {
        ok: true,
        userId: wireBody.user_id,
        walletAddress: wireBody.wallet_address,
        idempotent: wireBody.idempotent,
        conflictResolved: wireBody.conflict_resolved,
      };
    }
    if (res.status === 401 || res.status === 503) {
      const body = await safeJson(res);
      throw new IdentityApiConfigError(
        `identity-api ${res.status}: ${(body as { message?: string })?.message ?? 'auth/config error'}`,
      );
    }
    if (res.status === 409) {
      const body = await safeJson(res);
      throw new IdentityApiCrossUserCollisionError(
        (body as { message?: string })?.message ?? 'cross_user_collision',
      );
    }
    if (res.status >= 500) {
      throw new IdentityApiTransientError(`identity-api ${res.status}`, res.status);
    }
    // 4xx other than 401/409 → bad input. Treat as config (do not retry).
    const body = await safeJson(res);
    throw new IdentityApiConfigError(
      `identity-api ${res.status}: ${(body as { message?: string })?.message ?? 'bad request'}`,
    );
  }
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// ─── service wrapper ───────────────────────────────────────────────────────

/**
 * The verify-completion port that Sietch's VerificationService.onWalletLink
 * binds to. T4.3 wires this; T4.2 ships it ready.
 *
 * Single-method interface by design: the verify path needs exactly one
 * operation. Resist the urge to add CRUD; if Sietch needs other
 * identity-api endpoints (resolve, getProfile, etc.), they go on a
 * separate facade so the surface stays cohesive.
 */
export class IdentityApiIdentityLink {
  constructor(private readonly client: IdentityApiClient) {}

  /**
   * Record a verified wallet linkage with identity-api. Maps to
   * POST /v1/link/verified-wallet.
   *
   * Returns the linked user_id + conflict resolution outcome. Throws:
   *   - IdentityApiCrossUserCollisionError → 409 hard-fail; caller MUST
   *     surface to the user as a real conflict (do not retry).
   *   - IdentityApiTransientError → network/5xx; caller MAY retry after
   *     backoff.
   *   - IdentityApiConfigError → 401/503/4xx; caller MUST log to ops and
   *     NOT retry.
   *
   * Per cycle-c NFR-3 the caller (VerificationService.onWalletLink wrap)
   * catches all errors and prevents them from rolling back the verify.
   */
  async recordVerifiedWalletLink(
    input: VerifiedWalletLinkInput,
  ): Promise<VerifiedWalletLinkResult> {
    logger.debug(
      {
        worldSlug: input.worldSlug,
        discordId: input.discordId,
        walletAddress: input.walletAddress,
      },
      'identity-api: recordVerifiedWalletLink',
    );
    const result = await this.client.linkVerifiedWallet(input);
    logger.info(
      {
        worldSlug: input.worldSlug,
        discordId: input.discordId,
        walletAddress: input.walletAddress,
        userId: result.userId,
        idempotent: result.idempotent,
        conflictResolved: result.conflictResolved,
      },
      'identity-api: linkage recorded',
    );
    return result;
  }
}

// ─── factory ───────────────────────────────────────────────────────────────

/**
 * Build the singleton from env. Returns null if not configured (caller
 * decides whether to fall back to legacy UserRegistryService writes or
 * error). Env vars:
 *   IDENTITY_API_URL          required
 *   IDENTITY_API_SERVICE_TOKEN  required
 *   IDENTITY_API_TIMEOUT_MS   optional (default 5000)
 */
export function buildIdentityApiIdentityLinkFromEnv(): IdentityApiIdentityLink | null {
  const baseUrl = process.env.IDENTITY_API_URL;
  const serviceToken = process.env.IDENTITY_API_SERVICE_TOKEN;
  if (!baseUrl || !serviceToken) return null;
  const timeoutMs = process.env.IDENTITY_API_TIMEOUT_MS
    ? Number(process.env.IDENTITY_API_TIMEOUT_MS)
    : undefined;
  const client = new IdentityApiClient({
    baseUrl,
    serviceToken,
    ...(timeoutMs !== undefined && Number.isFinite(timeoutMs) ? { timeoutMs } : {}),
  });
  return new IdentityApiIdentityLink(client);
}
