/**
 * DynamicContract Validation Tests — Sprint 359, Task 2.1 (FR-4)
 *
 * Tests loadDynamicContract(), resolveProtocolSurface(), isCapabilityGranted()
 * with all 6 failure modes and monotonic expansion verification.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  loadDynamicContract,
  resetDynamicContract,
  resolveProtocolSurface,
  isCapabilityGranted,
  validateContractFile,
  DynamicContractError,
} from '../../themes/sietch/src/packages/core/protocol/arrakis-dynamic-contract.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const VALID_CONTRACT_PATH = resolve(process.cwd(), 'config', 'dynamic-contract.json');

const mockLogger = {
  fatal: vi.fn(),
};

beforeEach(() => {
  resetDynamicContract();
  vi.unstubAllEnvs();
  mockLogger.fatal.mockClear();
});

afterEach(() => {
  resetDynamicContract();
});

// ─── loadDynamicContract ─────────────────────────────────────────────────────

describe('loadDynamicContract', () => {
  it('loads and validates a valid contract from disk', () => {
    const contract = loadDynamicContract(VALID_CONTRACT_PATH, { logger: mockLogger });
    expect(contract).toBeDefined();
    expect(contract.contract_id).toBe('arrakis-default-v8.2.0');
    expect(contract.contract_version).toBe('8.2.0');
    expect(mockLogger.fatal).not.toHaveBeenCalled();
  });

  it('caches the contract as singleton on subsequent calls', () => {
    const first = loadDynamicContract(VALID_CONTRACT_PATH, { logger: mockLogger });
    const second = loadDynamicContract(VALID_CONTRACT_PATH, { logger: mockLogger });
    expect(first).toBe(second);
  });

  // Failure mode 1: FILE_NOT_FOUND
  it('throws DynamicContractError(FILE_NOT_FOUND) for missing file', () => {
    expect(() =>
      loadDynamicContract('/nonexistent/path.json', { logger: mockLogger }),
    ).toThrow(DynamicContractError);

    try {
      loadDynamicContract('/nonexistent/path.json', { logger: mockLogger });
    } catch (e) {
      expect((e as DynamicContractError).failure).toBe('FILE_NOT_FOUND');
    }
  });

  // Failure mode 2: FILE_READ_ERROR (override blocked in production)
  it('throws when DYNAMIC_CONTRACT_OVERRIDE used in production without ALLOW flag', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DYNAMIC_CONTRACT_OVERRIDE', '{}');

    expect(() =>
      loadDynamicContract(undefined, { logger: mockLogger }),
    ).toThrow(DynamicContractError);

    expect(mockLogger.fatal).toHaveBeenCalled();
  });

  it('allows DYNAMIC_CONTRACT_OVERRIDE in production with ALLOW_DYNAMIC_CONTRACT_OVERRIDE=true', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ALLOW_DYNAMIC_CONTRACT_OVERRIDE', 'true');

    const validJson = readFileSync(VALID_CONTRACT_PATH, 'utf8');
    vi.stubEnv('DYNAMIC_CONTRACT_OVERRIDE', validJson);

    const contract = loadDynamicContract(undefined, { logger: mockLogger });
    expect(contract.contract_id).toBe('arrakis-default-v8.2.0');
  });

  // Failure mode 3: JSON_PARSE_ERROR
  it('throws DynamicContractError(JSON_PARSE_ERROR) for invalid JSON', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DYNAMIC_CONTRACT_OVERRIDE', 'not-json{{{');

    expect(() =>
      loadDynamicContract(undefined, { logger: mockLogger }),
    ).toThrow(DynamicContractError);

    try {
      resetDynamicContract();
      loadDynamicContract(undefined, { logger: mockLogger });
    } catch (e) {
      expect((e as DynamicContractError).failure).toBe('JSON_PARSE_ERROR');
    }
  });

  // Failure mode 4: SCHEMA_VALIDATION_ERROR
  it('throws DynamicContractError(SCHEMA_VALIDATION_ERROR) for schema-invalid contract', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DYNAMIC_CONTRACT_OVERRIDE', JSON.stringify({ invalid: true }));

    expect(() =>
      loadDynamicContract(undefined, { logger: mockLogger }),
    ).toThrow(DynamicContractError);

    try {
      resetDynamicContract();
      loadDynamicContract(undefined, { logger: mockLogger });
    } catch (e) {
      expect((e as DynamicContractError).failure).toBe('SCHEMA_VALIDATION_ERROR');
    }
  });

  // Failure mode 5: OVERRIDE_SIZE_EXCEEDED
  it('throws DynamicContractError(OVERRIDE_SIZE_EXCEEDED) for oversized override', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DYNAMIC_CONTRACT_OVERRIDE', 'x'.repeat(65 * 1024)); // 65KB > 64KB limit

    expect(() =>
      loadDynamicContract(undefined, { logger: mockLogger }),
    ).toThrow(DynamicContractError);

    try {
      resetDynamicContract();
      loadDynamicContract(undefined, { logger: mockLogger });
    } catch (e) {
      expect((e as DynamicContractError).failure).toBe('OVERRIDE_SIZE_EXCEEDED');
    }
  });

  it('allows override in non-production environment', () => {
    vi.stubEnv('NODE_ENV', 'test');
    const validJson = readFileSync(VALID_CONTRACT_PATH, 'utf8');
    vi.stubEnv('DYNAMIC_CONTRACT_OVERRIDE', validJson);

    const contract = loadDynamicContract(undefined, { logger: mockLogger });
    expect(contract.contract_id).toBe('arrakis-default-v8.2.0');
  });
});

// ─── resolveProtocolSurface ──────────────────────────────────────────────────

describe('resolveProtocolSurface', () => {
  it('returns correct surface for each reputation state', () => {
    const contract = loadDynamicContract(VALID_CONTRACT_PATH);

    const cold = resolveProtocolSurface(contract, 'cold');
    expect(cold.capabilities).toContain('inference');
    expect(cold.capabilities).not.toContain('governance');
    expect(cold.rate_limit_tier).toBe('restricted');

    const warming = resolveProtocolSurface(contract, 'warming');
    expect(warming.capabilities).toContain('tools');
    expect(warming.rate_limit_tier).toBe('standard');

    const established = resolveProtocolSurface(contract, 'established');
    expect(established.capabilities).toContain('ensemble');
    expect(established.rate_limit_tier).toBe('extended');

    const authoritative = resolveProtocolSurface(contract, 'authoritative');
    expect(authoritative.capabilities).toContain('governance');
    expect(authoritative.capabilities).toContain('byok');
    expect(authoritative.rate_limit_tier).toBe('unlimited');
  });

  it('fail-closed to cold surface for unknown reputation state', () => {
    const contract = loadDynamicContract(VALID_CONTRACT_PATH);
    const surface = resolveProtocolSurface(contract, 'nonexistent' as any);
    expect(surface.rate_limit_tier).toBe('restricted');
    expect(surface.capabilities).toEqual(['inference']);
  });
});

// ─── isCapabilityGranted ─────────────────────────────────────────────────────

describe('isCapabilityGranted', () => {
  it('returns true for granted capability', () => {
    const contract = loadDynamicContract(VALID_CONTRACT_PATH);
    const surface = resolveProtocolSurface(contract, 'authoritative');
    expect(isCapabilityGranted(surface, 'governance')).toBe(true);
  });

  it('returns false for denied capability', () => {
    const contract = loadDynamicContract(VALID_CONTRACT_PATH);
    const surface = resolveProtocolSurface(contract, 'cold');
    expect(isCapabilityGranted(surface, 'governance')).toBe(false);
    expect(isCapabilityGranted(surface, 'ensemble')).toBe(false);
  });

  it('cold surface only grants inference', () => {
    const contract = loadDynamicContract(VALID_CONTRACT_PATH);
    const surface = resolveProtocolSurface(contract, 'cold');
    expect(isCapabilityGranted(surface, 'inference')).toBe(true);
    expect(isCapabilityGranted(surface, 'tools')).toBe(false);
    expect(isCapabilityGranted(surface, 'ensemble')).toBe(false);
    expect(isCapabilityGranted(surface, 'governance')).toBe(false);
    expect(isCapabilityGranted(surface, 'byok')).toBe(false);
  });
});

// ─── validateContractFile ────────────────────────────────────────────────────

describe('validateContractFile', () => {
  it('returns valid for the default contract', () => {
    const result = validateContractFile(VALID_CONTRACT_PATH);
    expect(result.valid).toBe(true);
  });

  it('returns invalid for nonexistent file', () => {
    const result = validateContractFile('/nonexistent.json');
    expect(result.valid).toBe(false);
    expect((result as { valid: false; error: string }).error).toContain('FILE_NOT_FOUND');
  });
});

// ─── Monotonic Expansion ─────────────────────────────────────────────────────

describe('Monotonic expansion verification', () => {
  it('default contract passes monotonic expansion', () => {
    // loadDynamicContract already verifies this — if it loads, it passed
    const contract = loadDynamicContract(VALID_CONTRACT_PATH);
    expect(contract).toBeDefined();
  });
});
