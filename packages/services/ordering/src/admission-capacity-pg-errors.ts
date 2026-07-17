/** Postgres error classifiers for CR-201C admission capacity. */

export function isPgSerializationFailure(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "40001"
  );
}

/** Unique violation on held queued envelope per work_key (concurrent fan-in race). */
export function isHeldEnvelopeUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null || !("code" in err)) return false;
  const pgErr = err as { code: string; constraint?: string; detail?: string };
  if (pgErr.code !== "23505") return false;
  const hay = `${pgErr.constraint ?? ""} ${pgErr.detail ?? ""}`;
  return (
    hay.includes("admission_capacity_reservations_work_held_unique_idx") ||
    (hay.includes("work_key_digest") && hay.includes("held"))
  );
}

export function shouldRetryAdmissionTxn(err: unknown): boolean {
  return (
    (err instanceof Error && err.message === "serialization_retry") ||
    isHeldEnvelopeUniqueViolation(err) ||
    isPgSerializationFailure(err)
  );
}
