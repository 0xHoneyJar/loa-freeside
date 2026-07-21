import { Schema } from "effect";
import { PublicPermission } from "./contracts.js";
import { AuthorityWatermarks } from "./contracts.js";
import { PUBLIC_AUTHORIZATION_SCHEMA_VERSION } from "./version.js";

export const FixtureGrantRecord = Schema.Struct({
  subject_id: Schema.String,
  community_ref: Schema.String,
  permission: PublicPermission,
  active: Schema.Boolean,
});
export type FixtureGrantRecord = Schema.Schema.Type<typeof FixtureGrantRecord>;

export const FixtureMembershipRecord = Schema.Struct({
  subject_id: Schema.String,
  community_ref: Schema.String,
  active: Schema.Boolean,
});
export type FixtureMembershipRecord = Schema.Schema.Type<typeof FixtureMembershipRecord>;

export const FixtureProjectionBundle = Schema.Struct({
  schema_version: Schema.Literal(PUBLIC_AUTHORIZATION_SCHEMA_VERSION),
  description: Schema.optional(Schema.String),
  watermarks: AuthorityWatermarks,
  memberships: Schema.Array(FixtureMembershipRecord),
  grants: Schema.Array(FixtureGrantRecord),
});
export type FixtureProjectionBundle = Schema.Schema.Type<typeof FixtureProjectionBundle>;
