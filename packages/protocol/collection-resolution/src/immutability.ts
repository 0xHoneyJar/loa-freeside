/**
 * Deep-clone + deep-freeze helpers for CR-006 persisted truth boundaries.
 *
 * Ordering CAS is the sole mutation path. Every ingress/egress copy must be a
 * distinct frozen graph so Sonar/client object graphs cannot alias store truth.
 */

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const deepFreezeInPlace = <Value>(value: Value): Value => {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;

  if (Array.isArray(value)) {
    for (const entry of value) {
      deepFreezeInPlace(entry);
    }
    return Object.freeze(value);
  }

  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      deepFreezeInPlace(value[key]);
    }
    return Object.freeze(value);
  }

  return Object.freeze(value);
};

/**
 * Structured-clone then recursively freeze. Rejects values that cannot be
 * cloned (functions, symbols, cyclic non-JSON graphs).
 */
export const deepCloneFreeze = <Value>(value: Value): Value => {
  const cloned = structuredClone(value);
  return deepFreezeInPlace(cloned);
};

/** True when every nested plain object/array reachable from value is frozen. */
export const isDeepFrozen = (value: unknown): boolean => {
  if (value === null || typeof value !== "object") return true;
  if (!Object.isFrozen(value)) return false;
  if (Array.isArray(value)) {
    return value.every((entry) => isDeepFrozen(entry));
  }
  if (isPlainObject(value)) {
    return Object.keys(value).every((key) => isDeepFrozen(value[key]));
  }
  return Object.isFrozen(value);
};
