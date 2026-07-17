import { Schema } from "effect";

export const GATE_LEAK_PROTOCOL_VERSION = "1.0.0";
export const GATE_LEAK_PROTOCOL_SCHEMA_VERSION = 1;

const DISCORD_SNOWFLAKE_PATTERN = /^[0-9]{17,20}$/;
const COMMUNITY_REF_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const SUBJECT_REF_PATTERN = /^[a-z0-9][a-z0-9:._-]{0,127}$/;
const DECIMAL_PATTERN = /^(0|[1-9][0-9]*)$/;
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

export const isValidIsoTimestamp = (value: string): boolean => {
  const match = ISO_TIMESTAMP_PATTERN.exec(value);
  if (match === null) return false;
  const [datePart, timePart] = value.split("T");
  if (datePart === undefined || timePart === undefined) return false;
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute, second] = timePart
    .replace(/Z$/, "")
    .split(".")[0]!
    .split(":")
    .map(Number);
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined
  ) {
    return false;
  }
  const instant = new Date(0);
  instant.setUTCFullYear(year, month - 1, day);
  instant.setUTCHours(hour, minute, second, 0);
  return (
    instant.getUTCFullYear() === year &&
    instant.getUTCMonth() === month - 1 &&
    instant.getUTCDate() === day &&
    instant.getUTCHours() === hour &&
    instant.getUTCMinutes() === minute &&
    instant.getUTCSeconds() === second
  );
};

export const SchemaVersion = Schema.Literal(GATE_LEAK_PROTOCOL_SCHEMA_VERSION);

/** Discord guild, role, and user identifiers are snowflakes; never numeric. */
export const DiscordSnowflake = Schema.String.pipe(
  Schema.pattern(DISCORD_SNOWFLAKE_PATTERN),
).annotations({ identifier: "DiscordSnowflake" });
export type DiscordSnowflake = Schema.Schema.Type<typeof DiscordSnowflake>;

/** Server-issued community identifier; never a caller-composed display name. */
export const CommunityRef = Schema.String.pipe(
  Schema.pattern(COMMUNITY_REF_PATTERN),
).annotations({ identifier: "CommunityRef" });
export type CommunityRef = Schema.Schema.Type<typeof CommunityRef>;

/** Authenticated subject reference (operator/approver identity). */
export const SubjectRef = Schema.String.pipe(
  Schema.pattern(SUBJECT_REF_PATTERN),
).annotations({ identifier: "SubjectRef" });
export type SubjectRef = Schema.Schema.Type<typeof SubjectRef>;

/** Unsigned integer carried as a decimal string (token balances, sequences). */
export const DecimalString = Schema.String.pipe(
  Schema.pattern(DECIMAL_PATTERN),
).annotations({ identifier: "DecimalString" });
export type DecimalString = Schema.Schema.Type<typeof DecimalString>;

export const IsoTimestamp = Schema.String.pipe(
  Schema.pattern(ISO_TIMESTAMP_PATTERN),
  Schema.filter(isValidIsoTimestamp, {
    message: () => "timestamp must represent a real UTC calendar instant",
  }),
).annotations({ identifier: "IsoTimestamp" });
export type IsoTimestamp = Schema.Schema.Type<typeof IsoTimestamp>;

export const NonNegativeInt = Schema.Number.pipe(
  Schema.int(),
  Schema.greaterThanOrEqualTo(0),
).annotations({ identifier: "NonNegativeInt" });
export type NonNegativeInt = Schema.Schema.Type<typeof NonNegativeInt>;

export const PositiveInt = Schema.Number.pipe(
  Schema.int(),
  Schema.greaterThanOrEqualTo(1),
).annotations({ identifier: "PositiveInt" });
export type PositiveInt = Schema.Schema.Type<typeof PositiveInt>;

/**
 * Authorization permissions this contract names. Constants, not free strings,
 * so fixtures and consumers cannot drift on spelling.
 */
export const GATE_CONFIG_RATIFY_PERMISSION = "gate-config:ratify";
export const PRIVACY_APPROVE_GATE_AUDIT_PERMISSION = "privacy:approve-gate-audit";

export const OperatorPermission = Schema.Literal(
  GATE_CONFIG_RATIFY_PERMISSION,
  PRIVACY_APPROVE_GATE_AUDIT_PERMISSION,
).annotations({ identifier: "OperatorPermission" });
export type OperatorPermission = Schema.Schema.Type<typeof OperatorPermission>;

/** The versioned consent purpose required for identity-link eligibility. */
export const COMMUNITY_GATE_AUDIT_PURPOSE = "community_gate_audit";
