import { Effect } from "effect";
import {
  acquirePublicAuthorizationLease,
  AuthorizationDeniedError,
  decodePublicAuthorizationScope,
  resolutionScopeToPublic,
  toAuthorizationDenial,
  type AuthorizationLease,
  type ProtectedOperation,
  type PublicAuthorizationScope,
} from "@freeside/public-authorization-protocol";
import type { AuthorizationScope } from "@freeside/collection-resolution-protocol";
import {
  type PublicAuthorizationProjections,
  type PublicAuthorizationProjectionPort,
  FixturePublicAuthorizationProjectionPort,
} from "./public-authorization-projections.js";

export interface PublicAuthorizationServiceOptions {
  readonly projections: PublicAuthorizationProjectionPort;
  readonly now: () => number;
}

export class PublicAuthorizationService {
  private readonly projections: PublicAuthorizationProjectionPort;
  private readonly now: () => number;

  constructor(options: PublicAuthorizationServiceOptions) {
    this.projections = options.projections;
    this.now = options.now;
  }

  acquireLease(input: {
    operation: ProtectedOperation;
    scope: PublicAuthorizationScope;
    authoritativeCommunityRef?: string;
    authoritativeSubjectId?: string;
  }): AuthorizationLease {
    const { membership, grants } = this.projections.load(this.now());
    return acquirePublicAuthorizationLease({
      operation: input.operation,
      scope: input.scope,
      membership,
      grants,
      nowMs: this.now(),
      authoritativeCommunityRef: input.authoritativeCommunityRef,
      authoritativeSubjectId: input.authoritativeSubjectId,
    });
  }

  acquireLeaseFromResolutionScope(input: {
    operation: ProtectedOperation;
    scope: AuthorizationScope;
    authoritativeCommunityRef?: string;
  }): AuthorizationLease {
    return this.acquireLease({
      operation: input.operation,
      scope: resolutionScopeToPublic(input.scope),
      authoritativeCommunityRef: input.authoritativeCommunityRef,
    });
  }

  decodeScope(raw: unknown): PublicAuthorizationScope {
    return Effect.runSync(decodePublicAuthorizationScope(raw));
  }

  mapDenial(err: unknown): { status: 401 | 403 | 409; body: ReturnType<typeof toAuthorizationDenial> } {
    if (err instanceof AuthorizationDeniedError) {
      const status =
        err.safe_code === "unauthorized"
          ? 401
          : err.safe_code === "idempotency_conflict"
            ? 409
            : 403;
      return { status, body: toAuthorizationDenial(err) };
    }
    throw err;
  }
}

export function createFixturePublicAuthorizationService(
  fixtureJson: unknown,
  now: () => number = () => Date.now(),
): PublicAuthorizationService {
  return new PublicAuthorizationService({
    projections: new FixturePublicAuthorizationProjectionPort(fixtureJson),
    now,
  });
}

export type { PublicAuthorizationProjections, PublicAuthorizationProjectionPort };
