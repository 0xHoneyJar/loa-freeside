/**
 * Shared Clock Interface
 * Sprint S13-T2: Extract Clock from jwt-service to eliminate cross-service coupling
 *
 * @see Bridgebuilder PR #47 Comment 4 — Finding C
 */
/** Default clock using Date.now() */
export const REAL_CLOCK = { now: () => Date.now() };
//# sourceMappingURL=clock.js.map
