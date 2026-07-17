import { Data } from "effect";

export class ContractIntegrityError extends Data.TaggedError("ContractIntegrityError")<{
  readonly detail: string;
}> {}

export class KeyCustodyRejectedError extends Data.TaggedError("KeyCustodyRejectedError")<{
  readonly reason:
    | "unknown_signing_key"
    | "revoked_signing_key"
    | "compromised_signing_key"
    | "registry_stale"
    | "registry_unknown"
    | "fixture_key_in_production_context"
    | "production_key_in_fixture_context"
    | "key_class_backend_mismatch"
    | "invalid_key_id_pattern"
    | "database_clock_skew_exceeded"
    | "database_clock_unknown"
    | "insufficient_time_sources"
    | "time_source_divergence"
    | "rotation_overlap_invalid"
    | "signing_backend_unavailable";
  readonly remediation?:
    | "refresh_registry"
    | "rotate_signing_key"
    | "emergency_revoke"
    | "quarantine_dependency_intake"
    | "restore_time_sources"
    | "fail_closed_until_recovery";
}> {}

export class SigningBackendError extends Data.TaggedError("SigningBackendError")<{
  readonly backend: string;
  readonly operation: "sign" | "get_public_key" | "health_check";
  readonly detail: string;
}> {}
