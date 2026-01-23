/**
 * Web3 API Integration Tests
 *
 * Tests for Web3 data reading, ownership verification, and contract binding CRUD.
 * Sprint 4: Web3 Layer - Contract Binding API
 *
 * @see grimoires/loa/sdd.md §6. API Design
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import Database from 'better-sqlite3';
import { themeContractRouter } from '../../../src/api/routes/theme-contract.routes.js';
import { web3Router } from '../../../src/api/routes/web3.routes.js';
import { THEME_BUILDER_SCHEMA_SQL } from '../../../src/db/migrations/021_theme_builder.js';
import type { ContractBinding } from '../../../src/types/theme-web3.types.js';

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
    chain: { rpcUrls: ['https://eth.llamarpc.com'] },
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

// Mock ContractReadService to avoid actual RPC calls
vi.mock('../../../src/services/theme/ContractReadService.js', () => ({
  contractReadService: {
    readContract: vi.fn().mockResolvedValue({
      success: true,
      data: '1000000000000000000',
      cached: false,
      cachedAt: new Date().toISOString(),
    }),
    getTokenBalance: vi.fn().mockResolvedValue({
      success: true,
      data: {
        address: '0x1234567890123456789012345678901234567890',
        balance: '1000000000000000000',
        decimals: 18,
        symbol: 'TEST',
        formatted: '1.0',
      },
      cached: false,
    }),
    ownsNFT: vi.fn().mockResolvedValue({
      success: true,
      data: {
        address: '0x1234567890123456789012345678901234567890',
        tokenIds: ['1', '2'],
        count: 2,
      },
      cached: false,
    }),
    getERC1155Balance: vi.fn().mockResolvedValue({
      success: true,
      data: 5n,
      cached: false,
    }),
  },
  ContractReadService: vi.fn(),
}));

// Mock ThemeChainService
vi.mock('../../../src/services/theme/ThemeChainService.js', () => ({
  themeChainService: {
    getClient: vi.fn(),
    getRpcHealth: vi.fn().mockReturnValue([
      { url: 'https://eth.llamarpc.com', chainId: 1, failureCount: 0, lastFailure: null, lastSuccess: new Date(), isHealthy: true },
    ]),
    getPooledClients: vi.fn().mockReturnValue([
      { chainId: 1, createdAt: new Date(), lastUsed: new Date() },
    ]),
    isChainHealthy: vi.fn().mockReturnValue(true),
  },
  ThemeChainService: vi.fn(),
}));

// =============================================================================
// Test App Setup
// =============================================================================

function createTestApp(): Express {
  const app = express();
  app.use(express.json());

  // Mount contract binding routes under themes
  app.use('/api/themes/:themeId/contracts', themeContractRouter);

  // Mount web3 routes - wrap async handlers to catch errors
  app.use('/api/web3', web3Router);

  // Error handler - must handle async errors
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

function teardownTestDatabase(): void {
  testDb?.close();
}

// Create a theme directly in the database (bypassing audit log)
function createTestTheme(communityId: string, name: string): string {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const defaultConfig = JSON.stringify({
    branding: {
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
    },
    pages: [],
    contracts: [],
    chains: [],
  });

  testDb.prepare(`
    INSERT INTO themes (id, community_id, name, status, version, config, created_at, updated_at)
    VALUES (?, ?, ?, 'draft', '1.0.0', ?, ?, ?)
  `).run(id, communityId, name, defaultConfig, now, now);

  return id;
}

// Valid ERC20 ABI for testing
const validErc20Abi = [
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: 'balance', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'totalSupply',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
];

// Valid Ethereum address for testing
const VALID_ADDRESS = '0x1234567890123456789012345678901234567890';
const VALID_WALLET = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';

// =============================================================================
// Test Suite
// =============================================================================

describe('Contract Binding API', () => {
  let app: Express;
  let themeId: string;

  beforeEach(() => {
    setupTestDatabase();
    app = createTestApp();

    // Create a test theme directly (bypassing audit log)
    themeId = createTestTheme('test-community', 'Test Theme');
  });

  afterEach(() => {
    teardownTestDatabase();
    vi.clearAllMocks();
  });

  // ===========================================================================
  // Contract Binding CRUD
  // ===========================================================================

  describe('POST /api/themes/:themeId/contracts', () => {
    it('should create a contract binding with valid input', async () => {
      const res = await request(app)
        .post(`/api/themes/${themeId}/contracts`)
        .send({
          name: 'Test Token',
          chainId: 1,
          address: VALID_ADDRESS,
          abi: validErc20Abi,
          type: 'erc20',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.name).toBe('Test Token');
      expect(res.body.data.chainId).toBe(1);
      expect(res.body.validation).toBeDefined();
    });

    it('should reject invalid address', async () => {
      const res = await request(app)
        .post(`/api/themes/${themeId}/contracts`)
        .send({
          name: 'Test Token',
          chainId: 1,
          address: 'invalid-address',
          abi: validErc20Abi,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid');
    });

    it('should reject unsupported chain ID', async () => {
      const res = await request(app)
        .post(`/api/themes/${themeId}/contracts`)
        .send({
          name: 'Test Token',
          chainId: 999999, // Unsupported
          address: VALID_ADDRESS,
          abi: validErc20Abi,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Chain ID');
    });

    it('should reject duplicate binding', async () => {
      // Create first binding
      await request(app)
        .post(`/api/themes/${themeId}/contracts`)
        .send({
          name: 'Test Token',
          chainId: 1,
          address: VALID_ADDRESS,
          abi: validErc20Abi,
        });

      // Try to create duplicate
      const res = await request(app)
        .post(`/api/themes/${themeId}/contracts`)
        .send({
          name: 'Test Token 2',
          chainId: 1,
          address: VALID_ADDRESS,
          abi: validErc20Abi,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('already exists');
    });

    it('should return 404 for non-existent theme', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const res = await request(app)
        .post(`/api/themes/${fakeId}/contracts`)
        .send({
          name: 'Test Token',
          chainId: 1,
          address: VALID_ADDRESS,
          abi: validErc20Abi,
        });

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/themes/:themeId/contracts', () => {
    it('should list contract bindings', async () => {
      // Create bindings
      await request(app)
        .post(`/api/themes/${themeId}/contracts`)
        .send({
          name: 'Token 1',
          chainId: 1,
          address: VALID_ADDRESS,
          abi: validErc20Abi,
        });

      const res = await request(app).get(`/api/themes/${themeId}/contracts`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.count).toBe(1);
    });

    it('should return empty array for theme with no bindings', async () => {
      const res = await request(app).get(`/api/themes/${themeId}/contracts`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
      expect(res.body.count).toBe(0);
    });
  });

  describe('GET /api/themes/:themeId/contracts/:bindingId', () => {
    it('should get specific contract binding', async () => {
      // Create binding
      const createRes = await request(app)
        .post(`/api/themes/${themeId}/contracts`)
        .send({
          name: 'Test Token',
          chainId: 1,
          address: VALID_ADDRESS,
          abi: validErc20Abi,
        });

      const bindingId = createRes.body.data.id;

      const res = await request(app).get(`/api/themes/${themeId}/contracts/${bindingId}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(bindingId);
    });

    it('should return 404 for non-existent binding', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const res = await request(app).get(`/api/themes/${themeId}/contracts/${fakeId}`);

      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/themes/:themeId/contracts/:bindingId', () => {
    it('should update contract binding name', async () => {
      // Create binding
      const createRes = await request(app)
        .post(`/api/themes/${themeId}/contracts`)
        .send({
          name: 'Original Name',
          chainId: 1,
          address: VALID_ADDRESS,
          abi: validErc20Abi,
        });

      const bindingId = createRes.body.data.id;

      const res = await request(app)
        .patch(`/api/themes/${themeId}/contracts/${bindingId}`)
        .send({ name: 'Updated Name' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Updated Name');
    });

    it('should validate updated ABI', async () => {
      // Create binding
      const createRes = await request(app)
        .post(`/api/themes/${themeId}/contracts`)
        .send({
          name: 'Test Token',
          chainId: 1,
          address: VALID_ADDRESS,
          abi: validErc20Abi,
        });

      const bindingId = createRes.body.data.id;

      // Try to update with invalid ABI (non-view function)
      const res = await request(app)
        .patch(`/api/themes/${themeId}/contracts/${bindingId}`)
        .send({
          abi: [
            {
              type: 'function',
              name: 'transfer',
              inputs: [
                { name: 'to', type: 'address' },
                { name: 'amount', type: 'uint256' },
              ],
              outputs: [{ name: '', type: 'bool' }],
              stateMutability: 'nonpayable', // Not view/pure
            },
          ],
        });

      expect(res.status).toBe(400);
      // Schema validation catches invalid stateMutability before service validation
      expect(res.body.error).toContain('Invalid');
    });
  });

  describe('DELETE /api/themes/:themeId/contracts/:bindingId', () => {
    it('should delete contract binding', async () => {
      // Create binding
      const createRes = await request(app)
        .post(`/api/themes/${themeId}/contracts`)
        .send({
          name: 'Test Token',
          chainId: 1,
          address: VALID_ADDRESS,
          abi: validErc20Abi,
        });

      const bindingId = createRes.body.data.id;

      const res = await request(app).delete(`/api/themes/${themeId}/contracts/${bindingId}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify deleted
      const getRes = await request(app).get(`/api/themes/${themeId}/contracts/${bindingId}`);
      expect(getRes.status).toBe(404);
    });
  });

  describe('POST /api/themes/:themeId/contracts/validate', () => {
    it('should validate contract address', async () => {
      const res = await request(app)
        .post(`/api/themes/${themeId}/contracts/validate`)
        .send({
          chainId: 1,
          address: VALID_ADDRESS,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.valid).toBe(true);
      expect(res.body.data.normalizedAddress).toBeDefined();
    });

    it('should reject invalid address', async () => {
      const res = await request(app)
        .post(`/api/themes/${themeId}/contracts/validate`)
        .send({
          chainId: 1,
          address: 'not-an-address',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.valid).toBe(false);
      expect(res.body.data.errors.length).toBeGreaterThan(0);
    });
  });
});

// =============================================================================
// Web3 Data API Tests
// =============================================================================

describe('Web3 Data API', () => {
  let app: Express;

  beforeEach(() => {
    setupTestDatabase();
    app = createTestApp();
  });

  afterEach(() => {
    teardownTestDatabase();
    vi.clearAllMocks();
  });

  describe('GET /api/web3/chains', () => {
    it('should return supported chains', async () => {
      const res = await request(app).get('/api/web3/chains');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.data.length).toBeGreaterThan(0);

      // Check chain structure
      const chain = res.body.data[0];
      expect(chain).toHaveProperty('chainId');
      expect(chain).toHaveProperty('name');
      expect(chain).toHaveProperty('blockExplorer');
      expect(chain).toHaveProperty('nativeCurrency');
      // Should not expose RPC URLs
      expect(chain).not.toHaveProperty('rpcUrl');
      expect(chain).not.toHaveProperty('rpcUrls');
    });
  });

  describe('GET /api/web3/health', () => {
    it('should return chain health status', async () => {
      const res = await request(app).get('/api/web3/health');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('overall');
      expect(res.body.data).toHaveProperty('chains');
      expect(res.body.data).toHaveProperty('pooledClients');
    });
  });

  describe('POST /api/web3/verify-ownership', () => {
    it('should verify ERC20 token ownership', async () => {
      const res = await request(app)
        .post('/api/web3/verify-ownership')
        .send({
          chainId: 1,
          walletAddress: VALID_WALLET,
          contractAddress: VALID_ADDRESS,
          contractType: 'erc20',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('owns');
      expect(res.body.data).toHaveProperty('balance');
      expect(res.body.data).toHaveProperty('meetsMinimum');
    });

    it('should verify ERC721 NFT ownership', async () => {
      const res = await request(app)
        .post('/api/web3/verify-ownership')
        .send({
          chainId: 1,
          walletAddress: VALID_WALLET,
          contractAddress: VALID_ADDRESS,
          contractType: 'erc721',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.owns).toBe(true);
      expect(res.body.data.tokenIds).toBeInstanceOf(Array);
    });

    it('should verify ERC1155 balance', async () => {
      const res = await request(app)
        .post('/api/web3/verify-ownership')
        .send({
          chainId: 1,
          walletAddress: VALID_WALLET,
          contractAddress: VALID_ADDRESS,
          tokenId: '1',
          contractType: 'erc1155',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.owns).toBe(true);
    });
  });

  describe('GET /api/web3/token/:chainId/:address', () => {
    it('should return token metadata', async () => {
      const res = await request(app).get(`/api/web3/token/1/${VALID_ADDRESS}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('chainId', 1);
      expect(res.body.data).toHaveProperty('type', 'erc20');
      expect(res.body.cache).toBeDefined();
    });
  });

  describe('GET /api/web3/nft/:chainId/:address', () => {
    it('should return NFT collection metadata', async () => {
      const res = await request(app).get(`/api/web3/nft/1/${VALID_ADDRESS}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('chainId', 1);
      expect(res.body.data).toHaveProperty('interfaces');
    });
  });

  describe('POST /api/web3/read', () => {
    it('should read contract data', async () => {
      const res = await request(app)
        .post('/api/web3/read')
        .send({
          chainId: 1,
          address: VALID_ADDRESS,
          functionName: 'balanceOf',
          args: [VALID_WALLET],
          abi: validErc20Abi,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('success');
      expect(res.body.meta).toHaveProperty('chainId', 1);
      expect(res.body.meta).toHaveProperty('functionName', 'balanceOf');
    });
  });
});
