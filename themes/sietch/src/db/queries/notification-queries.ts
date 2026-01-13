// =============================================================================
// Notification Preferences Queries (Sprint 13: Notification System)
// =============================================================================

import { getDatabase } from '../connection.js';
import type { NotificationPreferences, AlertFrequency, AlertRecord, AlertType, AlertData } from '../../types/index.js';

/**
 * Database row type for notification_preferences table
 */
interface NotificationPreferencesRow {
  id: number;
  member_id: string;
  position_updates: number;
  at_risk_warnings: number;
  naib_alerts: number;
  frequency: string;
  alerts_sent_this_week: number;
  week_start_timestamp: string;
  created_at: string;
  updated_at: string;
}

/**
 * Convert database row to NotificationPreferences interface
 */
function rowToNotificationPreferences(row: NotificationPreferencesRow): NotificationPreferences {
  return {
    id: row.id,
    memberId: row.member_id,
    positionUpdates: row.position_updates === 1,
    atRiskWarnings: row.at_risk_warnings === 1,
    naibAlerts: row.naib_alerts === 1,
    frequency: row.frequency as AlertFrequency,
    alertsSentThisWeek: row.alerts_sent_this_week,
    weekStartTimestamp: new Date(row.week_start_timestamp),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Get notification preferences for a member
 * Returns null if member has no preferences set
 */
export function getNotificationPreferences(memberId: string): NotificationPreferences | null {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT * FROM notification_preferences
    WHERE member_id = ?
  `).get(memberId) as NotificationPreferencesRow | undefined;

  return row ? rowToNotificationPreferences(row) : null;
}

/**
 * Create or update notification preferences for a member
 * Uses upsert pattern (INSERT OR REPLACE)
 */
export function upsertNotificationPreferences(
  memberId: string,
  prefs: {
    positionUpdates?: boolean;
    atRiskWarnings?: boolean;
    naibAlerts?: boolean;
    frequency?: AlertFrequency;
  }
): NotificationPreferences {
  const database = getDatabase();

  // Get existing preferences to merge with new values
  const existing = getNotificationPreferences(memberId);

  const positionUpdates = prefs.positionUpdates ?? existing?.positionUpdates ?? true;
  const atRiskWarnings = prefs.atRiskWarnings ?? existing?.atRiskWarnings ?? true;
  const naibAlerts = prefs.naibAlerts ?? existing?.naibAlerts ?? true;
  const frequency = prefs.frequency ?? existing?.frequency ?? '3_per_week';
  const alertsSentThisWeek = existing?.alertsSentThisWeek ?? 0;
  const weekStartTimestamp = existing?.weekStartTimestamp?.toISOString() ?? new Date().toISOString();

  if (existing) {
    // Update existing
    database.prepare(`
      UPDATE notification_preferences
      SET position_updates = ?,
          at_risk_warnings = ?,
          naib_alerts = ?,
          frequency = ?,
          updated_at = datetime('now')
      WHERE member_id = ?
    `).run(
      positionUpdates ? 1 : 0,
      atRiskWarnings ? 1 : 0,
      naibAlerts ? 1 : 0,
      frequency,
      memberId
    );
  } else {
    // Insert new
    database.prepare(`
      INSERT INTO notification_preferences (
        member_id,
        position_updates,
        at_risk_warnings,
        naib_alerts,
        frequency,
        alerts_sent_this_week,
        week_start_timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      memberId,
      positionUpdates ? 1 : 0,
      atRiskWarnings ? 1 : 0,
      naibAlerts ? 1 : 0,
      frequency,
      alertsSentThisWeek,
      weekStartTimestamp
    );
  }

  return getNotificationPreferences(memberId)!;
}

/**
 * Increment the alert counter for a member
 */
export function incrementAlertCounter(memberId: string): void {
  const database = getDatabase();

  database.prepare(`
    UPDATE notification_preferences
    SET alerts_sent_this_week = alerts_sent_this_week + 1,
        updated_at = datetime('now')
    WHERE member_id = ?
  `).run(memberId);
}

/**
 * Reset weekly alert counters for all members
 * Should be called at the start of each week
 */
export function resetWeeklyAlertCounters(): number {
  const database = getDatabase();

  const result = database.prepare(`
    UPDATE notification_preferences
    SET alerts_sent_this_week = 0,
        week_start_timestamp = datetime('now'),
        updated_at = datetime('now')
  `).run();

  return result.changes;
}

/**
 * Get all members eligible for position alerts
 * Returns members with position_updates enabled who haven't reached their weekly limit
 */
export function getMembersForPositionAlerts(): NotificationPreferences[] {
  const database = getDatabase();

  const rows = database.prepare(`
    SELECT * FROM notification_preferences
    WHERE position_updates = 1
    AND (
      (frequency = 'daily') OR
      (frequency = '3_per_week' AND alerts_sent_this_week < 3) OR
      (frequency = '2_per_week' AND alerts_sent_this_week < 2) OR
      (frequency = '1_per_week' AND alerts_sent_this_week < 1)
    )
  `).all() as NotificationPreferencesRow[];

  return rows.map(rowToNotificationPreferences);
}

/**
 * Get all members eligible for at-risk warnings
 * Returns members with at_risk_warnings enabled
 */
export function getMembersForAtRiskAlerts(): NotificationPreferences[] {
  const database = getDatabase();

  const rows = database.prepare(`
    SELECT * FROM notification_preferences
    WHERE at_risk_warnings = 1
  `).all() as NotificationPreferencesRow[];

  return rows.map(rowToNotificationPreferences);
}

/**
 * Get notification preferences count by setting
 */
export function getNotificationPreferencesStats(): {
  total: number;
  positionUpdatesEnabled: number;
  atRiskWarningsEnabled: number;
  naibAlertsEnabled: number;
} {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN position_updates = 1 THEN 1 ELSE 0 END) as position_updates_enabled,
      SUM(CASE WHEN at_risk_warnings = 1 THEN 1 ELSE 0 END) as at_risk_warnings_enabled,
      SUM(CASE WHEN naib_alerts = 1 THEN 1 ELSE 0 END) as naib_alerts_enabled
    FROM notification_preferences
  `).get() as {
    total: number;
    position_updates_enabled: number;
    at_risk_warnings_enabled: number;
    naib_alerts_enabled: number;
  };

  return {
    total: row.total,
    positionUpdatesEnabled: row.position_updates_enabled,
    atRiskWarningsEnabled: row.at_risk_warnings_enabled,
    naibAlertsEnabled: row.naib_alerts_enabled,
  };
}

// =============================================================================
// Alert History Queries (Sprint 13: Notification System)
// =============================================================================

/**
 * Database row type for alert_history table
 */
interface AlertHistoryRow {
  id: number;
  recipient_id: string;
  recipient_type: string;
  alert_type: string;
  alert_data: string;
  delivered: number;
  delivery_error: string | null;
  sent_at: string;
}

/**
 * Convert database row to AlertRecord interface
 */
function rowToAlertRecord(row: AlertHistoryRow): AlertRecord {
  return {
    id: row.id,
    recipientId: row.recipient_id,
    recipientType: row.recipient_type as 'member' | 'waitlist',
    alertType: row.alert_type as AlertType,
    alertData: JSON.parse(row.alert_data) as AlertData,
    delivered: row.delivered === 1,
    deliveryError: row.delivery_error,
    sentAt: new Date(row.sent_at),
  };
}

/**
 * Insert a new alert record
 */
export function insertAlertRecord(data: {
  recipientId: string;
  recipientType: 'member' | 'waitlist';
  alertType: AlertType;
  alertData: AlertData;
  delivered: boolean;
  deliveryError?: string;
}): AlertRecord {
  const database = getDatabase();

  const result = database.prepare(`
    INSERT INTO alert_history (
      recipient_id,
      recipient_type,
      alert_type,
      alert_data,
      delivered,
      delivery_error
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    data.recipientId,
    data.recipientType,
    data.alertType,
    JSON.stringify(data.alertData),
    data.delivered ? 1 : 0,
    data.deliveryError ?? null
  );

  const row = database.prepare(`
    SELECT * FROM alert_history WHERE id = ?
  `).get(result.lastInsertRowid) as AlertHistoryRow;

  return rowToAlertRecord(row);
}

/**
 * Update alert delivery status
 */
export function updateAlertDeliveryStatus(
  alertId: number,
  delivered: boolean,
  deliveryError?: string
): void {
  const database = getDatabase();

  database.prepare(`
    UPDATE alert_history
    SET delivered = ?,
        delivery_error = ?
    WHERE id = ?
  `).run(delivered ? 1 : 0, deliveryError ?? null, alertId);
}

/**
 * Get alert history for a recipient
 */
export function getAlertHistory(
  recipientId: string,
  options: {
    limit?: number;
    alertType?: AlertType;
  } = {}
): AlertRecord[] {
  const database = getDatabase();

  const limit = options.limit ?? 50;

  if (options.alertType) {
    const rows = database.prepare(`
      SELECT * FROM alert_history
      WHERE recipient_id = ? AND alert_type = ?
      ORDER BY sent_at DESC
      LIMIT ?
    `).all(recipientId, options.alertType, limit) as AlertHistoryRow[];

    return rows.map(rowToAlertRecord);
  }

  const rows = database.prepare(`
    SELECT * FROM alert_history
    WHERE recipient_id = ?
    ORDER BY sent_at DESC
    LIMIT ?
  `).all(recipientId, limit) as AlertHistoryRow[];

  return rows.map(rowToAlertRecord);
}

/**
 * Count alerts sent to a recipient this week
 */
export function countAlertsThisWeek(recipientId: string): number {
  const database = getDatabase();

  // Get start of current week (Sunday)
  const now = new Date();
  const dayOfWeek = now.getDay();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - dayOfWeek);
  startOfWeek.setHours(0, 0, 0, 0);

  const row = database.prepare(`
    SELECT COUNT(*) as count
    FROM alert_history
    WHERE recipient_id = ? AND sent_at >= ?
  `).get(recipientId, startOfWeek.toISOString()) as { count: number };

  return row.count;
}

/**
 * Get alert statistics
 */
export function getAlertStats(): {
  totalSent: number;
  sentThisWeek: number;
  byType: Record<string, number>;
  deliveryRate: number;
} {
  const database = getDatabase();

  // Total sent
  const totalRow = database.prepare(`
    SELECT COUNT(*) as count FROM alert_history
  `).get() as { count: number };

  // Sent this week
  const now = new Date();
  const dayOfWeek = now.getDay();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - dayOfWeek);
  startOfWeek.setHours(0, 0, 0, 0);

  const weekRow = database.prepare(`
    SELECT COUNT(*) as count
    FROM alert_history
    WHERE sent_at >= ?
  `).get(startOfWeek.toISOString()) as { count: number };

  // By type
  const typeRows = database.prepare(`
    SELECT alert_type, COUNT(*) as count
    FROM alert_history
    GROUP BY alert_type
  `).all() as Array<{ alert_type: string; count: number }>;

  const byType: Record<string, number> = {};
  for (const row of typeRows) {
    byType[row.alert_type] = row.count;
  }

  // Delivery rate
  const deliveryRow = database.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN delivered = 1 THEN 1 ELSE 0 END) as delivered
    FROM alert_history
  `).get() as { total: number; delivered: number };

  const deliveryRate = deliveryRow.total > 0
    ? deliveryRow.delivered / deliveryRow.total
    : 1;

  return {
    totalSent: totalRow.count,
    sentThisWeek: weekRow.count,
    byType,
    deliveryRate,
  };
}

/**
 * Get recent alerts across all recipients (for admin)
 */
export function getRecentAlerts(limit: number = 50): AlertRecord[] {
  const database = getDatabase();

  const rows = database.prepare(`
    SELECT * FROM alert_history
    ORDER BY sent_at DESC
    LIMIT ?
  `).all(limit) as AlertHistoryRow[];

  return rows.map(rowToAlertRecord);
}
