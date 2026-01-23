/**
 * Component API Routes Tests
 *
 * Sprint 5: Component System - Registry & Validators
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express, { type Request, type Response, type NextFunction } from 'express';

// =============================================================================
// Mock Setup - Must be before imports
// =============================================================================

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
    chain: { rpcUrls: ['https://eth.llamarpc.com'] },
  },
  validateApiKey: () => 'test-admin',
  validateApiKeyAsync: () => Promise.resolve('test-admin'),
}));

// Mock middleware
vi.mock('../../../src/api/middleware.js', () => ({
  publicRateLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
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
  errorHandler: (err: any, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err.status || 500).json({
      success: false,
      error: err.message,
    });
  },
}));

// =============================================================================
// Imports after mocks
// =============================================================================

import { componentRouter } from '../../../src/api/routes/component.routes.js';
import { ComponentRegistry } from '../../../src/services/theme/ComponentRegistry.js';

// =============================================================================
// Test Setup
// =============================================================================

const app = express();
app.use(express.json());
app.use('/api/components', componentRouter);

// Error handler
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  res.status(err.status || 500).json({
    success: false,
    error: err.message,
  });
});

describe('Component API', () => {
  describe('GET /api/components', () => {
    it('should list all components', async () => {
      const res = await request(app).get('/api/components');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.count).toBeGreaterThan(0);

      // Check MVP components are registered
      const types = res.body.data.map((c: { type: string }) => c.type);
      expect(types).toContain('token-gate');
      expect(types).toContain('nft-gallery');
      expect(types).toContain('leaderboard');
      expect(types).toContain('profile-card');
      expect(types).toContain('rich-text');
      expect(types).toContain('layout-container');
    });

    it('should filter by category', async () => {
      const res = await request(app).get('/api/components?category=web3');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // All returned components should be web3 category
      res.body.data.forEach((c: { category: string }) => {
        expect(c.category).toBe('web3');
      });
    });

    it('should reject invalid category', async () => {
      const res = await request(app).get('/api/components?category=invalid');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('Invalid category');
    });

    it('should include component schema', async () => {
      const res = await request(app).get('/api/components');

      expect(res.status).toBe(200);

      const richText = res.body.data.find((c: { type: string }) => c.type === 'rich-text');
      expect(richText).toBeDefined();
      expect(richText.propsSchema).toBeDefined();
      expect(richText.propsSchema.properties).toBeDefined();
      expect(richText.defaultProps).toBeDefined();
    });
  });

  describe('GET /api/components/categories', () => {
    it('should list categories with counts', async () => {
      const res = await request(app).get('/api/components/categories');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);

      // Check category structure
      const web3Category = res.body.data.find((c: { category: string }) => c.category === 'web3');
      expect(web3Category).toBeDefined();
      expect(typeof web3Category.count).toBe('number');
    });
  });

  describe('GET /api/components/:type', () => {
    it('should get specific component', async () => {
      const res = await request(app).get('/api/components/rich-text');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.type).toBe('rich-text');
      expect(res.body.data.name).toBe('Rich Text');
      expect(res.body.data.category).toBe('content');
    });

    it('should return 404 for unknown component', async () => {
      const res = await request(app).get('/api/components/unknown-type');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('Component not found');
    });

    it('should include capabilities', async () => {
      const res = await request(app).get('/api/components/token-gate');

      expect(res.status).toBe(200);
      expect(res.body.data.requiresWeb3).toBe(true);
      expect(res.body.data.requiresContract).toBe(true);
    });
  });

  describe('POST /api/components/validate', () => {
    it('should validate valid props', async () => {
      const res = await request(app)
        .post('/api/components/validate')
        .send({
          type: 'rich-text',
          props: {
            type: 'rich-text',
            content: 'Hello World',
            textAlign: 'center',
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.valid).toBe(true);
      expect(res.body.data.errors).toHaveLength(0);
    });

    it('should fail for missing required props', async () => {
      // Test with token-gate which requires gateConfig
      const res = await request(app)
        .post('/api/components/validate')
        .send({
          type: 'token-gate',
          props: {
            type: 'token-gate',
            // missing 'gateConfig' which is required
            showBalance: false,
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.valid).toBe(false);
      expect(res.body.data.errors.length).toBeGreaterThan(0);
    });

    it('should fail for invalid prop values', async () => {
      const res = await request(app)
        .post('/api/components/validate')
        .send({
          type: 'rich-text',
          props: {
            type: 'rich-text',
            content: 'Hello',
            textAlign: 'invalid-alignment', // Invalid enum value
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.data.valid).toBe(false);
      expect(res.body.data.errors.length).toBeGreaterThan(0);
    });

    it('should fail for unknown component type', async () => {
      const res = await request(app)
        .post('/api/components/validate')
        .send({
          type: 'unknown-component',
          props: {},
        });

      expect(res.status).toBe(200);
      expect(res.body.data.valid).toBe(false);
      expect(res.body.data.errors[0].code).toBe('UNKNOWN_TYPE');
    });

    it('should validate NFT gallery props', async () => {
      const res = await request(app)
        .post('/api/components/validate')
        .send({
          type: 'nft-gallery',
          props: {
            type: 'nft-gallery',
            contractId: 'contract-123',
            layout: 'grid',
            columns: 4,
            maxItems: 20,
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.data.valid).toBe(true);
    });

    it('should validate profile card props', async () => {
      const res = await request(app)
        .post('/api/components/validate')
        .send({
          type: 'profile-card',
          props: {
            type: 'profile-card',
            showAvatar: true,
            showWallet: true,
            showBalance: false,
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.data.valid).toBe(true);
    });

    it('should fail for invalid request body', async () => {
      const res = await request(app)
        .post('/api/components/validate')
        .send({
          // missing type and props
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /api/components/:type/defaults', () => {
    it('should return default props', async () => {
      const res = await request(app)
        .post('/api/components/rich-text/defaults')
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.type).toBe('rich-text');
      expect(res.body.data.content).toBeDefined();
      expect(res.body.data.textAlign).toBe('left');
    });

    it('should merge overrides with defaults', async () => {
      const res = await request(app)
        .post('/api/components/rich-text/defaults')
        .send({
          content: 'Custom content',
          textAlign: 'center',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.content).toBe('Custom content');
      expect(res.body.data.textAlign).toBe('center');
      expect(res.body.data.type).toBe('rich-text');
    });

    it('should return 404 for unknown component', async () => {
      const res = await request(app)
        .post('/api/components/unknown-type/defaults')
        .send({});

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('Component not found');
    });
  });
});

describe('ComponentRegistry Unit Tests', () => {
  beforeEach(() => {
    // Reset registry for isolated tests
    ComponentRegistry.resetInstance();
  });

  it('should register and retrieve component', () => {
    const registry = ComponentRegistry.getInstance();

    registry.registerComponent({
      type: 'test-component' as any,
      definition: {
        type: 'test-component' as any,
        name: 'Test Component',
        description: 'A test component',
        category: 'content',
        icon: 'test',
        propsSchema: {
          type: 'object',
          properties: {
            message: { type: 'string', default: 'Hello' },
          },
          required: ['message'],
        },
        defaultProps: { type: 'test-component', message: 'Hello' } as any,
        minWidth: 1,
        minHeight: 1,
      },
    });

    const component = registry.getComponent('test-component' as any);
    expect(component).toBeDefined();
    expect(component?.name).toBe('Test Component');
  });

  it('should validate props correctly', () => {
    const registry = ComponentRegistry.getInstance();

    registry.registerComponent({
      type: 'test-component' as any,
      definition: {
        type: 'test-component' as any,
        name: 'Test',
        description: 'Test',
        category: 'content',
        icon: 'test',
        propsSchema: {
          type: 'object',
          properties: {
            message: { type: 'string' },
            count: { type: 'number', minimum: 0, maximum: 100 },
          },
          required: ['message'],
        },
        defaultProps: { type: 'test-component', message: '' } as any,
        minWidth: 1,
        minHeight: 1,
      },
    });

    // Valid props
    const validResult = registry.validateProps('test-component' as any, {
      message: 'Hello',
      count: 50,
    });
    expect(validResult.valid).toBe(true);

    // Missing required
    const missingResult = registry.validateProps('test-component' as any, {
      count: 50,
    });
    expect(missingResult.valid).toBe(false);
    expect(missingResult.errors[0].path).toBe('message');

    // Out of range
    const rangeResult = registry.validateProps('test-component' as any, {
      message: 'Hello',
      count: 150, // > 100
    });
    expect(rangeResult.valid).toBe(false);
  });

  it('should list components by category', () => {
    const registry = ComponentRegistry.getInstance();

    registry.registerComponent({
      type: 'web3-test' as any,
      definition: {
        type: 'web3-test' as any,
        name: 'Web3 Test',
        description: 'Test',
        category: 'web3',
        icon: 'test',
        propsSchema: { type: 'object', properties: {} },
        defaultProps: {} as any,
        minWidth: 1,
        minHeight: 1,
      },
    });

    registry.registerComponent({
      type: 'content-test' as any,
      definition: {
        type: 'content-test' as any,
        name: 'Content Test',
        description: 'Test',
        category: 'content',
        icon: 'test',
        propsSchema: { type: 'object', properties: {} },
        defaultProps: {} as any,
        minWidth: 1,
        minHeight: 1,
      },
    });

    const web3Components = registry.listComponentsByCategory('web3');
    expect(web3Components).toHaveLength(1);
    expect(web3Components[0].type).toBe('web3-test');

    const contentComponents = registry.listComponentsByCategory('content');
    expect(contentComponents).toHaveLength(1);
    expect(contentComponents[0].type).toBe('content-test');
  });

  it('should get component count', () => {
    const registry = ComponentRegistry.getInstance();
    expect(registry.getComponentCount()).toBe(0);

    registry.registerComponent({
      type: 'test1' as any,
      definition: {
        type: 'test1' as any,
        name: 'Test 1',
        description: 'Test',
        category: 'content',
        icon: 'test',
        propsSchema: { type: 'object', properties: {} },
        defaultProps: {} as any,
        minWidth: 1,
        minHeight: 1,
      },
    });

    expect(registry.getComponentCount()).toBe(1);
  });

  it('should check component existence', () => {
    const registry = ComponentRegistry.getInstance();

    expect(registry.hasComponent('rich-text')).toBe(false);

    registry.registerComponent({
      type: 'rich-text',
      definition: {
        type: 'rich-text',
        name: 'Rich Text',
        description: 'Test',
        category: 'content',
        icon: 'test',
        propsSchema: { type: 'object', properties: {} },
        defaultProps: { type: 'rich-text', content: '' } as any,
        minWidth: 1,
        minHeight: 1,
      },
    });

    expect(registry.hasComponent('rich-text')).toBe(true);
  });
});
