/**
 * OAuth Token Encryption Service
 *
 * Sprint S-22: Vault Integration & Kill Switch
 *
 * Encrypts and decrypts Discord OAuth tokens using Vault Transit.
 * Ensures no plaintext tokens are stored in the database.
 *
 * @see SDD §6.4.2 (S-22.4)
 */

import type { Logger } from 'pino';
import type {
  IOAuthTokenEncryption,
  IVaultClient,
  EncryptedOAuthTokens,
  DecryptedOAuthTokens,
} from '@freeside/core/ports';
import { VAULT_KEY_NAMES } from '@freeside/core/ports';
import type { VaultMetrics } from './metrics.js';
import { VaultMetricsHelper } from './metrics.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Options for OAuthTokenEncryption.
 */
export interface OAuthTokenEncryptionOptions {
  /** Vault client */
  vault: IVaultClient;
  /** Logger instance */
  logger: Logger;
  /** Prometheus metrics */
  metrics: VaultMetrics;
  /** Custom key name (optional) */
  keyName?: string;
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * OAuth token encryption service using Vault Transit.
 */
export class OAuthTokenEncryption implements IOAuthTokenEncryption {
  private readonly vault: IVaultClient;
  private readonly log: Logger;
  private readonly metrics: VaultMetrics;
  private readonly keyName: string;

  constructor(options: OAuthTokenEncryptionOptions) {
    this.vault = options.vault;
    this.log = options.logger.child({ component: 'OAuthTokenEncryption' });
    this.metrics = options.metrics;
    this.keyName = options.keyName ?? VAULT_KEY_NAMES.OAUTH_TOKENS;
  }

  /**
   * Encrypt OAuth tokens.
   */
  async encrypt(tokens: DecryptedOAuthTokens): Promise<EncryptedOAuthTokens> {
    const start = Date.now();

    try {
      // Encrypt access token and refresh token separately
      const [encryptedAccess, encryptedRefresh] = await Promise.all([
        this.vault.encrypt(this.keyName, tokens.accessToken),
        this.vault.encrypt(this.keyName, tokens.refreshToken),
      ]);

      VaultMetricsHelper.oauthOperation(this.metrics, 'encrypt', true);

      this.log.debug('OAuth tokens encrypted');

      return {
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        tokenType: tokens.tokenType,
        expiresAt: tokens.expiresAt,
        scope: tokens.scope,
      };
    } catch (error) {
      VaultMetricsHelper.oauthOperation(this.metrics, 'encrypt', false);
      this.log.error({ error }, 'OAuth token encryption failed');
      throw error;
    }
  }

  /**
   * Decrypt OAuth tokens.
   */
  async decrypt(tokens: EncryptedOAuthTokens): Promise<DecryptedOAuthTokens> {
    const start = Date.now();

    try {
      // Decrypt access token and refresh token separately
      const [decryptedAccess, decryptedRefresh] = await Promise.all([
        this.vault.decrypt(this.keyName, tokens.accessToken),
        this.vault.decrypt(this.keyName, tokens.refreshToken),
      ]);

      VaultMetricsHelper.oauthOperation(this.metrics, 'decrypt', true);

      this.log.debug('OAuth tokens decrypted');

      return {
        accessToken: decryptedAccess,
        refreshToken: decryptedRefresh,
        tokenType: tokens.tokenType,
        expiresAt: tokens.expiresAt,
        scope: tokens.scope,
      };
    } catch (error) {
      VaultMetricsHelper.oauthOperation(this.metrics, 'decrypt', false);
      this.log.error({ error }, 'OAuth token decryption failed');
      throw error;
    }
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create an OAuth token encryption service.
 *
 * @param options - Service options
 * @returns OAuth token encryption instance
 */
export function createOAuthTokenEncryption(
  options: OAuthTokenEncryptionOptions
): IOAuthTokenEncryption {
  return new OAuthTokenEncryption(options);
}
