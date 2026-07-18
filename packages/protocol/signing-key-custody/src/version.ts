/** Registry document schema version for CR-013 pinned service-key distribution. */
export const SIGNING_KEY_CUSTODY_SCHEMA_VERSION = 1 as const;

/** Sprint G1 authority threshold: database clock skew blocks signed intake above 2s. */
export const ORDERING_DATABASE_MAX_SKEW_MS = 2_000 as const;

/** Minimum independent authoritative time sources required before trusting skew measurement. */
export const MIN_INDEPENDENT_TIME_SOURCES = 2 as const;

/** Default maximum age of a distributed registry snapshot before intake fails closed. */
export const DEFAULT_REGISTRY_MAX_STALENESS_MS = 300_000 as const;

/** Overlap rotation window recommended minimum (both keys must remain verifiable). */
export const MIN_ROTATION_OVERLAP_MS = 86_400_000 as const;
