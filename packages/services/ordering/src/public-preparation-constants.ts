/**
 * CR-204A public preparation adapter constants (T1 fixtures only).
 */

/** Worker lease duration for shared preparation dispatch. */
export const PUBLIC_PREP_WORKER_LEASE_MS = 30_000;

/** V1 retry ceiling from SDD §6.3. */
export const PUBLIC_PREP_MAX_ATTEMPTS = 12;
export const PUBLIC_PREP_RETRY_DEADLINE_MS = 7 * 24 * 60 * 60 * 1000;

/** Default retry schedule: 1m, 5m, 15m, 1h, 6h, 12h, then 24h slots. */
export const PUBLIC_PREP_RETRY_SCHEDULE_MS = [
  60_000,
  300_000,
  900_000,
  3_600_000,
  21_600_000,
  43_200_000,
  86_400_000,
] as const;

/** Separate concurrency pool scopes (SDD §6.5). */
export const COLLECTION_PREP_POOL_CAPABILITY = "collection_prep";
export const REPORT_GENERATION_POOL_CAPABILITY = "report_generation";

export function publicPrepRetryAtMs(attempt: number, nowMs: number): number {
  const idx = Math.min(Math.max(attempt, 1) - 1, PUBLIC_PREP_RETRY_SCHEDULE_MS.length - 1);
  return nowMs + PUBLIC_PREP_RETRY_SCHEDULE_MS[idx]!;
}

export function publicPrepWorkerEnabled(): boolean {
  return process.env.PUBLIC_PREP_WORKER_ENABLED?.trim() !== "false";
}

export function publicPrepWorkerIntervalMs(): number {
  const sec = Number(process.env.PUBLIC_PREP_WORKER_INTERVAL_SEC ?? 5);
  return Number.isFinite(sec) && sec > 0 ? sec * 1000 : 5_000;
}
