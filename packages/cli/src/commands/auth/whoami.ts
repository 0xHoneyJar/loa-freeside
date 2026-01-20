/**
 * Whoami Command for Gom Jabbar CLI Authentication
 *
 * Sprint 141: CLI Authentication Commands
 *
 * Displays current authentication status, including username, roles,
 * and session expiry information.
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
  getCredentialsPath,
} from './credentials.js';

// =============================================================================
// Types
// =============================================================================

interface WhoamiOptions {
  json?: boolean;
  quiet?: boolean;
}

// =============================================================================
// Whoami Command
// =============================================================================

/**
 * Execute the whoami command
 *
 * @param options - Command options
 */
export async function whoamiCommand(options: WhoamiOptions): Promise<void> {
  const { json, quiet } = options;

  // Load credentials
  const credentials = await loadCredentials();

  if (!credentials) {
    if (json) {
      console.log(JSON.stringify({
        authenticated: false,
        error: 'Not authenticated',
      }));
    } else {
      console.log(chalk.yellow('Not authenticated'));
      console.log('Run: gaib auth login');
    }
    process.exit(1);
  }

  // Check expiry
  const expired = isSessionExpired(credentials);
  const expiringSoon = isSessionExpiringSoon(credentials);
  const hoursRemaining = getSessionHoursRemaining(credentials);
  const expiresAt = new Date(credentials.expiresAt);

  if (expired) {
    if (json) {
      console.log(JSON.stringify({
        authenticated: false,
        error: 'Session expired',
        username: credentials.username,
        expiredAt: credentials.expiresAt,
      }));
    } else {
      console.log(chalk.red('Session expired'));
      console.log(`Username: ${credentials.username}`);
      console.log(`Expired at: ${expiresAt.toLocaleString()}`);
      console.log();
      console.log('Run: gaib auth login');
    }
    process.exit(1);
  }

  // Output current status
  if (json) {
    console.log(JSON.stringify({
      authenticated: true,
      username: credentials.username,
      roles: credentials.roles,
      sandboxAccess: credentials.sandboxAccess,
      serverUrl: credentials.serverUrl,
      expiresAt: credentials.expiresAt,
      hoursRemaining: Math.round(hoursRemaining * 100) / 100,
      expiringSoon,
      requirePasswordChange: credentials.requirePasswordChange,
    }));
  } else {
    console.log(chalk.green(`Logged in as ${chalk.bold(credentials.username)}`));
    console.log();

    // Server
    console.log(`Server: ${chalk.dim(credentials.serverUrl)}`);

    // Roles
    const roleDisplay = credentials.roles.map(role => {
      switch (role) {
        case 'admin': return chalk.red(role);
        case 'qa_admin': return chalk.yellow(role);
        case 'qa_tester': return chalk.blue(role);
        default: return role;
      }
    }).join(', ');
    console.log(`Roles: ${roleDisplay}`);

    // Sandbox access
    if (credentials.sandboxAccess.length > 0) {
      const accessDisplay = credentials.sandboxAccess.includes('*')
        ? chalk.green('* (all sandboxes)')
        : credentials.sandboxAccess.join(', ');
      console.log(`Sandbox access: ${accessDisplay}`);
    } else {
      console.log(`Sandbox access: ${chalk.dim('none')}`);
    }

    console.log();

    // Session info
    if (expiringSoon) {
      const minutes = Math.round(hoursRemaining * 60);
      console.log(chalk.yellow(`Session expires: ${expiresAt.toLocaleString()}`));
      console.log(chalk.yellow(`Warning: Session expires in ${minutes} minute${minutes !== 1 ? 's' : ''}`));
    } else {
      console.log(`Session expires: ${expiresAt.toLocaleString()}`);

      if (hoursRemaining < 24) {
        const displayHours = Math.floor(hoursRemaining);
        const displayMinutes = Math.round((hoursRemaining - displayHours) * 60);
        console.log(chalk.dim(`(${displayHours}h ${displayMinutes}m remaining)`));
      } else {
        const displayDays = Math.floor(hoursRemaining / 24);
        const displayHours = Math.round(hoursRemaining % 24);
        console.log(chalk.dim(`(${displayDays}d ${displayHours}h remaining)`));
      }
    }

    // Password change warning
    if (credentials.requirePasswordChange) {
      console.log();
      console.log(chalk.yellow('Note: Password change required'));
      console.log('Run: gaib auth change-password');
    }

    // Credential location
    if (!quiet) {
      console.log();
      console.log(chalk.dim(`Credentials: ${getCredentialsPath()}`));
    }
  }
}

export default whoamiCommand;
