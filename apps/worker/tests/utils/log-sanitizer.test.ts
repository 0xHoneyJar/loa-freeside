/**
 * Tests for log sanitization utilities
 *
 * Sprint SEC-2: Input Validation & Log Sanitization
 * Finding M-3: Sensitive data in logs
 * Finding M-5: Internal error details leaked
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  hashId,
  redact,
  truncate,
  logSerializers,
  sanitizeError,
  sanitizeLogObject,
} from '../../src/utils/log-sanitizer.js';

describe('Log Sanitization Utilities', () => {
  describe('hashId', () => {
    it('should hash an ID with prefix preserved', () => {
      const result = hashId('123456789012345678');
      expect(result).toMatch(/^1234\.\.\.[\da-f]{8}$/);
    });

    it('should return consistent hash for same input', () => {
      const result1 = hashId('123456789012345678');
      const result2 = hashId('123456789012345678');
      expect(result1).toBe(result2);
    });

    it('should return different hashes for different inputs', () => {
      const result1 = hashId('123456789012345678');
      const result2 = hashId('987654321098765432');
      expect(result1).not.toBe(result2);
    });

    it('should return null for null input', () => {
      expect(hashId(null)).toBeNull();
    });

    it('should return null for undefined input', () => {
      expect(hashId(undefined)).toBeNull();
    });

    it('should return null for non-string input', () => {
      expect(hashId(123 as unknown as string)).toBeNull();
    });
  });

  describe('redact', () => {
    it('should return [REDACTED]', () => {
      expect(redact()).toBe('[REDACTED]');
    });
  });

  describe('truncate', () => {
    it('should not truncate short strings', () => {
      const result = truncate('hello', 100);
      expect(result).toBe('hello');
    });

    it('should truncate long strings', () => {
      const longString = 'a'.repeat(150);
      const result = truncate(longString, 100);
      expect(result).toBe('a'.repeat(100) + '...[truncated]');
    });

    it('should use default max length of 100', () => {
      const longString = 'a'.repeat(150);
      const result = truncate(longString);
      expect(result?.length).toBeLessThan(150);
    });

    it('should return null for null input', () => {
      expect(truncate(null)).toBeNull();
    });

    it('should return null for non-string input', () => {
      expect(truncate(123 as unknown as string)).toBeNull();
    });
  });

  describe('logSerializers', () => {
    describe('userId serializer', () => {
      it('should hash user ID', () => {
        const result = logSerializers.userId('123456789012345678');
        expect(result).toMatch(/^1234\.\.\.[\da-f]{8}$/);
      });
    });

    describe('guildId serializer', () => {
      it('should hash guild ID', () => {
        const result = logSerializers.guildId('123456789012345678');
        expect(result).toMatch(/^1234\.\.\.[\da-f]{8}$/);
      });
    });

    describe('token serializers', () => {
      it('should redact token', () => {
        expect(logSerializers.token()).toBe('[REDACTED]');
      });

      it('should redact interactionToken', () => {
        expect(logSerializers.interactionToken()).toBe('[REDACTED]');
      });

      it('should redact apiKey', () => {
        expect(logSerializers.apiKey()).toBe('[REDACTED]');
      });

      it('should redact password', () => {
        expect(logSerializers.password()).toBe('[REDACTED]');
      });
    });

    describe('walletAddress serializer', () => {
      it('should partially mask wallet address', () => {
        const result = logSerializers.walletAddress('0x1234567890abcdef1234567890abcdef12345678');
        expect(result).toBe('0x1234...5678');
      });

      it('should hash short addresses', () => {
        const result = logSerializers.walletAddress('short');
        expect(result).toMatch(/^shor\.\.\.[\da-f]{8}$/);
      });

      it('should return null for null input', () => {
        expect(logSerializers.walletAddress(null)).toBeNull();
      });
    });

    describe('error serializer', () => {
      it('should sanitize Error objects', () => {
        const error = new Error('Something went wrong');
        const result = logSerializers.error(error);
        expect(result).toHaveProperty('name', 'Error');
        expect(result).toHaveProperty('message', 'Something went wrong');
      });

      it('should sanitize errors with code', () => {
        const error = new Error('Connection failed') as Error & { code: string };
        error.code = 'ECONNREFUSED';
        const result = logSerializers.error(error);
        expect(result).toHaveProperty('code', 'ECONNREFUSED');
      });
    });

    describe('payload serializer', () => {
      it('should truncate string payloads', () => {
        const longPayload = 'a'.repeat(300);
        const result = logSerializers.payload(longPayload);
        expect(typeof result).toBe('string');
        expect((result as string).length).toBeLessThan(300);
      });

      it('should return [object] for objects', () => {
        const result = logSerializers.payload({ key: 'value' });
        expect(result).toBe('[object]');
      });

      it('should return primitives as-is', () => {
        expect(logSerializers.payload(123)).toBe(123);
        expect(logSerializers.payload(true)).toBe(true);
      });
    });

    describe('content serializer', () => {
      it('should truncate message content', () => {
        const longContent = 'a'.repeat(100);
        const result = logSerializers.content(longContent);
        expect(typeof result).toBe('string');
        expect((result as string).length).toBeLessThan(100);
      });

      it('should return null for null input', () => {
        expect(logSerializers.content(null)).toBeNull();
      });
    });
  });

  describe('sanitizeError', () => {
    const originalEnv = process.env['NODE_ENV'];

    beforeEach(() => {
      process.env['NODE_ENV'] = 'production';
    });

    afterEach(() => {
      process.env['NODE_ENV'] = originalEnv;
    });

    it('should extract safe properties from Error', () => {
      const error = new Error('Test error');
      const result = sanitizeError(error);
      expect(result).toEqual({
        name: 'Error',
        message: 'Test error',
      });
    });

    it('should include error code if present', () => {
      const error = new Error('Connection error') as Error & { code: string };
      error.code = 'ECONNREFUSED';
      const result = sanitizeError(error);
      expect(result?.['code']).toBe('ECONNREFUSED');
    });

    it('should include HTTP status if present', () => {
      const error = new Error('Not found') as Error & { status: number };
      error.status = 404;
      const result = sanitizeError(error);
      expect(result?.['status']).toBe(404);
    });

    it('should redact file paths from error messages', () => {
      const error = new Error('Cannot read file /home/user/secrets.txt');
      const result = sanitizeError(error);
      expect(result?.['message']).toBe('Cannot read file [REDACTED]');
    });

    it('should redact connection strings', () => {
      const error = new Error('Failed to connect to postgres://user:pass@host/db');
      const result = sanitizeError(error);
      expect(result?.['message']).not.toContain('user:pass');
      expect(result?.['message']).toContain('[REDACTED]');
    });

    it('should redact Bearer tokens', () => {
      const error = new Error('Auth failed: Bearer eyJhbGciOiJIUzI1NiJ9.token');
      const result = sanitizeError(error);
      expect(result?.['message']).toContain('[REDACTED]');
      expect(result?.['message']).not.toContain('eyJ');
    });

    it('should redact IP addresses', () => {
      const error = new Error('Connection from 192.168.1.1 refused');
      const result = sanitizeError(error);
      expect(result?.['message']).toContain('[REDACTED]');
      expect(result?.['message']).not.toContain('192.168.1.1');
    });

    it('should handle string errors', () => {
      const result = sanitizeError('Simple error message');
      expect(result).toEqual({
        message: 'Simple error message',
      });
    });

    it('should handle object errors', () => {
      const result = sanitizeError({ message: 'Object error', code: 500 });
      expect(result).toEqual({
        message: 'Object error',
        code: 500,
      });
    });

    it('should return null for null error', () => {
      expect(sanitizeError(null)).toBeNull();
    });

    it('should handle unknown error types', () => {
      const result = sanitizeError(123);
      expect(result).toEqual({ type: 'number' });
    });

    it('should not include stack in production', () => {
      const error = new Error('Test');
      const result = sanitizeError(error);
      expect(result).not.toHaveProperty('stack');
    });

    it('should include sanitized stack in development', () => {
      process.env['NODE_ENV'] = 'development';
      const error = new Error('Test');
      const result = sanitizeError(error);
      expect(result).toHaveProperty('stack');
      // Stack should not contain home directory
      expect(result?.['stack']).not.toMatch(/\/home\/[^/]+\//);
    });

    it('should truncate long error messages', () => {
      const longMessage = 'a'.repeat(600);
      const error = new Error(longMessage);
      const result = sanitizeError(error);
      expect((result?.['message'] as string).length).toBeLessThan(600);
      expect(result?.['message']).toContain('[truncated]');
    });
  });

  describe('sanitizeLogObject', () => {
    it('should apply serializers to known fields', () => {
      const obj = {
        userId: '123456789012345678',
        guildId: '987654321098765432',
        message: 'Test',
      };
      const result = sanitizeLogObject(obj);
      expect(result.userId).toMatch(/^1234\.\.\.[\da-f]{8}$/);
      expect(result.guildId).toMatch(/^9876\.\.\.[\da-f]{8}$/);
      expect(result.message).toBe('Test');
    });

    it('should redact fields containing "token"', () => {
      const obj = {
        accessToken: 'secret123',
        refreshToken: 'secret456',
      };
      const result = sanitizeLogObject(obj);
      expect(result.accessToken).toBe('[REDACTED]');
      expect(result.refreshToken).toBe('[REDACTED]');
    });

    it('should redact fields containing "secret"', () => {
      const obj = {
        clientSecret: 'supersecret',
        secretKey: 'topsecret',
      };
      const result = sanitizeLogObject(obj);
      expect(result.clientSecret).toBe('[REDACTED]');
      expect(result.secretKey).toBe('[REDACTED]');
    });

    it('should redact fields containing "password"', () => {
      const obj = {
        password: 'pass123',
        dbPassword: 'dbpass',
      };
      const result = sanitizeLogObject(obj);
      expect(result.password).toBe('[REDACTED]');
      expect(result.dbPassword).toBe('[REDACTED]');
    });

    it('should preserve non-sensitive fields', () => {
      const obj = {
        action: 'login',
        timestamp: 1234567890,
        success: true,
      };
      const result = sanitizeLogObject(obj);
      expect(result).toEqual(obj);
    });
  });
});
