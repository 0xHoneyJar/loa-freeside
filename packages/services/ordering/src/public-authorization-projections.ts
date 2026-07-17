import { readFileSync } from "node:fs";
import { Effect } from "effect";
import {
  decodeFixtureProjectionBundle,
  fixtureProjectionFromBundle,
  type GrantProjectionView,
  type MembershipProjectionView,
} from "@freeside/public-authorization-protocol";

export interface PublicAuthorizationProjections {
  readonly membership: MembershipProjectionView;
  readonly grants: GrantProjectionView;
}

export interface PublicAuthorizationProjectionPort {
  /** Current membership + grant projections for fail-closed recheck. */
  load(nowMs: number): PublicAuthorizationProjections;
}

/** Fixture-backed projections for T0/T1 until Identity grant streams land (CR-007B). */
export class FixturePublicAuthorizationProjectionPort implements PublicAuthorizationProjectionPort {
  constructor(private readonly fixtureJson: unknown) {}

  load(nowMs: number): PublicAuthorizationProjections {
    const bundle = Effect.runSync(decodeFixtureProjectionBundle(this.fixtureJson));
    return fixtureProjectionFromBundle(bundle, nowMs);
  }
}

export function publicAuthFixtureFromEnv(nowMs: number): PublicAuthorizationProjections {
  const path = process.env.PUBLIC_AUTH_FIXTURE_PATH?.trim();
  const raw =
    path !== undefined && path.length > 0
      ? JSON.parse(readFileSync(path, "utf8"))
      : DEFAULT_BASELINE_FIXTURE;
  return new FixturePublicAuthorizationProjectionPort(raw).load(nowMs);
}

/** Embedded baseline — mirrors packages/protocol/public-authorization/fixtures/acl/projection-baseline.valid.json */
export const DEFAULT_BASELINE_FIXTURE = {
  schema_version: 1,
  watermarks: {
    schema_version: 1,
    membership_stream_epoch: 1,
    membership_sequence: 10,
    grant_stream_epoch: 1,
    grant_sequence: 20,
    projected_at_unix_ms: 0,
  },
  memberships: [
    { subject_id: "subject-alice", community_ref: "community-alpha", active: true },
    { subject_id: "subject-bob", community_ref: "community-alpha", active: true },
    { subject_id: "subject-carol", community_ref: "community-beta", active: true },
  ],
  grants: [
    {
      subject_id: "subject-alice",
      community_ref: "community-alpha",
      permission: "report:create",
      active: true,
    },
    {
      subject_id: "subject-alice",
      community_ref: "community-alpha",
      permission: "report:read",
      active: true,
    },
    {
      subject_id: "subject-alice",
      community_ref: "community-alpha",
      permission: "demand:create",
      active: true,
    },
    {
      subject_id: "subject-alice",
      community_ref: "community-alpha",
      permission: "demand:read",
      active: true,
    },
    {
      subject_id: "subject-alice",
      community_ref: "community-alpha",
      permission: "demand:withdraw",
      active: true,
    },
    {
      subject_id: "subject-bob",
      community_ref: "community-alpha",
      permission: "report:read",
      active: true,
    },
    {
      subject_id: "subject-carol",
      community_ref: "community-beta",
      permission: "report:create",
      active: true,
    },
  ],
} as const;
