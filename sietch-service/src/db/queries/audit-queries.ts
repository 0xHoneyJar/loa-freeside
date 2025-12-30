// =============================================================================
// Audit Log Queries
// =============================================================================

import { getDatabase } from '../connection.js';
import type { AuditLogEntry } from '../../types/index.js';

/**
 * Log an audit event
 */
export function logAuditEvent(
  eventType: AuditLogEntry['eventType'],
  eventData: Record<string, unknown>
): number {
  const database = getDatabase();

  const stmt = database.prepare(`
    INSERT INTO audit_log (event_type, event_data)
    VALUES (?, ?)
  `);

  const result = stmt.run(eventType, JSON.stringify(eventData));
  return result.lastInsertRowid as number;
}

/**
 * Get audit log entries
 */
export function getAuditLog(options: {
  limit?: number;
  eventType?: AuditLogEntry['eventType'];
  since?: Date;
} = {}): AuditLogEntry[] {
  const database = getDatabase();

  let sql = 'SELECT id, event_type, event_data, created_at FROM audit_log WHERE 1=1';
  const params: unknown[] = [];

  if (options.eventType) {
    sql += ' AND event_type = ?';
    params.push(options.eventType);
  }

  if (options.since) {
    sql += ' AND created_at >= ?';
    params.push(options.since.toISOString());
  }

  sql += ' ORDER BY created_at DESC';

  if (options.limit) {
    sql += ' LIMIT ?';
    params.push(options.limit);
  }

  const rows = database.prepare(sql).all(...params) as Array<{
    id: number;
    event_type: AuditLogEntry['eventType'];
    event_data: string;
    created_at: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    eventType: row.event_type,
    eventData: JSON.parse(row.event_data) as Record<string, unknown>,
    createdAt: new Date(row.created_at),
  }));
}
