/** Wire contract version for CR-007A public authorization scopes and leases. */
export const PUBLIC_AUTHORIZATION_SCHEMA_VERSION = 1 as const;

/** Maximum interactive lease lifetime for public-path protected reads and mutations (SDD §11.1). */
export const PUBLIC_AUTHORIZATION_LEASE_MAX_MS = 30_000;

/** Authority projection freshness ceiling before fail-closed denial (SDD §11.1). */
export const PUBLIC_AUTHORIZATION_PROJECTION_MAX_LAG_MS = 60_000;
