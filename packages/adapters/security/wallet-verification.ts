/**
 * Wallet Verification Service
 *
 * Sprint S-22: Vault Integration & Kill Switch
 *
 * Creates HSM-backed challenges for wallet verification.
 * Prevents challenge replay and tampering using Vault Transit signatures.
 *
 * @see SDD §6.4.2 (S-22.5)
 */

import type { Logger } from 'pino';
import type {
  IWalletVerification,
  IVaultClient,
  WalletChallenge,
} from '@freeside/core/ports';
import { VAULT_KEY_NAMES } from '@freeside/core/ports';
import type { VaultMetrics } from './metrics.js';
import { VaultMetricsHelper } from './metrics.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Options for WalletVerification.
 */
export interface WalletVerificationOptions {
  /** Vault client */
  vault: IVaultClient;
  /** Logger instance */
  logger: Logger;
  /** Prometheus metrics */
  metrics: VaultMetrics;
  /** Custom key name (optional) */
  keyName?: string;
  /** Challenge expiration in seconds (default: 300 = 5 minutes) */
  challengeExpirationSeconds?: number;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_CHALLENGE_EXPIRATION_SECONDS = 300; // 5 minutes
const NONCE_BYTES = 32;

// =============================================================================
// Implementation
// =============================================================================

/**
 * Wallet verification service using Vault Transit.
 */
export class WalletVerification implements IWalletVerification {
  private readonly vault: IVaultClient;
  private readonly log: Logger;
  private readonly metrics: VaultMetrics;
  private readonly keyName: string;
  private readonly challengeExpirationSeconds: number;

  constructor(options: WalletVerificationOptions) {
    this.vault = options.vault;
    this.log = options.logger.child({ component: 'WalletVerification' });
    this.metrics = options.metrics;
    this.keyName = options.keyName ?? VAULT_KEY_NAMES.WALLET_VERIFICATION;
    this.challengeExpirationSeconds =
      options.challengeExpirationSeconds ?? DEFAULT_CHALLENGE_EXPIRATION_SECONDS;
  }

  /**
   * Create a new wallet verification challenge.
   */
  async createChallenge(userId: string, walletAddress: string): Promise<WalletChallenge> {
    try {
      // Generate cryptographically secure nonce
      const nonce = this.generateNonce();

      // Calculate expiration
      const expiresAt = new Date(Date.now() + this.challengeExpirationSeconds * 1000);

      // Create challenge message
      const message = this.buildChallengeMessage(userId, walletAddress, nonce, expiresAt);

      // Sign the challenge with Vault
      const signature = await this.vault.sign(this.keyName, message);

      VaultMetricsHelper.walletChallenge(this.metrics, true);

      this.log.debug(
        { userId, walletAddress: this.maskAddress(walletAddress) },
        'Wallet challenge created'
      );

      return {
        nonce,
        message,
        expiresAt,
        signature,
      };
    } catch (error) {
      VaultMetricsHelper.walletChallenge(this.metrics, false);
      this.log.error({ error, userId }, 'Failed to create wallet challenge');
      throw error;
    }
  }

  /**
   * Verify a challenge signature.
   */
  async verifyChallenge(challenge: WalletChallenge): Promise<boolean> {
    try {
      // Check expiration
      if (new Date() > challenge.expiresAt) {
        this.log.debug('Challenge expired');
        return false;
      }

      // Verify signature with Vault
      const valid = await this.vault.verify(
        this.keyName,
        challenge.message,
        challenge.signature
      );

      if (!valid) {
        this.log.warn('Challenge signature invalid');
      }

      return valid;
    } catch (error) {
      this.log.error({ error }, 'Challenge verification failed');
      return false;
    }
  }

  /**
   * Generate a cryptographically secure nonce.
   */
  private generateNonce(): string {
    // Use crypto.getRandomValues for browser compatibility
    // or crypto.randomBytes for Node.js
    const bytes = new Uint8Array(NONCE_BYTES);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Build the challenge message.
   */
  private buildChallengeMessage(
    userId: string,
    walletAddress: string,
    nonce: string,
    expiresAt: Date
  ): string {
    // Standard EIP-4361 inspired message format
    return [
      'Arrakis Wallet Verification',
      '',
      `User: ${userId}`,
      `Wallet: ${walletAddress}`,
      `Nonce: ${nonce}`,
      `Expires: ${expiresAt.toISOString()}`,
      '',
      'Sign this message to verify wallet ownership.',
    ].join('\n');
  }

  /**
   * Mask wallet address for logging.
   */
  private maskAddress(address: string): string {
    if (address.length < 10) return '***';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a wallet verification service.
 *
 * @param options - Service options
 * @returns Wallet verification instance
 */
export function createWalletVerification(
  options: WalletVerificationOptions
): IWalletVerification {
  return new WalletVerification(options);
}
