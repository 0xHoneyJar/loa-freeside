/**
 * PepperManager - Versioned Pepper Support for API Key Hashing
 *
 * Sprint 152: API Key Security Hardening (H-1, M-4)
 *
 * Implements versioned pepper support for secure API key hashing:
 * - Multiple pepper versions can be active simultaneously
 * - Keys gradually migrate to new pepper on successful auth
 * - Zero-downtime rotation support
 * - Audit logging for pepper usage
 *
 * @module services/auth/pepper-manager
 */

import * as crypto from 'crypto';
import { logger } from '../../utils/logger.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Pepper version record
 */
export interface PepperVersion {
  /** Version identifier (e.g., "v1", "v2") */
  version: string;
  /** The pepper value */
  pepper: string;
  /** When this pepper was added */
  addedAt: Date;
  /** Whether this is the current primary pepper for new hashes */
  isPrimary: boolean;
  /** Whether this pepper is still accepted for validation */
  isActive: boolean;
}

/**
 * Hash result with version tracking
 */
export interface VersionedHash {
  /** The HMAC-SHA256 hash */
  hash: string;
  /** The pepper version used */
  pepperVersion: string;
}

/**
 * Validation result with migration info
 */
export interface PepperValidationResult {
  /** Whether the secret validated successfully */
  valid: boolean;
  /** The pepper version that matched (if valid) */
  matchedVersion?: string;
  /** Whether migration to primary pepper is recommended */
  migrationRecommended?: boolean;
  /** Error reason if invalid */
  reason?: string;
}

/**
 * Pepper manager configuration
 */
export interface PepperManagerConfig {
  /**
   * Pepper versions in order of preference (primary first)
   *
   * Configure via environment variables:
   * - API_KEY_PEPPER_V1=<pepper1>
   * - API_KEY_PEPPER_V2=<pepper2>
   *
   * Or provide directly for testing
   */
  peppers?: Map<string, string>;
  /** Enable debug logging */
  debug?: boolean;
}

// =============================================================================
// Constants
// =============================================================================

/** Environment variable prefix for pepper versions */
const PEPPER_ENV_PREFIX = 'API_KEY_PEPPER';

/** Minimum pepper length in production */
const MIN_PEPPER_LENGTH = 32;

/** Default insecure pepper value to reject */
const DEFAULT_INSECURE_PEPPER = 'CHANGE_ME_IN_PRODUCTION';

// =============================================================================
// PepperManager Class
// =============================================================================

/**
 * Pepper Manager for Versioned API Key Hashing
 *
 * Addresses H-1 vulnerability: API Key Pepper Not Rotatable
 *
 * Security Features:
 * - Multiple pepper versions supported
 * - Zero-downtime rotation (old + new peppers valid during transition)
 * - Gradual migration to new pepper on successful auth
 * - Audit logging for pepper usage patterns
 *
 * @example
 * ```typescript
 * // Environment setup:
 * // API_KEY_PEPPER=<current_primary>
 * // API_KEY_PEPPER_V1=<old_pepper>
 * // API_KEY_PEPPER_V2=<new_pepper>
 *
 * const manager = new PepperManager();
 *
 * // Hash with primary pepper
 * const { hash, pepperVersion } = manager.hash(secret);
 *
 * // Validate against all active peppers
 * const result = manager.validate(secret, storedHash, storedVersion);
 * if (result.migrationRecommended) {
 *   // Re-hash with new pepper
 *   const newHash = manager.hash(secret);
 *   // Update stored hash
 * }
 * ```
 */
export class PepperManager {
  private readonly peppers: Map<string, PepperVersion>;
  private readonly primaryVersion: string;
  private readonly debug: boolean;

  constructor(config: PepperManagerConfig = {}) {
    this.debug = config.debug ?? false;
    this.peppers = this.loadPeppers(config.peppers);

    // Determine primary version (first active pepper)
    const primary = Array.from(this.peppers.values()).find(p => p.isPrimary && p.isActive);
    if (!primary) {
      throw new Error(
        'No primary pepper configured. Set API_KEY_PEPPER environment variable.'
      );
    }
    this.primaryVersion = primary.version;

    this.log('PepperManager initialized', {
      versions: Array.from(this.peppers.keys()),
      primaryVersion: this.primaryVersion
    });
  }

  // ===========================================================================
  // Pepper Loading
  // ===========================================================================

  /**
   * Load peppers from environment or config
   */
  private loadPeppers(configPeppers?: Map<string, string>): Map<string, PepperVersion> {
    const peppers = new Map<string, PepperVersion>();
    const isProduction = process.env.NODE_ENV === 'production';

    // If config provides peppers, use those (for testing)
    if (configPeppers && configPeppers.size > 0) {
      let primary = true;
      for (const [version, pepper] of configPeppers) {
        peppers.set(version, {
          version,
          pepper,
          addedAt: new Date(),
          isPrimary: primary,
          isActive: true,
        });
        primary = false;
      }
      return peppers;
    }

    // Load from environment variables
    // Primary pepper (current/default)
    const primaryPepper = process.env.API_KEY_PEPPER;
    if (primaryPepper && primaryPepper !== DEFAULT_INSECURE_PEPPER) {
      this.validatePepper(primaryPepper, 'primary', isProduction);
      peppers.set('primary', {
        version: 'primary',
        pepper: primaryPepper,
        addedAt: new Date(),
        isPrimary: true,
        isActive: true,
      });
    }

    // Load versioned peppers (API_KEY_PEPPER_V1, API_KEY_PEPPER_V2, etc.)
    for (let i = 1; i <= 10; i++) {
      const envVar = `${PEPPER_ENV_PREFIX}_V${i}`;
      const pepper = process.env[envVar];

      if (pepper && pepper !== DEFAULT_INSECURE_PEPPER) {
        this.validatePepper(pepper, `v${i}`, isProduction);
        peppers.set(`v${i}`, {
          version: `v${i}`,
          pepper,
          addedAt: new Date(),
          isPrimary: !peppers.has('primary') && i === 1, // First if no primary
          isActive: true,
        });
      }
    }

    // Fallback: check for legacy single pepper
    if (peppers.size === 0 && !isProduction) {
      // Allow insecure default in development
      peppers.set('primary', {
        version: 'primary',
        pepper: DEFAULT_INSECURE_PEPPER,
        addedAt: new Date(),
        isPrimary: true,
        isActive: true,
      });
      logger.warn(
        'Using insecure default pepper in development. ' +
        'Configure API_KEY_PEPPER for production.'
      );
    }

    return peppers;
  }

  /**
   * Validate pepper meets security requirements
   */
  private validatePepper(pepper: string, version: string, isProduction: boolean): void {
    if (pepper === DEFAULT_INSECURE_PEPPER) {
      throw new Error(
        `Pepper version ${version} uses insecure default value. ` +
        'Generate a secure pepper with: openssl rand -base64 32'
      );
    }

    if (isProduction && pepper.length < MIN_PEPPER_LENGTH) {
      throw new Error(
        `Pepper version ${version} must be at least ${MIN_PEPPER_LENGTH} characters in production. ` +
        `Current length: ${pepper.length}`
      );
    }
  }

  // ===========================================================================
  // Hashing
  // ===========================================================================

  /**
   * Hash a secret with the primary pepper
   *
   * @param secret - The secret to hash
   * @returns Hash with version tracking
   */
  hash(secret: string): VersionedHash {
    const pepperRecord = this.peppers.get(this.primaryVersion);
    if (!pepperRecord) {
      throw new Error('Primary pepper not found');
    }

    const hash = this.computeHash(secret, pepperRecord.pepper);

    this.log('Secret hashed', { pepperVersion: this.primaryVersion });

    return {
      hash,
      pepperVersion: this.primaryVersion,
    };
  }

  /**
   * Hash a secret with a specific pepper version
   *
   * @param secret - The secret to hash
   * @param version - The pepper version to use
   * @returns Hash with version tracking
   */
  hashWithVersion(secret: string, version: string): VersionedHash {
    const pepperRecord = this.peppers.get(version);
    if (!pepperRecord) {
      throw new Error(`Unknown pepper version: ${version}`);
    }
    if (!pepperRecord.isActive) {
      throw new Error(`Pepper version ${version} is not active`);
    }

    const hash = this.computeHash(secret, pepperRecord.pepper);

    return {
      hash,
      pepperVersion: version,
    };
  }

  /**
   * Compute HMAC-SHA256 hash
   */
  private computeHash(secret: string, pepper: string): string {
    return crypto
      .createHmac('sha256', pepper)
      .update(secret)
      .digest('hex');
  }

  // ===========================================================================
  // Validation
  // ===========================================================================

  /**
   * Validate a secret against a stored hash
   *
   * Tries the specified version first, then falls back to other active versions
   * for migration support.
   *
   * @param secret - The secret to validate
   * @param storedHash - The stored hash to compare against
   * @param storedVersion - The pepper version the hash was created with (optional)
   * @returns Validation result with migration recommendation
   */
  validate(
    secret: string,
    storedHash: string,
    storedVersion?: string
  ): PepperValidationResult {
    // If version specified, try that first
    if (storedVersion) {
      const pepperRecord = this.peppers.get(storedVersion);
      if (pepperRecord && pepperRecord.isActive) {
        const hash = this.computeHash(secret, pepperRecord.pepper);
        if (this.secureCompare(hash, storedHash)) {
          const migrationRecommended = storedVersion !== this.primaryVersion;
          this.log('Secret validated', {
            version: storedVersion,
            migrationRecommended
          });
          return {
            valid: true,
            matchedVersion: storedVersion,
            migrationRecommended,
          };
        }
      }
    }

    // Try all active versions (for migration from unknown version)
    for (const [version, pepperRecord] of this.peppers) {
      if (!pepperRecord.isActive) continue;
      if (version === storedVersion) continue; // Already tried

      const hash = this.computeHash(secret, pepperRecord.pepper);
      if (this.secureCompare(hash, storedHash)) {
        const migrationRecommended = version !== this.primaryVersion;
        this.log('Secret validated via fallback', {
          version,
          migrationRecommended
        });
        return {
          valid: true,
          matchedVersion: version,
          migrationRecommended,
        };
      }
    }

    return {
      valid: false,
      reason: 'No matching pepper version found',
    };
  }

  /**
   * Constant-time string comparison to prevent timing attacks
   */
  private secureCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }

    try {
      return crypto.timingSafeEqual(
        Buffer.from(a, 'utf-8'),
        Buffer.from(b, 'utf-8')
      );
    } catch {
      return false;
    }
  }

  // ===========================================================================
  // Version Management
  // ===========================================================================

  /**
   * Get all pepper versions
   */
  getVersions(): string[] {
    return Array.from(this.peppers.keys());
  }

  /**
   * Get the primary pepper version
   */
  getPrimaryVersion(): string {
    return this.primaryVersion;
  }

  /**
   * Check if a pepper version is active
   */
  isVersionActive(version: string): boolean {
    const pepper = this.peppers.get(version);
    return pepper?.isActive ?? false;
  }

  /**
   * Get pepper statistics for monitoring
   */
  getStats(): {
    totalVersions: number;
    activeVersions: number;
    primaryVersion: string;
    versions: Array<{ version: string; isPrimary: boolean; isActive: boolean }>;
  } {
    const versions = Array.from(this.peppers.values()).map(p => ({
      version: p.version,
      isPrimary: p.isPrimary,
      isActive: p.isActive,
    }));

    return {
      totalVersions: this.peppers.size,
      activeVersions: versions.filter(v => v.isActive).length,
      primaryVersion: this.primaryVersion,
      versions,
    };
  }

  // ===========================================================================
  // Logging
  // ===========================================================================

  private log(message: string, data?: Record<string, unknown>): void {
    if (this.debug) {
      logger.debug({ ...data }, `[PepperManager] ${message}`);
    }
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let pepperManagerInstance: PepperManager | null = null;

/**
 * Get the singleton PepperManager instance
 *
 * @param config - Optional configuration (only used on first call)
 * @returns PepperManager instance
 */
export function getPepperManager(config?: PepperManagerConfig): PepperManager {
  if (!pepperManagerInstance) {
    pepperManagerInstance = new PepperManager(config);
  }
  return pepperManagerInstance;
}

/**
 * Reset the singleton instance (for testing)
 */
export function resetPepperManager(): void {
  pepperManagerInstance = null;
}
