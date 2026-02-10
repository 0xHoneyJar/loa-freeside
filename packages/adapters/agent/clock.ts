/**
 * Shared Clock Interface
 * Sprint S13-T2: Extract Clock from jwt-service to eliminate cross-service coupling
 *
 * Injectable clock for testability across all time-dependent services
 * (JwtService, BudgetDriftMonitor, and future rate limiter / circuit breaker).
 *
 * @see Bridgebuilder PR #47 Comment 4 — Finding C
 */

// --------------------------------------------------------------------------
// Clock Interface
// --------------------------------------------------------------------------

/** Injectable clock for testability */
export interface Clock {
  /** Returns current time in milliseconds since epoch */
  now(): number;
}

/** Default clock using Date.now() */
export const REAL_CLOCK: Clock = { now: () => Date.now() };
