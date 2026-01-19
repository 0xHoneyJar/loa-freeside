/**
 * MFAService - Multi-Factor Authentication Service
 *
 * Sprint 47: Kill Switch & MFA
 *
 * TOTP (Time-based One-Time Password) implementation using RFC 6238.
 *
 * Features:
 * - TOTP secret generation
 * - QR code generation for authenticator apps
 * - TOTP verification with time drift tolerance
 * - Backup recovery codes
 * - Rate limiting for verification attempts
 *
 * Dependencies:
 * - crypto (built-in): For secret generation and hashing
 * - Redis: For rate limiting and backup code storage
 *
 * Note: This implementation uses built-in crypto instead of otplib
 * to minimize dependencies while maintaining RFC 6238 compliance.
 *
 * @module packages/security/MFAService
 */

import * as crypto from 'crypto';
import type { Redis } from 'ioredis';
import type {
  MFASetupOptions,
  MFASetupResult,
  MFAVerificationRequest,
  MFAVerificationResult,
  MFAConfig,
  MFAMethod,
} from './types.js';

/**
 * MFA Service configuration
 */
export interface MFAServiceConfig {
  /** Redis client for rate limiting and backup codes */
  redis: Redis;
  /** TOTP window size (number of 30s windows to check, default: 1 = ±30s) */
  totpWindow?: number;
  /** TOTP step in seconds (default: 30) */
  totpStep?: number;
  /** Number of backup codes to generate (default: 10) */
  backupCodeCount?: number;
  /** Maximum verification attempts per window (default: 5) */
  maxAttempts?: number;
  /** Verification attempt window in seconds (default: 300 = 5min) */
  attemptWindow?: number;
  /** Whether to enable debug logging */
  debug?: boolean;
}

/**
 * MFA Service Error
 */
export class MFAError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly userId?: string
  ) {
    super(message);
    this.name = 'MFAError';
  }
}

/**
 * MFAService - Multi-Factor Authentication Service
 *
 * @example
 * ```typescript
 * const mfaService = new MFAService({ redis });
 *
 * // Setup TOTP for user
 * const setup = await mfaService.setupTOTP({ userId: 'user123', method: 'TOTP' });
 * console.log(setup.totpSecret); // Share with user via QR code
 *
 * // Verify TOTP code
 * const result = await mfaService.verifyTOTP('user123', '123456');
 * console.log(result.valid); // true/false
 * ```
 */
export class MFAService {
  private readonly redis: Redis;
  private readonly totpWindow: number;
  private readonly totpStep: number;
  private readonly backupCodeCount: number;
  private readonly maxAttempts: number;
  private readonly attemptWindow: number;
  private readonly debug: boolean;

  constructor(config: MFAServiceConfig) {
    this.redis = config.redis;
    this.totpWindow = config.totpWindow ?? 1;
    this.totpStep = config.totpStep ?? 30;
    this.backupCodeCount = config.backupCodeCount ?? 10;
    this.maxAttempts = config.maxAttempts ?? 5;
    this.attemptWindow = config.attemptWindow ?? 300;
    this.debug = config.debug ?? false;
  }

  /**
   * Setup TOTP for a user
   *
   * @param options - Setup options
   * @returns Setup result with secret and QR code
   */
  async setupTOTP(options: MFASetupOptions): Promise<MFASetupResult> {
    if (options.method !== 'TOTP') {
      throw new MFAError('Only TOTP method is currently supported', 'UNSUPPORTED_METHOD', options.userId);
    }

    this.log('Setting up TOTP', { userId: options.userId });

    // Generate TOTP secret (base32 encoded)
    const secret = this.generateTOTPSecret();

    // Generate backup codes
    const backupCodes = this.generateBackupCodes();

    // Store MFA config in Redis
    const configKey = this.configKey(options.userId);
    const config: MFAConfig = {
      userId: options.userId,
      enabled: true,
      primaryMethod: 'TOTP',
      backupMethods: ['BACKUP_CODES'],
      backupCodesRemaining: backupCodes.length,
    };

    await this.redis.setex(configKey, 86400 * 365, JSON.stringify(config)); // 1 year TTL

    // Store TOTP secret
    await this.redis.setex(this.secretKey(options.userId), 86400 * 365, secret);

    // Store backup codes (hashed)
    const backupCodesKey = this.backupCodesKey(options.userId);
    const hashedCodes = backupCodes.map((code) => this.hashBackupCode(code));
    await this.redis.setex(backupCodesKey, 86400 * 365, JSON.stringify(hashedCodes));

    // Generate QR code data URL
    const qrCodeDataUrl = this.generateQRCodeDataUrl(options.userId, secret);

    this.log('TOTP setup complete', { userId: options.userId });

    return {
      success: true,
      method: 'TOTP',
      totpSecret: secret,
      qrCodeDataUrl,
      backupCodes,
      setupAt: new Date(),
    };
  }

  /**
   * Verify TOTP code
   *
   * @param userId - User ID
   * @param code - 6-digit TOTP code
   * @returns Verification result
   */
  async verifyTOTP(userId: string, code: string): Promise<MFAVerificationResult> {
    this.log('Verifying TOTP', { userId, code: '******' });

    // Check rate limiting
    const allowed = await this.checkRateLimit(userId);
    if (!allowed) {
      this.log('Rate limit exceeded', { userId });
      return {
        valid: false,
        error: 'Too many verification attempts. Please try again later.',
        attemptsRemaining: 0,
      };
    }

    // Get TOTP secret
    const secret = await this.redis.get(this.secretKey(userId));
    if (!secret) {
      this.log('TOTP not configured', { userId });
      return {
        valid: false,
        error: 'TOTP not configured for this user',
      };
    }

    // Verify TOTP code
    const valid = this.verifyTOTPCode(secret, code);

    if (valid) {
      // Update last verified timestamp
      await this.updateLastVerified(userId);

      // Reset rate limit on success
      await this.resetRateLimit(userId);

      this.log('TOTP verification successful', { userId });

      return {
        valid: true,
        method: 'TOTP',
        verifiedAt: new Date(),
      };
    }

    // Increment failure count
    await this.incrementFailureCount(userId);

    const remaining = await this.getRemainingAttempts(userId);

    this.log('TOTP verification failed', { userId, remaining });

    return {
      valid: false,
      error: 'Invalid TOTP code',
      attemptsRemaining: remaining,
    };
  }

  /**
   * Verify backup code
   *
   * @param userId - User ID
   * @param code - Backup recovery code
   * @returns Verification result
   */
  async verifyBackupCode(userId: string, code: string): Promise<MFAVerificationResult> {
    this.log('Verifying backup code', { userId });

    // Get stored backup codes (hashed)
    const backupCodesKey = this.backupCodesKey(userId);
    const storedCodesJson = await this.redis.get(backupCodesKey);
    if (!storedCodesJson) {
      return {
        valid: false,
        error: 'No backup codes configured',
      };
    }

    const storedCodes: string[] = JSON.parse(storedCodesJson);
    const hashedCode = this.hashBackupCode(code);

    // Check if code matches any stored code
    const index = storedCodes.indexOf(hashedCode);
    if (index === -1) {
      return {
        valid: false,
        error: 'Invalid backup code',
      };
    }

    // Remove used backup code
    storedCodes.splice(index, 1);
    await this.redis.setex(backupCodesKey, 86400 * 365, JSON.stringify(storedCodes));

    // Update config
    const config = await this.getConfig(userId);
    if (config) {
      config.backupCodesRemaining = storedCodes.length;
      await this.redis.setex(this.configKey(userId), 86400 * 365, JSON.stringify(config));
    }

    // Update last verified timestamp
    await this.updateLastVerified(userId);

    this.log('Backup code verification successful', { userId, remaining: storedCodes.length });

    return {
      valid: true,
      method: 'BACKUP_CODES',
      verifiedAt: new Date(),
    };
  }

  /**
   * Verify MFA request
   *
   * @param request - Verification request
   * @returns Verification result
   */
  async verify(request: MFAVerificationRequest): Promise<MFAVerificationResult> {
    // Try TOTP first if provided
    if (request.totpCode) {
      return this.verifyTOTP(request.userId, request.totpCode);
    }

    // Try backup code if provided
    if (request.backupCode) {
      return this.verifyBackupCode(request.userId, request.backupCode);
    }

    return {
      valid: false,
      error: 'No verification code provided',
    };
  }

  /**
   * Get MFA configuration for user
   *
   * @param userId - User ID
   * @returns MFA config or null
   */
  async getConfig(userId: string): Promise<MFAConfig | null> {
    const configJson = await this.redis.get(this.configKey(userId));
    if (!configJson) {
      return null;
    }
    return JSON.parse(configJson);
  }

  /**
   * Disable MFA for user
   *
   * @param userId - User ID
   */
  async disable(userId: string): Promise<void> {
    await this.redis.del(this.configKey(userId));
    await this.redis.del(this.secretKey(userId));
    await this.redis.del(this.backupCodesKey(userId));
    await this.redis.del(this.attemptsKey(userId));

    this.log('MFA disabled', { userId });
  }

  /**
   * Generate TOTP secret (base32 encoded)
   */
  private generateTOTPSecret(): string {
    const buffer = crypto.randomBytes(20);
    return this.base32Encode(buffer);
  }

  /**
   * Generate backup recovery codes
   */
  private generateBackupCodes(): string[] {
    const codes: string[] = [];
    for (let i = 0; i < this.backupCodeCount; i++) {
      // Generate 8-character alphanumeric code
      const code = crypto.randomBytes(4).toString('hex').toUpperCase();
      codes.push(code);
    }
    return codes;
  }

  /**
   * Hash backup code for storage
   */
  private hashBackupCode(code: string): string {
    return crypto.createHash('sha256').update(code).digest('hex');
  }

  /**
   * Generate QR code data URL for TOTP
   *
   * Note: Returns otpauth:// URI. In production, use a QR code library
   * to convert this to an actual QR code image.
   */
  private generateQRCodeDataUrl(userId: string, secret: string): string {
    const issuer = 'Arrakis';
    const label = `${issuer}:${userId}`;
    const otpauthUri = `otpauth://totp/${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`;
    return otpauthUri;
  }

  /**
   * Verify TOTP code against secret
   *
   * Implements RFC 6238 TOTP algorithm with time drift tolerance
   */
  private verifyTOTPCode(secret: string, code: string): boolean {
    const currentTime = Math.floor(Date.now() / 1000);

    // Check current window and drift windows (±window)
    for (let i = -this.totpWindow; i <= this.totpWindow; i++) {
      const timeCounter = Math.floor(currentTime / this.totpStep) + i;
      const expectedCode = this.generateTOTPCode(secret, timeCounter);

      if (expectedCode === code) {
        return true;
      }
    }

    return false;
  }

  /**
   * Generate TOTP code for a time counter
   *
   * Implements RFC 6238 TOTP algorithm
   */
  private generateTOTPCode(secret: string, timeCounter: number): string {
    // Decode base32 secret
    const secretBuffer = this.base32Decode(secret);

    // Convert time counter to 8-byte buffer (big-endian)
    const timeBuffer = Buffer.alloc(8);
    timeBuffer.writeBigUInt64BE(BigInt(timeCounter), 0);

    // HMAC-SHA1
    const hmac = crypto.createHmac('sha1', secretBuffer);
    hmac.update(timeBuffer);
    const hmacResult = hmac.digest();

    // Dynamic truncation (RFC 4226)
    const lastByte = hmacResult[hmacResult.length - 1];
    if (lastByte === undefined) {
      throw new Error('Invalid HMAC result');
    }
    const offset = lastByte & 0x0f;
    const b0 = hmacResult[offset] ?? 0;
    const b1 = hmacResult[offset + 1] ?? 0;
    const b2 = hmacResult[offset + 2] ?? 0;
    const b3 = hmacResult[offset + 3] ?? 0;
    const truncated =
      ((b0 & 0x7f) << 24) |
      ((b1 & 0xff) << 16) |
      ((b2 & 0xff) << 8) |
      (b3 & 0xff);

    // Generate 6-digit code
    const code = (truncated % 1000000).toString().padStart(6, '0');
    return code;
  }

  /**
   * Base32 encode with RFC 4648 padding
   *
   * Adds padding (=) to make length a multiple of 8 for TOTP compatibility
   */
  private base32Encode(buffer: Buffer): string {
    const base32Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = 0;
    let value = 0;
    let output = '';

    for (let i = 0; i < buffer.length; i++) {
      value = (value << 8) | (buffer[i] ?? 0);
      bits += 8;

      while (bits >= 5) {
        output += base32Chars[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }

    if (bits > 0) {
      output += base32Chars[(value << (5 - bits)) & 31];
    }

    // RFC 4648: Pad to multiple of 8 characters
    const paddingLength = (8 - (output.length % 8)) % 8;
    output += '='.repeat(paddingLength);

    return output;
  }

  /**
   * Base32 decode with RFC 4648 padding support
   *
   * Strips padding before decoding
   */
  private base32Decode(input: string): Buffer {
    const base32Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const output: number[] = [];
    let bits = 0;
    let value = 0;

    // Strip padding characters (=)
    input = input.replace(/=+$/, '');

    for (let i = 0; i < input.length; i++) {
      const char = input[i];
      if (!char) continue;
      const charIndex = base32Chars.indexOf(char.toUpperCase());
      if (charIndex === -1) continue;

      value = (value << 5) | charIndex;
      bits += 5;

      if (bits >= 8) {
        output.push((value >>> (bits - 8)) & 255);
        bits -= 8;
      }
    }

    return Buffer.from(output);
  }

  /**
   * Check rate limit for verification attempts
   */
  private async checkRateLimit(userId: string): Promise<boolean> {
    const attempts = await this.getFailureCount(userId);
    return attempts < this.maxAttempts;
  }

  /**
   * Get failure count
   */
  private async getFailureCount(userId: string): Promise<number> {
    const count = await this.redis.get(this.attemptsKey(userId));
    return count ? parseInt(count, 10) : 0;
  }

  /**
   * Increment failure count
   */
  private async incrementFailureCount(userId: string): Promise<void> {
    const key = this.attemptsKey(userId);
    const current = await this.getFailureCount(userId);

    if (current === 0) {
      // First failure, set with TTL
      await this.redis.setex(key, this.attemptWindow, '1');
    } else {
      await this.redis.incr(key);
    }
  }

  /**
   * Reset rate limit
   */
  private async resetRateLimit(userId: string): Promise<void> {
    await this.redis.del(this.attemptsKey(userId));
  }

  /**
   * Get remaining attempts
   */
  private async getRemainingAttempts(userId: string): Promise<number> {
    const attempts = await this.getFailureCount(userId);
    return Math.max(0, this.maxAttempts - attempts);
  }

  /**
   * Update last verified timestamp
   */
  private async updateLastVerified(userId: string): Promise<void> {
    const config = await this.getConfig(userId);
    if (config) {
      config.lastVerifiedAt = new Date();
      await this.redis.setex(this.configKey(userId), 86400 * 365, JSON.stringify(config));
    }
  }

  /**
   * Redis key helpers
   */
  private configKey(userId: string): string {
    return `mfa:config:${userId}`;
  }

  private secretKey(userId: string): string {
    return `mfa:secret:${userId}`;
  }

  private backupCodesKey(userId: string): string {
    return `mfa:backup_codes:${userId}`;
  }

  private attemptsKey(userId: string): string {
    return `mfa:attempts:${userId}`;
  }

  /**
   * Debug logging
   */
  private log(message: string, context?: Record<string, unknown>): void {
    if (this.debug) {
      console.log(`[MFAService] ${message}`, context ?? '');
    }
  }
}
