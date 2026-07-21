import type { SharedPreparationStore } from "./shared-preparation-store.js";
import type { PublicPreparationWorkKeyMaterial } from "./shared-preparation-types.js";

export interface SharedPreparationServiceDeps {
  readonly store: SharedPreparationStore;
  readonly now: () => number;
}

export function createSharedPreparationService(deps: SharedPreparationServiceDeps) {
  return {
    joinPublicWork(input: {
      order_id: string;
      order_tenant_scope_digest: string;
      work_key: PublicPreparationWorkKeyMaterial;
    }) {
      return deps.store.joinPublicWork({
        ...input,
        now_ms: deps.now(),
      });
    },
    store: deps.store,
  };
}

export type SharedPreparationService = ReturnType<typeof createSharedPreparationService>;
