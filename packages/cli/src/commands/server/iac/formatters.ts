/**
 * Output Formatters
 *
 * Sprint 101: Polish & Documentation
 *
 * Provides consistent output formatting for CLI commands with
 * support for color, tables, spinners, and JSON output.
 *
 * @see SDD §6.0 CLI Commands
 * @module packages/cli/commands/server/iac/formatters
 */

import chalk from 'chalk';
import type {
  ServerDiff,
  ResourceChange,
  PermissionChange,
  ApplyBatchResult,
  ChangeOperation,
} from './types.js';
import type { GaibState, StateResource } from './backends/types.js';

// ============================================================================
// Configuration
// ============================================================================

/**
 * Get chalk instance respecting color settings
 */
function getChalk(): typeof chalk {
  // chalk automatically respects NO_COLOR and TERM=dumb
  // shouldUseColor is checked for TTY, but chalk handles this
  return chalk;
}

// ============================================================================
// Symbols and Colors
// ============================================================================

/**
 * Operation symbols for diff display
 */
export const Symbols = {
  create: '+',
  update: '~',
  delete: '-',
  noop: ' ',
  success: '✓',
  error: '✗',
  warning: '⚠',
  info: 'ℹ',
  bullet: '•',
  arrow: '→',
} as const;

/**
 * Get colored operation symbol
 */
export function getOperationSymbol(operation: ChangeOperation): string {
  const c = getChalk();
  switch (operation) {
    case 'create':
      return c.green(Symbols.create);
    case 'update':
      return c.yellow(Symbols.update);
    case 'delete':
      return c.red(Symbols.delete);
    case 'noop':
      return c.dim(Symbols.noop);
    default:
      return ' ';
  }
}

/**
 * Get colored operation text
 */
export function colorByOperation(operation: ChangeOperation, text: string): string {
  const c = getChalk();
  switch (operation) {
    case 'create':
      return c.green(text);
    case 'update':
      return c.yellow(text);
    case 'delete':
      return c.red(text);
    case 'noop':
      return c.dim(text);
    default:
      return text;
  }
}

// ============================================================================
// Plan Formatting
// ============================================================================

/**
 * Format a resource change for display
 */
export function formatResourceChange<T>(
  change: ResourceChange<T>,
  resourceType: string
): string {
  const c = getChalk();
  const symbol = getOperationSymbol(change.operation);
  const typeName = colorByOperation(change.operation, resourceType);
  const name = change.name;

  let line = `  ${symbol} ${typeName}: ${name}`;

  // Show field changes for updates
  if (change.operation === 'update' && change.changes && change.changes.length > 0) {
    for (const fieldChange of change.changes) {
      line += `\n      ${c.dim(fieldChange.field)}: ${c.red(String(fieldChange.from))} ${Symbols.arrow} ${c.green(String(fieldChange.to))}`;
    }
  }

  return line;
}

/**
 * Format a permission change for display
 */
export function formatPermissionChange(change: PermissionChange): string {
  const symbol = getOperationSymbol(change.operation);
  const typeName = colorByOperation(change.operation, 'permission');

  return `  ${symbol} ${typeName}: ${change.targetName}/${change.subjectName}`;
}

/**
 * Format a plan summary header
 */
export function formatPlanSummary(diff: ServerDiff): string {
  const c = getChalk();
  const lines: string[] = [];

  lines.push(c.bold.cyan('\n🔍 Execution Plan\n'));
  lines.push(
    c.dim('  The following changes would be applied to bring Discord in sync with your config:\n')
  );

  lines.push(
    `  ${c.green(`${diff.summary.create} to create`)}, ` +
    `${c.yellow(`${diff.summary.update} to update`)}, ` +
    `${c.red(`${diff.summary.delete} to delete`)}\n`
  );

  return lines.join('\n');
}

/**
 * Format a plan result for human-readable display
 */
export function formatPlan(diff: ServerDiff): string {
  const c = getChalk();
  const lines: string[] = [];

  lines.push(formatPlanSummary(diff));

  if (!diff.hasChanges) {
    lines.push(c.dim('  No changes detected. Server is in sync with configuration.\n'));
    return lines.join('\n');
  }

  // Roles
  const roleChanges = diff.roles.filter((r) => r.operation !== 'noop');
  if (roleChanges.length > 0) {
    lines.push(c.bold('Roles:'));
    for (const change of roleChanges) {
      lines.push(formatResourceChange(change, 'role'));
    }
    lines.push('');
  }

  // Categories
  const categoryChanges = diff.categories.filter((c) => c.operation !== 'noop');
  if (categoryChanges.length > 0) {
    lines.push(c.bold('Categories:'));
    for (const change of categoryChanges) {
      lines.push(formatResourceChange(change, 'category'));
    }
    lines.push('');
  }

  // Channels
  const channelChanges = diff.channels.filter((c) => c.operation !== 'noop');
  if (channelChanges.length > 0) {
    lines.push(c.bold('Channels:'));
    for (const change of channelChanges) {
      lines.push(formatResourceChange(change, 'channel'));
    }
    lines.push('');
  }

  // Permissions
  const permissionChanges = diff.permissions.filter((p) => p.operation !== 'noop');
  if (permissionChanges.length > 0) {
    lines.push(c.bold('Permissions:'));
    for (const change of permissionChanges) {
      lines.push(formatPermissionChange(change));
    }
    lines.push('');
  }

  lines.push(c.dim('  To apply these changes, run: gaib server apply\n'));

  return lines.join('\n');
}

// ============================================================================
// Apply/Destroy Result Formatting
// ============================================================================

/**
 * Format an apply batch result for display
 */
export function formatApplyResult(result: ApplyBatchResult): string {
  const c = getChalk();
  const lines: string[] = [];

  if (result.success) {
    lines.push(c.green.bold(`\n${Symbols.success} Apply Complete!\n`));
  } else {
    lines.push(c.red.bold(`\n${Symbols.error} Apply Failed\n`));
  }

  // Summary
  const created = result.results.filter((r) => r.operation === 'create' && r.success).length;
  const updated = result.results.filter((r) => r.operation === 'update' && r.success).length;
  const deleted = result.results.filter((r) => r.operation === 'delete' && r.success).length;
  const failed = result.results.filter((r) => !r.success);

  lines.push(`  ${c.green(`${created} created`)}`);
  lines.push(`  ${c.yellow(`${updated} updated`)}`);
  lines.push(`  ${c.red(`${deleted} deleted`)}`);

  // Show errors if any
  if (failed.length > 0) {
    lines.push('');
    lines.push(c.red.bold('Errors:'));
    for (const error of failed) {
      const address = `${error.resourceType}.${error.resourceName}`;
      lines.push(`  ${c.red(Symbols.bullet)} ${address}: ${error.error ?? 'Unknown error'}`);
    }
  }

  // Duration
  if (result.totalDurationMs) {
    lines.push('');
    lines.push(c.dim(`  Duration: ${(result.totalDurationMs / 1000).toFixed(2)}s`));
  }

  lines.push('');

  return lines.join('\n');
}

/**
 * Format a destroy result for display
 */
export function formatDestroyResult(result: {
  success: boolean;
  destroyed: number;
  errors: Array<{ address: string; error: string }>;
  duration?: number;
}): string {
  const c = getChalk();
  const lines: string[] = [];

  if (result.success) {
    lines.push(c.green.bold(`\n${Symbols.success} Destroy Complete!\n`));
  } else {
    lines.push(c.red.bold(`\n${Symbols.error} Destroy Failed\n`));
  }

  lines.push(`  ${c.red(`${result.destroyed} resources destroyed`)}`);

  // Show errors if any
  if (result.errors.length > 0) {
    lines.push('');
    lines.push(c.red.bold('Errors:'));
    for (const error of result.errors) {
      lines.push(`  ${c.red(Symbols.bullet)} ${error.address}: ${error.error}`);
    }
  }

  // Duration
  if (result.duration) {
    lines.push('');
    lines.push(c.dim(`  Duration: ${(result.duration / 1000).toFixed(2)}s`));
  }

  lines.push('');

  return lines.join('\n');
}

// ============================================================================
// State List Formatting
// ============================================================================

/**
 * Format state resources as a table
 */
export function formatStateList(
  state: GaibState | null,
  workspace: string
): string {
  const c = getChalk();
  const lines: string[] = [];

  lines.push(c.blue(`${Symbols.info} Workspace: ${workspace}`));

  if (!state || state.resources.length === 0) {
    lines.push('');
    lines.push(c.yellow('No resources in state.'));
    lines.push('');
    return lines.join('\n');
  }

  lines.push(c.dim(`  State serial: ${state.serial}`));
  lines.push('');

  // Group by type
  const byType: Record<string, StateResource[]> = {};
  for (const resource of state.resources) {
    if (!byType[resource.type]) {
      byType[resource.type] = [];
    }
    byType[resource.type].push(resource);
  }

  // Calculate column widths
  const maxNameLen = Math.max(
    ...state.resources.map((r) => r.name.length),
    4 // "NAME"
  );
  const maxIdLen = Math.max(
    ...state.resources.map((r) => String(r.instances[0]?.attributes?.id ?? '').length),
    2 // "ID"
  );

  // Table header
  const nameCol = 'NAME'.padEnd(maxNameLen);
  const idCol = 'ID'.padEnd(maxIdLen);
  lines.push(c.dim(`  ${nameCol}  ${idCol}  DISCORD_NAME`));
  lines.push(c.dim('  ' + '-'.repeat(maxNameLen + maxIdLen + 20)));

  // Table rows by type
  for (const [type, resources] of Object.entries(byType)) {
    lines.push(c.bold(`\n  ${type}:`));
    for (const resource of resources) {
      const id = String(resource.instances[0]?.attributes?.id ?? 'unknown');
      const discordName = String(resource.instances[0]?.attributes?.name ?? resource.name);
      const namePadded = resource.name.padEnd(maxNameLen);
      const idPadded = id.padEnd(maxIdLen);
      lines.push(`  ${c.cyan(namePadded)}  ${c.dim(idPadded)}  ${discordName}`);
    }
  }

  lines.push('');
  lines.push(c.dim(`Total: ${state.resources.length} resource(s)`));
  lines.push('');

  return lines.join('\n');
}

// ============================================================================
// Progress Indicators
// ============================================================================

/**
 * Spinner frames for progress indication
 */
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Create a simple text spinner
 */
export class Spinner {
  private interval: ReturnType<typeof setInterval> | null = null;
  private frameIndex = 0;
  private message: string;
  private stream: NodeJS.WriteStream;

  constructor(message: string) {
    this.message = message;
    this.stream = process.stderr;
  }

  /**
   * Start the spinner
   */
  start(): void {
    if (!process.stderr.isTTY) {
      // Non-TTY: just print the message once
      this.stream.write(`${this.message}...\n`);
      return;
    }

    this.interval = setInterval(() => {
      const frame = SPINNER_FRAMES[this.frameIndex];
      this.stream.clearLine(0);
      this.stream.cursorTo(0);
      this.stream.write(`${frame} ${this.message}`);
      this.frameIndex = (this.frameIndex + 1) % SPINNER_FRAMES.length;
    }, 80);
  }

  /**
   * Update the spinner message
   */
  update(message: string): void {
    this.message = message;
  }

  /**
   * Stop the spinner with a final message
   */
  stop(finalMessage?: string): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    if (process.stderr.isTTY) {
      this.stream.clearLine(0);
      this.stream.cursorTo(0);
    }

    if (finalMessage) {
      this.stream.write(`${finalMessage}\n`);
    }
  }

  /**
   * Stop with success message
   */
  succeed(message?: string): void {
    const c = getChalk();
    this.stop(c.green(`${Symbols.success} ${message ?? this.message}`));
  }

  /**
   * Stop with failure message
   */
  fail(message?: string): void {
    const c = getChalk();
    this.stop(c.red(`${Symbols.error} ${message ?? this.message}`));
  }

  /**
   * Stop with warning message
   */
  warn(message?: string): void {
    const c = getChalk();
    this.stop(c.yellow(`${Symbols.warning} ${message ?? this.message}`));
  }
}

/**
 * Create a spinner for an operation
 */
export function createSpinner(message: string): Spinner {
  return new Spinner(message);
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format a timestamp for display
 */
export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString();
}

/**
 * Format a duration in milliseconds
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/**
 * Format bytes for display
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Truncate a string with ellipsis
 */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) {
    return str;
  }
  return str.slice(0, maxLen - 3) + '...';
}

/**
 * Pad string to center
 */
export function center(str: string, width: number): string {
  const padding = width - str.length;
  if (padding <= 0) {
    return str;
  }
  const left = Math.floor(padding / 2);
  const right = padding - left;
  return ' '.repeat(left) + str + ' '.repeat(right);
}

// ============================================================================
// Box Drawing
// ============================================================================

/**
 * Draw a simple box around text
 */
export function box(content: string, title?: string): string {
  const c = getChalk();
  const lines = content.split('\n');
  const maxLen = Math.max(...lines.map((l) => l.length), (title?.length ?? 0) + 4);
  const width = maxLen + 4;

  const result: string[] = [];

  // Top border
  if (title) {
    const titlePart = ` ${title} `;
    const remaining = width - titlePart.length - 2;
    const left = Math.floor(remaining / 2);
    const right = remaining - left;
    result.push(c.dim('┌' + '─'.repeat(left) + titlePart + '─'.repeat(right) + '┐'));
  } else {
    result.push(c.dim('┌' + '─'.repeat(width - 2) + '┐'));
  }

  // Content
  for (const line of lines) {
    result.push(c.dim('│') + ' ' + line.padEnd(width - 4) + ' ' + c.dim('│'));
  }

  // Bottom border
  result.push(c.dim('└' + '─'.repeat(width - 2) + '┘'));

  return result.join('\n');
}

// ============================================================================
// JSON Output Helpers
// ============================================================================

/**
 * Format data as JSON for machine output
 */
export function formatJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

/**
 * Create a standard success response
 */
export function jsonSuccess<T extends Record<string, unknown>>(data: T): string {
  return formatJson({
    success: true,
    ...data,
  });
}

/**
 * Create a standard error response
 */
export function jsonError(
  message: string,
  code?: string,
  details?: unknown
): string {
  return formatJson({
    success: false,
    error: {
      message,
      code: code ?? 'UNKNOWN',
      details,
    },
  });
}
