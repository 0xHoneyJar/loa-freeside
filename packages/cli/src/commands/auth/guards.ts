/**
 * Authentication Guards for Gom Jabbar CLI
 *
 * Sprint 141: CLI Authentication Commands
 *
 * Middleware functions for requiring authentication and role-based access
 * control in CLI commands.
 *
 * @see grimoires/loa/sdd.md §13.3.3 CLI Authentication Commands
 * @see grimoires/loa/prd.md §12 Gom Jabbar
 */

import chalk from 'chalk';
import {
  loadCredentials,
  isSessionExpired,
  isSessionExpiringSoon,
  getSessionHoursRemaining,
  type StoredCredentials,
} from './credentials.js';

// =============================================================================
// Types
// =============================================================================

export type UserRole = 'admin' | 'qa_admin' | 'qa_tester';

// =============================================================================
// Authentication Guards
// =============================================================================

/**
 * Require authentication for a command
 *
 * Loads stored credentials and validates the session.
 * Exits with code 1 if not authenticated or session is expired.
 *
 * @returns Valid credentials
 */
export async function requireAuth(): Promise<StoredCredentials> {
  const credentials = await loadCredentials();

  if (!credentials) {
    console.error(chalk.red('Authentication required.'));
    console.error('Run: gaib auth login');
    process.exit(1);
  }

  if (isSessionExpired(credentials)) {
    console.error(chalk.red('Session expired.'));
    console.error('Run: gaib auth login');
    process.exit(1);
  }

  // Warn if session is expiring soon
  if (isSessionExpiringSoon(credentials)) {
    const minutes = Math.round(getSessionHoursRemaining(credentials) * 60);
    console.error(chalk.yellow(`Warning: Session expires in ${minutes} minute${minutes !== 1 ? 's' : ''}`));
  }

  return credentials;
}

/**
 * Require specific roles for a command
 *
 * Checks if the authenticated user has at least one of the required roles.
 * Exits with code 1 if the user doesn't have required roles.
 *
 * @param credentials - Authenticated user credentials
 * @param allowedRoles - List of roles that are allowed to execute the command
 */
export async function requireRoles(
  credentials: StoredCredentials,
  allowedRoles: UserRole[]
): Promise<void> {
  const userRoles = credentials.roles as UserRole[];

  const hasRequiredRole = allowedRoles.some(role => userRoles.includes(role));

  if (!hasRequiredRole) {
    console.error(chalk.red('Permission denied.'));
    console.error(`Required role: ${allowedRoles.join(' or ')}`);
    console.error(`Your roles: ${userRoles.join(', ')}`);
    process.exit(1);
  }
}

/**
 * Check if user has a specific role
 *
 * @param credentials - User credentials
 * @param role - Role to check
 * @returns True if user has the role
 */
export function hasRole(credentials: StoredCredentials, role: UserRole): boolean {
  return (credentials.roles as UserRole[]).includes(role);
}

/**
 * Check if user has any of the specified roles
 *
 * @param credentials - User credentials
 * @param roles - Roles to check
 * @returns True if user has at least one of the roles
 */
export function hasAnyRole(credentials: StoredCredentials, roles: UserRole[]): boolean {
  const userRoles = credentials.roles as UserRole[];
  return roles.some(role => userRoles.includes(role));
}

/**
 * Check if user can access a sandbox
 *
 * @param credentials - User credentials
 * @param sandboxId - Sandbox ID to check access for
 * @returns True if user can access the sandbox
 */
export function canAccessSandbox(credentials: StoredCredentials, sandboxId: string): boolean {
  // Admins have full access
  if (hasRole(credentials, 'admin')) {
    return true;
  }

  // Check sandbox access list
  const sandboxAccess = credentials.sandboxAccess || [];
  return sandboxAccess.includes(sandboxId) || sandboxAccess.includes('*');
}

/**
 * Require sandbox access for a command
 *
 * Exits with code 1 if user doesn't have access to the sandbox.
 *
 * @param credentials - User credentials
 * @param sandboxId - Sandbox ID to check access for
 */
export async function requireSandboxAccess(
  credentials: StoredCredentials,
  sandboxId: string
): Promise<void> {
  if (!canAccessSandbox(credentials, sandboxId)) {
    console.error(chalk.red('Sandbox access denied.'));
    console.error(`You don't have access to sandbox: ${sandboxId}`);
    console.error('Contact an administrator to request access.');
    process.exit(1);
  }
}
