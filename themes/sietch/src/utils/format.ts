/**
 * Formatting Utilities (v4.1 - Sprint 31)
 *
 * Common formatting functions for display purposes.
 */

/**
 * Format a bigint with decimals for display
 *
 * @param value - The bigint value to format
 * @param decimals - Number of decimal places in the value (default: 18 for ETH/BGT)
 * @param displayDecimals - Number of decimal places to show (default: 2)
 * @returns Formatted string
 *
 * @example
 * formatBigInt(1000000000000000000n, 18, 2) // "1.00"
 * formatBigInt(123456789012345678n, 18, 4) // "0.1235"
 */
export function formatBigInt(
  value: bigint,
  decimals: number = 18,
  displayDecimals: number = 2
): string {
  if (value === 0n) {
    return '0';
  }

  const divisor = 10n ** BigInt(decimals);
  const wholePart = value / divisor;
  const fractionalPart = value % divisor;

  // Convert fractional part to string with leading zeros
  const fractionalStr = fractionalPart.toString().padStart(decimals, '0');

  // Get the desired number of decimal places
  const displayFraction = fractionalStr.slice(0, displayDecimals);

  // Remove trailing zeros from fraction
  const trimmedFraction = displayFraction.replace(/0+$/, '');

  if (trimmedFraction.length === 0) {
    return wholePart.toString();
  }

  return `${wholePart}.${trimmedFraction}`;
}

/**
 * Format a number with thousands separators
 *
 * @param value - The number to format
 * @returns Formatted string with commas
 *
 * @example
 * formatNumber(1234567) // "1,234,567"
 */
export function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}

/**
 * Format a date as relative time (e.g., "2 days ago")
 *
 * @param date - The date to format
 * @returns Relative time string
 */
export function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) {
    return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  }
  if (diffHours > 0) {
    return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  }
  if (diffMinutes > 0) {
    return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
  }
  return 'just now';
}
