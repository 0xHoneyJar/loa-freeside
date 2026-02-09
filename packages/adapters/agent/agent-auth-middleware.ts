/**
 * Agent Auth Middleware + Request Context Builder
 * Sprint S4-T6: Express middleware for agent request authentication
 *
 * Derives AgentRequestContext from server-side session, NOT client input.
 * Prevents tier spoofing by reading tier from conviction scoring service.
 *
 * @see SDD §4.6 Agent Auth Middleware
 * @see Flatline SKP-005 Conviction scoring dependency
 */

import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { Logger } from 'pino';
import type { AgentRequestContext, AgentPlatform, AccessLevel, ModelAlias } from '@arrakis/core/ports';
import type { TierAccessMapper } from './tier-access-mapper.js';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** Auth context extracted from existing session infrastructure */
export interface SessionContext {
  userId: string;
  walletAddress: string;
  communityId: string;
  platform: AgentPlatform;
  channelId: string;
  nftId?: string | null;
  roles?: string[];
}

/** Conviction scoring service interface */
export interface ConvictionScorer {
  /** Get tier for a user in a community. Returns 1-9. */
  getTier(communityId: string, userId: string): Promise<number>;
}

/** Session extractor: resolves session from request */
export interface SessionExtractor {
  /** Extract session context from request. Returns null if not authenticated. */
  extractSession(req: Request): Promise<SessionContext | null>;
}

/** Deps injected into the middleware factory */
export interface AgentAuthDeps {
  sessionExtractor: SessionExtractor;
  tierMapper: TierAccessMapper;
  convictionScorer: ConvictionScorer;
  logger: Logger;
}

// 5s: Conviction scoring is a network call to conviction service. 5s allows for
// cold starts. Fail-closed to tier 1 on timeout preserves security. See SDD §4.6.
const CONVICTION_TIMEOUT_MS = 5_000;
// 60s: Tier changes are infrequent (NFT-based). 60s cache reduces conviction service
// load by ~60x while keeping tier changes responsive within 1 minute.
const CONVICTION_CACHE_TTL_MS = 60_000;
// 10s: On conviction timeout/error, cache tier 1 with shorter TTL. Limits retry storms
// to at most 1 per 10s per user while recovering quickly when service returns.
const CONVICTION_ERROR_CACHE_TTL_MS = 10_000;

// --------------------------------------------------------------------------
// Conviction Score Cache (in-memory, per-process)
// --------------------------------------------------------------------------

interface CachedTier {
  tier: number;
  expiresAt: number;
}

const tierCache = new Map<string, CachedTier>();

function getCachedTier(communityId: string, userId: string): number | null {
  const key = `${communityId}:${userId}`;
  const entry = tierCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    tierCache.delete(key);
    return null;
  }
  // True LRU: delete and re-set to move to end
  tierCache.delete(key);
  tierCache.set(key, entry);
  return entry.tier;
}

function setCachedTier(communityId: string, userId: string, tier: number, ttlMs = CONVICTION_CACHE_TTL_MS): void {
  const key = `${communityId}:${userId}`;
  // Evict oldest if over 10K entries
  if (tierCache.size >= 10_000) {
    const oldest = tierCache.keys().next().value;
    if (oldest !== undefined) tierCache.delete(oldest);
  }
  tierCache.set(key, { tier, expiresAt: Date.now() + ttlMs });
}

// --------------------------------------------------------------------------
// Middleware Factory
// --------------------------------------------------------------------------

/**
 * Creates Express middleware that validates authentication and builds AgentRequestContext.
 * Attaches context to `req.agentContext` for downstream route handlers.
 */
export function requireAgentAuth(deps: AgentAuthDeps) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const context = await buildAgentRequestContext(req, deps);
      if (!context) {
        res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required' });
        return;
      }

      // Attach to request for downstream handlers
      (req as AgentAuthenticatedRequest).agentContext = context;

      // Set trace ID response header
      res.setHeader('X-Trace-Id', context.traceId);

      next();
    } catch (err) {
      deps.logger.error({ err }, 'AgentAuth: unexpected error in middleware');
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Authentication failed' });
    }
  };
}

// --------------------------------------------------------------------------
// Context Builder
// --------------------------------------------------------------------------

/**
 * Build AgentRequestContext from server-side session data.
 * Tier is resolved from conviction scoring service (NOT from client input).
 *
 * @returns AgentRequestContext or null if not authenticated
 */
export async function buildAgentRequestContext(
  req: Request,
  deps: AgentAuthDeps,
): Promise<AgentRequestContext | null> {
  // 1. Extract session from request (server-side, not client headers)
  const session = await deps.sessionExtractor.extractSession(req);
  if (!session) return null;

  // 2. Resolve tier from conviction scoring service (fail-closed to tier 1)
  const tier = await resolveTier(
    session.communityId,
    session.userId,
    deps.convictionScorer,
    deps.logger,
  );

  // 3. Resolve access level + allowed models from tier mapper
  const { accessLevel, allowedModelAliases } = await deps.tierMapper.resolveAccess(
    tier,
    session.communityId,
  );

  // 4. Idempotency key: use client-provided or generate new
  const rawIdempotency = req.headers['x-idempotency-key'];
  const idempotencyKey =
    (typeof rawIdempotency === 'string' && rawIdempotency.trim()) ||
    (Array.isArray(rawIdempotency) && rawIdempotency[0]?.trim()) ||
    randomUUID();

  // 5. Trace ID: always generate new
  const traceId = randomUUID();

  // 6. Channel ID: from request header or session context
  const rawChannelId = req.headers['x-channel-id'];
  const channelId =
    (typeof rawChannelId === 'string' && rawChannelId.trim()) ||
    (Array.isArray(rawChannelId) && rawChannelId[0]?.trim()) ||
    session.channelId;

  return {
    tenantId: session.communityId,
    userId: session.walletAddress,
    nftId: session.nftId ?? null,
    tier,
    accessLevel,
    allowedModelAliases,
    platform: session.platform,
    channelId,
    idempotencyKey,
    traceId,
  };
}

// --------------------------------------------------------------------------
// Tier Resolution (with timeout, cache, fail-safe)
// --------------------------------------------------------------------------

/**
 * Resolve tier from conviction scoring with:
 * - In-memory cache (60s TTL)
 * - 5s timeout
 * - Fail-closed to tier 1 (lowest access) if unavailable
 *
 * @see Flatline SKP-005
 */
async function resolveTier(
  communityId: string,
  userId: string,
  scorer: ConvictionScorer,
  logger: Logger,
): Promise<number> {
  // Check cache first
  const cached = getCachedTier(communityId, userId);
  if (cached !== null) return cached;

  try {
    const tier = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Conviction scoring timeout')),
        CONVICTION_TIMEOUT_MS,
      );

      scorer
        .getTier(communityId, userId)
        .then((t) => {
          clearTimeout(timeout);
          resolve(t);
        })
        .catch((err) => {
          clearTimeout(timeout);
          reject(err);
        });
    });

    // Validate tier range (fail-closed on invalid values)
    const truncated = Math.trunc(tier);
    const validTier = Number.isFinite(truncated)
      ? Math.max(1, Math.min(9, truncated))
      : 1;

    if (!Number.isFinite(truncated)) {
      logger.warn(
        { tier, communityId, userId },
        'AgentAuth: conviction scorer returned invalid tier — fail-closed to tier 1',
      );
    }

    setCachedTier(communityId, userId, validTier);
    return validTier;
  } catch (err) {
    // Fail-closed to lowest tier (most restrictive access).
    // Cache tier 1 with short TTL to prevent retry storms when service is degraded.
    // Without this cache, every request retries the 5s timeout → cascading delays.
    logger.warn(
      { err, communityId, userId },
      'AgentAuth: conviction scoring unavailable — fail-closed to tier 1 (cached 10s)',
    );
    setCachedTier(communityId, userId, 1, CONVICTION_ERROR_CACHE_TTL_MS);
    return 1;
  }
}

// --------------------------------------------------------------------------
// Type Augmentation
// --------------------------------------------------------------------------

/** Express Request with attached AgentRequestContext */
export interface AgentAuthenticatedRequest extends Request {
  agentContext: AgentRequestContext;
}
