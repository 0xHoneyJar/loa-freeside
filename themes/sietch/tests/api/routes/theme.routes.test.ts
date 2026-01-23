/**
 * Theme Builder API Integration Tests
 *
 * Tests for theme CRUD, versioning, and publishing endpoints.
 * Sprint 2: Foundation - Theme CRUD API
 *
 * @see grimoires/loa/sdd.md §6. API Design
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import Database from 'better-sqlite3';
import { themeRouter } from '../../../src/api/routes/theme.routes.js';
import { THEME_BUILDER_SCHEMA_SQL } from '../../../src/db/migrations/021_theme_builder.js';
import type {
  Theme,
  ThemeVersion,
  ThemeBranding,
} from '../../../src/types/theme.types.js';

// =============================================================================
// Mock Setup
// =============================================================================

// Mock the database connection module
let testDb: Database.Database;

vi.mock('../../../src/db/connection.js', () => ({
  getDatabase: () => testDb,
  initDatabase: vi.fn(),
  closeDatabase: vi.fn(),
}));

// Mock logger
vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock config
vi.mock('../../../src/config.js', () => ({
  config: {
    server: { adminApiKeys: { legacyKeys: new Map([['test-key', 'test-admin']]), hashedKeys: [] } },
    featureFlags: { redisEnabled: false },
  },
  validateApiKey: () => 'test-admin',
  validateApiKeyAsync: () => Promise.resolve('test-admin'),
}));

// Mock middleware
vi.mock('../../../src/api/middleware.js', () => ({
  adminRateLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireApiKeyAsync: (req: Request, _res: Response, next: NextFunction) => {
    (req as any).adminName = 'test-admin';
    (req as any).apiKeyId = 'test-key';
    next();
  },
  ValidationError: class ValidationError extends Error {
    status = 400;
    constructor(message: string) {
      super(message);
      this.name = 'ValidationError';
    }
  },
  NotFoundError: class NotFoundError extends Error {
    status = 404;
    constructor(message: string) {
      super(message);
      this.name = 'NotFoundError';
    }
  },
}));

// =============================================================================
// Test App Setup
// =============================================================================

function createTestApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/themes', themeRouter);

  // Error handler
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err.status || 500).json({
      error: err.message || 'Internal server error',
    });
  });

  return app;
}

function setupTestDatabase(): void {
  testDb = new Database(':memory:');
  testDb.exec(THEME_BUILDER_SCHEMA_SQL);
}

function cleanupTestDatabase(): void {
  if (testDb) {
    testDb.close();
  }
}

// =============================================================================
// Test Data Factories
// =============================================================================

function createValidThemeInput(overrides: Record<string, unknown> = {}) {
  return {
    communityId: 'comm-test-123',
    name: 'Test Theme',
    description: 'A test theme for unit tests',
    ...overrides,
  };
}

function createValidBrandingInput(): Partial<ThemeBranding> {
  return {
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
    borderRadius: 'md',
    spacing: 'comfortable',
  };
}

// =============================================================================
// Test Suites
// =============================================================================

describe('Theme API Routes', () => {
  let app: Express;

  beforeEach(() => {
    setupTestDatabase();
    app = createTestApp();
  });

  afterEach(() => {
    cleanupTestDatabase();
    vi.clearAllMocks();
  });

  // ===========================================================================
  // POST /api/themes - Create Theme
  // ===========================================================================

  describe('POST /api/themes', () => {
    it('should create a new theme with valid input', async () => {
      const input = createValidThemeInput();

      const response = await request(app)
        .post('/api/themes')
        .send(input)
        .expect(201);

      expect(response.body.id).toBeDefined();
      expect(response.body.theme.name).toBe(input.name);
      expect(response.body.theme.communityId).toBe(input.communityId);
      expect(response.body.theme.status).toBe('draft');
      expect(response.body.theme.version).toBe('1.0.0');
    });

    it('should create a theme with custom branding', async () => {
      const input = createValidThemeInput({
        branding: createValidBrandingInput(),
      });

      const response = await request(app)
        .post('/api/themes')
        .send(input)
        .expect(201);

      expect(response.body.theme.branding.colors.primary).toBe('#6366f1');
      expect(response.body.theme.branding.borderRadius).toBe('md');
    });

    it('should reject missing required fields', async () => {
      const response = await request(app)
        .post('/api/themes')
        .send({ name: 'Test' }) // missing communityId
        .expect(400);

      expect(response.body.error).toContain('Invalid theme input');
    });

    it('should reject invalid name (too long)', async () => {
      const input = createValidThemeInput({
        name: 'x'.repeat(101), // max 100 chars
      });

      const response = await request(app)
        .post('/api/themes')
        .send(input)
        .expect(400);

      expect(response.body.error).toContain('Invalid theme input');
    });
  });

  // ===========================================================================
  // GET /api/themes - List Themes
  // ===========================================================================

  describe('GET /api/themes', () => {
    beforeEach(async () => {
      // Create some test themes
      await request(app)
        .post('/api/themes')
        .send(createValidThemeInput({ name: 'Theme 1' }));
      await request(app)
        .post('/api/themes')
        .send(createValidThemeInput({ name: 'Theme 2', communityId: 'comm-other' }));
    });

    it('should list all themes', async () => {
      const response = await request(app)
        .get('/api/themes')
        .expect(200);

      expect(response.body.themes).toHaveLength(2);
      expect(response.body.pagination.total).toBe(2);
    });

    it('should filter by communityId', async () => {
      const response = await request(app)
        .get('/api/themes')
        .query({ communityId: 'comm-test-123' })
        .expect(200);

      expect(response.body.themes).toHaveLength(1);
      expect(response.body.themes[0].name).toBe('Theme 1');
    });

    it('should filter by status', async () => {
      const response = await request(app)
        .get('/api/themes')
        .query({ status: 'published' })
        .expect(200);

      expect(response.body.themes).toHaveLength(0);
    });

    it('should support pagination', async () => {
      const response = await request(app)
        .get('/api/themes')
        .query({ limit: 1, offset: 0 })
        .expect(200);

      expect(response.body.themes).toHaveLength(1);
      expect(response.body.pagination.hasMore).toBe(true);
    });
  });

  // ===========================================================================
  // GET /api/themes/:themeId - Get Theme
  // ===========================================================================

  describe('GET /api/themes/:themeId', () => {
    let themeId: string;

    beforeEach(async () => {
      const response = await request(app)
        .post('/api/themes')
        .send(createValidThemeInput());
      themeId = response.body.id;
    });

    it('should return theme by ID', async () => {
      const response = await request(app)
        .get(`/api/themes/${themeId}`)
        .expect(200);

      expect(response.body.theme.id).toBe(themeId);
      expect(response.body.theme.name).toBe('Test Theme');
    });

    it('should return 404 for non-existent theme', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app)
        .get(`/api/themes/${fakeId}`)
        .expect(404);

      expect(response.body.error).toContain('Theme not found');
    });

    it('should return 400 for invalid UUID', async () => {
      const response = await request(app)
        .get('/api/themes/not-a-uuid')
        .expect(400);

      expect(response.body.error).toContain('Invalid theme ID');
    });
  });

  // ===========================================================================
  // PATCH /api/themes/:themeId - Update Theme Metadata
  // ===========================================================================

  describe('PATCH /api/themes/:themeId', () => {
    let themeId: string;

    beforeEach(async () => {
      const response = await request(app)
        .post('/api/themes')
        .send(createValidThemeInput());
      themeId = response.body.id;
    });

    it('should update theme name', async () => {
      const response = await request(app)
        .patch(`/api/themes/${themeId}`)
        .send({ name: 'Updated Name' })
        .expect(200);

      expect(response.body.theme.name).toBe('Updated Name');
    });

    it('should update theme description', async () => {
      const response = await request(app)
        .patch(`/api/themes/${themeId}`)
        .send({ description: 'New description' })
        .expect(200);

      expect(response.body.theme.description).toBe('New description');
    });

    it('should return 404 for non-existent theme', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      await request(app)
        .patch(`/api/themes/${fakeId}`)
        .send({ name: 'Test' })
        .expect(404);
    });
  });

  // ===========================================================================
  // PUT /api/themes/:themeId/config - Update Theme Config
  // ===========================================================================

  describe('PUT /api/themes/:themeId/config', () => {
    let themeId: string;

    beforeEach(async () => {
      const response = await request(app)
        .post('/api/themes')
        .send(createValidThemeInput());
      themeId = response.body.id;
    });

    it('should update theme branding', async () => {
      const response = await request(app)
        .put(`/api/themes/${themeId}/config`)
        .send({
          branding: {
            colors: { primary: '#ff0000' },
          },
          changeSummary: 'Changed primary color',
        })
        .expect(200);

      expect(response.body.theme.branding.colors.primary).toBe('#ff0000');
      expect(response.body.theme.version).toBe('1.0.1');
    });

    it('should create version snapshot on config update', async () => {
      await request(app)
        .put(`/api/themes/${themeId}/config`)
        .send({ branding: { spacing: 'compact' } });

      const versionsResponse = await request(app)
        .get(`/api/themes/${themeId}/versions`)
        .expect(200);

      expect(versionsResponse.body.versions.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ===========================================================================
  // DELETE /api/themes/:themeId - Delete Theme
  // ===========================================================================

  describe('DELETE /api/themes/:themeId', () => {
    let themeId: string;

    beforeEach(async () => {
      const response = await request(app)
        .post('/api/themes')
        .send(createValidThemeInput());
      themeId = response.body.id;
    });

    it('should delete a theme', async () => {
      const response = await request(app)
        .delete(`/api/themes/${themeId}`)
        .expect(200);

      expect(response.body.message).toContain('deleted');

      // Verify theme is gone
      await request(app)
        .get(`/api/themes/${themeId}`)
        .expect(404);
    });

    it('should return 404 for non-existent theme', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      await request(app)
        .delete(`/api/themes/${fakeId}`)
        .expect(404);
    });
  });

  // ===========================================================================
  // POST /api/themes/:themeId/publish - Publish Theme
  // ===========================================================================

  describe('POST /api/themes/:themeId/publish', () => {
    let themeId: string;

    beforeEach(async () => {
      const response = await request(app)
        .post('/api/themes')
        .send(createValidThemeInput());
      themeId = response.body.id;
    });

    it('should publish a draft theme', async () => {
      const response = await request(app)
        .post(`/api/themes/${themeId}/publish`)
        .expect(200);

      expect(response.body.theme.status).toBe('published');
      expect(response.body.theme.publishedAt).toBeDefined();
    });

    it('should return 404 for non-existent theme', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      await request(app)
        .post(`/api/themes/${fakeId}/publish`)
        .expect(404);
    });
  });

  // ===========================================================================
  // POST /api/themes/:themeId/unpublish - Unpublish Theme
  // ===========================================================================

  describe('POST /api/themes/:themeId/unpublish', () => {
    let themeId: string;

    beforeEach(async () => {
      const createResponse = await request(app)
        .post('/api/themes')
        .send(createValidThemeInput());
      themeId = createResponse.body.id;

      // Publish it first
      await request(app).post(`/api/themes/${themeId}/publish`);
    });

    it('should unpublish a published theme', async () => {
      const response = await request(app)
        .post(`/api/themes/${themeId}/unpublish`)
        .expect(200);

      expect(response.body.theme.status).toBe('draft');
    });
  });

  // ===========================================================================
  // GET /api/themes/:themeId/versions - List Versions
  // ===========================================================================

  describe('GET /api/themes/:themeId/versions', () => {
    let themeId: string;

    beforeEach(async () => {
      const response = await request(app)
        .post('/api/themes')
        .send(createValidThemeInput());
      themeId = response.body.id;

      // Make a config update to create a version
      await request(app)
        .put(`/api/themes/${themeId}/config`)
        .send({ branding: { spacing: 'spacious' } });
    });

    it('should return version history', async () => {
      const response = await request(app)
        .get(`/api/themes/${themeId}/versions`)
        .expect(200);

      expect(Array.isArray(response.body.versions)).toBe(true);
      expect(response.body.versions.length).toBeGreaterThanOrEqual(1);
    });

    it('should return 404 for non-existent theme', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      await request(app)
        .get(`/api/themes/${fakeId}/versions`)
        .expect(404);
    });
  });

  // ===========================================================================
  // POST /api/themes/:themeId/rollback - Rollback Theme
  // ===========================================================================

  describe('POST /api/themes/:themeId/rollback', () => {
    let themeId: string;

    beforeEach(async () => {
      const response = await request(app)
        .post('/api/themes')
        .send(createValidThemeInput());
      themeId = response.body.id;

      // Make a config update
      await request(app)
        .put(`/api/themes/${themeId}/config`)
        .send({ branding: { spacing: 'compact' } });
    });

    it('should rollback to previous version', async () => {
      const response = await request(app)
        .post(`/api/themes/${themeId}/rollback`)
        .send({ version: '1.0.0' })
        .expect(200);

      expect(response.body.message).toContain('rolled back');
      expect(response.body.theme.version).toBe('1.0.2'); // version incremented after rollback
    });

    it('should return 400 for invalid version format', async () => {
      await request(app)
        .post(`/api/themes/${themeId}/rollback`)
        .send({ version: 'invalid' })
        .expect(400);
    });

    it('should return 404 for non-existent version', async () => {
      await request(app)
        .post(`/api/themes/${themeId}/rollback`)
        .send({ version: '99.0.0' })
        .expect(404);
    });
  });

  // ===========================================================================
  // GET /api/themes/:themeId/audit - Audit Log
  // ===========================================================================

  describe('GET /api/themes/:themeId/audit', () => {
    let themeId: string;

    beforeEach(async () => {
      const response = await request(app)
        .post('/api/themes')
        .send(createValidThemeInput());
      themeId = response.body.id;
    });

    it('should return audit log entries', async () => {
      const response = await request(app)
        .get(`/api/themes/${themeId}/audit`)
        .expect(200);

      expect(Array.isArray(response.body.audit)).toBe(true);
      expect(response.body.audit.length).toBeGreaterThanOrEqual(1);
      expect(response.body.audit[0].action).toBe('create');
    });

    it('should support pagination', async () => {
      const response = await request(app)
        .get(`/api/themes/${themeId}/audit`)
        .query({ limit: 10, offset: 0 })
        .expect(200);

      expect(response.body.pagination.limit).toBe(10);
      expect(response.body.pagination.offset).toBe(0);
    });

    it('should return 404 for non-existent theme', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      await request(app)
        .get(`/api/themes/${fakeId}/audit`)
        .expect(404);
    });
  });
});
