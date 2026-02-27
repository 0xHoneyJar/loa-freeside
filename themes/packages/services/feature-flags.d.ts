/**
 * Stub type declaration for feature-flags service.
 *
 * The actual implementation lives at packages/services/feature-flags.ts
 * in the repository root, but route files under themes/sietch reference
 * it via a broken relative path (../../../../packages/services/).
 * This stub allows TypeScript compilation to succeed.
 */

/**
 * Check whether a feature flag is enabled.
 * @param flag - The feature flag identifier (e.g. 'FEATURE_EVENT_SOURCING').
 */
export declare function isFeatureEnabled(flag: string): boolean;
