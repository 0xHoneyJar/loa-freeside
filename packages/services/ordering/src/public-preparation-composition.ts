/**
 * CR-204A public-prep composition — single factory for adapter + worker wiring.
 *
 * Wire when Sonar kitchen env is present. ENABLE_PUBLIC_PREP=false forces off.
 * No soft "enabled but missing token" middle state.
 */

import type { AdmissionCapacityStore } from "./admission-capacity-store.js";
import type { SharedPreparationStore } from "./shared-preparation-store.js";
import type { OrderStore } from "./store.js";
import { PostgresOrderStore } from "./store-postgres.js";
import {
  InMemoryPublicPrepDispatchStore,
  type PublicPrepDispatchStore,
} from "./public-preparation-dispatch-store.js";
import { PostgresPublicPrepDispatchStore } from "./public-preparation-dispatch-store-postgres.js";
import { PublicPreparationAdapter } from "./public-preparation-adapter.js";
import { PublicPreparationWorker } from "./public-preparation-worker.js";
import { httpPublicPreparationSonarFromEnv } from "./public-preparation-sonar-http.js";

export interface PublicPrepComposition {
  readonly adapter: PublicPreparationAdapter;
  readonly worker: PublicPreparationWorker;
  readonly mode: "http";
}

export interface CreatePublicPrepCompositionInput {
  readonly preparationStore: SharedPreparationStore;
  readonly capacityStore: AdmissionCapacityStore;
  readonly orderStore: OrderStore;
}

function createDispatchStore(orderStore: OrderStore): PublicPrepDispatchStore {
  if (orderStore instanceof PostgresOrderStore) {
    return new PostgresPublicPrepDispatchStore(orderStore.getPool());
  }
  return new InMemoryPublicPrepDispatchStore();
}

/**
 * Returns a wired public-prep composition, or undefined when disabled / unconfigured.
 */
export function createPublicPrepComposition(
  input: CreatePublicPrepCompositionInput,
): PublicPrepComposition | undefined {
  if (process.env.ENABLE_PUBLIC_PREP?.trim() === "false") {
    return undefined;
  }
  const sonar = httpPublicPreparationSonarFromEnv();
  if (!sonar) return undefined;

  const adapter = new PublicPreparationAdapter({
    preparationStore: input.preparationStore,
    dispatchStore: createDispatchStore(input.orderStore),
    sonar,
    orderStore: input.orderStore,
    capacityStore: input.capacityStore,
    now: () => Date.now(),
    workerId: process.env.HOSTNAME?.trim() || "ordering-public-prep",
  });

  return {
    adapter,
    worker: new PublicPreparationWorker(adapter),
    mode: "http",
  };
}
