/**
 * Login Command for Gom Jabbar CLI Authentication
 *
 * Sprint 141: CLI Authentication Commands
 *
 * Authenticates a user with username/password and stores the session token.
 *
 * @see grimoires/loa/sdd.md §13.3.3 CLI Authentication Commands
 * @see grimoires/loa/prd.md §12 Gom Jabbar
 */

import * as readline from 'readline/promises';
import chalk from 'chalk';
import ora from 'ora';
import {
  storeCredentials,
  loadCredentials,
  isSessionExpired,
  getCredentialsPath,
} from './credentials.js';

// =============================================================================
// Types
// =============================================================================

interface LoginOptions {
  username?: string;
  server: string;
  json?: boolean;
  quiet?: boolean;
}

interface LoginResponse {
  success: boolean;
  user?: {
    id: string;
    username: string;
    roles: string[];
    sandboxAccess: string[];
    requirePasswordChange?: boolean;
  };
  token?: string;
  expiresAt?: string;
  error?: string;
  remainingAttempts?: number;
  lockedUntil?: string;
}

// =============================================================================
// Login Command
// =============================================================================

/**
 * Execute the login command
 *
 * @param options - Command options
 */
export async function loginCommand(options: LoginOptions): Promise<void> {
  const { server, json, quiet } = options;

  // Check if already logged in
  const existing = await loadCredentials();
  if (existing && !isSessionExpired(existing)) {
    if (json) {
      console.log(JSON.stringify({
        success: false,
        error: 'Already logged in',
        username: existing.username,
      }));
      process.exit(1);
    }
    console.log(chalk.yellow(`Already logged in as ${existing.username}`));
    console.log('Run: gaib auth logout');
    process.exit(1);
  }

  // Get username
  let username = options.username;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    if (!username) {
      username = await rl.question('Username: ');
    }

    if (!username.trim()) {
      if (json) {
        console.log(JSON.stringify({ success: false, error: 'Username required' }));
      } else {
        console.error(chalk.red('Username required'));
      }
      process.exit(1);
    }

    // Get password (hidden input)
    const password = await askPassword(rl, 'Password: ');

    if (!password) {
      if (json) {
        console.log(JSON.stringify({ success: false, error: 'Password required' }));
      } else {
        console.error(chalk.red('Password required'));
      }
      process.exit(1);
    }

    // Attempt login
    const spinner = !quiet && !json ? ora('Authenticating...').start() : null;

    try {
      const response = await fetch(`${server}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          password,
          sessionType: 'cli',
        }),
      });

      const data = await response.json() as LoginResponse;

      if (!response.ok || !data.success) {
        spinner?.fail('Authentication failed');

        if (json) {
          console.log(JSON.stringify({
            success: false,
            error: data.error || 'Invalid credentials',
            remainingAttempts: data.remainingAttempts,
            lockedUntil: data.lockedUntil,
          }));
        } else {
          console.error(chalk.red(data.error || 'Invalid credentials'));

          if (data.remainingAttempts !== undefined && data.remainingAttempts > 0) {
            console.error(chalk.yellow(`${data.remainingAttempts} attempt${data.remainingAttempts !== 1 ? 's' : ''} remaining`));
          }

          if (data.lockedUntil) {
            const lockTime = new Date(data.lockedUntil);
            console.error(chalk.red(`Account locked until ${lockTime.toLocaleString()}`));
          }
        }

        process.exit(1);
      }

      // Store credentials
      await storeCredentials({
        sessionToken: data.token!,
        username: data.user!.username,
        roles: data.user!.roles,
        sandboxAccess: data.user!.sandboxAccess,
        expiresAt: data.expiresAt!,
        serverUrl: server,
        requirePasswordChange: data.user!.requirePasswordChange,
      });

      spinner?.succeed('Authenticated successfully');

      if (json) {
        console.log(JSON.stringify({
          success: true,
          username: data.user!.username,
          roles: data.user!.roles,
          sandboxAccess: data.user!.sandboxAccess,
          expiresAt: data.expiresAt,
          requirePasswordChange: data.user!.requirePasswordChange,
        }));
      } else {
        console.log();
        console.log(chalk.green(`Logged in as ${chalk.bold(data.user!.username)}`));
        console.log(`Roles: ${data.user!.roles.join(', ')}`);

        if (data.user!.sandboxAccess.length > 0) {
          console.log(`Sandbox access: ${data.user!.sandboxAccess.join(', ')}`);
        }

        const expiresAt = new Date(data.expiresAt!);
        console.log(`Session expires: ${expiresAt.toLocaleString()}`);

        if (data.user!.requirePasswordChange) {
          console.log();
          console.log(chalk.yellow('Note: Password change required'));
          console.log('Run: gaib auth change-password');
        }

        if (!quiet) {
          console.log();
          console.log(chalk.dim(`Credentials stored in ${getCredentialsPath()}`));
        }
      }
    } catch (error) {
      spinner?.fail('Connection failed');

      if (json) {
        console.log(JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : 'Connection failed',
        }));
      } else {
        console.error(chalk.red('Failed to connect to server'));
        console.error(chalk.dim(error instanceof Error ? error.message : String(error)));
      }

      process.exit(1);
    }
  } finally {
    rl.close();
  }
}

/**
 * Ask for password with hidden input
 *
 * @param rl - Readline interface
 * @param prompt - Prompt to display
 * @returns Entered password
 */
async function askPassword(
  _rl: readline.Interface,
  prompt: string
): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;

    // Output the prompt
    stdout.write(prompt);

    // Store original mode
    const wasRaw = stdin.isRaw;

    // Set raw mode if available (for terminal input)
    if (stdin.isTTY && stdin.setRawMode) {
      stdin.setRawMode(true);
    }

    let password = '';

    const onData = (char: Buffer) => {
      const c = char.toString('utf8');

      switch (c) {
        case '\n':
        case '\r':
        case '\u0004': // Ctrl+D
          // Restore mode and clean up
          if (stdin.isTTY && stdin.setRawMode) {
            stdin.setRawMode(wasRaw ?? false);
          }
          stdin.removeListener('data', onData);
          stdout.write('\n');
          resolve(password);
          break;
        case '\u0003': // Ctrl+C
          // Exit cleanly
          if (stdin.isTTY && stdin.setRawMode) {
            stdin.setRawMode(wasRaw ?? false);
          }
          stdin.removeListener('data', onData);
          stdout.write('\n');
          process.exit(130);
          break;
        case '\u007F': // Backspace
        case '\b':
          if (password.length > 0) {
            password = password.slice(0, -1);
          }
          break;
        default:
          // Only add printable characters
          if (c.length === 1 && c.charCodeAt(0) >= 32) {
            password += c;
          }
      }
    };

    stdin.on('data', onData);
    stdin.resume();
  });
}

export default loginCommand;
