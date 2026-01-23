/**
 * Theme Builder Query Module
 *
 * Database operations for themes, versions, and audit logs.
 * Sprint 1: Foundation - Database Schema & Types
 *
 * @module db/queries/theme-queries
 * @see grimoires/loa/sdd.md §5. Database Schema
 */

import { randomUUID } from 'crypto';
import { getDatabase } from '../connection.js';
import { logger } from '../../utils/logger.js';
import type {
  Theme,
  ThemeConfig,
  ThemeRow,
  ThemeStatus,
  ThemeVersion,
  ThemeVersionRow,
  ThemeAuditLog,
  ThemeAuditLogRow,
  AuditAction,
  AuditActorType,
  CreateThemeInput,
  UpdateThemeInput,
  UpdateThemeConfigInput,
  ThemeListOptions,
  PaginatedThemeList,
} from '../../types/theme.types.js';

// =============================================================================
// Default Values
// =============================================================================

/**
 * Default branding for new themes
 */
const DEFAULT_BRANDING: ThemeConfig['branding'] = {
  colors: {
    primary: '#6366f1',
    secondary: '#8b5cf6',
    background: '#0f172a',
    surface: '#1e293b',
    text: '#f8fafc',
    textMuted: '#94a3b8',
    accent: '#f59e0b',
    error: '#ef4444',
    success: '#22c55e',
    warning: '#f59e0b',
  },
  fonts: {
    heading: { family: 'Inter', source: 'google', weights: [500, 600, 700] },
    body: { family: 'Inter', source: 'google', weights: [400, 500] },
    mono: { family: 'JetBrains Mono', source: 'google', weights: [400, 500] },
  },
  borderRadius: 'md',
  spacing: 'comfortable',
};

/**
 * Default theme config for new themes
 */
const DEFAULT_THEME_CONFIG: ThemeConfig = {
  branding: DEFAULT_BRANDING,
  pages: [],
  contracts: [],
  chains: [],
};

// =============================================================================
// Row to Model Converters
// =============================================================================

/**
 * Convert theme row to Theme model
 */
function rowToTheme(row: ThemeRow): Theme {
  const config = JSON.parse(row.config) as ThemeConfig;
  return {
    id: row.id,
    communityId: row.community_id,
    name: row.name,
    description: row.description,
    branding: config.branding,
    pages: config.pages,
    contracts: config.contracts,
    chains: config.chains,
    discord: config.discord,
    status: row.status,
    version: row.version,
    publishedAt: row.published_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Convert theme version row to ThemeVersion model
 */
function rowToThemeVersion(row: ThemeVersionRow): ThemeVersion {
  return {
    id: row.id,
    themeId: row.theme_id,
    version: row.version,
    config: JSON.parse(row.config) as ThemeConfig,
    changeSummary: row.change_summary ?? undefined,
    changedBy: row.changed_by,
    createdAt: row.created_at,
  };
}

/**
 * Convert audit log row to ThemeAuditLog model
 */
function rowToAuditLog(row: ThemeAuditLogRow): ThemeAuditLog {
  return {
    id: row.id,
    themeId: row.theme_id,
    action: row.action,
    actorId: row.actor_id,
    actorType: row.actor_type,
    details: row.details ? JSON.parse(row.details) : undefined,
    createdAt: row.created_at,
  };
}

// =============================================================================
// Theme CRUD Operations
// =============================================================================

/**
 * Create a new theme
 */
export function createTheme(
  input: CreateThemeInput,
  actorId: string,
  actorType: AuditActorType = 'user'
): Theme {
  const db = getDatabase();
  const id = randomUUID();
  const now = new Date().toISOString();

  // Merge input branding with defaults
  const config: ThemeConfig = {
    ...DEFAULT_THEME_CONFIG,
    branding: input.branding
      ? { ...DEFAULT_BRANDING, ...input.branding }
      : DEFAULT_BRANDING,
  };

  const stmt = db.prepare(`
    INSERT INTO themes (id, community_id, name, description, status, config, version, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'draft', ?, '1.0.0', ?, ?)
  `);

  stmt.run(
    id,
    input.communityId,
    input.name,
    input.description ?? '',
    JSON.stringify(config),
    now,
    now
  );

  // Log audit event
  logThemeAudit(id, 'create', actorId, actorType, { name: input.name });

  logger.info({ themeId: id, communityId: input.communityId }, 'Created theme');

  return getThemeById(id)!;
}

/**
 * Get theme by ID
 */
export function getThemeById(id: string): Theme | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM themes WHERE id = ?').get(id) as ThemeRow | undefined;
  return row ? rowToTheme(row) : null;
}

/**
 * Get themes by community ID
 */
export function getThemesByCommunity(communityId: string): Theme[] {
  const db = getDatabase();
  const rows = db.prepare(
    'SELECT * FROM themes WHERE community_id = ? ORDER BY updated_at DESC'
  ).all(communityId) as ThemeRow[];
  return rows.map(rowToTheme);
}

/**
 * List themes with pagination and filtering
 */
export function listThemes(options: ThemeListOptions = {}): PaginatedThemeList {
  const db = getDatabase();
  const {
    communityId,
    status,
    limit = 20,
    offset = 0,
    orderBy = 'updated_at',
    orderDir = 'desc',
  } = options;

  // Build WHERE clause
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (communityId) {
    conditions.push('community_id = ?');
    params.push(communityId);
  }

  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Count total
  const countStmt = db.prepare(`SELECT COUNT(*) as count FROM themes ${whereClause}`);
  const countResult = countStmt.get(...params) as { count: number };

  // Fetch page
  const orderClause = `ORDER BY ${orderBy} ${orderDir.toUpperCase()}`;
  const fetchStmt = db.prepare(
    `SELECT * FROM themes ${whereClause} ${orderClause} LIMIT ? OFFSET ?`
  );
  const rows = fetchStmt.all(...params, limit, offset) as ThemeRow[];

  return {
    themes: rows.map(rowToTheme),
    total: countResult.count,
    limit,
    offset,
  };
}

/**
 * Update theme metadata (name, description)
 */
export function updateTheme(
  id: string,
  input: UpdateThemeInput,
  actorId: string,
  actorType: AuditActorType = 'user'
): Theme | null {
  const db = getDatabase();
  const existing = getThemeById(id);
  if (!existing) return null;

  const updates: string[] = ['updated_at = datetime(\'now\')'];
  const params: unknown[] = [];

  if (input.name !== undefined) {
    updates.push('name = ?');
    params.push(input.name);
  }

  if (input.description !== undefined) {
    updates.push('description = ?');
    params.push(input.description);
  }

  params.push(id);

  const stmt = db.prepare(`UPDATE themes SET ${updates.join(', ')} WHERE id = ?`);
  stmt.run(...params);

  // Log audit event
  logThemeAudit(id, 'update', actorId, actorType, { fields: Object.keys(input) });

  logger.info({ themeId: id }, 'Updated theme metadata');

  return getThemeById(id);
}

/**
 * Update theme configuration (branding, pages, contracts, etc.)
 */
export function updateThemeConfig(
  id: string,
  input: UpdateThemeConfigInput,
  actorId: string,
  actorType: AuditActorType = 'user'
): Theme | null {
  const db = getDatabase();
  const existing = getThemeById(id);
  if (!existing) return null;

  // Get current config
  const currentConfig: ThemeConfig = {
    branding: existing.branding,
    pages: existing.pages,
    contracts: existing.contracts,
    chains: existing.chains,
    discord: existing.discord,
  };

  // Merge updates
  const newConfig: ThemeConfig = {
    branding: input.branding
      ? { ...currentConfig.branding, ...input.branding }
      : currentConfig.branding,
    pages: input.pages ?? currentConfig.pages,
    contracts: input.contracts ?? currentConfig.contracts,
    chains: input.chains ?? currentConfig.chains,
    discord: input.discord ?? currentConfig.discord,
  };

  // Save current version for history
  saveThemeVersion(id, existing.version, currentConfig, actorId, input.changeSummary);

  // Increment patch version
  const versionParts = existing.version.split('.').map(Number);
  const major = versionParts[0] ?? 1;
  const minor = versionParts[1] ?? 0;
  const patch = versionParts[2] ?? 0;
  const newVersion = `${major}.${minor}.${patch + 1}`;

  const stmt = db.prepare(`
    UPDATE themes
    SET config = ?, version = ?, updated_at = datetime('now')
    WHERE id = ?
  `);
  stmt.run(JSON.stringify(newConfig), newVersion, id);

  // Log audit event
  logThemeAudit(id, 'update', actorId, actorType, {
    version: newVersion,
    changeSummary: input.changeSummary,
  });

  logger.info({ themeId: id, version: newVersion }, 'Updated theme config');

  return getThemeById(id);
}

/**
 * Publish a theme
 */
export function publishTheme(
  id: string,
  actorId: string,
  actorType: AuditActorType = 'user'
): Theme | null {
  const db = getDatabase();
  const existing = getThemeById(id);
  if (!existing) return null;

  const stmt = db.prepare(`
    UPDATE themes
    SET status = 'published', published_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `);
  stmt.run(id);

  // Log audit event
  logThemeAudit(id, 'publish', actorId, actorType, { version: existing.version });

  logger.info({ themeId: id, version: existing.version }, 'Published theme');

  return getThemeById(id);
}

/**
 * Unpublish a theme (set to draft)
 */
export function unpublishTheme(
  id: string,
  actorId: string,
  actorType: AuditActorType = 'user'
): Theme | null {
  const db = getDatabase();
  const existing = getThemeById(id);
  if (!existing) return null;

  const stmt = db.prepare(`
    UPDATE themes
    SET status = 'draft', updated_at = datetime('now')
    WHERE id = ?
  `);
  stmt.run(id);

  // Log audit event
  logThemeAudit(id, 'unpublish', actorId, actorType);

  logger.info({ themeId: id }, 'Unpublished theme');

  return getThemeById(id);
}

/**
 * Delete a theme
 */
export function deleteTheme(
  id: string,
  actorId: string,
  actorType: AuditActorType = 'user'
): boolean {
  const db = getDatabase();
  const existing = getThemeById(id);
  if (!existing) return false;

  // Log audit event before deletion (cascade will delete audit logs)
  logThemeAudit(id, 'delete', actorId, actorType, { name: existing.name });

  const stmt = db.prepare('DELETE FROM themes WHERE id = ?');
  const result = stmt.run(id);

  logger.info({ themeId: id }, 'Deleted theme');

  return result.changes > 0;
}

// =============================================================================
// Theme Version Operations
// =============================================================================

/**
 * Save a theme version snapshot
 */
function saveThemeVersion(
  themeId: string,
  version: string,
  config: ThemeConfig,
  changedBy: string,
  changeSummary?: string
): void {
  const db = getDatabase();
  const id = randomUUID();

  const stmt = db.prepare(`
    INSERT INTO theme_versions (id, theme_id, version, config, change_summary, changed_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  stmt.run(id, themeId, version, JSON.stringify(config), changeSummary ?? null, changedBy);

  logger.debug({ themeId, version }, 'Saved theme version');
}

/**
 * Get all versions for a theme
 */
export function getThemeVersions(themeId: string): ThemeVersion[] {
  const db = getDatabase();
  const rows = db.prepare(
    'SELECT * FROM theme_versions WHERE theme_id = ? ORDER BY created_at DESC'
  ).all(themeId) as ThemeVersionRow[];
  return rows.map(rowToThemeVersion);
}

/**
 * Get a specific version
 */
export function getThemeVersion(themeId: string, version: string): ThemeVersion | null {
  const db = getDatabase();
  const row = db.prepare(
    'SELECT * FROM theme_versions WHERE theme_id = ? AND version = ?'
  ).get(themeId, version) as ThemeVersionRow | undefined;
  return row ? rowToThemeVersion(row) : null;
}

/**
 * Rollback theme to a previous version
 */
export function rollbackTheme(
  themeId: string,
  targetVersion: string,
  actorId: string,
  actorType: AuditActorType = 'user'
): Theme | null {
  const db = getDatabase();
  const existing = getThemeById(themeId);
  if (!existing) return null;

  const targetVersionData = getThemeVersion(themeId, targetVersion);
  if (!targetVersionData) return null;

  // Save current state as a version first
  const currentConfig: ThemeConfig = {
    branding: existing.branding,
    pages: existing.pages,
    contracts: existing.contracts,
    chains: existing.chains,
    discord: existing.discord,
  };
  saveThemeVersion(
    themeId,
    existing.version,
    currentConfig,
    actorId,
    `Pre-rollback snapshot (before rollback to ${targetVersion})`
  );

  // Increment version
  const versionParts = existing.version.split('.').map(Number);
  const major = versionParts[0] ?? 1;
  const minor = versionParts[1] ?? 0;
  const patch = versionParts[2] ?? 0;
  const newVersion = `${major}.${minor}.${patch + 1}`;

  // Apply target version config
  const stmt = db.prepare(`
    UPDATE themes
    SET config = ?, version = ?, updated_at = datetime('now')
    WHERE id = ?
  `);
  stmt.run(JSON.stringify(targetVersionData.config), newVersion, themeId);

  // Log audit event
  logThemeAudit(themeId, 'update', actorId, actorType, {
    action: 'rollback',
    targetVersion,
    newVersion,
  });

  logger.info({ themeId, targetVersion, newVersion }, 'Rolled back theme');

  return getThemeById(themeId);
}

// =============================================================================
// Audit Log Operations
// =============================================================================

/**
 * Log a theme audit event
 */
function logThemeAudit(
  themeId: string,
  action: AuditAction,
  actorId: string,
  actorType: AuditActorType,
  details?: Record<string, unknown>
): void {
  const db = getDatabase();

  const stmt = db.prepare(`
    INSERT INTO theme_audit_log (theme_id, action, actor_id, actor_type, details)
    VALUES (?, ?, ?, ?, ?)
  `);

  stmt.run(themeId, action, actorId, actorType, details ? JSON.stringify(details) : null);
}

/**
 * Get audit log for a theme
 */
export function getThemeAuditLog(
  themeId: string,
  limit = 50,
  offset = 0
): ThemeAuditLog[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT * FROM theme_audit_log
    WHERE theme_id = ?
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(themeId, limit, offset) as ThemeAuditLogRow[];
  return rows.map(rowToAuditLog);
}

/**
 * Get audit log by actor
 */
export function getAuditLogByActor(
  actorId: string,
  limit = 50,
  offset = 0
): ThemeAuditLog[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT * FROM theme_audit_log
    WHERE actor_id = ?
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(actorId, limit, offset) as ThemeAuditLogRow[];
  return rows.map(rowToAuditLog);
}

// =============================================================================
// Utility Queries
// =============================================================================

/**
 * Check if a theme exists
 */
export function themeExists(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare('SELECT 1 FROM themes WHERE id = ?').get(id);
  return result !== undefined;
}

/**
 * Check if a community has any themes
 */
export function communityHasThemes(communityId: string): boolean {
  const db = getDatabase();
  const result = db.prepare(
    'SELECT 1 FROM themes WHERE community_id = ? LIMIT 1'
  ).get(communityId);
  return result !== undefined;
}

/**
 * Get published theme for a community
 */
export function getPublishedTheme(communityId: string): Theme | null {
  const db = getDatabase();
  const row = db.prepare(
    'SELECT * FROM themes WHERE community_id = ? AND status = \'published\' LIMIT 1'
  ).get(communityId) as ThemeRow | undefined;
  return row ? rowToTheme(row) : null;
}

/**
 * Count themes by status for a community
 */
export function countThemesByStatus(communityId: string): { draft: number; published: number } {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT status, COUNT(*) as count
    FROM themes
    WHERE community_id = ?
    GROUP BY status
  `).all(communityId) as Array<{ status: ThemeStatus; count: number }>;

  const result = { draft: 0, published: 0 };
  for (const row of rows) {
    result[row.status] = row.count;
  }
  return result;
}
