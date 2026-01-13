/**
 * Notification Routes Module
 * Sprint 51: Route modularization - Notification preferences and history endpoints
 */

import { Router } from 'express';
import { z } from 'zod';
import type { Response, Request } from 'express';
import {
  memberRateLimiter,
  ValidationError,
  NotFoundError,
} from '../middleware.js';
import { notificationService } from '../../services/notification.js';
import { naibService } from '../../services/naib.js';
import { thresholdService } from '../../services/threshold.js';
import { getMemberProfileByDiscordId, getWalletPosition, getCurrentEligibility as getEligibilityList, getWalletByDiscordId } from '../../db/index.js';
import type {
  NotificationPreferencesResponse,
  NotificationHistoryResponse,
  PositionResponse,
  AlertFrequency,
} from '../../types/index.js';

/**
 * Notification routes (rate limited, requires member auth headers)
 */
export const notificationRouter = Router();

// Apply member rate limiting
notificationRouter.use(memberRateLimiter);

/**
 * GET /api/notifications/preferences
 * Get notification preferences for authenticated member
 * Note: In a real implementation, this would use Discord OAuth
 * For now, requires discordUserId header for testing
 */
notificationRouter.get('/notifications/preferences', (req: Request, res: Response) => {
  const discordUserId = req.headers['x-discord-user-id'] as string;

  if (!discordUserId) {
    throw new ValidationError('Discord user ID required in x-discord-user-id header');
  }

  const member = getMemberProfileByDiscordId(discordUserId);
  if (!member) {
    throw new NotFoundError('Member not found');
  }

  const prefs = notificationService.getPreferences(member.memberId);
  const maxAlerts = notificationService.getMaxAlertsPerWeek(prefs.frequency);

  const response: NotificationPreferencesResponse = {
    position_updates: prefs.positionUpdates,
    at_risk_warnings: prefs.atRiskWarnings,
    naib_alerts: prefs.naibAlerts,
    frequency: prefs.frequency,
    alerts_sent_this_week: prefs.alertsSentThisWeek,
    max_alerts_per_week: maxAlerts,
  };

  res.json(response);
});

/**
 * PUT /api/notifications/preferences
 * Update notification preferences for authenticated member
 */
const updatePreferencesSchema = z.object({
  position_updates: z.boolean().optional(),
  at_risk_warnings: z.boolean().optional(),
  naib_alerts: z.boolean().optional(),
  frequency: z.enum(['1_per_week', '2_per_week', '3_per_week', 'daily']).optional(),
});

notificationRouter.put('/notifications/preferences', (req: Request, res: Response) => {
  const discordUserId = req.headers['x-discord-user-id'] as string;

  if (!discordUserId) {
    throw new ValidationError('Discord user ID required in x-discord-user-id header');
  }

  const member = getMemberProfileByDiscordId(discordUserId);
  if (!member) {
    throw new NotFoundError('Member not found');
  }

  const validation = updatePreferencesSchema.safeParse(req.body);
  if (!validation.success) {
    throw new ValidationError(validation.error.message);
  }

  const updates = validation.data;

  const prefs = notificationService.updatePreferences(member.memberId, {
    positionUpdates: updates.position_updates,
    atRiskWarnings: updates.at_risk_warnings,
    naibAlerts: updates.naib_alerts,
    frequency: updates.frequency as AlertFrequency | undefined,
  });

  const maxAlerts = notificationService.getMaxAlertsPerWeek(prefs.frequency);

  const response: NotificationPreferencesResponse = {
    position_updates: prefs.positionUpdates,
    at_risk_warnings: prefs.atRiskWarnings,
    naib_alerts: prefs.naibAlerts,
    frequency: prefs.frequency,
    alerts_sent_this_week: prefs.alertsSentThisWeek,
    max_alerts_per_week: maxAlerts,
  };

  res.json(response);
});

/**
 * GET /api/notifications/history
 * Get alert history for authenticated member
 */
const historyQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  alert_type: z.string().optional(),
});

notificationRouter.get('/notifications/history', (req: Request, res: Response) => {
  const discordUserId = req.headers['x-discord-user-id'] as string;

  if (!discordUserId) {
    throw new ValidationError('Discord user ID required in x-discord-user-id header');
  }

  const member = getMemberProfileByDiscordId(discordUserId);
  if (!member) {
    throw new NotFoundError('Member not found');
  }

  const validation = historyQuerySchema.safeParse(req.query);
  if (!validation.success) {
    throw new ValidationError(validation.error.message);
  }

  const { limit, alert_type } = validation.data;

  const alerts = notificationService.getHistory(member.memberId, {
    limit,
    alertType: alert_type as any,
  });

  const response: NotificationHistoryResponse = {
    alerts: alerts.map((a) => ({
      id: a.id,
      alert_type: a.alertType,
      delivered: a.delivered,
      sent_at: a.sentAt.toISOString(),
      alert_data: a.alertData,
    })),
    total: alerts.length,
  };

  res.json(response);
});

/**
 * GET /api/position
 * Get own position in eligibility ranking
 */
notificationRouter.get('/position', (req: Request, res: Response) => {
  const discordUserId = req.headers['x-discord-user-id'] as string;

  if (!discordUserId) {
    throw new ValidationError('Discord user ID required in x-discord-user-id header');
  }

  const member = getMemberProfileByDiscordId(discordUserId);
  if (!member) {
    throw new NotFoundError('Member not found');
  }

  const walletAddress = getWalletByDiscordId(discordUserId);
  if (!walletAddress) {
    throw new ValidationError('Member has no wallet address linked');
  }

  const walletPos = getWalletPosition(walletAddress);
  if (!walletPos) {
    throw new NotFoundError('Wallet not found in eligibility rankings');
  }

  const position = walletPos.position;
  const bgt = Number(BigInt(walletPos.bgt)) / 1e18;

  // Calculate distances
  const eligibility = getEligibilityList();
  let distanceToAbove: number | null = null;
  let distanceToBelow: number | null = null;

  const currentIndex = eligibility.findIndex((e) => e.rank === position);
  if (currentIndex > 0) {
    const above = eligibility[currentIndex - 1];
    if (above) {
      const aboveBgt = Number(BigInt(above.bgtHeld)) / 1e18;
      distanceToAbove = aboveBgt - bgt;
    }
  }
  if (currentIndex < eligibility.length - 1 && currentIndex >= 0) {
    const below = eligibility[currentIndex + 1];
    if (below) {
      const belowBgt = Number(BigInt(below.bgtHeld)) / 1e18;
      distanceToBelow = bgt - belowBgt;
    }
  }

  // Distance to entry
  let distanceToEntry: number | null = null;
  const entryThreshold = thresholdService.getEntryThreshold();
  if (position > 69 && entryThreshold) {
    distanceToEntry = entryThreshold.human - bgt;
  }

  const isNaib = naibService.isCurrentNaib(member.memberId);
  const isFedaykin = position <= 69;
  const isAtRisk = notificationService.isAtRisk(position);

  const response: PositionResponse = {
    position,
    bgt,
    distance_to_above: distanceToAbove,
    distance_to_below: distanceToBelow,
    distance_to_entry: distanceToEntry,
    is_naib: isNaib,
    is_fedaykin: isFedaykin,
    is_at_risk: isAtRisk,
  };

  res.json(response);
});
