import type { ResolutionStore } from "./resolution-store.js";
import { InMemoryResolutionStore } from "./resolution-store.js";
import { PostgresResolutionStore } from "./resolution-store-postgres.js";
import type { PostgresOrderStore } from "./store-postgres.js";

/**
 * Prefer Postgres when DATABASE_URL is set (or a shared order-store pool is
 * provided). Otherwise the in-memory reference backend for local/tests.
 */
export async function createResolutionStore(opts?: {
  readonly orderStore?: { getPool?: () => import("pg").Pool };
}): Promise<ResolutionStore> {
  const url = process.env.DATABASE_URL?.trim();
  const sharedPool =
    opts?.orderStore && typeof opts.orderStore.getPool === "function"
      ? (opts.orderStore as PostgresOrderStore).getPool()
      : undefined;

  if (sharedPool) {
    const store = new PostgresResolutionStore({ pool: sharedPool });
    if (process.env.RUN_MIGRATIONS === "true") {
      await store.runMigrations();
    }
    return store;
  }

  if (url) {
    return PostgresResolutionStore.connect(url, {
      migrate: process.env.RUN_MIGRATIONS === "true",
    });
  }

  return new InMemoryResolutionStore();
}
