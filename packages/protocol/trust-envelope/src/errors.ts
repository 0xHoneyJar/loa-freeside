import { Data } from "effect";

export class ContractIntegrityError extends Data.TaggedError("ContractIntegrityError")<{
  readonly detail: string;
}> {}

export class TrustEnvelopeRejectedError extends Data.TaggedError("TrustEnvelopeRejectedError")<{
  readonly reason:
    | "unknown_schema_major"
    | "schema_minor_unsupported"
    | "excess_property"
    | "signature_invalid"
    | "body_digest_mismatch"
    | "unknown_signing_key"
    | "revoked_signing_key"
    | "capability_not_bound"
    | "tenant_scope_not_bound"
    | "issued_in_future"
    | "expired"
    | "event_id_replay"
    | "sequence_gap"
    | "sequence_reuse"
    | "epoch_mismatch"
    | "epoch_baseline_required"
    | "epoch_resume_forbidden"
    | "retention_violation";
  readonly remediation?:
    | "request_replay_range"
    | "install_epoch_baseline"
    | "rotate_signing_key"
    | "retry_after_authority_catchup";
}> {}

export class StreamEpochBaselineRejectedError extends Data.TaggedError(
  "StreamEpochBaselineRejectedError",
)<{
  readonly reason:
    | "signature_invalid"
    | "unknown_signing_key"
    | "revoked_signing_key"
    | "epoch_not_advanced"
    | "baseline_incomplete";
}> {}
