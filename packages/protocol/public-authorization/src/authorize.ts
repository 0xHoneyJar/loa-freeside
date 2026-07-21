import { randomUUID } from "node:crypto";
import { AuthorizationDeniedError } from "./errors.js";
import {
  type AuthorityWatermarks,
  type AuthorizationDenial,
  type AuthorizationLease,
  type ProtectedOperation,
  type PublicAuthorizationScope,
  requiredPermissionFor,
  scopesPermissionMatch,
} from "./contracts.js";
import {
  PUBLIC_AUTHORIZATION_LEASE_MAX_MS,
  PUBLIC_AUTHORIZATION_PROJECTION_MAX_LAG_MS,
} from "./version.js";

export interface MembershipProjectionView {
  readonly isActiveMember: (subjectId: string, communityRef: string) => boolean;
  readonly watermarks: AuthorityWatermarks;
}

export interface GrantProjectionView {
  readonly hasGrant: (
    subjectId: string,
    communityRef: string,
    permission: PublicAuthorizationScope["permission"],
  ) => boolean;
  readonly watermarks: Pick<AuthorityWatermarks, "grant_stream_epoch" | "grant_sequence">;
}

export interface AuthorizePublicOperationInput {
  readonly operation: ProtectedOperation;
  readonly scope: PublicAuthorizationScope;
  readonly membership: MembershipProjectionView;
  readonly grants: GrantProjectionView;
  readonly nowMs: number;
  readonly authoritativeCommunityRef?: string;
  readonly authoritativeSubjectId?: string;
}

export interface AcquireLeaseInput extends AuthorizePublicOperationInput {
  readonly leaseId?: string;
}

function mergeWatermarks(
  membership: MembershipProjectionView,
  grants: GrantProjectionView,
): AuthorityWatermarks {
  return {
    schema_version: 1,
    membership_stream_epoch: membership.watermarks.membership_stream_epoch,
    membership_sequence: membership.watermarks.membership_sequence,
    grant_stream_epoch: grants.watermarks.grant_stream_epoch,
    grant_sequence: grants.watermarks.grant_sequence,
    projected_at_unix_ms: membership.watermarks.projected_at_unix_ms,
  };
}

function assertProjectionFresh(watermarks: AuthorityWatermarks, nowMs: number): void {
  if (nowMs - watermarks.projected_at_unix_ms > PUBLIC_AUTHORIZATION_PROJECTION_MAX_LAG_MS) {
    throw new AuthorizationDeniedError({
      reason: "projection_stale",
      safe_code: "forbidden",
    });
  }
}

function assertMembership(
  scope: PublicAuthorizationScope,
  membership: MembershipProjectionView,
): void {
  if (!membership.isActiveMember(scope.subject_id, scope.community_ref)) {
    throw new AuthorizationDeniedError({
      reason: "membership_revoked",
      safe_code: "forbidden",
    });
  }
}

function assertGrant(
  scope: PublicAuthorizationScope,
  grants: GrantProjectionView,
): void {
  if (!grants.hasGrant(scope.subject_id, scope.community_ref, scope.permission)) {
    throw new AuthorizationDeniedError({
      reason: "permission_revoked",
      safe_code: "forbidden",
    });
  }
}

function assertAuthoritativeScope(
  scope: PublicAuthorizationScope,
  authoritativeCommunityRef?: string,
  authoritativeSubjectId?: string,
): void {
  if (
    authoritativeCommunityRef !== undefined &&
    scope.community_ref !== authoritativeCommunityRef
  ) {
    throw new AuthorizationDeniedError({
      reason: "scope_tamper",
      safe_code: "authorization_scope_mismatch",
    });
  }
  if (
    authoritativeSubjectId !== undefined &&
    scope.subject_id !== authoritativeSubjectId
  ) {
    throw new AuthorizationDeniedError({
      reason: "cross_subject",
      safe_code: "authorization_scope_mismatch",
    });
  }
}

/** Fail-closed membership + grant recheck for a protected public operation. */
export function authorizePublicOperation(input: AuthorizePublicOperationInput): void {
  const required = requiredPermissionFor(input.operation);
  if (required === undefined) {
    throw new AuthorizationDeniedError({
      reason: "unsupported_permission",
      safe_code: "forbidden",
    });
  }
  if (!scopesPermissionMatch(input.scope, input.operation)) {
    throw new AuthorizationDeniedError({
      reason: "scope_tamper",
      safe_code: "authorization_scope_mismatch",
    });
  }

  const watermarks = mergeWatermarks(input.membership, input.grants);
  assertProjectionFresh(watermarks, input.nowMs);
  assertAuthoritativeScope(
    input.scope,
    input.authoritativeCommunityRef,
    input.authoritativeSubjectId,
  );
  assertMembership(input.scope, input.membership);
  assertGrant(input.scope, input.grants);
}

/** Acquire a short database-stamped lease after authorizePublicOperation succeeds. */
export function acquirePublicAuthorizationLease(
  input: AcquireLeaseInput,
): AuthorizationLease {
  authorizePublicOperation(input);
  const watermarks = mergeWatermarks(input.membership, input.grants);
  const issuedAt = input.nowMs;
  return {
    schema_version: 1,
    lease_id: input.leaseId ?? randomUUID(),
    subject_id: input.scope.subject_id,
    community_ref: input.scope.community_ref,
    resource: input.operation.resource,
    action: input.operation.action,
    permission: input.scope.permission,
    watermarks,
    issued_at_unix_ms: issuedAt,
    expires_at_unix_ms: issuedAt + PUBLIC_AUTHORIZATION_LEASE_MAX_MS,
  };
}

export function assertLeaseValid(lease: AuthorizationLease, nowMs: number): void {
  if (nowMs >= lease.expires_at_unix_ms) {
    throw new AuthorizationDeniedError({
      reason: "lease_expired",
      safe_code: "forbidden",
    });
  }
}

export function toAuthorizationDenial(err: AuthorizationDeniedError): AuthorizationDenial {
  return {
    schema_version: 1,
    code: err.safe_code,
    reason: err.reason,
  };
}

/** Bridge CR-006 resolution scopes (report:create only) into public authorization. */
export function resolutionScopeToPublic(scope: {
  schema_version: 1;
  subject_id: string;
  community_ref?: string;
  permission: "report:create";
}): PublicAuthorizationScope {
  if (scope.community_ref === undefined) {
    throw new AuthorizationDeniedError({
      reason: "scope_tamper",
      safe_code: "authorization_scope_mismatch",
    });
  }
  return {
    schema_version: 1,
    subject_id: scope.subject_id,
    community_ref: scope.community_ref,
    permission: scope.permission,
  };
}
