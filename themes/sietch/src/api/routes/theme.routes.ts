/**
 * Theme Builder Routes
 *
 * RESTful API for theme management with CRUD operations,
 * versioning, and publishing functionality.
 *
 * Sprint 2: Foundation - Theme CRUD API
 *
 * @see grimoires/loa/sdd.md §6. API Design
 */

import { Router } from 'express';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../middleware.js';
import {
  adminRateLimiter,
  requireApiKeyAsync,
  ValidationError,
  NotFoundError,
} from '../middleware.js';
import {
  createTheme,
  getThemeById,
  getThemesByCommunity,
  listThemes,
  updateTheme,
  updateThemeConfig,
  publishTheme,
  unpublishTheme,
  deleteTheme,
  getThemeVersions,
  getThemeVersion,
  rollbackTheme,
  getThemeAuditLog,
  themeExists,
} from '../../db/queries/theme-queries.js';
import {
  createThemeInputSchema,
  updateThemeInputSchema,
  updateThemeConfigInputSchema,
  themeListOptionsSchema,
  themeUuidSchema,
  semverSchema,
} from '../../packages/core/validation/theme-schemas.js';
import { logger } from '../../utils/logger.js';
import type {
  Theme,
  ThemeVersion,
  ThemeAuditLog,
  PaginatedThemeList,
  UpdateThemeConfigInput,
} from '../../types/theme.types.js';

/**
 * Theme routes (rate limited, API key required)
 */
export const themeRouter = Router();

// Apply rate limiting and authentication
themeRouter.use(adminRateLimiter);
themeRouter.use(requireApiKeyAsync);

// =============================================================================
// Theme CRUD Endpoints
// =============================================================================

/**
 * POST /api/themes
 * Create a new theme
 *
 * @body {communityId: string, name: string, description?: string, branding?: Partial<ThemeBranding>}
 * @returns {201} Created theme
 */
themeRouter.post('/', (req: AuthenticatedRequest, res: Response) => {
  const result = createThemeInputSchema.safeParse(req.body);

  if (!result.success) {
    const errors = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new ValidationError(`Invalid theme input: ${errors}`);
  }

  const theme = createTheme(result.data, req.adminName ?? 'system', 'api');

  logger.info(
    { themeId: theme.id, communityId: theme.communityId, admin: req.adminName },
    'Theme created via API'
  );

  res.status(201).json({
    id: theme.id,
    theme: formatThemeResponse(theme),
  });
});

/**
 * GET /api/themes
 * List themes with pagination and filtering
 *
 * @query {communityId?: string, status?: 'draft'|'published', limit?: number, offset?: number, orderBy?: string, orderDir?: 'asc'|'desc'}
 * @returns {200} Paginated theme list
 */
themeRouter.get('/', (req: AuthenticatedRequest, res: Response) => {
  const result = themeListOptionsSchema.safeParse(req.query);

  if (!result.success) {
    const errors = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new ValidationError(`Invalid query parameters: ${errors}`);
  }

  const options = result.data;
  const pagedResult = listThemes(options);

  res.json({
    themes: pagedResult.themes.map(formatThemeResponse),
    pagination: {
      total: pagedResult.total,
      limit: pagedResult.limit,
      offset: pagedResult.offset,
      hasMore: pagedResult.offset + pagedResult.themes.length < pagedResult.total,
    },
  });
});

/**
 * GET /api/themes/:themeId
 * Get a specific theme by ID
 *
 * @param themeId - Theme UUID
 * @returns {200} Theme details
 * @returns {404} Theme not found
 */
themeRouter.get('/:themeId', (req: AuthenticatedRequest, res: Response) => {
  const themeIdResult = themeUuidSchema.safeParse(req.params.themeId);
  if (!themeIdResult.success) {
    throw new ValidationError('Invalid theme ID format');
  }

  const theme = getThemeById(themeIdResult.data);
  if (!theme) {
    throw new NotFoundError(`Theme not found: ${req.params.themeId}`);
  }

  res.json({
    theme: formatThemeResponse(theme),
  });
});

/**
 * PATCH /api/themes/:themeId
 * Update theme metadata (name, description)
 *
 * @param themeId - Theme UUID
 * @body {name?: string, description?: string}
 * @returns {200} Updated theme
 * @returns {404} Theme not found
 */
themeRouter.patch('/:themeId', (req: AuthenticatedRequest, res: Response) => {
  const themeIdResult = themeUuidSchema.safeParse(req.params.themeId);
  if (!themeIdResult.success) {
    throw new ValidationError('Invalid theme ID format');
  }

  const bodyResult = updateThemeInputSchema.safeParse(req.body);
  if (!bodyResult.success) {
    const errors = bodyResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new ValidationError(`Invalid update input: ${errors}`);
  }

  const theme = updateTheme(
    themeIdResult.data,
    bodyResult.data,
    req.adminName ?? 'system',
    'api'
  );

  if (!theme) {
    throw new NotFoundError(`Theme not found: ${req.params.themeId}`);
  }

  logger.info(
    { themeId: theme.id, admin: req.adminName, fields: Object.keys(bodyResult.data) },
    'Theme metadata updated via API'
  );

  res.json({
    theme: formatThemeResponse(theme),
  });
});

/**
 * PUT /api/themes/:themeId/config
 * Update theme configuration (branding, pages, contracts, etc.)
 *
 * @param themeId - Theme UUID
 * @body {branding?: Partial<ThemeBranding>, pages?: ThemePage[], contracts?: ContractBinding[], chains?: ChainConfig[], discord?: DiscordThemeConfig, changeSummary?: string}
 * @returns {200} Updated theme
 * @returns {404} Theme not found
 */
themeRouter.put('/:themeId/config', (req: AuthenticatedRequest, res: Response) => {
  const themeIdResult = themeUuidSchema.safeParse(req.params.themeId);
  if (!themeIdResult.success) {
    throw new ValidationError('Invalid theme ID format');
  }

  const bodyResult = updateThemeConfigInputSchema.safeParse(req.body);
  if (!bodyResult.success) {
    const errors = bodyResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new ValidationError(`Invalid config input: ${errors}`);
  }

  const theme = updateThemeConfig(
    themeIdResult.data,
    bodyResult.data as UpdateThemeConfigInput,
    req.adminName ?? 'system',
    'api'
  );

  if (!theme) {
    throw new NotFoundError(`Theme not found: ${req.params.themeId}`);
  }

  logger.info(
    { themeId: theme.id, version: theme.version, admin: req.adminName },
    'Theme config updated via API'
  );

  res.json({
    theme: formatThemeResponse(theme),
  });
});

/**
 * DELETE /api/themes/:themeId
 * Delete a theme (cascades to versions, assets, audit log)
 *
 * @param themeId - Theme UUID
 * @returns {200} Deletion confirmation
 * @returns {404} Theme not found
 */
themeRouter.delete('/:themeId', (req: AuthenticatedRequest, res: Response) => {
  const themeIdResult = themeUuidSchema.safeParse(req.params.themeId);
  if (!themeIdResult.success) {
    throw new ValidationError('Invalid theme ID format');
  }

  const deleted = deleteTheme(themeIdResult.data, req.adminName ?? 'system', 'api');

  if (!deleted) {
    throw new NotFoundError(`Theme not found: ${req.params.themeId}`);
  }

  logger.info(
    { themeId: req.params.themeId, admin: req.adminName },
    'Theme deleted via API'
  );

  res.json({
    message: 'Theme deleted successfully',
    id: req.params.themeId,
  });
});

// =============================================================================
// Theme Publishing Endpoints
// =============================================================================

/**
 * POST /api/themes/:themeId/publish
 * Publish a theme (changes status to 'published')
 *
 * @param themeId - Theme UUID
 * @returns {200} Published theme
 * @returns {404} Theme not found
 */
themeRouter.post('/:themeId/publish', (req: AuthenticatedRequest, res: Response) => {
  const themeIdResult = themeUuidSchema.safeParse(req.params.themeId);
  if (!themeIdResult.success) {
    throw new ValidationError('Invalid theme ID format');
  }

  const theme = publishTheme(themeIdResult.data, req.adminName ?? 'system', 'api');

  if (!theme) {
    throw new NotFoundError(`Theme not found: ${req.params.themeId}`);
  }

  logger.info(
    { themeId: theme.id, version: theme.version, admin: req.adminName },
    'Theme published via API'
  );

  res.json({
    message: 'Theme published successfully',
    theme: formatThemeResponse(theme),
  });
});

/**
 * POST /api/themes/:themeId/unpublish
 * Unpublish a theme (changes status to 'draft')
 *
 * @param themeId - Theme UUID
 * @returns {200} Unpublished theme
 * @returns {404} Theme not found
 */
themeRouter.post('/:themeId/unpublish', (req: AuthenticatedRequest, res: Response) => {
  const themeIdResult = themeUuidSchema.safeParse(req.params.themeId);
  if (!themeIdResult.success) {
    throw new ValidationError('Invalid theme ID format');
  }

  const theme = unpublishTheme(themeIdResult.data, req.adminName ?? 'system', 'api');

  if (!theme) {
    throw new NotFoundError(`Theme not found: ${req.params.themeId}`);
  }

  logger.info(
    { themeId: theme.id, admin: req.adminName },
    'Theme unpublished via API'
  );

  res.json({
    message: 'Theme unpublished successfully',
    theme: formatThemeResponse(theme),
  });
});

// =============================================================================
// Theme Version Endpoints
// =============================================================================

/**
 * GET /api/themes/:themeId/versions
 * Get version history for a theme
 *
 * @param themeId - Theme UUID
 * @returns {200} List of theme versions
 * @returns {404} Theme not found
 */
themeRouter.get('/:themeId/versions', (req: AuthenticatedRequest, res: Response) => {
  const themeIdResult = themeUuidSchema.safeParse(req.params.themeId);
  if (!themeIdResult.success) {
    throw new ValidationError('Invalid theme ID format');
  }

  if (!themeExists(themeIdResult.data)) {
    throw new NotFoundError(`Theme not found: ${req.params.themeId}`);
  }

  const versions = getThemeVersions(themeIdResult.data);

  res.json({
    versions: versions.map(formatVersionResponse),
  });
});

/**
 * GET /api/themes/:themeId/versions/:version
 * Get a specific version
 *
 * @param themeId - Theme UUID
 * @param version - Version string (semver)
 * @returns {200} Version details with config
 * @returns {404} Theme or version not found
 */
themeRouter.get('/:themeId/versions/:version', (req: AuthenticatedRequest, res: Response) => {
  const themeIdResult = themeUuidSchema.safeParse(req.params.themeId);
  if (!themeIdResult.success) {
    throw new ValidationError('Invalid theme ID format');
  }

  const versionResult = semverSchema.safeParse(req.params.version);
  if (!versionResult.success) {
    throw new ValidationError('Invalid version format (expected semver like 1.0.0)');
  }

  if (!themeExists(themeIdResult.data)) {
    throw new NotFoundError(`Theme not found: ${req.params.themeId}`);
  }

  const version = getThemeVersion(themeIdResult.data, versionResult.data);
  if (!version) {
    throw new NotFoundError(`Version not found: ${req.params.version}`);
  }

  res.json({
    version: formatVersionResponse(version),
  });
});

/**
 * POST /api/themes/:themeId/rollback
 * Rollback theme to a previous version
 *
 * @param themeId - Theme UUID
 * @body {version: string} - Target version to rollback to
 * @returns {200} Rolled back theme
 * @returns {404} Theme or version not found
 */
themeRouter.post('/:themeId/rollback', (req: AuthenticatedRequest, res: Response) => {
  const themeIdResult = themeUuidSchema.safeParse(req.params.themeId);
  if (!themeIdResult.success) {
    throw new ValidationError('Invalid theme ID format');
  }

  const versionResult = semverSchema.safeParse(req.body?.version);
  if (!versionResult.success) {
    throw new ValidationError('Invalid or missing version in request body (expected semver like 1.0.0)');
  }

  const theme = rollbackTheme(
    themeIdResult.data,
    versionResult.data,
    req.adminName ?? 'system',
    'api'
  );

  if (!theme) {
    throw new NotFoundError(`Theme or target version not found`);
  }

  logger.info(
    { themeId: theme.id, targetVersion: versionResult.data, newVersion: theme.version, admin: req.adminName },
    'Theme rolled back via API'
  );

  res.json({
    message: `Theme rolled back to version ${versionResult.data}`,
    theme: formatThemeResponse(theme),
  });
});

// =============================================================================
// Theme Audit Log Endpoints
// =============================================================================

/**
 * GET /api/themes/:themeId/audit
 * Get audit log for a theme
 *
 * @param themeId - Theme UUID
 * @query {limit?: number, offset?: number}
 * @returns {200} Audit log entries
 * @returns {404} Theme not found
 */
themeRouter.get('/:themeId/audit', (req: AuthenticatedRequest, res: Response) => {
  const themeIdResult = themeUuidSchema.safeParse(req.params.themeId);
  if (!themeIdResult.success) {
    throw new ValidationError('Invalid theme ID format');
  }

  if (!themeExists(themeIdResult.data)) {
    throw new NotFoundError(`Theme not found: ${req.params.themeId}`);
  }

  const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 100);
  const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

  const auditLog = getThemeAuditLog(themeIdResult.data, limit, offset);

  res.json({
    audit: auditLog.map(formatAuditLogResponse),
    pagination: {
      limit,
      offset,
    },
  });
});

// =============================================================================
// Response Formatters
// =============================================================================

/**
 * Format theme for API response
 */
function formatThemeResponse(theme: Theme) {
  return {
    id: theme.id,
    communityId: theme.communityId,
    name: theme.name,
    description: theme.description,
    status: theme.status,
    version: theme.version,
    branding: theme.branding,
    pages: theme.pages,
    contracts: theme.contracts,
    chains: theme.chains,
    discord: theme.discord,
    publishedAt: theme.publishedAt ?? null,
    createdAt: theme.createdAt,
    updatedAt: theme.updatedAt,
  };
}

/**
 * Format theme version for API response
 */
function formatVersionResponse(version: ThemeVersion) {
  return {
    id: version.id,
    themeId: version.themeId,
    version: version.version,
    config: version.config,
    changeSummary: version.changeSummary ?? null,
    changedBy: version.changedBy,
    createdAt: version.createdAt,
  };
}

/**
 * Format audit log entry for API response
 */
function formatAuditLogResponse(entry: ThemeAuditLog) {
  return {
    id: entry.id,
    themeId: entry.themeId,
    action: entry.action,
    actorId: entry.actorId,
    actorType: entry.actorType,
    details: entry.details ?? null,
    createdAt: entry.createdAt,
  };
}
