import { Data } from "effect";

export class AuthorizationDeniedError extends Data.TaggedError("AuthorizationDeniedError")<{
  readonly reason:
    | "unauthenticated"
    | "membership_revoked"
    | "permission_revoked"
    | "community_mismatch"
    | "cross_subject"
    | "scope_tamper"
    | "projection_stale"
    | "projection_gap"
    | "lease_expired"
    | "unsupported_permission"
    | "idempotency_replay_mismatch";
  readonly safe_code:
    | "unauthorized"
    | "forbidden"
    | "authorization_scope_mismatch"
    | "idempotency_conflict";
}> {}

export class ContractIntegrityError extends Data.TaggedError("ContractIntegrityError")<{
  readonly detail: string;
}> {}
