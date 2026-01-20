/**
 * Logout Command for Gom Jabbar CLI Authentication
 *
 * Sprint 141: CLI Authentication Commands
 *
 * Clears stored credentials and optionally notifies the server to
 * invalidate the session.
 *
 * @see grimoires/loa/sdd.md §13.3.3 CLI Authentication Commands
 * @see grimoires/loa/prd.md §12 Gom Jabbar
 */

import chalk from 'chalk';
import ora from 'ora';
import {
  loadCredentials,
  clearCredentials,
  getCredentialsPath,
} from './credentials.js';

// =============================================================================
// Types
// =============================================================================

interface LogoutOptions {
  json?: boolean;
  quiet?: boolean;
}

// =============================================================================
// Logout Command
// =============================================================================

/**
 * Execute the logout command
 *
 * @param options - Command options
 */
export async function logoutCommand(options: LogoutOptions): Promise<void> {
  const { json, quiet } = options;

  // Load existing credentials
  const credentials = await loadCredentials();

  if (!credentials) {
    if (json) {
      console.log(JSON.stringify({ success: true, message: 'Not logged in' }));
    } else if (!quiet) {
      console.log('Not logged in');
    }
    return;
  }

  const spinner = !quiet && !json ? ora('Logging out...').start() : null;

  // Notify server to invalidate session (best effort)
  try {
    await fetch(`${credentials.serverUrl}/api/auth/logout`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${credentials.sessionToken}`,
        'Content-Type': 'application/json',
      },
    });
  } catch {
    // Server might be unavailable, continue with local logout
  }

  // Clear local credentials
  await clearCredentials();

  spinner?.succeed('Logged out successfully');

  if (json) {
    console.log(JSON.stringify({
      success: true,
      username: credentials.username,
      message: 'Logged out successfully',
    }));
  } else if (!quiet) {
    console.log(chalk.green(`Logged out from ${chalk.bold(credentials.username)}`));
    console.log(chalk.dim(`Cleared credentials from ${getCredentialsPath()}`));
  }
}

export default logoutCommand;
