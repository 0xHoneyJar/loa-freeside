/**
 * Notification Service Integration Tests
 *
 * Tests for the notification and alert system:
 * - Notification preferences
 * - Alert rate limiting
 * - Alert sending
 * - Weekly counter reset
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { notificationService } from '../../src/services/notification.js';
import * as queries from '../../src/db/index.js';

// Mock the database queries
vi.mock('../../src/db/index.js', () => {
  return {
    getNotificationPreferences: vi.fn(),
    upsertNotificationPreferences: vi.fn(),
    incrementAlertCounter: vi.fn(),
    resetWeeklyAlertCounters: vi.fn(),
    getMembersForPositionAlerts: vi.fn(),
    getMembersForAtRiskAlerts: vi.fn(),
    getNotificationPreferencesStats: vi.fn(),
    insertAlertRecord: vi.fn(),
    updateAlertDeliveryStatus: vi.fn(),
    getAlertHistory: vi.fn(),
    countAlertsThisWeek: vi.fn(),
    getAlertStats: vi.fn(),
    getMemberProfileById: vi.fn(),
    getWalletByDiscordId: vi.fn(),
    getWalletPosition: vi.fn(),
    logAuditEvent: vi.fn(),
  };
});

describe('NotificationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getPreferences', () => {
    it('should return existing preferences', () => {
      const mockPrefs = {
        memberId: 'member_1',
        positionUpdates: true,
        atRiskWarnings: true,
        naibAlerts: true,
        frequency: '2_per_week' as const,
        alertsSentThisWeek: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      vi.mocked(queries.getNotificationPreferences).mockReturnValue(mockPrefs);

      const result = notificationService.getPreferences('member_1');

      expect(result).toEqual(mockPrefs);
    });

    it('should create default preferences if none exist', () => {
      const defaultPrefs = {
        memberId: 'member_1',
        positionUpdates: true,
        atRiskWarnings: true,
        naibAlerts: true,
        frequency: '2_per_week' as const,
        alertsSentThisWeek: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      vi.mocked(queries.getNotificationPreferences).mockReturnValue(null);
      vi.mocked(queries.upsertNotificationPreferences).mockReturnValue(defaultPrefs);

      const result = notificationService.getPreferences('member_1');

      expect(result).toEqual(defaultPrefs);
      expect(queries.upsertNotificationPreferences).toHaveBeenCalledWith('member_1', {});
    });
  });

  describe('updatePreferences', () => {
    it('should update preferences', () => {
      const updatedPrefs = {
        memberId: 'member_1',
        positionUpdates: false,
        atRiskWarnings: true,
        naibAlerts: true,
        frequency: 'daily' as const,
        alertsSentThisWeek: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      vi.mocked(queries.upsertNotificationPreferences).mockReturnValue(updatedPrefs);

      const result = notificationService.updatePreferences('member_1', {
        positionUpdates: false,
        frequency: 'daily',
      });

      expect(result.positionUpdates).toBe(false);
      expect(result.frequency).toBe('daily');
    });
  });

  describe('canSendAlert', () => {
    it('should allow alert when preferences enabled and under limit', () => {
      const mockPrefs = {
        memberId: 'member_1',
        positionUpdates: true,
        atRiskWarnings: true,
        naibAlerts: true,
        frequency: '2_per_week' as const,
        alertsSentThisWeek: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      vi.mocked(queries.getNotificationPreferences).mockReturnValue(mockPrefs);

      const result = notificationService.canSendAlert('member_1', 'position_update');

      expect(result.canSend).toBe(true);
      expect(result.alertsSentThisWeek).toBe(1);
      expect(result.maxAlertsPerWeek).toBe(2);
    });

    it('should block alert when position updates disabled', () => {
      const mockPrefs = {
        memberId: 'member_1',
        positionUpdates: false,
        atRiskWarnings: true,
        naibAlerts: true,
        frequency: '2_per_week' as const,
        alertsSentThisWeek: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      vi.mocked(queries.getNotificationPreferences).mockReturnValue(mockPrefs);

      const result = notificationService.canSendAlert('member_1', 'position_update');

      expect(result.canSend).toBe(false);
      expect(result.reason).toBe('Position updates disabled');
    });

    it('should block alert when at-risk warnings disabled', () => {
      const mockPrefs = {
        memberId: 'member_1',
        positionUpdates: true,
        atRiskWarnings: false,
        naibAlerts: true,
        frequency: '2_per_week' as const,
        alertsSentThisWeek: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      vi.mocked(queries.getNotificationPreferences).mockReturnValue(mockPrefs);

      const result = notificationService.canSendAlert('member_1', 'at_risk_warning');

      expect(result.canSend).toBe(false);
      expect(result.reason).toBe('At-risk warnings disabled');
    });

    it('should block alert when Naib alerts disabled', () => {
      const mockPrefs = {
        memberId: 'member_1',
        positionUpdates: true,
        atRiskWarnings: true,
        naibAlerts: false,
        frequency: '2_per_week' as const,
        alertsSentThisWeek: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      vi.mocked(queries.getNotificationPreferences).mockReturnValue(mockPrefs);

      const result = notificationService.canSendAlert('member_1', 'naib_threat');

      expect(result.canSend).toBe(false);
      expect(result.reason).toBe('Naib alerts disabled');
    });

    it('should block alert when weekly limit reached', () => {
      const mockPrefs = {
        memberId: 'member_1',
        positionUpdates: true,
        atRiskWarnings: true,
        naibAlerts: true,
        frequency: '2_per_week' as const,
        alertsSentThisWeek: 2, // Already at limit
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      vi.mocked(queries.getNotificationPreferences).mockReturnValue(mockPrefs);

      const result = notificationService.canSendAlert('member_1', 'position_update');

      expect(result.canSend).toBe(false);
      expect(result.reason).toContain('Weekly limit reached');
    });

    it('should allow critical alerts even at limit (naib_bump)', () => {
      const mockPrefs = {
        memberId: 'member_1',
        positionUpdates: true,
        atRiskWarnings: true,
        naibAlerts: true,
        frequency: '1_per_week' as const,
        alertsSentThisWeek: 5, // Over limit
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      vi.mocked(queries.getNotificationPreferences).mockReturnValue(mockPrefs);

      const result = notificationService.canSendAlert('member_1', 'naib_bump');

      expect(result.canSend).toBe(true); // Critical alert bypasses limit
    });

    it('should allow critical alerts even at limit (naib_seated)', () => {
      const mockPrefs = {
        memberId: 'member_1',
        positionUpdates: true,
        atRiskWarnings: true,
        naibAlerts: true,
        frequency: '1_per_week' as const,
        alertsSentThisWeek: 5,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      vi.mocked(queries.getNotificationPreferences).mockReturnValue(mockPrefs);

      const result = notificationService.canSendAlert('member_1', 'naib_seated');

      expect(result.canSend).toBe(true);
    });

    it('should allow waitlist_eligible alerts regardless of limits', () => {
      const mockPrefs = {
        memberId: 'member_1',
        positionUpdates: false,
        atRiskWarnings: false,
        naibAlerts: false,
        frequency: '1_per_week' as const,
        alertsSentThisWeek: 10,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      vi.mocked(queries.getNotificationPreferences).mockReturnValue(mockPrefs);

      const result = notificationService.canSendAlert('member_1', 'waitlist_eligible');

      expect(result.canSend).toBe(true);
    });
  });

  describe('resetWeeklyCounters', () => {
    it('should reset all weekly counters', () => {
      vi.mocked(queries.resetWeeklyAlertCounters).mockReturnValue(50);

      const result = notificationService.resetWeeklyCounters();

      expect(result).toBe(50);
      expect(queries.resetWeeklyAlertCounters).toHaveBeenCalled();
    });
  });

  describe('getHistory', () => {
    it('should return alert history for member', () => {
      const mockHistory = [
        { id: 1, recipientId: 'member_1', recipientType: 'member', alertType: 'position_update', alertData: {}, delivered: true, deliveryError: null, createdAt: new Date() },
        { id: 2, recipientId: 'member_1', recipientType: 'member', alertType: 'at_risk_warning', alertData: {}, delivered: true, deliveryError: null, createdAt: new Date() },
      ];
      vi.mocked(queries.getAlertHistory).mockReturnValue(mockHistory as any);

      const result = notificationService.getHistory('member_1');

      expect(result.length).toBe(2);
      expect(queries.getAlertHistory).toHaveBeenCalledWith('member_1', undefined);
    });

    it('should filter by alert type', () => {
      vi.mocked(queries.getAlertHistory).mockReturnValue([]);

      notificationService.getHistory('member_1', { alertType: 'position_update' });

      expect(queries.getAlertHistory).toHaveBeenCalledWith('member_1', { alertType: 'position_update' });
    });
  });

  describe('getStats', () => {
    it('should return alert statistics', () => {
      vi.mocked(queries.getAlertStats).mockReturnValue({
        totalSent: 100,
        sentThisWeek: 25,
        byType: { position_update: 50, at_risk_warning: 30, naib_threat: 20 },
        deliveryRate: 0.95,
      });
      vi.mocked(queries.getNotificationPreferencesStats).mockReturnValue({
        total: 50,
        positionUpdatesEnabled: 45,
        atRiskWarningsEnabled: 40,
        naibAlertsEnabled: 30,
      });

      const result = notificationService.getStats();

      expect(result.totalSent).toBe(100);
      expect(result.sentThisWeek).toBe(25);
      expect(result.deliveryRate).toBe(0.95);
      expect(result.prefStats.total).toBe(50);
    });
  });

  describe('isAtRisk', () => {
    it('should return true for positions 63-69', () => {
      expect(notificationService.isAtRisk(63)).toBe(true);
      expect(notificationService.isAtRisk(65)).toBe(true);
      expect(notificationService.isAtRisk(69)).toBe(true);
    });

    it('should return false for positions outside 63-69', () => {
      expect(notificationService.isAtRisk(62)).toBe(false);
      expect(notificationService.isAtRisk(70)).toBe(false);
      expect(notificationService.isAtRisk(1)).toBe(false);
    });
  });

  describe('getMaxAlertsPerWeek', () => {
    it('should return correct limits for each frequency', () => {
      expect(notificationService.getMaxAlertsPerWeek('1_per_week')).toBe(1);
      expect(notificationService.getMaxAlertsPerWeek('2_per_week')).toBe(2);
      expect(notificationService.getMaxAlertsPerWeek('3_per_week')).toBe(3);
      expect(notificationService.getMaxAlertsPerWeek('daily')).toBe(7);
    });
  });

  describe('recordAlertSent', () => {
    it('should record alert and increment counter for member', () => {
      const mockRecord = {
        id: 1,
        recipientId: 'member_1',
        recipientType: 'member' as const,
        alertType: 'position_update' as const,
        alertData: {},
        delivered: true,
        deliveryError: null,
        createdAt: new Date(),
      };
      vi.mocked(queries.insertAlertRecord).mockReturnValue(mockRecord);
      vi.mocked(queries.incrementAlertCounter).mockReturnValue(undefined);

      const result = notificationService.recordAlertSent(
        'member_1',
        'member',
        'position_update',
        { type: 'position_update', position: 50, bgt: 1.5, distanceToAbove: null, distanceToBelow: null, distanceToEntry: null, isNaib: false, isFedaykin: true },
        true
      );

      expect(result).toEqual(mockRecord);
      expect(queries.insertAlertRecord).toHaveBeenCalled();
      expect(queries.incrementAlertCounter).toHaveBeenCalledWith('member_1');
    });

    it('should not increment counter for failed delivery', () => {
      const mockRecord = {
        id: 1,
        recipientId: 'member_1',
        recipientType: 'member' as const,
        alertType: 'position_update' as const,
        alertData: {},
        delivered: false,
        deliveryError: 'DMs disabled',
        createdAt: new Date(),
      };
      vi.mocked(queries.insertAlertRecord).mockReturnValue(mockRecord);

      notificationService.recordAlertSent(
        'member_1',
        'member',
        'position_update',
        { type: 'position_update', position: 50, bgt: 1.5, distanceToAbove: null, distanceToBelow: null, distanceToEntry: null, isNaib: false, isFedaykin: true },
        false,
        'DMs disabled'
      );

      expect(queries.incrementAlertCounter).not.toHaveBeenCalled();
    });

    it('should not increment counter for waitlist recipient', () => {
      const mockRecord = {
        id: 1,
        recipientId: 'discord_1',
        recipientType: 'waitlist' as const,
        alertType: 'waitlist_eligible' as const,
        alertData: {},
        delivered: true,
        deliveryError: null,
        createdAt: new Date(),
      };
      vi.mocked(queries.insertAlertRecord).mockReturnValue(mockRecord);

      notificationService.recordAlertSent(
        'discord_1',
        'waitlist',
        'waitlist_eligible',
        { type: 'waitlist_eligible', previousPosition: 75, currentPosition: 65, bgt: 1.5 },
        true
      );

      expect(queries.incrementAlertCounter).not.toHaveBeenCalled();
    });
  });
});
