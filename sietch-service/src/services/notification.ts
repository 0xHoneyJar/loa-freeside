/**
 * Notification Service
 *
 * Manages alerts and notification preferences for Sietch v2.1.
 *
 * Key Features:
 * - Position updates: Regular distance notifications
 * - At-risk warnings: Bottom 10% alerts
 * - Naib alerts: Seat threat notifications
 * - Rate limiting: Respects user frequency preferences
 * - Audit trail: All alerts logged to database
 *
 * Alert Types:
 * - position_update: Regular position distance info
 * - at_risk_warning: Bottom 10% warning (positions 63-69)
 * - naib_threat: Someone challenging your Naib seat
 * - naib_bump: You were bumped from Naib
 * - naib_seated: Congratulations, you're now Naib
 * - waitlist_eligible: Waitlist member became eligible
 */

import { Client, User } from 'discord.js';
import { logger } from '../utils/logger.js';
import {
  getNotificationPreferences,
  upsertNotificationPreferences,
  incrementAlertCounter,
  resetWeeklyAlertCounters,
  getMembersForPositionAlerts,
  getMembersForAtRiskAlerts,
  getNotificationPreferencesStats,
  insertAlertRecord,
  updateAlertDeliveryStatus,
  getAlertHistory,
  countAlertsThisWeek,
  getAlertStats,
  getMemberProfileById,
  getWalletByDiscordId,
  getWalletPosition,
  logAuditEvent,
} from '../db/queries.js';
import type {
  NotificationPreferences,
  AlertFrequency,
  AlertType,
  AlertData,
  AlertRecord,
  CanSendAlertResult,
  SendAlertResult,
  PositionUpdateAlertData,
  AtRiskWarningAlertData,
  NaibThreatAlertData,
  NaibBumpAlertData,
  NaibSeatedAlertData,
  WaitlistEligibleAlertData,
  TierPromotionAlertData,
  BadgeAwardAlertData,
} from '../types/index.js';

/**
 * Constants for notification rate limiting
 */
const MAX_ALERTS_PER_FREQUENCY: Record<AlertFrequency, number> = {
  '1_per_week': 1,
  '2_per_week': 2,
  '3_per_week': 3,
  'daily': 7, // Effectively no weekly limit
};

/**
 * At-risk threshold: bottom 10% of eligible members (positions 63-69)
 */
const AT_RISK_THRESHOLD_POSITION = 63;
const ENTRY_THRESHOLD_POSITION = 69;

/**
 * Notification Service class
 */
class NotificationService {
  private discordClient: Client | null = null;

  /**
   * Set the Discord client for sending DMs
   */
  setDiscordClient(client: Client): void {
    this.discordClient = client;
  }

  /**
   * Get or create notification preferences for a member
   * Creates default preferences if none exist
   */
  getPreferences(memberId: string): NotificationPreferences {
    const existing = getNotificationPreferences(memberId);
    if (existing) return existing;

    // Create default preferences
    return upsertNotificationPreferences(memberId, {});
  }

  /**
   * Update notification preferences for a member
   */
  updatePreferences(
    memberId: string,
    updates: {
      positionUpdates?: boolean;
      atRiskWarnings?: boolean;
      naibAlerts?: boolean;
      frequency?: AlertFrequency;
    }
  ): NotificationPreferences {
    const result = upsertNotificationPreferences(memberId, updates);

    logger.info(
      { memberId, updates },
      'Updated notification preferences'
    );

    return result;
  }

  /**
   * Check if an alert can be sent based on preferences and rate limits
   */
  canSendAlert(
    memberId: string,
    alertType: AlertType
  ): CanSendAlertResult {
    const prefs = this.getPreferences(memberId);
    const maxAlerts = MAX_ALERTS_PER_FREQUENCY[prefs.frequency];

    // Check if alert type is enabled
    switch (alertType) {
      case 'position_update':
        if (!prefs.positionUpdates) {
          return {
            canSend: false,
            reason: 'Position updates disabled',
            alertsSentThisWeek: prefs.alertsSentThisWeek,
            maxAlertsPerWeek: maxAlerts,
          };
        }
        break;
      case 'at_risk_warning':
        if (!prefs.atRiskWarnings) {
          return {
            canSend: false,
            reason: 'At-risk warnings disabled',
            alertsSentThisWeek: prefs.alertsSentThisWeek,
            maxAlertsPerWeek: maxAlerts,
          };
        }
        break;
      case 'naib_threat':
      case 'naib_bump':
      case 'naib_seated':
        if (!prefs.naibAlerts) {
          return {
            canSend: false,
            reason: 'Naib alerts disabled',
            alertsSentThisWeek: prefs.alertsSentThisWeek,
            maxAlertsPerWeek: maxAlerts,
          };
        }
        break;
      case 'waitlist_eligible':
        // Waitlist alerts are always sent (one-time critical notification)
        break;
      case 'tier_promotion':
        // Tier promotions are critical one-time milestone notifications that always send.
        // Unlike regular position_updates, promotions represent significant achievements
        // that members should be informed about regardless of frequency settings.
        // This aligns with the pattern used for waitlist_eligible and naib_seated alerts.
        break;
      case 'badge_award':
        // Badge awards are always sent (one-time notification)
        break;
    }

    // Check rate limit (except for critical alerts)
    const criticalAlerts: AlertType[] = ['naib_bump', 'naib_seated', 'waitlist_eligible', 'tier_promotion', 'badge_award'];
    if (!criticalAlerts.includes(alertType)) {
      if (prefs.alertsSentThisWeek >= maxAlerts) {
        return {
          canSend: false,
          reason: `Weekly limit reached (${prefs.alertsSentThisWeek}/${maxAlerts})`,
          alertsSentThisWeek: prefs.alertsSentThisWeek,
          maxAlertsPerWeek: maxAlerts,
        };
      }
    }

    return {
      canSend: true,
      reason: null,
      alertsSentThisWeek: prefs.alertsSentThisWeek,
      maxAlertsPerWeek: maxAlerts,
    };
  }

  /**
   * Send a position update alert
   */
  async sendPositionUpdate(
    memberId: string,
    data: Omit<PositionUpdateAlertData, 'type'>
  ): Promise<SendAlertResult> {
    const alertData: PositionUpdateAlertData = { type: 'position_update', ...data };
    return this.sendAlert(memberId, 'member', 'position_update', alertData);
  }

  /**
   * Send an at-risk warning alert
   */
  async sendAtRiskWarning(
    memberId: string,
    data: Omit<AtRiskWarningAlertData, 'type'>
  ): Promise<SendAlertResult> {
    const alertData: AtRiskWarningAlertData = { type: 'at_risk_warning', ...data };
    return this.sendAlert(memberId, 'member', 'at_risk_warning', alertData);
  }

  /**
   * Send a Naib threat alert
   */
  async sendNaibThreat(
    memberId: string,
    data: Omit<NaibThreatAlertData, 'type'>
  ): Promise<SendAlertResult> {
    const alertData: NaibThreatAlertData = { type: 'naib_threat', ...data };
    return this.sendAlert(memberId, 'member', 'naib_threat', alertData);
  }

  /**
   * Send a bump notification (you were bumped from Naib)
   */
  async sendBumpNotification(
    memberId: string,
    data: Omit<NaibBumpAlertData, 'type'>
  ): Promise<SendAlertResult> {
    const alertData: NaibBumpAlertData = { type: 'naib_bump', ...data };
    return this.sendAlert(memberId, 'member', 'naib_bump', alertData);
  }

  /**
   * Send a Naib seated notification
   */
  async sendNaibSeated(
    memberId: string,
    data: Omit<NaibSeatedAlertData, 'type'>
  ): Promise<SendAlertResult> {
    const alertData: NaibSeatedAlertData = { type: 'naib_seated', ...data };
    return this.sendAlert(memberId, 'member', 'naib_seated', alertData);
  }

  /**
   * Send waitlist eligible notification
   */
  async sendWaitlistEligible(
    discordUserId: string,
    data: Omit<WaitlistEligibleAlertData, 'type'>
  ): Promise<SendAlertResult> {
    const alertData: WaitlistEligibleAlertData = { type: 'waitlist_eligible', ...data };
    return this.sendAlert(discordUserId, 'waitlist', 'waitlist_eligible', alertData);
  }

  /**
   * Send tier promotion notification (v3.0 - Sprint 18)
   * Called when a member is promoted to a higher tier
   */
  async sendTierPromotion(
    memberId: string,
    data: Omit<TierPromotionAlertData, 'type'>
  ): Promise<SendAlertResult> {
    const alertData: TierPromotionAlertData = { type: 'tier_promotion', ...data };
    return this.sendAlert(memberId, 'member', 'tier_promotion', alertData);
  }

  /**
   * Send badge award notification (v3.0 - Sprint 18)
   * Called when admin awards a badge to a member
   */
  async sendBadgeAward(
    memberId: string,
    data: Omit<BadgeAwardAlertData, 'type'>
  ): Promise<SendAlertResult> {
    const alertData: BadgeAwardAlertData = { type: 'badge_award', ...data };
    return this.sendAlert(memberId, 'member', 'badge_award', alertData);
  }

  /**
   * Core alert sending method
   */
  private async sendAlert(
    recipientId: string,
    recipientType: 'member' | 'waitlist',
    alertType: AlertType,
    alertData: AlertData
  ): Promise<SendAlertResult> {
    // Check if can send (for members)
    if (recipientType === 'member') {
      const canSend = this.canSendAlert(recipientId, alertType);
      if (!canSend.canSend) {
        logger.debug(
          { recipientId, alertType, reason: canSend.reason },
          'Alert blocked by preferences/rate limit'
        );
        return {
          success: false,
          alertId: null,
          error: canSend.reason,
        };
      }
    }

    // Create alert record (initially not delivered)
    const alertRecord = insertAlertRecord({
      recipientId,
      recipientType,
      alertType,
      alertData,
      delivered: false,
    });

    // Try to send Discord DM
    try {
      const discordUserId = await this.getDiscordUserId(recipientId, recipientType);
      if (!discordUserId) {
        throw new Error('Could not resolve Discord user ID');
      }

      await this.sendDiscordDM(discordUserId, alertType, alertData);

      // Update as delivered
      updateAlertDeliveryStatus(alertRecord.id, true);

      // Increment counter for members
      if (recipientType === 'member') {
        incrementAlertCounter(recipientId);
      }

      logger.info(
        { recipientId, recipientType, alertType, alertId: alertRecord.id },
        'Alert sent successfully'
      );

      // Log audit event
      logAuditEvent('alert_sent', {
        actorId: 'system',
        targetId: recipientId,
        alertType,
        alertId: alertRecord.id,
      });

      return {
        success: true,
        alertId: alertRecord.id,
        error: null,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Update as failed
      updateAlertDeliveryStatus(alertRecord.id, false, errorMessage);

      logger.warn(
        { recipientId, recipientType, alertType, error: errorMessage },
        'Failed to send alert'
      );

      return {
        success: false,
        alertId: alertRecord.id,
        error: errorMessage,
      };
    }
  }

  /**
   * Get Discord user ID from recipient
   */
  private async getDiscordUserId(
    recipientId: string,
    recipientType: 'member' | 'waitlist'
  ): Promise<string | null> {
    if (recipientType === 'waitlist') {
      // For waitlist, recipientId IS the Discord user ID
      return recipientId;
    }

    // For members, look up the Discord user ID from the member profile
    const member = getMemberProfileById(recipientId);
    return member?.discordUserId ?? null;
  }

  /**
   * Send Discord DM with alert embed
   * The actual embed building is delegated to the alerts embed builder
   */
  private async sendDiscordDM(
    discordUserId: string,
    alertType: AlertType,
    alertData: AlertData
  ): Promise<void> {
    if (!this.discordClient) {
      throw new Error('Discord client not initialized');
    }

    // Fetch user
    let user: User;
    try {
      user = await this.discordClient.users.fetch(discordUserId);
    } catch {
      throw new Error(`Could not fetch Discord user: ${discordUserId}`);
    }

    // Import embed builder dynamically to avoid circular dependencies
    const { buildAlertEmbed } = await import('../discord/embeds/alerts.js');

    const embed = buildAlertEmbed(alertType, alertData);

    // Send DM
    try {
      await user.send({ embeds: [embed] });
    } catch {
      throw new Error('Could not send DM (user may have DMs disabled)');
    }
  }

  /**
   * Process position alerts for all eligible members
   * Called during sync task
   */
  async processPositionAlerts(): Promise<{
    sent: number;
    skipped: number;
    failed: number;
  }> {
    const eligibleMembers = getMembersForPositionAlerts();
    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const prefs of eligibleMembers) {
      try {
        // Get member's wallet position
        const member = getMemberProfileById(prefs.memberId);
        if (!member) {
          skipped++;
          continue;
        }

        const walletAddress = getWalletByDiscordId(member.discordUserId);
        if (!walletAddress) {
          skipped++;
          continue;
        }

        const position = getWalletPosition(walletAddress);
        if (!position) {
          skipped++;
          continue;
        }

        // Calculate distances (simplified - actual calculation would use threshold service)
        const isNaib = position.position <= 7;
        const isFedaykin = position.position <= ENTRY_THRESHOLD_POSITION;
        const isAtRisk = position.position >= AT_RISK_THRESHOLD_POSITION && position.position <= ENTRY_THRESHOLD_POSITION;

        const result = await this.sendPositionUpdate(prefs.memberId, {
          position: position.position,
          bgt: Number(BigInt(position.bgt)) / 1e18,
          distanceToAbove: null, // Would be calculated from eligibility list
          distanceToBelow: null,
          distanceToEntry: isFedaykin ? null : 0, // Simplified
          isNaib,
          isFedaykin,
        });

        if (result.success) {
          sent++;
        } else if (result.error?.includes('limit') || result.error?.includes('disabled')) {
          skipped++;
        } else {
          failed++;
        }
      } catch (error) {
        logger.error({ memberId: prefs.memberId, error }, 'Error processing position alert');
        failed++;
      }
    }

    logger.info({ sent, skipped, failed }, 'Processed position alerts');
    return { sent, skipped, failed };
  }

  /**
   * Process at-risk warnings for members in bottom 10%
   * Called during sync task
   */
  async processAtRiskAlerts(
    atRiskMembers: Array<{
      memberId: string;
      position: number;
      bgt: number;
      distanceToBelow: number;
    }>
  ): Promise<{ sent: number; skipped: number; failed: number }> {
    const eligibleMembers = getMembersForAtRiskAlerts();
    const eligibleMemberIds = new Set(eligibleMembers.map((m) => m.memberId));

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const member of atRiskMembers) {
      if (!eligibleMemberIds.has(member.memberId)) {
        skipped++;
        continue;
      }

      const result = await this.sendAtRiskWarning(member.memberId, {
        position: member.position,
        bgt: member.bgt,
        distanceToBelow: member.distanceToBelow,
        positionsAtRisk: ENTRY_THRESHOLD_POSITION - member.position + 1,
      });

      if (result.success) {
        sent++;
      } else if (result.error?.includes('disabled')) {
        skipped++;
      } else {
        failed++;
      }
    }

    logger.info({ sent, skipped, failed }, 'Processed at-risk alerts');
    return { sent, skipped, failed };
  }

  /**
   * Record that an alert was sent (for external callers)
   */
  recordAlertSent(
    recipientId: string,
    recipientType: 'member' | 'waitlist',
    alertType: AlertType,
    alertData: AlertData,
    delivered: boolean,
    deliveryError?: string
  ): AlertRecord {
    const record = insertAlertRecord({
      recipientId,
      recipientType,
      alertType,
      alertData,
      delivered,
      deliveryError,
    });

    if (delivered && recipientType === 'member') {
      incrementAlertCounter(recipientId);
    }

    return record;
  }

  /**
   * Reset weekly counters (called by scheduled task)
   */
  resetWeeklyCounters(): number {
    const count = resetWeeklyAlertCounters();
    logger.info({ membersReset: count }, 'Reset weekly alert counters');
    return count;
  }

  /**
   * Get alert history for a member
   */
  getHistory(
    memberId: string,
    options?: { limit?: number; alertType?: AlertType }
  ): AlertRecord[] {
    return getAlertHistory(memberId, options);
  }

  /**
   * Get alert statistics for admin
   */
  getStats(): {
    totalSent: number;
    sentThisWeek: number;
    byType: Record<string, number>;
    deliveryRate: number;
    prefStats: {
      total: number;
      positionUpdatesEnabled: number;
      atRiskWarningsEnabled: number;
      naibAlertsEnabled: number;
    };
  } {
    const alertStats = getAlertStats();
    const prefStats = getNotificationPreferencesStats();

    return {
      ...alertStats,
      prefStats,
    };
  }

  /**
   * Check if member is at risk (positions 63-69)
   */
  isAtRisk(position: number): boolean {
    return position >= AT_RISK_THRESHOLD_POSITION && position <= ENTRY_THRESHOLD_POSITION;
  }

  /**
   * Get max alerts per week for a frequency
   */
  getMaxAlertsPerWeek(frequency: AlertFrequency): number {
    return MAX_ALERTS_PER_FREQUENCY[frequency];
  }
}

// Export singleton instance
export const notificationService = new NotificationService();
