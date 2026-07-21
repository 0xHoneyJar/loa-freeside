import { Schema } from "effect";
import type { ParseOptions } from "effect/SchemaAST";
import { PUBLIC_AUTHORIZATION_SCHEMA_VERSION } from "./version.js";
import { AuthorityWatermarks, PublicPermission } from "./contracts.js";
import type { GrantProjectionView, MembershipProjectionView } from "./authorize.js";
import type { FixtureProjectionBundle } from "./fixture-types.js";

export type { FixtureGrantRecord, FixtureMembershipRecord, FixtureProjectionBundle } from "./fixture-types.js";

const strictOptions: ParseOptions = {
  errors: "all",
  onExcessProperty: "error",
};

const FixtureGrantRecordSchema = Schema.Struct({
  subject_id: Schema.String,
  community_ref: Schema.String,
  permission: PublicPermission,
  active: Schema.Boolean,
});

const FixtureMembershipRecordSchema = Schema.Struct({
  subject_id: Schema.String,
  community_ref: Schema.String,
  active: Schema.Boolean,
});

export const FixtureProjectionBundleSchema = Schema.Struct({
  schema_version: Schema.Literal(PUBLIC_AUTHORIZATION_SCHEMA_VERSION),
  description: Schema.optional(Schema.String),
  watermarks: AuthorityWatermarks,
  memberships: Schema.Array(FixtureMembershipRecordSchema),
  grants: Schema.Array(FixtureGrantRecordSchema),
}).annotations({ identifier: "FixtureProjectionBundle" });

export const decodeFixtureProjectionBundle = Schema.decodeUnknown(
  FixtureProjectionBundleSchema,
  strictOptions,
);

export function fixtureProjectionFromBundle(
  bundle: FixtureProjectionBundle,
  nowMs: number,
): { membership: MembershipProjectionView; grants: GrantProjectionView } {
  const membershipActive = new Set<string>();
  for (const row of bundle.memberships) {
    if (row.active) membershipActive.add(`${row.subject_id}\0${row.community_ref}`);
  }
  const grantActive = new Set<string>();
  for (const row of bundle.grants) {
    if (row.active) grantActive.add(`${row.subject_id}\0${row.community_ref}\0${row.permission}`);
  }

  const watermarks: AuthorityWatermarks = {
    ...bundle.watermarks,
    projected_at_unix_ms: nowMs,
  };

  return {
    membership: {
      watermarks,
      isActiveMember: (subjectId, communityRef) =>
        membershipActive.has(`${subjectId}\0${communityRef}`),
    },
    grants: {
      watermarks: {
        grant_stream_epoch: watermarks.grant_stream_epoch,
        grant_sequence: watermarks.grant_sequence,
      },
      hasGrant: (subjectId, communityRef, permission) =>
        grantActive.has(`${subjectId}\0${communityRef}\0${permission}`),
    },
  };
}
