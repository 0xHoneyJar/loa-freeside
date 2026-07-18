import type { OrderStore } from "./store.js";
import { InMemoryAdmissionCapacityStore } from "./admission-capacity-store.js";
import { InMemorySharedPreparationStore } from "./shared-preparation-store.js";
import { PostgresOrderStore } from "./store-postgres.js";
import { PostgresSharedPreparationStore } from "./shared-preparation-store-postgres.js";
import { PostgresAdmissionCapacityStore } from "./admission-capacity-store-postgres.js";
import {
  createAdmissionCapacityService,
  type AdmissionCapacityService,
} from "./admission-capacity-service.js";

export interface AdmissionCapacityComposition {
  readonly admissionCapacity: AdmissionCapacityService;
}

export async function createAdmissionCapacityComposition(
  store: OrderStore,
): Promise<AdmissionCapacityComposition> {
  const now = () => Date.now();

  if (store instanceof PostgresOrderStore) {
    const connectionString = process.env.DATABASE_URL!.trim();
    const pool = store.getPool();
    const preparationStore = await PostgresSharedPreparationStore.connect(connectionString, {
      pool,
      migrate: process.env.RUN_MIGRATIONS === "true",
    });
    const capacityStore = await PostgresAdmissionCapacityStore.connect(connectionString, {
      migrate: process.env.RUN_MIGRATIONS === "true",
      preparationStore,
    });
    return {
      admissionCapacity: createAdmissionCapacityService({ store: capacityStore, now }),
    };
  }

  const preparationStore = new InMemorySharedPreparationStore();
  const capacityStore = new InMemoryAdmissionCapacityStore({
    orderStore: store,
    preparationStore,
  });
  return {
    admissionCapacity: createAdmissionCapacityService({ store: capacityStore, now }),
  };
}
