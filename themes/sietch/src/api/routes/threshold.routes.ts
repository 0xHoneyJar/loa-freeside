/**
 * Threshold Routes Module
 * Sprint 51: Route modularization - Threshold and waitlist endpoints
 */

import { Router } from 'express';
import { z } from 'zod';
import type { Response, Request } from 'express';
import {
  memberRateLimiter,
  ValidationError,
} from '../middleware.js';
import { thresholdService } from '../../services/threshold.js';
import type {
  ThresholdResponse,
  ThresholdHistoryResponse,
  WaitlistStatusResponse,
} from '../../types/index.js';

/**
 * Threshold routes (rate limited, no auth required)
 */
export const thresholdRouter = Router();

// Apply member rate limiting
thresholdRouter.use(memberRateLimiter);

/**
 * GET /api/threshold
 * Get current entry threshold data
 */
thresholdRouter.get('/threshold', (_req: Request, res: Response) => {
  const data = thresholdService.getThresholdData();
  const topWaitlist = thresholdService.getTopWaitlistPositions(5);

  const response: ThresholdResponse = {
    entry_threshold: data.entryThreshold,
    eligible_count: data.eligibleCount,
    waitlist_count: data.waitlistCount,
    gap_to_entry: data.gapToEntry,
    top_waitlist: topWaitlist.map(p => ({
      position: p.position,
      address_display: p.addressDisplay,
      bgt: p.bgt,
      distance_to_entry: p.distanceToEntry,
      is_registered: p.isRegistered,
    })),
    updated_at: data.updatedAt.toISOString(),
  };

  // Set cache headers (1 minute - threshold data changes frequently)
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json(response);
});

/**
 * Zod schema for threshold history query
 */
const thresholdHistorySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(24),
  since: z.string().datetime().optional(),
});

/**
 * GET /api/threshold/history
 * Get threshold snapshot history
 */
thresholdRouter.get('/threshold/history', (req: Request, res: Response) => {
  const result = thresholdHistorySchema.safeParse(req.query);

  if (!result.success) {
    const errors = result.error.issues.map(i => i.message).join(', ');
    throw new ValidationError(errors);
  }

  const { limit, since } = result.data;
  const sinceDate = since ? new Date(since) : undefined;

  const snapshots = thresholdService.getSnapshotHistory(limit, sinceDate);

  const response: ThresholdHistoryResponse = {
    snapshots: snapshots.map(s => ({
      id: s.id,
      entry_threshold: Number(BigInt(s.entryThresholdBgt)) / 1e18,
      eligible_count: s.eligibleCount,
      waitlist_count: s.waitlistCount,
      created_at: s.snapshotAt.toISOString(),
    })),
    count: snapshots.length,
  };

  res.json(response);
});

/**
 * GET /api/waitlist/status/:address
 * Check waitlist registration status for an address
 */
thresholdRouter.get('/waitlist/status/:address', (req: Request, res: Response) => {
  const address = req.params.address;

  if (!address) {
    throw new ValidationError('Address parameter is required');
  }

  // Validate address format
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new ValidationError('Invalid Ethereum address format');
  }

  const normalizedAddress = address.toLowerCase();

  // Check if wallet is in the waitlist range (70-100)
  const position = thresholdService.getWalletPosition(normalizedAddress);

  // Get registration if any (by wallet)
  const registrations = thresholdService.getActiveRegistrations();
  const registration = registrations.find(
    r => r.walletAddress.toLowerCase() === normalizedAddress
  );

  const response: WaitlistStatusResponse = {
    address: normalizedAddress,
    is_in_waitlist_range: position !== null,
    position: position?.position ?? null,
    bgt: position?.bgt ?? null,
    distance_to_entry: position?.distanceToEntry ?? null,
    is_registered: registration !== undefined,
    registered_at: registration?.registeredAt?.toISOString() ?? null,
  };

  res.json(response);
});
