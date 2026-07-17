/**
 * Deep-clone + deep-freeze helpers for CR-006 persisted truth boundaries.
 *
 * Ordering CAS is the sole mutation path. Every ingress/egress copy must be a
 * distinct frozen graph so Sonar/client object graphs cannot alias store truth.
 */
/**
 * Structured-clone then recursively freeze. Rejects values that cannot be
 * cloned (functions, symbols, cyclic non-JSON graphs).
 */
export declare const deepCloneFreeze: <Value>(value: Value) => Value;
/** True when every nested plain object/array reachable from value is frozen. */
export declare const isDeepFrozen: (value: unknown) => boolean;
//# sourceMappingURL=immutability.d.ts.map