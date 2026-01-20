/**
 * Password Hashing Utilities for Gom Jabbar
 *
 * Sprint 139: Database Schema & Core Models
 *
 * Uses Argon2id for password hashing as specified in SDD §13.3.2:
 * - Memory cost: 64MB (65536 KiB)
 * - Time cost: 3 iterations
 * - Parallelism: 4 threads
 * - Salt length: 16 bytes (auto-generated)
 * - Hash length: 32 bytes
 *
 * @see grimoires/loa/sdd.md §13.3.2 Password Storage
 */

import * as argon2 from 'argon2';
import { randomBytes, createHash } from 'crypto';
import { logger } from './logger.js';

/**
 * Argon2id configuration matching SDD specifications
 */
const ARGON2_CONFIG: argon2.Options = {
  type: argon2.argon2id,      // Argon2id variant (hybrid of Argon2i and Argon2d)
  memoryCost: 65536,          // 64MB memory
  timeCost: 3,                // 3 iterations
  parallelism: 4,             // 4 parallel threads
  hashLength: 32,             // 32 byte output
};

/**
 * Password validation requirements
 */
export interface PasswordRequirements {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumbers: boolean;
  requireSpecial: boolean;
}

/**
 * Default password requirements from SDD §13.2
 */
export const DEFAULT_PASSWORD_REQUIREMENTS: PasswordRequirements = {
  minLength: 12,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecial: true,
};

/**
 * Validation result for password strength
 */
export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Hash a password using Argon2id
 *
 * @param password - Plain text password to hash
 * @returns Argon2id hash string (includes algorithm params and salt)
 */
export async function hashPassword(password: string): Promise<string> {
  try {
    const hash = await argon2.hash(password, ARGON2_CONFIG);
    return hash;
  } catch (error) {
    logger.error({ error }, 'Failed to hash password');
    throw new Error('Password hashing failed');
  }
}

/**
 * Verify a password against an Argon2id hash
 *
 * @param password - Plain text password to verify
 * @param hash - Stored Argon2id hash
 * @returns true if password matches, false otherwise
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch (error) {
    // Log error but don't expose details
    logger.debug({ error }, 'Password verification failed');
    return false;
  }
}

/**
 * Check if a hash needs rehashing (e.g., if config changed)
 *
 * @param hash - Existing Argon2id hash
 * @returns true if hash should be regenerated
 */
export async function needsRehash(hash: string): Promise<boolean> {
  try {
    return argon2.needsRehash(hash, ARGON2_CONFIG);
  } catch {
    // If we can't check, assume it needs rehash
    return true;
  }
}

/**
 * Validate password meets strength requirements
 *
 * @param password - Password to validate
 * @param requirements - Password requirements (defaults to SDD spec)
 * @returns Validation result with any errors
 */
export function validatePasswordStrength(
  password: string,
  requirements: PasswordRequirements = DEFAULT_PASSWORD_REQUIREMENTS
): PasswordValidationResult {
  const errors: string[] = [];

  if (password.length < requirements.minLength) {
    errors.push(`Password must be at least ${requirements.minLength} characters`);
  }

  if (requirements.requireUppercase && !/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }

  if (requirements.requireLowercase && !/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }

  if (requirements.requireNumbers && !/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }

  if (requirements.requireSpecial && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Generate a random password meeting requirements
 *
 * @param length - Password length (minimum 12)
 * @returns Randomly generated password
 */
export function generateRandomPassword(length: number = 16): string {
  if (length < 12) {
    length = 12;
  }

  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const numbers = '0123456789';
  const special = '!@#$%^&*()_+-=[]{}|;:,.<>?';
  const all = uppercase + lowercase + numbers + special;

  // Ensure at least one of each required type
  let password = '';
  password += uppercase[randomInt(uppercase.length)];
  password += lowercase[randomInt(lowercase.length)];
  password += numbers[randomInt(numbers.length)];
  password += special[randomInt(special.length)];

  // Fill remaining with random characters
  for (let i = password.length; i < length; i++) {
    password += all[randomInt(all.length)];
  }

  // Shuffle the password
  return shuffleString(password);
}

/**
 * Generate a cryptographically secure random integer
 */
function randomInt(max: number): number {
  const bytes = randomBytes(4);
  const value = bytes.readUInt32BE(0);
  return value % max;
}

/**
 * Shuffle a string using Fisher-Yates algorithm
 */
function shuffleString(str: string): string {
  const arr = str.split('');
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const temp = arr[i];
    arr[i] = arr[j]!;
    arr[j] = temp!;
  }
  return arr.join('');
}

/**
 * Generate a secure session token
 *
 * @param bytes - Number of bytes (default 32 = 256 bits)
 * @returns Hex-encoded token
 */
export function generateSessionToken(bytes: number = 32): string {
  return randomBytes(bytes).toString('hex');
}

/**
 * Hash a session token for storage (using SHA-256)
 * Session tokens are stored hashed, not plain text
 *
 * @param token - Plain session token
 * @returns SHA-256 hash of token
 */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
