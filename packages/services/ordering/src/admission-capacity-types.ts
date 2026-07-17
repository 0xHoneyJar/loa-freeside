/**
 * CR-201C — three non-interchangeable capacity ledgers + admission artifacts.
 */

export const CAPACITY_LEDGER_KINDS = [
  "admission_rate",
  "queued_work",
  "active_execution",
] as const;
export type CapacityLedgerKind = (typeof CAPACITY_LEDGER_KINDS)[number];

export const CAPACITY_RESERVATION_STATES = [
  "held",
  "released",
  "transferred",
  "expired",
] as const;
export type CapacityReservationState = (typeof CAPACITY_RESERVATION_STATES)[number];

export interface CapacityPoolScope {
  readonly network_ref: string;
  readonly capability: string;
  readonly community_ref?: string;
}

export interface CapacityPoolRecord {
  readonly pool_id: string;
  readonly ledger_kind: CapacityLedgerKind;
  readonly network_ref: string;
  readonly capability: string;
  readonly community_ref?: string;
  readonly limit_units: number;
  readonly consumed_units: number;
  readonly version: number;
  readonly updated_at_unix_ms: number;
}

export interface CapacityReservationRecord {
  readonly reservation_id: string;
  readonly order_id: string;
  readonly pool_id: string;
  readonly ledger_kind: CapacityLedgerKind;
  readonly quantity: number;
  readonly reservation_version: number;
  readonly state: CapacityReservationState;
  readonly identity_digest: string;
  readonly work_key_digest?: string;
  readonly lease_until_unix_ms?: number;
  readonly created_at_unix_ms: number;
  readonly released_at_unix_ms?: number;
}

export interface CapacityTransferEvent {
  readonly event_id: string;
  readonly reservation_id: string;
  readonly from_state: CapacityReservationState;
  readonly to_state: CapacityReservationState;
  readonly reason: string;
  readonly event_version: number;
  readonly created_at_unix_ms: number;
}

export interface OrderAdmissionIdempotencyRecord {
  readonly requester_subject: string;
  readonly client_request_id: string;
  readonly body_digest: string;
  readonly order_id: string;
  readonly reservation_ids: readonly string[];
  readonly stored_at_unix_ms: number;
}

/**
 * Immutable recipe expansion certificate. Full compiler lands in CR-202;
 * CR-201C admits only pre-validated certificates into the capacity transaction.
 */
export interface RecipeExpansionCertificate {
  readonly schema_version: 1;
  readonly compiler_version: string;
  readonly root_count: number;
  readonly worst_case_total_nodes: number;
  readonly capacity_weight: number;
  readonly certificate_digest: string;
}

export type CapacityUnavailableReason =
  | "insufficient_admission_rate"
  | "insufficient_queued_work"
  | "insufficient_active_execution"
  | "lock_timeout"
  | "advisory_shed"
  | "certificate_too_large";

export class CapacityUnavailableError extends Error {
  readonly code = "capacity_unavailable" as const;
  constructor(
    readonly reason: CapacityUnavailableReason,
    message?: string,
  ) {
    super(message ?? `capacity_unavailable:${reason}`);
    this.name = "CapacityUnavailableError";
  }
}

export class AdmissionIdempotencyConflictError extends Error {
  readonly code = "idempotency_conflict" as const;
  constructor(message = "idempotency_conflict") {
    super(message);
    this.name = "AdmissionIdempotencyConflictError";
  }
}
