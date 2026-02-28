/**
 * Audit Trail Helpers — Shared utilities for audit chain services (cycle-043)
 *
 * Advisory lock key computation moved to canonical export:
 *   computeAdvisoryLockKey from @0xhoneyjar/loa-hounfour/commons (v8.3.1)
 */

/**
 * Sleep for a given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
