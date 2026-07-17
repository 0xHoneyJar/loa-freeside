/** V1 admission capacity ceilings (CR-201C / SDD §6.6). */

export const V1_MAX_RECIPE_NODES = 160;
export const V1_MAX_ROOT_REFERENCES = 32;
export const V1_MAX_DEPLOYMENTS = 16;

/** Default pool limits for in-memory / fixture admission. */
export const DEFAULT_ADMISSION_RATE_LIMIT = 10_000;
export const DEFAULT_QUEUED_WORK_LIMIT = 1_000;
export const DEFAULT_ACTIVE_EXECUTION_LIMIT = 64;

/** Active-execution lease TTL (ms). Queued envelopes do not expire. */
export const ACTIVE_EXECUTION_LEASE_MS = 30_000;

/** Advisory shed: refuse before opening the txn when simulated lock wait exceeds this. */
export const ADVISORY_LOCK_WAIT_BUDGET_MS = 250;

/** Bounded serialization retries inside the admission transaction. */
export const ADMISSION_SERIALIZATION_RETRIES = 8;
