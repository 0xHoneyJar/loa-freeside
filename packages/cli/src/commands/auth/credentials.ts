/**
 * Secure Credential Storage for Gom Jabbar CLI Authentication
 *
 * Sprint 141: CLI Authentication Commands
 *
 * Stores and retrieves session credentials in ~/.config/gaib/credentials.json
 * with secure file permissions (0600 - user read/write only).
 *
 * @see grimoires/loa/sdd.md §13.3.3 CLI Authentication Commands
 * @see grimoires/loa/prd.md §12 Gom Jabbar
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// =============================================================================
// Constants
// =============================================================================

const CONFIG_DIR = path.join(os.homedir(), '.config', 'gaib');
const CREDENTIALS_PATH = path.join(CONFIG_DIR, 'credentials.json');

// =============================================================================
// Types
// =============================================================================

/**
 * Stored credentials format
 */
export interface StoredCredentials {
  /** Session token for API authentication */
  sessionToken: string;
  /** Authenticated username */
  username: string;
  /** User's roles */
  roles: string[];
  /** Sandbox access list */
  sandboxAccess: string[];
  /** Session expiration timestamp (ISO 8601) */
  expiresAt: string;
  /** API server URL */
  serverUrl: string;
  /** Whether password change is required */
  requirePasswordChange?: boolean;
}

// =============================================================================
// Credential Storage Functions
// =============================================================================

/**
 * Store credentials securely
 *
 * Creates the config directory if it doesn't exist and writes
 * credentials with restrictive permissions (0600).
 *
 * @param credentials - Credentials to store
 */
export async function storeCredentials(credentials: StoredCredentials): Promise<void> {
  // Create config directory if it doesn't exist
  await fs.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });

  // Write credentials with restrictive permissions
  await fs.writeFile(
    CREDENTIALS_PATH,
    JSON.stringify(credentials, null, 2),
    { mode: 0o600 } // User read/write only
  );
}

/**
 * Load stored credentials
 *
 * @returns Stored credentials or null if not found/invalid
 */
export async function loadCredentials(): Promise<StoredCredentials | null> {
  try {
    const data = await fs.readFile(CREDENTIALS_PATH, 'utf-8');
    const credentials = JSON.parse(data) as StoredCredentials;

    // Validate required fields
    if (!credentials.sessionToken || !credentials.username || !credentials.expiresAt || !credentials.serverUrl) {
      return null;
    }

    return credentials;
  } catch {
    // File doesn't exist or is invalid
    return null;
  }
}

/**
 * Clear stored credentials
 *
 * Removes the credentials file if it exists.
 */
export async function clearCredentials(): Promise<void> {
  try {
    await fs.unlink(CREDENTIALS_PATH);
  } catch {
    // File might not exist, that's OK
  }
}

/**
 * Check if credentials exist
 *
 * @returns True if credentials file exists
 */
export async function hasCredentials(): Promise<boolean> {
  try {
    await fs.access(CREDENTIALS_PATH);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get credentials path for display
 *
 * @returns Path to credentials file
 */
export function getCredentialsPath(): string {
  return CREDENTIALS_PATH;
}

// =============================================================================
// Session Validation
// =============================================================================

/**
 * Check if session is expired
 *
 * @param credentials - Credentials to check
 * @returns True if session has expired
 */
export function isSessionExpired(credentials: StoredCredentials): boolean {
  const expiresAt = new Date(credentials.expiresAt);
  return expiresAt <= new Date();
}

/**
 * Get hours remaining until session expires
 *
 * @param credentials - Credentials to check
 * @returns Hours remaining (negative if expired)
 */
export function getSessionHoursRemaining(credentials: StoredCredentials): number {
  const expiresAt = new Date(credentials.expiresAt);
  const now = new Date();
  return (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60);
}

/**
 * Check if session is expiring soon (< 1 hour)
 *
 * @param credentials - Credentials to check
 * @returns True if session expires within 1 hour
 */
export function isSessionExpiringSoon(credentials: StoredCredentials): boolean {
  const hoursRemaining = getSessionHoursRemaining(credentials);
  return hoursRemaining > 0 && hoursRemaining < 1;
}
