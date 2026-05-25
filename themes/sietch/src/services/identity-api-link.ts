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
   * envelope: 401 → config, 503 (`service_unconfigured`) → config, 503
   * (infra) → transient, 409 → cross_user_collision, 5xx → transient.
   *
   * BB review F-001: the timeout MUST cover the body read, not just the
   * headers. The previous version cleared the timer in `finally` as soon
   * as headers arrived — `res.json()` then ran with no timeout and could
   * hang indefinitely. Fix: read the body INSIDE the try block before
   * clearing the timer. Same Go-net/http-1.7 lesson — phase-2 reads need
   * the same deadline as phase-1.
   *
   * BB review F-004: 503 is emitted by load balancers, k8s readiness
   * probes, Railway gateway during deploys — NOT just identity-api's
   * `service_unconfigured`. Discriminate on the body's `code` field
   * instead of the status alone. AWS SDK v3 / ALB-503 lesson.
   */
  async linkVerifiedWallet(input: VerifiedWalletLinkInput): Promise<VerifiedWalletLinkResult> {
    const url = `${this.baseUrl}/v1/link/verified-wallet`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
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
      }

      // ALL body reads happen INSIDE the timeout's lifetime (F-001).
      if (res.status === 200) {
        // identity-api returns snake_case wire shape per protocol/api/link.ts
        // LinkVerifiedWalletRespSchema. Map to camelCase result type so
        // callers can read result.userId etc. without surprises. FAGAN
        // iter-1 fix on the original commit.
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
      if (res.status === 401) {
        const body = await safeJson(res);
        throw new IdentityApiConfigError(
          `identity-api 401: ${(body as { message?: string })?.message ?? 'unauthorized'}`,
        );
      }
      if (res.status === 503) {
        // F-004: discriminate identity-api's typed 503 from infrastructure
        // 503. If body has code === 'service_unconfigured', this is a
        // permanent config issue. Otherwise (bare 503 from LB / gateway /
        // probe) it's transient.
        const body = await safeJson(res);
        const code = (body as { code?: string })?.code;
        if (code === 'service_unconfigured') {
          throw new IdentityApiConfigError(
            `identity-api 503: ${(body as { message?: string })?.message ?? 'service unconfigured'}`,
          );
        }
        throw new IdentityApiTransientError(
          `identity-api 503 (infrastructure): ${(body as { message?: string })?.message ?? 'transient unavailable'}`,
          503,
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
    } catch (err) {
      // FAGAN-on-BB-F-001: a body-read abort (from the timer firing during
      // `res.json()`) would escape as an untyped error and bypass the
      // caller's typed-error handling. Preserve already-classified errors;
      // wrap anything else as IdentityApiTransientError so the verify
      // callback's classification still works.
      if (
        err instanceof IdentityApiConfigError ||
        err instanceof IdentityApiCrossUserCollisionError ||
        err instanceof IdentityApiTransientError
      ) {
        throw err;
      }
      throw new IdentityApiTransientError(`network/body: ${String(err)}`);
    } finally {
      // Cleared only after EVERY body read returns — F-001.
      clearTimeout(timer);
    }
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

// ─── lazy singleton (BB F-003 fix) ────────────────────────────────────────

/**
 * BB review F-003: `buildIdentityApiIdentityLinkFromEnv` was previously
 * called inside the verify callback closure — a new `IdentityApiClient`
 * was constructed on every verify event. No connection pooling, log spam,
 * and the docstring "lazy" was a lie. This cache makes it true-singleton:
 * built once on first call, reused for the life of the process.
 *
 * `__resetForTest` lets tests change env mid-process and force a rebuild.
 */
let _identityApiLinkCache: IdentityApiIdentityLink | null | undefined = undefined;

export function getIdentityApiIdentityLink(): IdentityApiIdentityLink | null {
  if (_identityApiLinkCache === undefined) {
    _identityApiLinkCache = buildIdentityApiIdentityLinkFromEnv();
  }
  return _identityApiLinkCache;
}

/** Test-only — reset the singleton so the next get-call rebuilds from env. */
export function __resetIdentityApiIdentityLinkForTest(): void {
  _identityApiLinkCache = undefined;
}
