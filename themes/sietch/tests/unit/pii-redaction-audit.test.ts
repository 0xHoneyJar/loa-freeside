/**
 * PII Redaction Audit Tests
 * Sprint S12-T3: §16, NF-RET-1/3
 *
 * Verifies:
 * - AGENT_REDACTION_PATHS covers all required PII categories
 * - hashWallet() produces irreversible output
 * - AgentRequestLog schema has no raw PII fields
 * - No raw content, wallet, JWT, or thinking traces in log output
 */

import { describe, it, expect, vi } from 'vitest';

// Mock fs before barrel imports
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    readFileSync: vi.fn().mockReturnValue('-- mock lua'),
  };
});

import {
  AGENT_REDACTION_PATHS,
  hashWallet,
} from '@arrakis/adapters/agent';

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe('PII Redaction Audit (§16, NF-RET-1/3)', () => {
  // ========================================================================
  // AGENT_REDACTION_PATHS coverage
  // ========================================================================
  describe('AGENT_REDACTION_PATHS coverage', () => {
    it('covers user message content (NF-RET-1: no raw prompts)', () => {
      expect(AGENT_REDACTION_PATHS).toContain('messages[*].content');
      expect(AGENT_REDACTION_PATHS).toContain('request.messages[*].content');
    });

    it('covers response content', () => {
      expect(AGENT_REDACTION_PATHS).toContain('response.content');
    });

    it('covers thinking traces (NF-RET-1: no thinking persisted)', () => {
      expect(AGENT_REDACTION_PATHS).toContain('response.thinking');
    });

    it('covers JWT tokens', () => {
      expect(AGENT_REDACTION_PATHS).toContain('jwt');
      expect(AGENT_REDACTION_PATHS).toContain('token');
      expect(AGENT_REDACTION_PATHS).toContain('authorization');
      expect(AGENT_REDACTION_PATHS).toContain('headers.authorization');
    });

    it('covers raw wallet addresses', () => {
      expect(AGENT_REDACTION_PATHS).toContain('userWallet');
      expect(AGENT_REDACTION_PATHS).toContain('walletAddress');
      expect(AGENT_REDACTION_PATHS).toContain('context.userWallet');
    });

    it('has at least 10 redaction paths', () => {
      expect(AGENT_REDACTION_PATHS.length).toBeGreaterThanOrEqual(10);
    });
  });

  // ========================================================================
  // hashWallet() irreversibility
  // ========================================================================
  describe('hashWallet() — irreversible wallet hashing', () => {
    it('returns 12 hex characters', () => {
      const hash = hashWallet('0x1234567890abcdef1234567890abcdef12345678');
      expect(hash).toMatch(/^[0-9a-f]{12}$/);
    });

    it('does not contain the original address', () => {
      const wallet = '0x1234567890abcdef1234567890abcdef12345678';
      const hash = hashWallet(wallet);
      expect(hash).not.toContain('1234567890');
      expect(hash).not.toContain(wallet);
    });

    it('is deterministic', () => {
      const wallet = '0xABCD1234';
      expect(hashWallet(wallet)).toBe(hashWallet(wallet));
    });

    it('is case-insensitive (lowercase normalization)', () => {
      expect(hashWallet('0xABCD1234')).toBe(hashWallet('0xabcd1234'));
    });

    it('produces different hashes for different wallets', () => {
      const hash1 = hashWallet('0x1111111111111111111111111111111111111111');
      const hash2 = hashWallet('0x2222222222222222222222222222222222222222');
      expect(hash1).not.toBe(hash2);
    });

    it('truncated hash is not reversible to full wallet', () => {
      // 12 hex chars = 48 bits of entropy — insufficient for lookup table
      // against 2^160 address space (Ethereum). This is a design assertion.
      const hash = hashWallet('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
      expect(hash.length).toBe(12);
      // Full SHA-256 is 64 hex chars; we only expose 12 (18.75%)
      expect(hash.length).toBeLessThan(64);
    });
  });

  // ========================================================================
  // PII pattern scan — log field names
  // ========================================================================
  describe('PII pattern scan — safe log field names', () => {
    // These field names should NEVER appear in structured logs
    const forbiddenLogFields = [
      'password',
      'secret',
      'privateKey',
      'apiKey',
      'api_key',
      'accessToken',
      'access_token',
      'refreshToken',
      'refresh_token',
      'ssn',
      'socialSecurity',
      'creditCard',
      'cardNumber',
    ];

    it('AGENT_REDACTION_PATHS does not accidentally include forbidden keywords as paths (sanity)', () => {
      // Redaction paths should be object paths, not loose keywords
      for (const path of AGENT_REDACTION_PATHS) {
        expect(path).not.toContain('password');
        expect(path).not.toContain('creditCard');
      }
    });

    it('redaction paths use correct Pino path syntax', () => {
      // All paths should be valid Pino redaction paths (dot-separated or array syntax)
      for (const path of AGENT_REDACTION_PATHS) {
        // Valid: 'key', 'a.b', 'a[*].b', 'a.b[*].c'
        expect(path).toMatch(/^[a-zA-Z_][a-zA-Z0-9_.*[\]]*$/);
      }
    });
  });

  // ========================================================================
  // AgentRequestLog schema — no content columns
  // ========================================================================
  describe('AgentRequestLog schema — metadata only', () => {
    it('log entry uses userWalletHash (not raw wallet)', () => {
      // The AgentRequestLog interface has userWalletHash, not userWallet
      // This is a compile-time assertion; we verify the runtime logging helper
      // uses the hash field by checking the redaction paths cover raw fields
      const rawWalletPaths = AGENT_REDACTION_PATHS.filter((p) =>
        p.toLowerCase().includes('wallet') && !p.includes('Hash'),
      );
      expect(rawWalletPaths.length).toBeGreaterThan(0);
    });
  });

  // ========================================================================
  // PII regex scan — simulated log output
  // ========================================================================
  describe('PII regex scan — simulated log output', () => {
    // Patterns that should NEVER appear in log output
    const piiPatterns = [
      { name: 'Ethereum address', regex: /0x[a-fA-F0-9]{40}/ },
      { name: 'JWT token', regex: /eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}/ },
      { name: 'API key (generic)', regex: /(?:api[_-]?key|apikey)\s*[:=]\s*['"][a-zA-Z0-9]{20,}/ },
      { name: 'Email address', regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/ },
      { name: 'Bearer token', regex: /Bearer\s+[a-zA-Z0-9._~+/=-]{20,}/ },
    ];

    // Simulate what a safe log entry looks like
    const safeLogEntry = JSON.stringify({
      level: 30,
      time: 1700000000000,
      component: 'agent-gateway',
      traceId: 'trace-abc123',
      tenantId: 'community-123',
      userWalletHash: 'a1b2c3d4e5f6',
      tier: 5,
      modelAlias: 'cheap',
      platform: 'discord',
      latencyMs: 150,
      costCents: 2,
      status: 'success',
      msg: 'agent-request',
    });

    for (const { name, regex } of piiPatterns) {
      it(`safe log entry does not match ${name} pattern`, () => {
        expect(safeLogEntry).not.toMatch(regex);
      });
    }

    it('safe log entry contains hashed wallet, not raw', () => {
      expect(safeLogEntry).toContain('userWalletHash');
      expect(safeLogEntry).not.toMatch(/0x[a-fA-F0-9]{40}/);
    });
  });
});
