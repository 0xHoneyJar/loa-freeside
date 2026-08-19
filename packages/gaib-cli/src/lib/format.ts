/**
 * Output formatters for gaib-cli — dotenv | json | raw.
 *
 * Per SDD §9.5: secret VALUES go to stdout (operator pipes to env or file).
 * This module formats; it never logs to stderr by accident.
 */
import type { OutputFormat } from '../types.js';

export interface FormatInput {
  envVars: Record<string, string>;
}

/**
 * Render `envVars` per the requested format and return the serialized string.
 * The caller writes to stdout.
 */
export function formatSecrets(input: FormatInput, format: OutputFormat): string {
  switch (format) {
    case 'dotenv':
      return renderDotenv(input.envVars);
    case 'json':
      return JSON.stringify(input.envVars, null, 2);
    case 'raw':
      return renderRaw(input.envVars);
    default: {
      const _exhaustive: never = format;
      throw new Error(`unsupported format: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Dotenv format. Each line: `KEY=value`. Values are quoted only when they
 * contain spaces, quotes, or backslashes. Multi-line values use double-quotes
 * with `\n` escapes.
 */
function renderDotenv(envVars: Record<string, string>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(envVars)) {
    lines.push(`${key}=${escapeDotenvValue(value)}`);
  }
  return lines.join('\n') + '\n';
}

function escapeDotenvValue(value: string): string {
  if (value === '') return '';
  if (value.includes('\n') || value.includes('"') || value.includes('\\')) {
    const escaped = value
      .replaceAll('\\', '\\\\')
      .replaceAll('"', '\\"')
      .replaceAll('\n', '\\n')
      .replaceAll('\r', '\\r');
    return `"${escaped}"`;
  }
  if (/[\s'#]/.test(value)) {
    return `"${value}"`;
  }
  return value;
}

/**
 * Raw: one line per value, no keys. Useful for piping a single key:
 *
 *   gaib secrets pull --world mibera --env prod --format raw \
 *     | grep -A1 DATABASE_URL | tail -1
 */
function renderRaw(envVars: Record<string, string>): string {
  return Object.values(envVars).join('\n') + '\n';
}

/**
 * Parse a dotenv file into an object. Used by `gaib secrets push --from-file`.
 * Intentionally minimal: handles `KEY=value`, `KEY="value with spaces"`,
 * comment lines (`# ...`), and blank lines. Multi-line values are NOT
 * supported in the parser — the operator is expected to provide single-line
 * values per dotenv convention.
 */
export function parseDotenv(input: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of input.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = line.slice(eq + 1);
    // Strip optional surrounding quotes.
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    // Unescape minimal sequences for double-quoted values.
    if (line.slice(eq + 1).startsWith('"')) {
      value = value
        .replaceAll('\\n', '\n')
        .replaceAll('\\r', '\r')
        .replaceAll('\\"', '"')
        .replaceAll('\\\\', '\\');
    }
    out[key] = value;
  }
  return out;
}
