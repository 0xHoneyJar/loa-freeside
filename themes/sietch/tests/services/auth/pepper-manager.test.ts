/**
 * PepperManager Tests
 *
 * Sprint 152: API Key Security Hardening (H-1)
 *
 * Tests for versioned pepper support and migration.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  PepperManager,
  getPepperManager,
  resetPepperManager,
} from '../../../src/services/auth/pepper-manager.js';

describe('PepperManager', () => {
  beforeEach(() => {
    // Reset singleton before each test
    resetPepperManager();
    // Clear environment variables
    delete process.env.API_KEY_PEPPER;
    delete process.env.API_KEY_PEPPER_V1;
    delete process.env.API_KEY_PEPPER_V2;
    delete process.env.NODE_ENV;
  });

  afterEach(() => {
    resetPepperManager();
  });

  describe('initialization', () => {
    it('should initialize with provided peppers', () => {
      const peppers = new Map([
        ['v1', 'pepper-v1-32-characters-long-xxx'],
        ['v2', 'pepper-v2-32-characters-long-xxx'],
      ]);

      const manager = new PepperManager({ peppers });

      expect(manager.getVersions()).toContain('v1');
      expect(manager.getVersions()).toContain('v2');
      expect(manager.getPrimaryVersion()).toBe('v1'); // First is primary
    });

    it('should load peppers from environment', () => {
      process.env.API_KEY_PEPPER = 'primary-pepper-32-characters-xx';
      process.env.API_KEY_PEPPER_V1 = 'old-pepper-v1-32-characters-xxx';

      const manager = new PepperManager();

      expect(manager.getVersions()).toContain('primary');
      expect(manager.getVersions()).toContain('v1');
      expect(manager.getPrimaryVersion()).toBe('primary');
    });

    it('should reject insecure default pepper in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.API_KEY_PEPPER = 'CHANGE_ME_IN_PRODUCTION';

      // Insecure default is ignored, so no primary pepper is found
      expect(() => new PepperManager()).toThrow('No primary pepper configured');
    });

    it('should reject short pepper in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.API_KEY_PEPPER = 'too-short';

      expect(() => new PepperManager()).toThrow('at least 32 characters');
    });

    it('should allow insecure pepper in development with warning', () => {
      process.env.NODE_ENV = 'development';
      // No pepper configured - uses insecure default

      const manager = new PepperManager();

      expect(manager.getPrimaryVersion()).toBe('primary');
    });
  });

  describe('hashing', () => {
    let manager: PepperManager;

    beforeEach(() => {
      const peppers = new Map([
        ['primary', 'primary-pepper-32-characters-xxx'],
        ['v1', 'old-pepper-v1-32-characters-xxxx'],
      ]);
      manager = new PepperManager({ peppers });
    });

    it('should hash with primary pepper', () => {
      const result = manager.hash('my-secret');

      expect(result.hash).toBeDefined();
      expect(result.hash.length).toBe(64); // SHA256 hex
      expect(result.pepperVersion).toBe('primary');
    });

    it('should produce consistent hashes for same secret', () => {
      const result1 = manager.hash('my-secret');
      const result2 = manager.hash('my-secret');

      expect(result1.hash).toBe(result2.hash);
    });

    it('should produce different hashes for different secrets', () => {
      const result1 = manager.hash('secret-1');
      const result2 = manager.hash('secret-2');

      expect(result1.hash).not.toBe(result2.hash);
    });

    it('should hash with specific version', () => {
      const result = manager.hashWithVersion('my-secret', 'v1');

      expect(result.pepperVersion).toBe('v1');
    });

    it('should produce different hashes with different peppers', () => {
      const result1 = manager.hash('my-secret');
      const result2 = manager.hashWithVersion('my-secret', 'v1');

      expect(result1.hash).not.toBe(result2.hash);
    });

    it('should throw for unknown pepper version', () => {
      expect(() => manager.hashWithVersion('secret', 'v99')).toThrow(
        'Unknown pepper version'
      );
    });
  });

  describe('validation', () => {
    let manager: PepperManager;

    beforeEach(() => {
      const peppers = new Map([
        ['primary', 'primary-pepper-32-characters-xxx'],
        ['v1', 'old-pepper-v1-32-characters-xxxx'],
      ]);
      manager = new PepperManager({ peppers });
    });

    it('should validate hash with matching pepper version', () => {
      const { hash, pepperVersion } = manager.hash('my-secret');

      const result = manager.validate('my-secret', hash, pepperVersion);

      expect(result.valid).toBe(true);
      expect(result.matchedVersion).toBe('primary');
      expect(result.migrationRecommended).toBe(false);
    });

    it('should validate and recommend migration for old version', () => {
      const { hash, pepperVersion } = manager.hashWithVersion('my-secret', 'v1');

      const result = manager.validate('my-secret', hash, pepperVersion);

      expect(result.valid).toBe(true);
      expect(result.matchedVersion).toBe('v1');
      expect(result.migrationRecommended).toBe(true);
    });

    it('should validate without stored version (fallback)', () => {
      const { hash } = manager.hashWithVersion('my-secret', 'v1');

      // Don't provide version - should try all
      const result = manager.validate('my-secret', hash);

      expect(result.valid).toBe(true);
      expect(result.matchedVersion).toBe('v1');
      expect(result.migrationRecommended).toBe(true);
    });

    it('should reject invalid secret', () => {
      const { hash, pepperVersion } = manager.hash('my-secret');

      const result = manager.validate('wrong-secret', hash, pepperVersion);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('No matching pepper version found');
    });

    it('should reject tampered hash', () => {
      const { pepperVersion } = manager.hash('my-secret');
      const tamperedHash = 'a'.repeat(64);

      const result = manager.validate('my-secret', tamperedHash, pepperVersion);

      expect(result.valid).toBe(false);
    });
  });

  describe('version management', () => {
    it('should report stats correctly', () => {
      const peppers = new Map([
        ['v1', 'pepper-v1-32-characters-long-xxx'],
        ['v2', 'pepper-v2-32-characters-long-xxx'],
        ['v3', 'pepper-v3-32-characters-long-xxx'],
      ]);
      const manager = new PepperManager({ peppers });

      const stats = manager.getStats();

      expect(stats.totalVersions).toBe(3);
      expect(stats.activeVersions).toBe(3);
      expect(stats.primaryVersion).toBe('v1');
      expect(stats.versions).toHaveLength(3);
    });

    it('should check version active status', () => {
      const peppers = new Map([
        ['v1', 'pepper-v1-32-characters-long-xxx'],
      ]);
      const manager = new PepperManager({ peppers });

      expect(manager.isVersionActive('v1')).toBe(true);
      expect(manager.isVersionActive('v99')).toBe(false);
    });
  });

  describe('singleton', () => {
    it('should return same instance', () => {
      const peppers = new Map([
        ['v1', 'pepper-v1-32-characters-long-xxx'],
      ]);

      const instance1 = getPepperManager({ peppers });
      const instance2 = getPepperManager();

      expect(instance1).toBe(instance2);
    });

    it('should reset singleton', () => {
      const peppers = new Map([
        ['v1', 'pepper-v1-32-characters-long-xxx'],
      ]);

      const instance1 = getPepperManager({ peppers });
      resetPepperManager();

      const peppers2 = new Map([
        ['v2', 'pepper-v2-32-characters-long-xxx'],
      ]);
      const instance2 = getPepperManager({ peppers: peppers2 });

      expect(instance1).not.toBe(instance2);
      expect(instance2.getPrimaryVersion()).toBe('v2');
    });
  });

  describe('migration workflow', () => {
    it('should support full migration workflow', () => {
      // Step 1: Initial setup with v1 pepper
      const peppersV1 = new Map([
        ['v1', 'old-pepper-v1-32-characters-xxxx'],
      ]);
      const managerV1 = new PepperManager({ peppers: peppersV1 });

      // Hash a secret with v1
      const { hash: oldHash, pepperVersion: oldVersion } = managerV1.hash('my-secret');
      expect(oldVersion).toBe('v1');

      // Step 2: Add new pepper v2 (becomes primary)
      resetPepperManager();
      const peppersV2 = new Map([
        ['v2', 'new-pepper-v2-32-characters-xxxx'],
        ['v1', 'old-pepper-v1-32-characters-xxxx'], // Still active for validation
      ]);
      const managerV2 = new PepperManager({ peppers: peppersV2 });

      // Step 3: Validate old hash - should work and recommend migration
      const result = managerV2.validate('my-secret', oldHash, oldVersion);
      expect(result.valid).toBe(true);
      expect(result.matchedVersion).toBe('v1');
      expect(result.migrationRecommended).toBe(true);

      // Step 4: Re-hash with new pepper
      const { hash: newHash, pepperVersion: newVersion } = managerV2.hash('my-secret');
      expect(newVersion).toBe('v2');
      expect(newHash).not.toBe(oldHash);

      // Step 5: Validate new hash - no migration needed
      const newResult = managerV2.validate('my-secret', newHash, newVersion);
      expect(newResult.valid).toBe(true);
      expect(newResult.matchedVersion).toBe('v2');
      expect(newResult.migrationRecommended).toBe(false);
    });
  });
});
