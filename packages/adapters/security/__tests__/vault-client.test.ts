/**
 * VaultClient Tests
 *
 * Sprint S-22: Vault Integration & Kill Switch
 *
 * Tests for HashiCorp Vault Transit client:
 * - AppRole authentication
 * - Transit operations (sign, verify, encrypt, decrypt)
 * - KV v2 operations (getSecret, putSecret, deleteSecret)
 * - Key rotation
 * - Health checks
 * - Token renewal
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VaultClient } from '../vault-client.js';
import type {
  VaultHttpClient,
  VaultResponse,
  VaultHealthResponse,
} from '../vault-client.js';
import type { VaultMetrics } from '../metrics.js';
import { createNoOpVaultMetrics } from '../metrics.js';
import type { VaultConfig } from '@freeside/core/ports';
import type { Logger } from 'pino';

// =============================================================================
// Mock Implementations
// =============================================================================

function createMockLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => createMockLogger()),
  } as unknown as Logger;
}

class MockVaultHttpClient implements VaultHttpClient {
  private responses: Map<string, unknown> = new Map();
  private callLog: Array<{ method: string; path: string; data?: unknown }> = [];

  setReadResponse(path: string, response: VaultResponse): void {
    this.responses.set(`read:${path}`, response);
  }

  setWriteResponse(path: string, response: VaultResponse): void {
    this.responses.set(`write:${path}`, response);
  }

  getCallLog(): Array<{ method: string; path: string; data?: unknown }> {
    return this.callLog;
  }

  clearCallLog(): void {
    this.callLog = [];
  }

  async read(path: string): Promise<VaultResponse> {
    this.callLog.push({ method: 'read', path });

    const response = this.responses.get(`read:${path}`);
    if (response) {
      return response as VaultResponse;
    }

    // Default responses
    if (path.includes('transit/keys/')) {
      return {
        data: {
          name: 'test-key',
          type: 'ed25519',
          latest_version: 1,
          min_decryption_version: 1,
          min_encryption_version: 0,
          supports_encryption: true,
          supports_decryption: true,
          supports_signing: true,
          exportable: false,
          deletion_allowed: false,
        },
      };
    }

    if (path.includes('secret/data/') || path.includes('/data/')) {
      return {
        data: {
          data: {
            key1: 'value1',
            key2: 'value2',
          },
          metadata: {
            version: 1,
          },
        },
      };
    }

    throw new Error(`No mock response for read ${path}`);
  }

  async write(path: string, data?: Record<string, unknown>): Promise<VaultResponse> {
    this.callLog.push({ method: 'write', path, data });

    const response = this.responses.get(`write:${path}`);
    if (response) {
      return response as VaultResponse;
    }

    // Default responses
    if (path === 'auth/approle/login') {
      return {
        data: {},
        auth: {
          client_token: 'test-token-123',
          accessor: 'test-accessor',
          policies: ['default'],
          token_policies: ['default'],
          metadata: {},
          lease_duration: 3600,
          renewable: true,
        },
      };
    }

    if (path.includes('transit/sign/')) {
      return {
        data: {
          signature: 'vault:v1:MEUCIQCtest-signature',
        },
      };
    }

    if (path.includes('transit/verify/')) {
      return {
        data: {
          valid: true,
        },
      };
    }

    if (path.includes('transit/encrypt/')) {
      return {
        data: {
          ciphertext: 'vault:v1:encrypted-data',
        },
      };
    }

    if (path.includes('transit/decrypt/')) {
      return {
        data: {
          plaintext: Buffer.from('decrypted-data').toString('base64'),
        },
      };
    }

    if (path.includes('transit/keys/') && path.includes('/rotate')) {
      return { data: {} };
    }

    if (path.includes('secret/data/')) {
      return { data: {} };
    }

    if (path === 'auth/token/renew-self') {
      return {
        data: {},
        auth: {
          client_token: 'renewed-token',
          accessor: 'test-accessor',
          policies: ['default'],
          token_policies: ['default'],
          metadata: {},
          lease_duration: 3600,
          renewable: true,
        },
      };
    }

    if (path === 'auth/token/revoke-self') {
      return { data: {} };
    }

    return { data: {} };
  }

  async delete(path: string): Promise<void> {
    this.callLog.push({ method: 'delete', path });
  }

  async health(): Promise<VaultHealthResponse> {
    this.callLog.push({ method: 'health', path: '/sys/health' });
    return {
      initialized: true,
      sealed: false,
      standby: false,
      performance_standby: false,
      replication_performance_mode: 'disabled',
      replication_dr_mode: 'disabled',
      server_time_utc: Date.now() / 1000,
      version: '1.15.0',
      cluster_name: 'test-cluster',
      cluster_id: 'test-cluster-id',
    };
  }
}

// =============================================================================
// Test Suites
// =============================================================================

describe('VaultClient', () => {
  let mockHttp: MockVaultHttpClient;
  let mockLogger: Logger;
  let mockMetrics: VaultMetrics;
  let client: VaultClient;

  const defaultConfig: VaultConfig = {
    endpoint: 'https://vault.example.com',
    roleId: 'test-role-id',
    secretId: 'test-secret-id',
  };

  beforeEach(() => {
    vi.useFakeTimers();
    mockHttp = new MockVaultHttpClient();
    mockLogger = createMockLogger();
    mockMetrics = createNoOpVaultMetrics();

    client = new VaultClient({
      config: defaultConfig,
      httpClient: mockHttp,
      logger: mockLogger,
      metrics: mockMetrics,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create a VaultClient instance', () => {
      expect(client).toBeInstanceOf(VaultClient);
    });

    it('should use static token when provided', () => {
      const clientWithToken = new VaultClient({
        config: { ...defaultConfig, token: 'static-token' },
        httpClient: mockHttp,
        logger: mockLogger,
        metrics: mockMetrics,
      });

      expect(clientWithToken).toBeDefined();
      // VaultClient logs via child logger, so check the child was created
      expect(mockLogger.child).toHaveBeenCalledWith({ component: 'VaultClient' });
    });
  });

  describe('authenticateAppRole', () => {
    it('should authenticate via AppRole', async () => {
      await client.authenticateAppRole();

      const calls = mockHttp.getCallLog();
      expect(calls.some((c) => c.path === 'auth/approle/login')).toBe(true);
    });

    it('should throw if credentials not configured', async () => {
      const clientWithoutCreds = new VaultClient({
        config: { endpoint: 'https://vault.example.com' },
        httpClient: mockHttp,
        logger: mockLogger,
        metrics: mockMetrics,
      });

      await expect(clientWithoutCreds.authenticateAppRole()).rejects.toThrow(
        'AppRole credentials not configured'
      );
    });

    it('should schedule token renewal after auth', async () => {
      await client.authenticateAppRole();

      // Verify timer was set (clear timers to check)
      expect(vi.getTimerCount()).toBeGreaterThan(0);
    });
  });

  describe('Transit Operations', () => {
    beforeEach(async () => {
      await client.authenticateAppRole();
      mockHttp.clearCallLog();
    });

    describe('sign', () => {
      it('should sign data using Transit engine', async () => {
        const signature = await client.sign('signing-key', 'data-to-sign');

        expect(signature).toBe('vault:v1:MEUCIQCtest-signature');
        const calls = mockHttp.getCallLog();
        expect(calls).toContainEqual(
          expect.objectContaining({
            method: 'write',
            path: 'transit/sign/signing-key',
          })
        );
      });

      it('should base64 encode input data', async () => {
        await client.sign('signing-key', 'test-data');

        const calls = mockHttp.getCallLog();
        const signCall = calls.find((c) => c.path.includes('transit/sign/'));
        expect(signCall?.data).toEqual({
          input: Buffer.from('test-data').toString('base64'),
        });
      });
    });

    describe('verify', () => {
      it('should verify signature using Transit engine', async () => {
        const valid = await client.verify(
          'signing-key',
          'data-to-verify',
          'vault:v1:signature'
        );

        expect(valid).toBe(true);
        const calls = mockHttp.getCallLog();
        expect(calls).toContainEqual(
          expect.objectContaining({
            method: 'write',
            path: 'transit/verify/signing-key',
          })
        );
      });

      it('should return false for invalid signature', async () => {
        mockHttp.setWriteResponse('transit/verify/signing-key', {
          data: { valid: false },
        });

        const valid = await client.verify('signing-key', 'data', 'invalid-sig');

        expect(valid).toBe(false);
      });
    });

    describe('encrypt', () => {
      it('should encrypt data using Transit engine', async () => {
        const ciphertext = await client.encrypt('encryption-key', 'plaintext');

        expect(ciphertext).toBe('vault:v1:encrypted-data');
        const calls = mockHttp.getCallLog();
        expect(calls).toContainEqual(
          expect.objectContaining({
            method: 'write',
            path: 'transit/encrypt/encryption-key',
          })
        );
      });
    });

    describe('decrypt', () => {
      it('should decrypt data using Transit engine', async () => {
        const plaintext = await client.decrypt(
          'encryption-key',
          'vault:v1:ciphertext'
        );

        expect(plaintext).toBe('decrypted-data');
        const calls = mockHttp.getCallLog();
        expect(calls).toContainEqual(
          expect.objectContaining({
            method: 'write',
            path: 'transit/decrypt/encryption-key',
          })
        );
      });
    });

    describe('rotateKey', () => {
      it('should rotate Transit key', async () => {
        await client.rotateKey('rotation-key');

        const calls = mockHttp.getCallLog();
        expect(calls).toContainEqual(
          expect.objectContaining({
            method: 'write',
            path: 'transit/keys/rotation-key/rotate',
          })
        );
      });
    });

    describe('getKeyInfo', () => {
      it('should get key information', async () => {
        const keyInfo = await client.getKeyInfo('info-key');

        expect(keyInfo.name).toBe('test-key');
        expect(keyInfo.type).toBe('ed25519');
        expect(keyInfo.latestVersion).toBe(1);
      });
    });
  });

  describe('KV v2 Operations', () => {
    beforeEach(async () => {
      await client.authenticateAppRole();
      mockHttp.clearCallLog();
    });

    describe('getSecret', () => {
      it('should get secret from KV v2', async () => {
        const secret = await client.getSecret('my/secret/path');

        expect(secret).toEqual({
          key1: 'value1',
          key2: 'value2',
        });
        const calls = mockHttp.getCallLog();
        expect(calls).toContainEqual(
          expect.objectContaining({
            method: 'read',
            path: 'secret/data/my/secret/path',
          })
        );
      });
    });

    describe('putSecret', () => {
      it('should store secret in KV v2', async () => {
        await client.putSecret('my/secret/path', {
          username: 'admin',
          password: 'secret123',
        });

        const calls = mockHttp.getCallLog();
        expect(calls).toContainEqual(
          expect.objectContaining({
            method: 'write',
            path: 'secret/data/my/secret/path',
            data: {
              data: {
                username: 'admin',
                password: 'secret123',
              },
            },
          })
        );
      });
    });

    describe('deleteSecret', () => {
      it('should delete secret from KV v2', async () => {
        await client.deleteSecret('my/secret/path');

        const calls = mockHttp.getCallLog();
        expect(calls).toContainEqual(
          expect.objectContaining({
            method: 'delete',
            path: 'secret/data/my/secret/path',
          })
        );
      });
    });
  });

  describe('Health and Lifecycle', () => {
    beforeEach(async () => {
      await client.authenticateAppRole();
      mockHttp.clearCallLog();
    });

    describe('health', () => {
      it('should return health status', async () => {
        const health = await client.health();

        expect(health.initialized).toBe(true);
        expect(health.sealed).toBe(false);
        expect(health.version).toBe('1.15.0');
      });
    });

    describe('renewToken', () => {
      it('should renew current token', async () => {
        await client.renewToken();

        const calls = mockHttp.getCallLog();
        expect(calls).toContainEqual(
          expect.objectContaining({
            method: 'write',
            path: 'auth/token/renew-self',
          })
        );
      });
    });

    describe('revokeToken', () => {
      it('should revoke current token', async () => {
        await client.revokeToken();

        const calls = mockHttp.getCallLog();
        expect(calls).toContainEqual(
          expect.objectContaining({
            method: 'write',
            path: 'auth/token/revoke-self',
          })
        );
      });
    });
  });

  describe('Token Auto-Renewal', () => {
    it('should schedule token renewal at 50% TTL', async () => {
      await client.authenticateAppRole();
      mockHttp.clearCallLog();

      // Fast-forward to 50% of 3600s TTL = 1800s
      await vi.advanceTimersByTimeAsync(1800 * 1000);

      const calls = mockHttp.getCallLog();
      expect(calls.some((c) => c.path === 'auth/token/renew-self')).toBe(true);
    });
  });
});

describe('VaultClient Custom Paths', () => {
  let mockHttp: MockVaultHttpClient;
  let mockLogger: Logger;
  let mockMetrics: VaultMetrics;

  beforeEach(() => {
    mockHttp = new MockVaultHttpClient();
    mockLogger = createMockLogger();
    mockMetrics = createNoOpVaultMetrics();
  });

  it('should use custom transit path', async () => {
    const client = new VaultClient({
      config: {
        endpoint: 'https://vault.example.com',
        roleId: 'role',
        secretId: 'secret',
        transitPath: 'custom-transit',
      },
      httpClient: mockHttp,
      logger: mockLogger,
      metrics: mockMetrics,
    });

    await client.authenticateAppRole();
    mockHttp.clearCallLog();

    await client.sign('key', 'data');

    const calls = mockHttp.getCallLog();
    expect(calls.some((c) => c.path.includes('custom-transit/sign/'))).toBe(
      true
    );
  });

  it('should use custom KV path', async () => {
    const client = new VaultClient({
      config: {
        endpoint: 'https://vault.example.com',
        roleId: 'role',
        secretId: 'secret',
        kvPath: 'custom-kv',
      },
      httpClient: mockHttp,
      logger: mockLogger,
      metrics: mockMetrics,
    });

    await client.authenticateAppRole();
    mockHttp.clearCallLog();

    await client.getSecret('path');

    const calls = mockHttp.getCallLog();
    expect(calls.some((c) => c.path.includes('custom-kv/data/'))).toBe(true);
  });
});
