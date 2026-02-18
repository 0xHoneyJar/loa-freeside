/**
 * Public Routes Module
 * Sprint 51: Route modularization - Public endpoints
 * Sprint 175: Updated to use PostgreSQL for eligibility queries
 */

import { Router } from 'express';
import type { Response, Request } from 'express';
import {
  publicRateLimiter,
  ValidationError,
} from '../middleware.js';
import { CONTRACT_VERSION, negotiateVersion } from '../../packages/core/protocol/arrakis-compat.js';
import {
  // SQLite queries (fallback)
  getCurrentEligibility,
  getEligibilityByAddress,
  getHealthStatus,
  // PostgreSQL queries (Sprint 175 - persistent eligibility)
  isEligibilityPgDbInitialized,
  getCurrentEligibilityPg,
  getEligibilityByAddressPg,
  getHealthStatusPg,
} from '../../db/index.js';
import type { EligibilityResponse, HealthResponse } from '../../types/index.js';
import { getPrometheusMetrics } from '../../utils/metrics.js';

/**
 * Public routes (rate limited, no auth required)
 */
export const publicRouter = Router();

// Apply public rate limiting
publicRouter.use(publicRateLimiter);

/**
 * GET /eligibility
 * Returns top 69 eligible wallets
 * Sprint 175: Uses PostgreSQL for persistent data (falls back to SQLite)
 */
publicRouter.get('/eligibility', async (_req: Request, res: Response) => {
  // Sprint 175: Use PostgreSQL if initialized, otherwise fallback to SQLite
  let eligibility;
  let health;

  if (isEligibilityPgDbInitialized()) {
    eligibility = await getCurrentEligibilityPg();
    health = await getHealthStatusPg();
  } else {
    eligibility = getCurrentEligibility();
    health = getHealthStatus();
  }

  const top69 = eligibility
    .filter((e) => e.rank !== undefined && e.rank <= 69)
    .map((e) => ({
      rank: e.rank!,
      address: e.address,
      bgt_held: Number(e.bgtHeld) / 1e18, // Convert from wei to BGT
    }));

  const top7 = eligibility
    .filter((e) => e.role === 'naib')
    .map((e) => e.address);

  // Handle different property names between SQLite (lastSuccessfulQuery) and PostgreSQL (lastSuccess)
  const lastSuccessTime = 'lastSuccess' in health
    ? health.lastSuccess
    : (health as any).lastSuccessfulQuery;

  const response: EligibilityResponse = {
    updated_at: lastSuccessTime?.toISOString() ?? new Date().toISOString(),
    grace_period: health.inGracePeriod,
    top_69: top69,
    top_7: top7,
  };

  // Set cache headers (5 minutes)
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json(response);
});

/**
 * GET /eligibility/:address
 * Check eligibility for a specific address
 * Sprint 175: Uses PostgreSQL for persistent data (falls back to SQLite)
 */
publicRouter.get('/eligibility/:address', async (req: Request, res: Response) => {
  const address = req.params.address;

  if (!address) {
    throw new ValidationError('Address parameter is required');
  }

  // Validate address format
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new ValidationError('Invalid Ethereum address format');
  }

  // Sprint 175: Use PostgreSQL if initialized, otherwise fallback to SQLite
  let entry;
  if (isEligibilityPgDbInitialized()) {
    entry = await getEligibilityByAddressPg(address);
  } else {
    entry = getEligibilityByAddress(address);
  }

  if (!entry) {
    res.json({
      address: address.toLowerCase(),
      eligible: false,
      rank: null,
      role: 'none',
      bgt_held: null,
    });
    return;
  }

  res.json({
    address: entry.address,
    eligible: entry.rank !== undefined && entry.rank <= 69,
    rank: entry.rank ?? null,
    role: entry.role,
    bgt_held: Number(entry.bgtHeld) / 1e18,
  });
});

/**
 * GET /health
 * Returns service health status
 * Sprint 175: Uses PostgreSQL for persistent data (falls back to SQLite)
 */
publicRouter.get('/health', async (_req: Request, res: Response) => {
  // Sprint 175: Use PostgreSQL if initialized, otherwise fallback to SQLite
  let health;
  if (isEligibilityPgDbInitialized()) {
    health = await getHealthStatusPg();
  } else {
    health = getHealthStatus();
  }

  // Handle different property names between SQLite (lastSuccessfulQuery) and PostgreSQL (lastSuccess)
  const lastSuccessTime = 'lastSuccess' in health
    ? health.lastSuccess
    : (health as any).lastSuccessfulQuery;

  // Calculate next scheduled query (every 6 hours)
  const lastQuery = lastSuccessTime ?? new Date();
  const nextQuery = new Date(lastQuery.getTime() + 6 * 60 * 60 * 1000);

  const response: HealthResponse & { protocol_version?: string } = {
    status: health.inGracePeriod ? 'degraded' : 'healthy',
    last_successful_query: lastSuccessTime?.toISOString() ?? null,
    next_query: nextQuery.toISOString(),
    grace_period: health.inGracePeriod,
    protocol_version: CONTRACT_VERSION,
  };

  // Use 200 even for degraded - it's still functioning
  res.json(response);
});

/**
 * GET /api/v1/compat
 * Returns protocol version negotiation info for coordination schema.
 * Sprint 302, Task 302.4: Coordination schema migration + version negotiation
 */
publicRouter.get('/api/v1/compat', (_req: Request, res: Response) => {
  const negotiation = negotiateVersion();
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.json({
    preferred: negotiation.preferred,
    supported: [...negotiation.supported],
    contract_version: CONTRACT_VERSION,
  });
});

/**
 * GET /metrics
 * Prometheus metrics endpoint
 */
publicRouter.get('/metrics', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.send(getPrometheusMetrics());
});

/**
 * GET /stats/community
 * Get public community statistics (aggregated)
 */
publicRouter.get('/stats/community', (_req: Request, res: Response) => {
  // Import statsService dynamically to avoid circular deps
  const { statsService } = require('../../services/StatsService.js');
  const stats = statsService.getCommunityStats();

  // Set cache headers (5 minutes)
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json(stats);
});
