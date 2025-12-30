// =============================================================================
// Admin Override Queries
// =============================================================================

import { getDatabase } from '../connection.js';
import type { AdminOverride } from '../../types/index.js';
import { logAuditEvent } from './audit-queries.js';

/**
 * Create a new admin override
 */
export function createAdminOverride(override: Omit<AdminOverride, 'id' | 'createdAt' | 'active'>): number {
  const database = getDatabase();

  const stmt = database.prepare(`
    INSERT INTO admin_overrides (address, action, reason, created_by, expires_at, active)
    VALUES (?, ?, ?, ?, ?, 1)
  `);

  const result = stmt.run(
    override.address.toLowerCase(),
    override.action,
    override.reason,
    override.createdBy,
    override.expiresAt?.toISOString() ?? null
  );

  logAuditEvent('admin_override', {
    overrideId: result.lastInsertRowid,
    address: override.address,
    action: override.action,
    reason: override.reason,
    createdBy: override.createdBy,
  });

  return result.lastInsertRowid as number;
}

/**
 * Get all active admin overrides
 */
export function getActiveAdminOverrides(): AdminOverride[] {
  const database = getDatabase();

  const rows = database.prepare(`
    SELECT id, address, action, reason, created_by, created_at, expires_at, active
    FROM admin_overrides
    WHERE active = 1
      AND (expires_at IS NULL OR expires_at > datetime('now'))
  `).all() as Array<{
    id: number;
    address: string;
    action: 'add' | 'remove';
    reason: string;
    created_by: string;
    created_at: string;
    expires_at: string | null;
    active: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    address: row.address,
    action: row.action,
    reason: row.reason,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at),
    expiresAt: row.expires_at ? new Date(row.expires_at) : null,
    active: row.active === 1,
  }));
}

/**
 * Deactivate an admin override
 */
export function deactivateAdminOverride(id: number): boolean {
  const database = getDatabase();

  const result = database.prepare(`
    UPDATE admin_overrides
    SET active = 0
    WHERE id = ?
  `).run(id);

  return result.changes > 0;
}
