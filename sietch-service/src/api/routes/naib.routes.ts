/**
 * Naib Routes Module
 * Sprint 51: Route modularization - Naib council endpoints
 */

import { Router } from 'express';
import type { Response, Request } from 'express';
import {
  memberRateLimiter,
  ValidationError,
} from '../middleware.js';
import { naibService } from '../../services/naib.js';

/**
 * Naib routes (rate limited, no auth required for public data)
 */
export const naibRouter = Router();

// Apply member rate limiting
naibRouter.use(memberRateLimiter);

/**
 * GET /api/naib
 * Get current Naib council and former members
 */
naibRouter.get('/naib', (_req: Request, res: Response) => {
  const current = naibService.getPublicCurrentNaib();
  const former = naibService.getFormerNaib();
  const emptySeats = naibService.getAvailableSeatCount();

  res.json({
    current: current.map(m => ({
      seat_number: m.seatNumber,
      nym: m.nym,
      member_id: m.memberId,
      pfp_url: m.pfpUrl,
      seated_at: m.seatedAt instanceof Date
        ? m.seatedAt.toISOString()
        : m.seatedAt,
      is_founding: m.isFounding,
      rank: m.rank,
    })),
    former: former.map(m => ({
      nym: m.nym,
      member_id: m.memberId,
      pfp_url: m.pfpUrl,
      first_seated_at: m.firstSeatedAt instanceof Date
        ? m.firstSeatedAt.toISOString()
        : m.firstSeatedAt,
      last_unseated_at: m.lastUnseatedAt instanceof Date
        ? m.lastUnseatedAt.toISOString()
        : m.lastUnseatedAt,
      total_tenure_days: Math.floor(m.totalTenureMs / (1000 * 60 * 60 * 24)),
      seat_count: m.seatCount,
    })),
    empty_seats: emptySeats,
    updated_at: new Date().toISOString(),
  });
});

/**
 * GET /api/naib/current
 * Get current Naib council members only
 */
naibRouter.get('/naib/current', (_req: Request, res: Response) => {
  const current = naibService.getPublicCurrentNaib();
  const emptySeats = naibService.getAvailableSeatCount();

  res.json({
    members: current.map(m => ({
      seat_number: m.seatNumber,
      nym: m.nym,
      member_id: m.memberId,
      pfp_url: m.pfpUrl,
      seated_at: m.seatedAt instanceof Date
        ? m.seatedAt.toISOString()
        : m.seatedAt,
      is_founding: m.isFounding,
      rank: m.rank,
    })),
    filled_seats: current.length,
    empty_seats: emptySeats,
    total_seats: 7,
  });
});

/**
 * GET /api/naib/former
 * Get former Naib members (honor roll)
 */
naibRouter.get('/naib/former', (_req: Request, res: Response) => {
  const former = naibService.getFormerNaib();

  res.json({
    members: former.map(m => ({
      nym: m.nym,
      member_id: m.memberId,
      pfp_url: m.pfpUrl,
      first_seated_at: m.firstSeatedAt instanceof Date
        ? m.firstSeatedAt.toISOString()
        : m.firstSeatedAt,
      last_unseated_at: m.lastUnseatedAt instanceof Date
        ? m.lastUnseatedAt.toISOString()
        : m.lastUnseatedAt,
      total_tenure_days: Math.floor(m.totalTenureMs / (1000 * 60 * 60 * 24)),
      seat_count: m.seatCount,
    })),
    total: former.length,
  });
});

/**
 * GET /api/naib/member/:memberId
 * Check if a specific member is a current or former Naib
 */
naibRouter.get('/naib/member/:memberId', (req: Request, res: Response) => {
  const memberId = req.params.memberId;

  if (!memberId) {
    throw new ValidationError('Member ID is required');
  }

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(memberId)) {
    throw new ValidationError('Invalid member ID format');
  }

  const isCurrentNaib = naibService.isCurrentNaib(memberId);
  const isFormerNaib = naibService.isFormerNaib(memberId);
  const hasEverBeenNaib = naibService.hasEverBeenNaib(memberId);
  const history = naibService.getMemberNaibHistory(memberId);

  res.json({
    member_id: memberId,
    is_current_naib: isCurrentNaib,
    is_former_naib: isFormerNaib,
    has_ever_been_naib: hasEverBeenNaib,
    seat_history: history.map(seat => ({
      seat_number: seat.seatNumber,
      seated_at: seat.seatedAt.toISOString(),
      unseated_at: seat.unseatedAt?.toISOString() ?? null,
      unseat_reason: seat.unseatReason,
      bgt_at_seating: seat.bgtAtSeating,
      bgt_at_unseating: seat.bgtAtUnseating,
    })),
  });
});
