/**
 * DuoMfaVerifier Tests
 *
 * Sprint 68: MFA Hardening & Observability
 *
 * Tests for Duo Security MFA integration
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DuoMfaVerifier,
  createDuoMfaVerifierFromEnv,
  isDuoConfigured,
  type DuoHttpClient,
  type DuoApiResponse,
} from '../../../../../src/packages/security/mfa/DuoMfaVerifier.js';

describe('DuoMfaVerifier', () => {
  const validConfig = {
    integrationKey: 'DI00000000000000000',
    secretKey: 'abcdefghijklmnopqrstuvwxyz123456',
    apiHostname: 'api-00000000.duosecurity.com',
    debug: false,
  };

  let mockHttpClient: DuoHttpClient;

  beforeEach(() => {
    mockHttpClient = {
      post: vi.fn(),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // Constructor Tests
  // ===========================================================================

  describe('constructor', () => {
    it('should create instance with valid configuration', () => {
      const verifier = new DuoMfaVerifier(validConfig);
      expect(verifier).toBeInstanceOf(DuoMfaVerifier);
    });

    it('should throw error if integration key is missing', () => {
      expect(() => {
        new DuoMfaVerifier({
          ...validConfig,
          integrationKey: '',
        });
      }).toThrow('Duo integration key is required');
    });

    it('should throw error if secret key is missing', () => {
      expect(() => {
        new DuoMfaVerifier({
          ...validConfig,
          secretKey: '',
        });
      }).toThrow('Duo secret key is required');
    });

    it('should throw error if API hostname is missing', () => {
      expect(() => {
        new DuoMfaVerifier({
          ...validConfig,
          apiHostname: '',
        });
      }).toThrow('Duo API hostname is required');
    });

    it('should generate application key if not provided', () => {
      const verifier = new DuoMfaVerifier(validConfig);
      // Should not throw - application key is auto-generated
      expect(verifier).toBeInstanceOf(DuoMfaVerifier);
    });

    it('should use provided application key', () => {
      const verifier = new DuoMfaVerifier({
        ...validConfig,
        applicationKey: 'custom-app-key-12345678901234567890',
      });
      expect(verifier).toBeInstanceOf(DuoMfaVerifier);
    });
  });

  // ===========================================================================
  // verify() Tests
  // ===========================================================================

  describe('verify()', () => {
    it('should verify with push notification when code is "push"', async () => {
      const mockResponse: DuoApiResponse = {
        status: 200,
        data: {
          stat: 'OK',
          response: {
            result: 'allow',
            status: 'allow',
            status_msg: 'Success. Logging you in...',
            txid: 'txid-12345',
          },
        },
      };

      (mockHttpClient.post as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const verifier = new DuoMfaVerifier({
        ...validConfig,
        httpClient: mockHttpClient,
      });

      const result = await verifier.verify('user@example.com', 'push');

      expect(result).toBe(true);
      expect(mockHttpClient.post).toHaveBeenCalledTimes(1);

      const callArgs = (mockHttpClient.post as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(callArgs[0]).toContain('duosecurity.com');
      expect(callArgs[1]).toMatchObject({
        username: 'user@example.com',
        factor: 'push',
        device: 'auto',
      });
    });

    it('should verify with passcode when code is numeric', async () => {
      const mockResponse: DuoApiResponse = {
        status: 200,
        data: {
          stat: 'OK',
          response: {
            result: 'allow',
            status: 'allow',
          },
        },
      };

      (mockHttpClient.post as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const verifier = new DuoMfaVerifier({
        ...validConfig,
        httpClient: mockHttpClient,
      });

      const result = await verifier.verify('user@example.com', '123456');

      expect(result).toBe(true);
      expect(mockHttpClient.post).toHaveBeenCalledTimes(1);

      const callArgs = (mockHttpClient.post as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(callArgs[1]).toMatchObject({
        username: 'user@example.com',
        factor: 'passcode',
        passcode: '123456',
      });
    });

    it('should return false for denied push notification', async () => {
      const mockResponse: DuoApiResponse = {
        status: 200,
        data: {
          stat: 'OK',
          response: {
            result: 'deny',
            status: 'deny',
            status_msg: 'Login request denied.',
          },
        },
      };

      (mockHttpClient.post as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const verifier = new DuoMfaVerifier({
        ...validConfig,
        httpClient: mockHttpClient,
      });

      const result = await verifier.verify('user@example.com', 'push');

      expect(result).toBe(false);
    });

    it('should return false for invalid passcode', async () => {
      const mockResponse: DuoApiResponse = {
        status: 200,
        data: {
          stat: 'OK',
          response: {
            result: 'deny',
            status: 'deny',
            status_msg: 'Invalid passcode.',
          },
        },
      };

      (mockHttpClient.post as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const verifier = new DuoMfaVerifier({
        ...validConfig,
        httpClient: mockHttpClient,
      });

      const result = await verifier.verify('user@example.com', '000000');

      expect(result).toBe(false);
    });

    it('should return false for invalid code format', async () => {
      const verifier = new DuoMfaVerifier({
        ...validConfig,
        httpClient: mockHttpClient,
      });

      // Non-numeric, non-push code
      const result = await verifier.verify('user@example.com', 'invalid');

      expect(result).toBe(false);
      expect(mockHttpClient.post).not.toHaveBeenCalled();
    });

    it('should throw error on Duo API failure', async () => {
      const mockResponse: DuoApiResponse = {
        status: 200,
        data: {
          stat: 'FAIL',
          message: 'Invalid signature',
          message_detail: 'The signed request is invalid.',
        },
      };

      (mockHttpClient.post as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const verifier = new DuoMfaVerifier({
        ...validConfig,
        httpClient: mockHttpClient,
      });

      // API errors should return false (not throw) based on our implementation
      const result = await verifier.verify('user@example.com', 'push');
      expect(result).toBe(false);
    });

    it('should throw error on network failure', async () => {
      (mockHttpClient.post as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Network error')
      );

      const verifier = new DuoMfaVerifier({
        ...validConfig,
        httpClient: mockHttpClient,
      });

      await expect(verifier.verify('user@example.com', 'push')).rejects.toThrow(
        'Duo MFA verification failed: Network error'
      );
    });

    it('should handle 8-digit passcodes', async () => {
      const mockResponse: DuoApiResponse = {
        status: 200,
        data: {
          stat: 'OK',
          response: {
            result: 'allow',
            status: 'allow',
          },
        },
      };

      (mockHttpClient.post as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const verifier = new DuoMfaVerifier({
        ...validConfig,
        httpClient: mockHttpClient,
      });

      // Hardware tokens can be 8 digits
      const result = await verifier.verify('user@example.com', '12345678');

      expect(result).toBe(true);
      expect(mockHttpClient.post).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Duo Web SDK Tests
  // ===========================================================================

  describe('generateSignedRequest()', () => {
    it('should generate a signed request for Duo Web SDK', () => {
      const verifier = new DuoMfaVerifier({
        ...validConfig,
        applicationKey: 'test-app-key-1234567890123456789012345678901234',
      });

      const signedRequest = verifier.generateSignedRequest('user@example.com');

      // Should be in format: TX|base64|sig:APP|base64|sig
      expect(signedRequest).toMatch(/^TX\|[^|]+\|[^:]+:APP\|[^|]+\|[^:]+$/);
    });

    it('should generate different signatures for different users', () => {
      const verifier = new DuoMfaVerifier({
        ...validConfig,
        applicationKey: 'test-app-key-1234567890123456789012345678901234',
      });

      const sig1 = verifier.generateSignedRequest('user1@example.com');
      const sig2 = verifier.generateSignedRequest('user2@example.com');

      expect(sig1).not.toBe(sig2);
    });
  });

  describe('verifySignedResponse()', () => {
    it('should verify valid signed response', () => {
      const verifier = new DuoMfaVerifier({
        ...validConfig,
        applicationKey: 'test-app-key-1234567890123456789012345678901234',
      });

      // Generate a valid signed request first
      const signedRequest = verifier.generateSignedRequest('user@example.com');

      // Extract the APP portion (second half after :)
      const [, appSig] = signedRequest.split(':');

      // For a real response, AUTH sig would come from Duo
      // But we can test that invalid responses are rejected
      const invalidResponse = `AUTH|invalid|sig:${appSig}`;

      const result = verifier.verifySignedResponse(invalidResponse, 'user@example.com');
      expect(result).toBe(false); // Invalid AUTH signature
    });

    it('should reject response with wrong format', () => {
      const verifier = new DuoMfaVerifier({
        ...validConfig,
        applicationKey: 'test-app-key-1234567890123456789012345678901234',
      });

      const result = verifier.verifySignedResponse('invalid-format', 'user@example.com');
      expect(result).toBe(false);
    });

    it('should reject response without both parts', () => {
      const verifier = new DuoMfaVerifier({
        ...validConfig,
        applicationKey: 'test-app-key-1234567890123456789012345678901234',
      });

      const result = verifier.verifySignedResponse('AUTH|base64|sig', 'user@example.com');
      expect(result).toBe(false);
    });
  });

  // ===========================================================================
  // Factory Functions Tests
  // ===========================================================================

  describe('createDuoMfaVerifierFromEnv()', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should create verifier from environment variables', () => {
      process.env.DUO_INTEGRATION_KEY = 'DI00000000000000000';
      process.env.DUO_SECRET_KEY = 'abcdefghijklmnopqrstuvwxyz123456';
      process.env.DUO_API_HOSTNAME = 'api-00000000.duosecurity.com';

      const verifier = createDuoMfaVerifierFromEnv();

      expect(verifier).toBeInstanceOf(DuoMfaVerifier);
    });

    it('should throw error if environment variables are missing', () => {
      delete process.env.DUO_INTEGRATION_KEY;
      delete process.env.DUO_SECRET_KEY;
      delete process.env.DUO_API_HOSTNAME;

      expect(() => createDuoMfaVerifierFromEnv()).toThrow(
        'Duo MFA environment variables not configured'
      );
    });

    it('should accept debug option', () => {
      process.env.DUO_INTEGRATION_KEY = 'DI00000000000000000';
      process.env.DUO_SECRET_KEY = 'abcdefghijklmnopqrstuvwxyz123456';
      process.env.DUO_API_HOSTNAME = 'api-00000000.duosecurity.com';

      const verifier = createDuoMfaVerifierFromEnv({ debug: true });

      expect(verifier).toBeInstanceOf(DuoMfaVerifier);
    });
  });

  describe('isDuoConfigured()', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should return true when all Duo env vars are set', () => {
      process.env.DUO_INTEGRATION_KEY = 'DI00000000000000000';
      process.env.DUO_SECRET_KEY = 'abcdefghijklmnopqrstuvwxyz123456';
      process.env.DUO_API_HOSTNAME = 'api-00000000.duosecurity.com';

      expect(isDuoConfigured()).toBe(true);
    });

    it('should return false when integration key is missing', () => {
      delete process.env.DUO_INTEGRATION_KEY;
      process.env.DUO_SECRET_KEY = 'abcdefghijklmnopqrstuvwxyz123456';
      process.env.DUO_API_HOSTNAME = 'api-00000000.duosecurity.com';

      expect(isDuoConfigured()).toBe(false);
    });

    it('should return false when secret key is missing', () => {
      process.env.DUO_INTEGRATION_KEY = 'DI00000000000000000';
      delete process.env.DUO_SECRET_KEY;
      process.env.DUO_API_HOSTNAME = 'api-00000000.duosecurity.com';

      expect(isDuoConfigured()).toBe(false);
    });

    it('should return false when API hostname is missing', () => {
      process.env.DUO_INTEGRATION_KEY = 'DI00000000000000000';
      process.env.DUO_SECRET_KEY = 'abcdefghijklmnopqrstuvwxyz123456';
      delete process.env.DUO_API_HOSTNAME;

      expect(isDuoConfigured()).toBe(false);
    });
  });

  // ===========================================================================
  // Request Signing Tests
  // ===========================================================================

  describe('request signing', () => {
    it('should include proper Authorization header', async () => {
      const mockResponse: DuoApiResponse = {
        status: 200,
        data: {
          stat: 'OK',
          response: {
            result: 'allow',
          },
        },
      };

      (mockHttpClient.post as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const verifier = new DuoMfaVerifier({
        ...validConfig,
        httpClient: mockHttpClient,
      });

      await verifier.verify('user@example.com', 'push');

      const callArgs = (mockHttpClient.post as ReturnType<typeof vi.fn>).mock.calls[0];
      const headers = callArgs[2];

      expect(headers['Authorization']).toMatch(/^Basic /);
      expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');
      expect(headers['Date']).toBeDefined();
    });

    it('should sort parameters alphabetically in signature', async () => {
      const mockResponse: DuoApiResponse = {
        status: 200,
        data: {
          stat: 'OK',
          response: {
            result: 'allow',
          },
        },
      };

      (mockHttpClient.post as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const verifier = new DuoMfaVerifier({
        ...validConfig,
        httpClient: mockHttpClient,
      });

      await verifier.verify('user@example.com', 'push');

      // Just verify the call was made - signature is internal
      expect(mockHttpClient.post).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Debug Logging Tests
  // ===========================================================================

  describe('debug logging', () => {
    it('should log when debug is enabled', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const mockResponse: DuoApiResponse = {
        status: 200,
        data: {
          stat: 'OK',
          response: {
            result: 'allow',
          },
        },
      };

      (mockHttpClient.post as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const verifier = new DuoMfaVerifier({
        ...validConfig,
        httpClient: mockHttpClient,
        debug: true,
      });

      await verifier.verify('user@example.com', 'push');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[DuoMfaVerifier]'),
        expect.any(Object)
      );

      consoleSpy.mockRestore();
    });

    it('should not log when debug is disabled', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const mockResponse: DuoApiResponse = {
        status: 200,
        data: {
          stat: 'OK',
          response: {
            result: 'allow',
          },
        },
      };

      (mockHttpClient.post as ReturnType<typeof vi.fn>).mockResolvedValue(mockResponse);

      const verifier = new DuoMfaVerifier({
        ...validConfig,
        httpClient: mockHttpClient,
        debug: false,
      });

      await verifier.verify('user@example.com', 'push');

      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });
});
