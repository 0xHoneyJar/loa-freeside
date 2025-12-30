/**
 * Public Routes Module
 * Sprint 51: Route modularization - Public endpoints
 */

import { Router } from 'express';
import type { Response, Request } from 'express';
import {
  publicRateLimiter,
  ValidationError,
} from '../middleware.js';
import {
  getCurrentEligibility,
  getEligibilityByAddress,
  getHealthStatus,
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
 */
publicRouter.get('/eligibility', (_req: Request, res: Response) => {
  const eligibility = getCurrentEligibility();
  const health = getHealthStatus();

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

  const response: EligibilityResponse = {
    updated_at: health.lastSuccessfulQuery?.toISOString() ?? new Date().toISOString(),
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
 */
publicRouter.get('/eligibility/:address', (req: Request, res: Response) => {
  const address = req.params.address;

  if (!address) {
    throw new ValidationError('Address parameter is required');
  }

  // Validate address format
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new ValidationError('Invalid Ethereum address format');
  }

  const entry = getEligibilityByAddress(address);

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
 */
publicRouter.get('/health', (_req: Request, res: Response) => {
  const health = getHealthStatus();

  // Calculate next scheduled query (every 6 hours)
  const lastQuery = health.lastSuccessfulQuery ?? new Date();
  const nextQuery = new Date(lastQuery.getTime() + 6 * 60 * 60 * 1000);

  const response: HealthResponse = {
    status: health.inGracePeriod ? 'degraded' : 'healthy',
    last_successful_query: health.lastSuccessfulQuery?.toISOString() ?? null,
    next_query: nextQuery.toISOString(),
    grace_period: health.inGracePeriod,
  };

  // Use 200 even for degraded - it's still functioning
  res.json(response);
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
