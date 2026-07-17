/**
 * MFA Verifier Implementation
 *
 * Sprint S-22: Vault Integration & Kill Switch
 *
 * TOTP-based MFA verification for kill switch activation.
 * Supports both Vault-stored secrets and external providers.
 *
 * @see SDD §6.4.3 Kill Switch (MFA requirement)
 */

import type { Logger } from 'pino';
import type {
  IMfaVerifier,
  IVaultClient,
  MfaVerificationResult,
} from '@freeside/core/ports';

// =============================================================================
// Types
// =============================================================================

/**
 * Options for MfaVerifier.
 */
export interface MfaVerifierOptions {
  /** Vault client for secret storage */
  vault: IVaultClient;
  /** Logger instance */
  logger: Logger;
  /** Issuer name for TOTP URI */
  issuer?: string;
  /** TOTP window (number of periods to check before/after) */
  window?: number;
  /** TOTP period in seconds */
  period?: number;
  /** TOTP digits */
  digits?: number;
}

/**
 * TOTP parameters.
 */
interface TotpParams {
  secret: string;
  period: number;
  digits: number;
  algorithm: 'SHA1' | 'SHA256' | 'SHA512';
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_ISSUER = 'Arrakis';
const DEFAULT_WINDOW = 1; // Allow 1 period before/after
const DEFAULT_PERIOD = 30; // 30 seconds
const DEFAULT_DIGITS = 6;
const SECRET_PATH_PREFIX = 'mfa/users/';

// =============================================================================
// Implementation
// =============================================================================

/**
 * TOTP-based MFA verifier.
 */
export class MfaVerifier implements IMfaVerifier {
  private readonly vault: IVaultClient;
  private readonly log: Logger;
  private readonly issuer: string;
  private readonly window: number;
  private readonly period: number;
  private readonly digits: number;

  constructor(options: MfaVerifierOptions) {
    this.vault = options.vault;
    this.log = options.logger.child({ component: 'MfaVerifier' });
    this.issuer = options.issuer ?? DEFAULT_ISSUER;
    this.window = options.window ?? DEFAULT_WINDOW;
    this.period = options.period ?? DEFAULT_PERIOD;
    this.digits = options.digits ?? DEFAULT_DIGITS;
  }

  /**
   * Verify a TOTP token.
   */
  async verify(userId: string, token: string): Promise<MfaVerificationResult> {
    const verifiedAt = new Date();

    try {
      // Validate token format
      if (!this.isValidTokenFormat(token)) {
        return {
          valid: false,
          error: 'Invalid token format',
          verifiedAt,
        };
      }

      // Get user's TOTP secret from Vault
      const secret = await this.getUserSecret(userId);
      if (!secret) {
        return {
          valid: false,
          error: 'MFA not configured for user',
          verifiedAt,
        };
      }

      // Verify TOTP
      const valid = this.verifyTotp(token, {
        secret,
        period: this.period,
        digits: this.digits,
        algorithm: 'SHA1',
      });

      if (valid) {
        this.log.info({ userId }, 'MFA verification successful');
      } else {
        this.log.warn({ userId }, 'MFA verification failed - invalid token');
      }

      return {
        valid,
        error: valid ? undefined : 'Invalid token',
        verifiedAt,
      };
    } catch (error) {
      this.log.error({ error, userId }, 'MFA verification error');
      return {
        valid: false,
        error: 'Verification error',
        verifiedAt,
      };
    }
  }

  /**
   * Generate a new TOTP secret for a user.
   */
  async generateSecret(userId: string): Promise<string> {
    // Generate 20-byte (160-bit) secret
    const bytes = new Uint8Array(20);
    crypto.getRandomValues(bytes);
    const secret = this.base32Encode(bytes);

    // Store in Vault
    await this.vault.putSecret(`${SECRET_PATH_PREFIX}${userId}`, {
      secret,
      createdAt: new Date().toISOString(),
    });

    this.log.info({ userId }, 'MFA secret generated');
    return secret;
  }

  /**
   * Get TOTP URI for QR code generation.
   */
  getTotpUri(userId: string, secret: string): string {
    const encodedIssuer = encodeURIComponent(this.issuer);
    const encodedUser = encodeURIComponent(userId);

    return `otpauth://totp/${encodedIssuer}:${encodedUser}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=${this.digits}&period=${this.period}`;
  }

  /**
   * Get user's TOTP secret from Vault.
   */
  private async getUserSecret(userId: string): Promise<string | null> {
    try {
      const data = await this.vault.getSecret(`${SECRET_PATH_PREFIX}${userId}`);
      return data.secret ?? null;
    } catch (error) {
      // Secret not found
      return null;
    }
  }

  /**
   * Validate token format.
   */
  private isValidTokenFormat(token: string): boolean {
    const pattern = new RegExp(`^\\d{${this.digits}}$`);
    return pattern.test(token);
  }

  /**
   * Verify TOTP token.
   */
  private verifyTotp(token: string, params: TotpParams): boolean {
    const now = Math.floor(Date.now() / 1000);

    // Check current period and window periods
    for (let i = -this.window; i <= this.window; i++) {
      const counter = Math.floor((now + i * params.period) / params.period);
      const expectedToken = this.generateTotp(params.secret, counter, params);

      if (token === expectedToken) {
        return true;
      }
    }

    return false;
  }

  /**
   * Generate TOTP token for a given counter.
   */
  private generateTotp(secret: string, counter: number, params: TotpParams): string {
    // Decode base32 secret
    const keyBytes = this.base32Decode(secret);

    // Counter to 8-byte buffer (big-endian)
    const counterBuffer = new ArrayBuffer(8);
    const counterView = new DataView(counterBuffer);
    counterView.setBigUint64(0, BigInt(counter), false);

    // HMAC-SHA1
    const hmac = this.hmacSha1(keyBytes, new Uint8Array(counterBuffer));

    // Dynamic truncation
    const offset = hmac[hmac.length - 1] & 0x0f;
    const binary =
      ((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff);

    // Generate token with specified digits
    const otp = binary % Math.pow(10, params.digits);
    return otp.toString().padStart(params.digits, '0');
  }

  /**
   * HMAC-SHA1 implementation using Web Crypto API.
   * Note: This is a simplified sync version for TOTP.
   * In production, use crypto.subtle for async HMAC.
   */
  private hmacSha1(key: Uint8Array, data: Uint8Array): Uint8Array {
    // Simplified HMAC-SHA1 for TOTP
    // In production, this should use crypto.subtle.sign()
    // For now, we use a basic implementation

    const blockSize = 64;
    const outputSize = 20;

    // Pad or hash key
    let keyPadded = key;
    if (key.length > blockSize) {
      keyPadded = this.sha1(key);
    }
    if (keyPadded.length < blockSize) {
      const padded = new Uint8Array(blockSize);
      padded.set(keyPadded);
      keyPadded = padded;
    }

    // Inner and outer padding
    const ipad = new Uint8Array(blockSize);
    const opad = new Uint8Array(blockSize);
    for (let i = 0; i < blockSize; i++) {
      ipad[i] = keyPadded[i] ^ 0x36;
      opad[i] = keyPadded[i] ^ 0x5c;
    }

    // Inner hash
    const inner = new Uint8Array(blockSize + data.length);
    inner.set(ipad);
    inner.set(data, blockSize);
    const innerHash = this.sha1(inner);

    // Outer hash
    const outer = new Uint8Array(blockSize + outputSize);
    outer.set(opad);
    outer.set(innerHash, blockSize);
    return this.sha1(outer);
  }

  /**
   * SHA-1 implementation.
   * Note: In production, use crypto.subtle.digest()
   */
  private sha1(data: Uint8Array): Uint8Array {
    // SHA-1 constants
    const K = [0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xca62c1d6];

    // Initial hash values
    let h0 = 0x67452301;
    let h1 = 0xefcdab89;
    let h2 = 0x98badcfe;
    let h3 = 0x10325476;
    let h4 = 0xc3d2e1f0;

    // Pre-processing
    const ml = data.length * 8;
    const padLen = 64 - ((data.length + 9) % 64);
    const paddedLen = data.length + 1 + padLen + 8;
    const padded = new Uint8Array(paddedLen);
    padded.set(data);
    padded[data.length] = 0x80;
    const view = new DataView(padded.buffer);
    view.setBigUint64(paddedLen - 8, BigInt(ml), false);

    // Process each 64-byte chunk
    for (let i = 0; i < paddedLen; i += 64) {
      const w = new Uint32Array(80);

      // Break chunk into 16 32-bit words
      for (let j = 0; j < 16; j++) {
        w[j] = view.getUint32(i + j * 4, false);
      }

      // Extend to 80 words
      for (let j = 16; j < 80; j++) {
        w[j] = this.rotl(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1);
      }

      let a = h0, b = h1, c = h2, d = h3, e = h4;

      for (let j = 0; j < 80; j++) {
        let f: number, k: number;
        if (j < 20) {
          f = (b & c) | (~b & d);
          k = K[0];
        } else if (j < 40) {
          f = b ^ c ^ d;
          k = K[1];
        } else if (j < 60) {
          f = (b & c) | (b & d) | (c & d);
          k = K[2];
        } else {
          f = b ^ c ^ d;
          k = K[3];
        }

        const temp = (this.rotl(a, 5) + f + e + k + w[j]) >>> 0;
        e = d;
        d = c;
        c = this.rotl(b, 30);
        b = a;
        a = temp;
      }

      h0 = (h0 + a) >>> 0;
      h1 = (h1 + b) >>> 0;
      h2 = (h2 + c) >>> 0;
      h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0;
    }

    // Produce final hash
    const result = new Uint8Array(20);
    const resultView = new DataView(result.buffer);
    resultView.setUint32(0, h0, false);
    resultView.setUint32(4, h1, false);
    resultView.setUint32(8, h2, false);
    resultView.setUint32(12, h3, false);
    resultView.setUint32(16, h4, false);
    return result;
  }

  /**
   * Rotate left for 32-bit integer.
   */
  private rotl(n: number, s: number): number {
    return ((n << s) | (n >>> (32 - s))) >>> 0;
  }

  /**
   * Base32 encode bytes.
   */
  private base32Encode(bytes: Uint8Array): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let result = '';
    let bits = 0;
    let value = 0;

    for (const byte of bytes) {
      value = (value << 8) | byte;
      bits += 8;

      while (bits >= 5) {
        bits -= 5;
        result += alphabet[(value >>> bits) & 0x1f];
      }
    }

    if (bits > 0) {
      result += alphabet[(value << (5 - bits)) & 0x1f];
    }

    return result;
  }

  /**
   * Base32 decode string.
   */
  private base32Decode(str: string): Uint8Array {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const cleanStr = str.toUpperCase().replace(/=+$/, '');

    const bytes: number[] = [];
    let bits = 0;
    let value = 0;

    for (const char of cleanStr) {
      const idx = alphabet.indexOf(char);
      if (idx === -1) continue;

      value = (value << 5) | idx;
      bits += 5;

      if (bits >= 8) {
        bits -= 8;
        bytes.push((value >>> bits) & 0xff);
      }
    }

    return new Uint8Array(bytes);
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create an MFA verifier.
 *
 * @param options - Verifier options
 * @returns MFA verifier instance
 */
export function createMfaVerifier(options: MfaVerifierOptions): IMfaVerifier {
  return new MfaVerifier(options);
}
