/**
 * Duo MFA Verifier - Hardware MFA for CRITICAL Tier Operations
 *
 * Sprint 68: MFA Hardening & Observability
 *
 * Implements the IMfaVerifier interface using Duo Security Web SDK for
 * hardware-backed MFA (push notifications, hardware tokens).
 *
 * Used for CRITICAL tier HITL approvals where software TOTP is insufficient.
 *
 * Configuration Environment Variables:
 * - DUO_INTEGRATION_KEY: Duo integration key (ikey)
 * - DUO_SECRET_KEY: Duo secret key (skey)
 * - DUO_API_HOSTNAME: Duo API hostname (e.g., api-XXXXXXXX.duosecurity.com)
 *
 * @module packages/security/mfa/DuoMfaVerifier
 */

import * as crypto from 'crypto';
import type { MfaVerifier } from '../../infrastructure/EnhancedHITLApprovalGate.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Duo MFA Verifier configuration
 */
export interface DuoMfaVerifierConfig {
  /** Duo integration key (ikey) */
  integrationKey: string;
  /** Duo secret key (skey) */
  secretKey: string;
  /** Duo API hostname */
  apiHostname: string;
  /** Verification timeout in milliseconds (default: 60000 = 60s) */
  verificationTimeoutMs?: number;
  /** Enable debug logging */
  debug?: boolean;
  /** HTTP client for API calls (injectable for testing) */
  httpClient?: DuoHttpClient;
  /** Application secret for signing (akey) - generated if not provided */
  applicationKey?: string;
}

/**
 * HTTP client interface for Duo API calls
 */
export interface DuoHttpClient {
  post(
    url: string,
    params: Record<string, string>,
    headers: Record<string, string>
  ): Promise<DuoApiResponse>;
}

/**
 * Duo API response data structure
 */
export interface DuoApiResponseData {
  response?: {
    result?: 'allow' | 'deny';
    status?: string;
    status_msg?: string;
    txid?: string;
  };
  stat: 'OK' | 'FAIL';
  message?: string;
  message_detail?: string;
}

/**
 * Duo API response structure
 */
export interface DuoApiResponse {
  status: number;
  data: DuoApiResponseData;
}

/**
 * Duo verification result
 */
export interface DuoVerificationResult {
  success: boolean;
  method: 'duo_push' | 'duo_passcode' | 'duo_phone';
  transactionId?: string;
  status?: string;
  error?: string;
}

// =============================================================================
// Constants
// =============================================================================

/** Default verification timeout (60 seconds for push approval) */
const DEFAULT_VERIFICATION_TIMEOUT_MS = 60_000;

/** Duo Auth API version */
const DUO_API_VERSION = '/auth/v2';

/** Application key length (for signing) */
const APP_KEY_LENGTH = 40;

/** Signature expiration time (5 minutes) */
const SIGNATURE_EXPIRE_SECS = 300;

// =============================================================================
// Implementation
// =============================================================================

/**
 * DuoMfaVerifier - Hardware MFA implementation using Duo Security
 *
 * Implements IMfaVerifier interface for use with EnhancedHITLApprovalGate.
 *
 * @example
 * ```typescript
 * const duoVerifier = new DuoMfaVerifier({
 *   integrationKey: process.env.DUO_INTEGRATION_KEY!,
 *   secretKey: process.env.DUO_SECRET_KEY!,
 *   apiHostname: process.env.DUO_API_HOSTNAME!,
 * });
 *
 * // Verify with push notification (code is 'push')
 * const result = await duoVerifier.verify('user@example.com', 'push');
 *
 * // Verify with passcode from hardware token
 * const result = await duoVerifier.verify('user@example.com', '123456');
 * ```
 */
export class DuoMfaVerifier implements MfaVerifier {
  private readonly config: Required<Omit<DuoMfaVerifierConfig, 'httpClient'>> & {
    httpClient?: DuoHttpClient;
  };
  private readonly httpClient: DuoHttpClient;

  constructor(config: DuoMfaVerifierConfig) {
    // Validate required configuration
    if (!config.integrationKey) {
      throw new Error('Duo integration key is required');
    }
    if (!config.secretKey) {
      throw new Error('Duo secret key is required');
    }
    if (!config.apiHostname) {
      throw new Error('Duo API hostname is required');
    }

    // Generate application key if not provided
    const applicationKey = config.applicationKey || this.generateApplicationKey();

    this.config = {
      integrationKey: config.integrationKey,
      secretKey: config.secretKey,
      apiHostname: config.apiHostname,
      verificationTimeoutMs: config.verificationTimeoutMs ?? DEFAULT_VERIFICATION_TIMEOUT_MS,
      debug: config.debug ?? false,
      applicationKey,
    };

    this.httpClient = config.httpClient ?? this.createDefaultHttpClient();
  }

  /**
   * Verify MFA code for a user
   *
   * @param userId - User identifier (email or username)
   * @param code - MFA code: 'push' for push notification, or 6-digit passcode
   * @returns True if verification succeeded, false if failed
   * @throws Error if system error occurs (network, invalid configuration)
   */
  async verify(userId: string, code: string): Promise<boolean> {
    this.log('Verifying Duo MFA', { userId, method: code === 'push' ? 'push' : 'passcode' });

    try {
      // Determine verification method based on code
      if (code.toLowerCase() === 'push') {
        return await this.verifyWithPush(userId);
      }

      // Assume numeric code is a passcode (hardware token or app)
      if (/^\d{6,8}$/.test(code)) {
        return await this.verifyWithPasscode(userId, code);
      }

      // Invalid code format
      this.log('Invalid Duo code format', { userId, codeLength: code.length });
      return false;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.log('Duo verification error', { userId, error: errorMessage });

      // Rethrow system errors (network, configuration)
      throw new Error(`Duo MFA verification failed: ${errorMessage}`);
    }
  }

  /**
   * Verify using Duo Push notification
   */
  private async verifyWithPush(userId: string): Promise<boolean> {
    const result = await this.duoAuth({
      username: userId,
      factor: 'push',
      device: 'auto',
    });

    return result.success;
  }

  /**
   * Verify using passcode (hardware token or Duo Mobile)
   */
  private async verifyWithPasscode(userId: string, passcode: string): Promise<boolean> {
    const result = await this.duoAuth({
      username: userId,
      factor: 'passcode',
      passcode,
    });

    return result.success;
  }

  /**
   * Make Duo Auth API call
   */
  private async duoAuth(params: {
    username: string;
    factor: 'push' | 'passcode' | 'phone';
    device?: string;
    passcode?: string;
  }): Promise<DuoVerificationResult> {
    const timestamp = Math.floor(Date.now() / 1000);
    const path = `${DUO_API_VERSION}/auth`;
    const url = `https://${this.config.apiHostname}${path}`;

    // Build request parameters
    const requestParams: Record<string, string> = {
      username: params.username,
      factor: params.factor,
      ipaddr: '0.0.0.0', // Client IP (placeholder)
    };

    if (params.device) {
      requestParams.device = params.device;
    }

    if (params.passcode) {
      requestParams.passcode = params.passcode;
    }

    // Sign the request
    const signature = this.signRequest('POST', path, requestParams, timestamp);
    const authHeader = `Basic ${Buffer.from(`${this.config.integrationKey}:${signature}`).toString('base64')}`;

    // Make API call
    const response = await this.httpClient.post(url, requestParams, {
      'Authorization': authHeader,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Date': new Date(timestamp * 1000).toUTCString(),
    });

    // Parse response
    if (response.data.stat !== 'OK') {
      this.log('Duo API error', {
        message: response.data.message,
        detail: response.data.message_detail,
      });
      return {
        success: false,
        method: this.getMethodFromFactor(params.factor),
        error: response.data.message || 'Duo API error',
      };
    }

    const duoResponse = response.data.response;
    if (!duoResponse) {
      return {
        success: false,
        method: this.getMethodFromFactor(params.factor),
        error: 'Empty Duo response',
      };
    }

    return {
      success: duoResponse.result === 'allow',
      method: this.getMethodFromFactor(params.factor),
      transactionId: duoResponse.txid,
      status: duoResponse.status,
      error: duoResponse.result === 'deny' ? duoResponse.status_msg : undefined,
    };
  }

  /**
   * Sign a Duo API request using HMAC-SHA1
   */
  private signRequest(
    method: string,
    path: string,
    params: Record<string, string>,
    timestamp: number
  ): string {
    // Sort parameters alphabetically
    const sortedParams = Object.keys(params)
      .sort()
      .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key] ?? '')}`)
      .join('&');

    // Build canonical request
    const date = new Date(timestamp * 1000).toUTCString();
    const canonicalRequest = [
      date,
      method.toUpperCase(),
      this.config.apiHostname.toLowerCase(),
      path,
      sortedParams,
    ].join('\n');

    // Sign with HMAC-SHA1
    const hmac = crypto.createHmac('sha1', this.config.secretKey);
    hmac.update(canonicalRequest);
    return hmac.digest('hex');
  }

  /**
   * Generate signed request for Duo Web SDK (iframe integration)
   *
   * Used when integrating Duo into a web application with the Duo Web SDK.
   */
  generateSignedRequest(userId: string): string {
    const duoSig = this.signValue(
      this.config.secretKey,
      userId,
      this.config.integrationKey,
      'TX'
    );
    const appSig = this.signValue(
      this.config.applicationKey,
      userId,
      this.config.integrationKey,
      'APP'
    );
    return `${duoSig}:${appSig}`;
  }

  /**
   * Verify signed response from Duo Web SDK
   */
  verifySignedResponse(signedResponse: string, userId: string): boolean {
    const [authSig, appSig] = signedResponse.split(':');
    if (!authSig || !appSig) {
      return false;
    }

    const authUser = this.parseValue(this.config.secretKey, authSig, 'AUTH');
    const appUser = this.parseValue(this.config.applicationKey, appSig, 'APP');

    if (!authUser || !appUser) {
      return false;
    }

    return authUser === userId && appUser === userId;
  }

  /**
   * Sign a value for Duo Web SDK
   */
  private signValue(
    key: string,
    userId: string,
    ikey: string,
    prefix: string
  ): string {
    const expire = Math.floor(Date.now() / 1000) + SIGNATURE_EXPIRE_SECS;
    const value = `${userId}|${ikey}|${expire}`;
    const cookie = `${prefix}|${Buffer.from(value).toString('base64')}`;

    const hmac = crypto.createHmac('sha1', key);
    hmac.update(cookie);
    const sig = hmac.digest('hex');

    return `${cookie}|${sig}`;
  }

  /**
   * Parse a signed value from Duo Web SDK
   */
  private parseValue(key: string, signedValue: string, prefix: string): string | null {
    const parts = signedValue.split('|');
    if (parts.length !== 3) {
      return null;
    }

    const [sigPrefix, b64Value, sig] = parts;
    if (sigPrefix !== prefix) {
      return null;
    }

    // Verify signature
    const cookie = `${sigPrefix}|${b64Value}`;
    const hmac = crypto.createHmac('sha1', key);
    hmac.update(cookie);
    const expectedSig = hmac.digest('hex');

    if (sig !== expectedSig) {
      return null;
    }

    // Decode and validate expiration
    const value = Buffer.from(b64Value ?? '', 'base64').toString();
    const valueParts = value.split('|');
    if (valueParts.length !== 3) {
      return null;
    }

    const userId = valueParts[0];
    const expireStr = valueParts[2];
    if (!userId || !expireStr) {
      return null;
    }
    const expire = parseInt(expireStr, 10);
    if (isNaN(expire) || expire < Math.floor(Date.now() / 1000)) {
      return null; // Expired
    }

    return userId;
  }

  /**
   * Generate a secure application key
   */
  private generateApplicationKey(): string {
    return crypto.randomBytes(APP_KEY_LENGTH).toString('hex').slice(0, APP_KEY_LENGTH);
  }

  /**
   * Map Duo factor to method name
   */
  private getMethodFromFactor(factor: string): 'duo_push' | 'duo_passcode' | 'duo_phone' {
    switch (factor) {
      case 'push':
        return 'duo_push';
      case 'phone':
        return 'duo_phone';
      default:
        return 'duo_passcode';
    }
  }

  /**
   * Create default HTTP client using fetch
   */
  private createDefaultHttpClient(): DuoHttpClient {
    return {
      async post(
        url: string,
        params: Record<string, string>,
        headers: Record<string, string>
      ): Promise<DuoApiResponse> {
        const body = new URLSearchParams(params).toString();

        const response = await fetch(url, {
          method: 'POST',
          headers,
          body,
        });

        const data = (await response.json()) as DuoApiResponseData;

        return {
          status: response.status,
          data,
        };
      },
    };
  }

  /**
   * Debug logging
   */
  private log(message: string, context?: Record<string, unknown>): void {
    if (this.config.debug) {
      console.log(`[DuoMfaVerifier] ${message}`, context ?? '');
    }
  }
}

/**
 * Factory function to create DuoMfaVerifier from environment variables
 */
export function createDuoMfaVerifierFromEnv(options?: {
  debug?: boolean;
  httpClient?: DuoHttpClient;
}): DuoMfaVerifier {
  const integrationKey = process.env.DUO_INTEGRATION_KEY;
  const secretKey = process.env.DUO_SECRET_KEY;
  const apiHostname = process.env.DUO_API_HOSTNAME;

  if (!integrationKey || !secretKey || !apiHostname) {
    throw new Error(
      'Duo MFA environment variables not configured. ' +
        'Required: DUO_INTEGRATION_KEY, DUO_SECRET_KEY, DUO_API_HOSTNAME'
    );
  }

  return new DuoMfaVerifier({
    integrationKey,
    secretKey,
    apiHostname,
    debug: options?.debug,
    httpClient: options?.httpClient,
  });
}

/**
 * Check if Duo MFA is configured
 */
export function isDuoConfigured(): boolean {
  return !!(
    process.env.DUO_INTEGRATION_KEY &&
    process.env.DUO_SECRET_KEY &&
    process.env.DUO_API_HOSTNAME
  );
}
