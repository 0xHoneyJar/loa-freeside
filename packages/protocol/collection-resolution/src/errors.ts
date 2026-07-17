import { Data } from "effect";
import type { VersionedDigest } from "@freeside/collection-protocol";
import type { CapabilityRegistryVersion } from "@freeside/collection-protocol";

export class SelectionStaleError extends Data.TaggedError("SelectionStaleError")<{
  readonly resolution_id: string;
  readonly reason:
    | "deployment_changed"
    | "grouping_changed"
    | "network_changed"
    | "standard_changed"
    | "provenance_changed"
    | "capability_changed"
    | "authorization_changed"
    | "scope_changed"
    | "local_capability_incompatible"
    | "equivalence_revoked"
    | "identity_drift"
    | "finality_policy_changed"
    | "health_rejects_admission"
    | "recognition_changed"
    | "index_status_changed"
    | "report_readiness_changed"
    | "metadata_quality_changed"
    | "operation_incompatible"
    | "identity_digest_mismatch";
  readonly previous_candidate_snapshot_digest: VersionedDigest;
  readonly current_candidate_snapshot_digest: VersionedDigest;
}> {}

export class IdempotencyConflictError extends Data.TaggedError("IdempotencyConflictError")<{
  readonly operation: "create" | "confirm" | "refresh";
  readonly idempotency_key: string;
  readonly reason: "command_mismatch";
}> {}

export class ConcurrentConfirmationError extends Data.TaggedError(
  "ConcurrentConfirmationError",
)<{
  readonly resolution_id: string;
  readonly expected_confirmation_version: number;
  readonly current_confirmation_version: number;
}> {}

export class ResolutionNotFoundError extends Data.TaggedError("ResolutionNotFoundError")<{
  readonly resolution_id: string;
}> {}

export class ResolutionExpiredError extends Data.TaggedError("ResolutionExpiredError")<{
  readonly resolution_id: string;
  readonly expires_at: string;
}> {}

export class SelectionRejectedError extends Data.TaggedError("SelectionRejectedError")<{
  readonly reason:
    | "empty_selection"
    | "unknown_deployment"
    | "cross_candidate_composition"
    | "mixed_equivalence_groups"
    | "address_only_identity"
    | "alias_guessing"
    | "client_digest_forgery"
    | "ceiling_exceeded"
    | "unconfirmed_required";
  readonly detail: string;
}> {}

export class AuthorizationScopeMismatchError extends Data.TaggedError(
  "AuthorizationScopeMismatchError",
)<{
  readonly reason:
    | "subject_mismatch"
    | "community_mismatch"
    | "cross_subject_replay"
    | "permission_revoked"
    | "scope_required"
    | "scope_mismatch";
}> {}

export class ConfirmationVersionConflictError extends Data.TaggedError(
  "ConfirmationVersionConflictError",
)<{
  readonly resolution_id: string;
  readonly expected_confirmation_version: number;
  readonly current_confirmation_version: number;
}> {}

export class CapabilityViewStaleError extends Data.TaggedError("CapabilityViewStaleError")<{
  readonly resolution_id: string;
  readonly required: CapabilityRegistryVersion;
  readonly local: CapabilityRegistryVersion | null;
  readonly reason: "missing_view" | "older_than_required" | "epoch_mismatch" | "receipt_stale";
}> {}

export class OrderBindingRejectedError extends Data.TaggedError("OrderBindingRejectedError")<{
  readonly reason:
    | "raw_candidate_metadata_refused"
    | "digest_grafting"
    | "missing_confirmation"
    | "resolution_expired"
    | "scope_mismatch";
  readonly detail: string;
}> {}

export class ContractIntegrityError extends Data.TaggedError("ContractIntegrityError")<{
  readonly contract: string;
  readonly reason: string;
}> {}

export class ImmutableRequestMismatchError extends Data.TaggedError(
  "ImmutableRequestMismatchError",
)<{
  readonly resolution_id: string;
  readonly reason:
    | "identifier_mismatch"
    | "report_mismatch"
    | "environment_mismatch"
    | "community_mismatch"
    | "canonical_mismatch";
}> {}
