/**
 * PII Scrubber Tests (Sprint 75 - MED-2)
 *
 * Tests for PII log scrubbing functionality to ensure:
 * - Wallet addresses are redacted
 * - Discord IDs are redacted
 * - Email addresses are redacted
 * - IP addresses are redacted
 * - API keys and tokens are redacted
 * - Sensitive fields are completely redacted
 */

import { describe, it, expect } from 'vitest';
import {
  PIIScrubber,
  scrubPII,
  scrubPIIObject,
  DEFAULT_PII_PATTERNS,
  DEFAULT_SENSITIVE_FIELDS,
} from '../../../../../src/packages/infrastructure/logging/pii-scrubber.js';

describe('PII Scrubber', () => {
  const scrubber = new PIIScrubber();

  // ==========================================================================
  // Ethereum Wallet Address Tests
  // ==========================================================================
  describe('Ethereum Wallet Addresses', () => {
    it('should redact valid wallet address', () => {
      const input = 'User wallet: 0x1234567890abcdef1234567890abcdef12345678';
      const result = scrubber.scrub(input);
      expect(result).toBe('User wallet: 0x[WALLET_REDACTED]');
    });

    it('should redact multiple wallet addresses', () => {
      const input = 'From 0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa to 0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
      const result = scrubber.scrub(input);
      expect(result).toBe('From 0x[WALLET_REDACTED] to 0x[WALLET_REDACTED]');
    });

    it('should redact checksummed addresses', () => {
      const input = 'Address: 0xAbCdEf1234567890AbCdEf1234567890AbCdEf12';
      const result = scrubber.scrub(input);
      expect(result).toBe('Address: 0x[WALLET_REDACTED]');
    });

    it('should not redact short hex strings', () => {
      const input = 'Version: 0x1234';
      const result = scrubber.scrub(input);
      expect(result).toBe('Version: 0x1234');
    });
  });

  // ==========================================================================
  // Discord ID Tests
  // ==========================================================================
  describe('Discord IDs', () => {
    it('should redact 18-digit Discord ID', () => {
      const input = 'User ID: 123456789012345678';
      const result = scrubber.scrub(input);
      expect(result).toBe('User ID: [DISCORD_ID]');
    });

    it('should redact 19-digit Discord ID', () => {
      const input = 'Guild ID: 1234567890123456789';
      const result = scrubber.scrub(input);
      expect(result).toBe('Guild ID: [DISCORD_ID]');
    });

    it('should redact multiple Discord IDs', () => {
      const input = 'User 123456789012345678 joined guild 987654321098765432';
      const result = scrubber.scrub(input);
      expect(result).toBe('User [DISCORD_ID] joined guild [DISCORD_ID]');
    });

    it('should not redact shorter numbers', () => {
      const input = 'Count: 12345';
      const result = scrubber.scrub(input);
      expect(result).toBe('Count: 12345');
    });
  });

  // ==========================================================================
  // Email Address Tests
  // ==========================================================================
  describe('Email Addresses', () => {
    it('should redact simple email', () => {
      const input = 'Contact: user@example.com';
      const result = scrubber.scrub(input);
      expect(result).toBe('Contact: [EMAIL_REDACTED]');
    });

    it('should redact email with subdomain', () => {
      const input = 'Email: test@mail.example.co.uk';
      const result = scrubber.scrub(input);
      expect(result).toBe('Email: [EMAIL_REDACTED]');
    });

    it('should redact email with special chars', () => {
      const input = 'Support: user.name+tag@example.org';
      const result = scrubber.scrub(input);
      expect(result).toBe('Support: [EMAIL_REDACTED]');
    });

    it('should redact multiple emails', () => {
      const input = 'From a@b.com to c@d.com';
      const result = scrubber.scrub(input);
      expect(result).toBe('From [EMAIL_REDACTED] to [EMAIL_REDACTED]');
    });
  });

  // ==========================================================================
  // IP Address Tests
  // ==========================================================================
  describe('IP Addresses', () => {
    it('should redact IPv4 address', () => {
      const input = 'Client IP: 192.168.1.100';
      const result = scrubber.scrub(input);
      expect(result).toBe('Client IP: [IP_REDACTED]');
    });

    it('should redact localhost', () => {
      const input = 'Server: 127.0.0.1';
      const result = scrubber.scrub(input);
      expect(result).toBe('Server: [IP_REDACTED]');
    });

    it('should redact public IP', () => {
      const input = 'Origin: 203.0.113.50';
      const result = scrubber.scrub(input);
      expect(result).toBe('Origin: [IP_REDACTED]');
    });

    it('should not redact invalid IP', () => {
      const input = 'Not IP: 999.999.999.999';
      const result = scrubber.scrub(input);
      expect(result).toBe('Not IP: 999.999.999.999');
    });
  });

  // ==========================================================================
  // API Key Tests
  // ==========================================================================
  describe('API Keys and Tokens', () => {
    it('should redact sk_ prefixed keys', () => {
      // Using example placeholder key
      const input = 'Key: sk_example_placeholder_keyvalue';
      const result = scrubber.scrub(input);
      expect(result).toBe('Key: [API_KEY_REDACTED]');
    });

    it('should redact pk_ prefixed keys', () => {
      // Using example placeholder key
      const input = 'Public: pk_example_placeholder_keyvalue';
      const result = scrubber.scrub(input);
      expect(result).toBe('Public: [API_KEY_REDACTED]');
    });

    it('should redact api_ prefixed keys', () => {
      const input = 'API: api_key_abcdefghij1234567890';
      const result = scrubber.scrub(input);
      expect(result).toBe('API: [API_KEY_REDACTED]');
    });

    it('should redact Bearer tokens', () => {
      const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123';
      const result = scrubber.scrub(input);
      expect(result).toBe('Authorization: Bearer [TOKEN_REDACTED]');
    });

    it('should redact standalone JWT tokens', () => {
      const input = 'Token: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123def456';
      const result = scrubber.scrub(input);
      expect(result).toBe('Token: [JWT_REDACTED]');
    });
  });

  // ==========================================================================
  // Object Scrubbing Tests
  // ==========================================================================
  describe('Object Scrubbing', () => {
    it('should scrub nested objects', () => {
      const input = {
        user: {
          wallet: '0x1234567890abcdef1234567890abcdef12345678',
          discordId: '123456789012345678',
        },
      };
      const result = scrubber.scrubObject(input);
      expect(result.user.wallet).toBe('0x[WALLET_REDACTED]');
      expect(result.user.discordId).toBe('[DISCORD_ID]');
    });

    it('should scrub arrays', () => {
      const input = {
        wallets: [
          '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        ],
      };
      const result = scrubber.scrubObject(input);
      expect(result.wallets).toEqual([
        '0x[WALLET_REDACTED]',
        '0x[WALLET_REDACTED]',
      ]);
    });

    it('should completely redact sensitive fields', () => {
      const input = {
        username: 'alice',
        password: 'secret123',
        apiKey: 'key_12345',
        token: 'abc.def.ghi',
      };
      const result = scrubber.scrubObject(input);
      expect(result.username).toBe('alice');
      expect(result.password).toBe('[REDACTED]');
      expect(result.apiKey).toBe('[REDACTED]');
      expect(result.token).toBe('[REDACTED]');
    });

    it('should not modify original object', () => {
      const input = {
        wallet: '0x1234567890abcdef1234567890abcdef12345678',
      };
      const _result = scrubber.scrubObject(input);
      expect(input.wallet).toBe('0x1234567890abcdef1234567890abcdef12345678');
    });

    it('should handle null and undefined', () => {
      const input = {
        nullField: null,
        undefinedField: undefined,
        wallet: '0x1234567890abcdef1234567890abcdef12345678',
      };
      const result = scrubber.scrubObject(input);
      expect(result.nullField).toBeNull();
      expect(result.undefinedField).toBeUndefined();
      expect(result.wallet).toBe('0x[WALLET_REDACTED]');
    });

    it('should handle numbers and booleans', () => {
      const input = {
        count: 42,
        active: true,
        wallet: '0x1234567890abcdef1234567890abcdef12345678',
      };
      const result = scrubber.scrubObject(input);
      expect(result.count).toBe(42);
      expect(result.active).toBe(true);
      expect(result.wallet).toBe('0x[WALLET_REDACTED]');
    });
  });

  // ==========================================================================
  // Scrub With Metadata Tests
  // ==========================================================================
  describe('Scrub With Metadata', () => {
    it('should return metadata about scrubbed PII', () => {
      const input = 'User 0x1234567890abcdef1234567890abcdef12345678 with email test@example.com';
      const result = scrubber.scrubWithMetadata(input);
      expect(result.scrubbed).toBe(true);
      expect(result.piiTypesFound).toContain('Ethereum wallet address');
      expect(result.piiTypesFound).toContain('Email address');
    });

    it('should return scrubbed=false for clean input', () => {
      const input = 'Hello world';
      const result = scrubber.scrubWithMetadata(input);
      expect(result.scrubbed).toBe(false);
      expect(result.piiTypesFound).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Configuration Tests
  // ==========================================================================
  describe('Configuration', () => {
    it('should respect enabled=false', () => {
      const disabledScrubber = new PIIScrubber({ enabled: false });
      const input = '0x1234567890abcdef1234567890abcdef12345678';
      const result = disabledScrubber.scrub(input);
      expect(result).toBe(input);
    });

    it('should support custom patterns', () => {
      const customScrubber = new PIIScrubber({
        customPatterns: [
          {
            pattern: /secret-\d{4}/g,
            replacement: '[SECRET]',
            description: 'Custom secret',
          },
        ],
      });
      const input = 'Code: secret-1234';
      const result = customScrubber.scrub(input);
      expect(result).toBe('Code: [SECRET]');
    });

    it('should support custom sensitive fields', () => {
      const customScrubber = new PIIScrubber({
        sensitiveFields: ['customSecret'],
      });
      const input = { customSecret: 'value123' };
      const result = customScrubber.scrubObject(input);
      expect(result.customSecret).toBe('[REDACTED]');
    });
  });

  // ==========================================================================
  // Convenience Function Tests
  // ==========================================================================
  describe('Convenience Functions', () => {
    it('scrubPII should use default scrubber', () => {
      const result = scrubPII('Wallet: 0x1234567890abcdef1234567890abcdef12345678');
      expect(result).toBe('Wallet: 0x[WALLET_REDACTED]');
    });

    it('scrubPIIObject should use default scrubber', () => {
      const result = scrubPIIObject({ email: 'test@example.com' });
      expect(result.email).toBe('[EMAIL_REDACTED]');
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================
  describe('Edge Cases', () => {
    it('should handle empty string', () => {
      expect(scrubber.scrub('')).toBe('');
    });

    it('should handle string with only PII', () => {
      expect(scrubber.scrub('0x1234567890abcdef1234567890abcdef12345678')).toBe('0x[WALLET_REDACTED]');
    });

    it('should handle deeply nested objects', () => {
      const input = {
        level1: {
          level2: {
            level3: {
              wallet: '0x1234567890abcdef1234567890abcdef12345678',
            },
          },
        },
      };
      const result = scrubber.scrubObject(input);
      expect(result.level1.level2.level3.wallet).toBe('0x[WALLET_REDACTED]');
    });

    it('should handle mixed arrays', () => {
      const input = {
        items: [
          'text',
          '0x1234567890abcdef1234567890abcdef12345678',
          123,
          { nested: 'test@example.com' },
        ],
      };
      const result = scrubber.scrubObject(input);
      expect(result.items[0]).toBe('text');
      expect(result.items[1]).toBe('0x[WALLET_REDACTED]');
      expect(result.items[2]).toBe(123);
      expect((result.items[3] as { nested: string }).nested).toBe('[EMAIL_REDACTED]');
    });
  });

  // ==========================================================================
  // Default Constants Tests
  // ==========================================================================
  describe('Default Constants', () => {
    it('should have expected number of default patterns', () => {
      // 8 patterns: wallet, discord, email, ipv4, ipv6, api key, bearer, jwt
      expect(DEFAULT_PII_PATTERNS.length).toBe(8);
    });

    it('should include common sensitive fields', () => {
      expect(DEFAULT_SENSITIVE_FIELDS).toContain('password');
      expect(DEFAULT_SENSITIVE_FIELDS).toContain('secret');
      expect(DEFAULT_SENSITIVE_FIELDS).toContain('token');
      expect(DEFAULT_SENSITIVE_FIELDS).toContain('apiKey');
      expect(DEFAULT_SENSITIVE_FIELDS).toContain('privateKey');
    });
  });
});
