/**
 * Arrakis Developer CLI
 *
 * Sprint 85: Discord Server Sandboxes - CLI Commands
 *
 * Provides CLI commands for managing Discord server sandboxes
 * and other Arrakis developer tools.
 *
 * @module @arrakis/cli
 */

// =============================================================================
// Command Exports
// =============================================================================

export { createSandboxCommand, registerCommands } from './commands/index.js';

// =============================================================================
// Utility Exports
// =============================================================================

export {
  getSandboxManager,
  closeSandboxManager,
  getCurrentUser,
  parseTTL,
  formatDate,
  formatDuration,
  timeUntil,
  handleError,
  createSilentLogger,
  DEFAULT_TTL_HOURS,
  MAX_TTL_HOURS,
} from './commands/sandbox/utils.js';
