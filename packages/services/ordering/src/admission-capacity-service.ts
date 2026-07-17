import type {
  AdmissionCapacityStore,
  AdmitOrderInput,
  AdmitOrderResult,
} from "./admission-capacity-store.js";

export interface AdmissionCapacityServiceDeps {
  readonly store: AdmissionCapacityStore;
  readonly now: () => number;
}

/**
 * Thin facade over the CR-201C admission capacity store.
 * Advisory shed may run before admitOrder; locked counters remain authoritative.
 */
export function createAdmissionCapacityService(deps: AdmissionCapacityServiceDeps) {
  return {
    admitOrder(
      input: Omit<AdmitOrderInput, "now_ms"> & { now_ms?: number },
    ): Promise<AdmitOrderResult> {
      return deps.store.admitOrder({
        ...input,
        now_ms: input.now_ms ?? deps.now(),
      });
    },
    acquireActiveExecutionLease(
      input: Parameters<AdmissionCapacityStore["acquireActiveExecutionLease"]>[0],
    ) {
      return deps.store.acquireActiveExecutionLease(input);
    },
    releaseOrderCapacity(
      input: Parameters<AdmissionCapacityStore["releaseOrderCapacity"]>[0],
    ) {
      return deps.store.releaseOrderCapacity(input);
    },
    reconcileExpiredActiveLeases(now_ms?: number) {
      return deps.store.reconcileExpiredActiveLeases({
        now_ms: now_ms ?? deps.now(),
      });
    },
    store: deps.store,
  };
}

export type AdmissionCapacityService = ReturnType<typeof createAdmissionCapacityService>;
