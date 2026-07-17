import { Schema } from "effect";
import type { ParseOptions } from "effect/SchemaAST";
import { SIGNING_KEY_CUSTODY_SCHEMA_VERSION } from "./version.js";

const Iso8601UtcSchema = Schema.String.pipe(
  Schema.pattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/, {
    message: () => "must be ISO-8601 UTC with trailing Z",
  }),
);

const Hex64Schema = Schema.String.pipe(
  Schema.pattern(/^[0-9a-f]{64}$/, {
    message: () => "must be 64 lowercase hex chars (sha256)",
  }),
);

const SigningKeyIdSchema = Schema.String.pipe(
  Schema.pattern(/^[A-Za-z0-9_.:-]{1,128}$/),
);

const CellSlugSchema = Schema.String.pipe(
  Schema.pattern(/^[a-z][a-z0-9-]*$/, {
    message: () => "must be lowercase kebab-case producer slug",
  }),
);

const CapabilitySchema = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(256));

export const strictDecodeOptions: ParseOptions = {
  errors: "all",
  onExcessProperty: "error",
};

export const KeyCustodyClass = Schema.Literal("fixture", "production");
export type KeyCustodyClass = Schema.Schema.Type<typeof KeyCustodyClass>;

export const CustodyBackendKind = Schema.Literal(
  "local-fixture",
  "aws-kms",
  "gcp-kms",
  "azure-keyvault",
  "vault-transit",
  "cloudhsm",
);
export type CustodyBackendKind = Schema.Schema.Type<typeof CustodyBackendKind>;

export const CustodySigningKey = Schema.Struct({
  signing_key_id: SigningKeyIdSchema,
  public_key_hex: Schema.String.pipe(
    Schema.pattern(/^[0-9a-f]{64}$/, { message: () => "must be 32-byte ed25519 pubkey hex" }),
  ),
  producer: CellSlugSchema,
  capabilities: Schema.Array(CapabilitySchema).pipe(Schema.minItems(1)),
  tenant_scope_digests: Schema.optionalWith(Schema.Array(Hex64Schema), { exact: true }),
  activated_at: Iso8601UtcSchema,
  revoked_at: Schema.optionalWith(Iso8601UtcSchema, { exact: true }),
  compromise: Schema.optionalWith(Schema.Boolean, { exact: true }),
  key_class: KeyCustodyClass,
  custody_backend: CustodyBackendKind,
  custody_key_ref: Schema.optionalWith(Schema.String.pipe(Schema.minLength(1)), { exact: true }),
  registry_generation: Schema.optionalWith(Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(1)), {
    exact: true,
  }),
}).annotations({ identifier: "CustodySigningKey" });
export type CustodySigningKey = Schema.Schema.Type<typeof CustodySigningKey>;

export const SigningKeyRegistryDocument = Schema.Struct({
  schema_version: Schema.Literal(SIGNING_KEY_CUSTODY_SCHEMA_VERSION),
  registry_id: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(128)),
  registry_generation: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(1)),
  published_at: Iso8601UtcSchema,
  max_staleness_ms: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(1)),
  key_class_scope: KeyCustodyClass,
  keys: Schema.Array(CustodySigningKey).pipe(Schema.minItems(1)),
  distribution_digest: Hex64Schema,
}).annotations({ identifier: "SigningKeyRegistryDocument" });
export type SigningKeyRegistryDocument = Schema.Schema.Type<typeof SigningKeyRegistryDocument>;

export const RotationEvent = Schema.Struct({
  event_id: Schema.String.pipe(Schema.minLength(1)),
  kind: Schema.Literal("rotation"),
  registry_id: Schema.String.pipe(Schema.minLength(1)),
  previous_key_id: SigningKeyIdSchema,
  next_key_id: SigningKeyIdSchema,
  overlap_starts_at: Iso8601UtcSchema,
  overlap_ends_at: Iso8601UtcSchema,
  issued_at: Iso8601UtcSchema,
}).annotations({ identifier: "RotationEvent" });
export type RotationEvent = Schema.Schema.Type<typeof RotationEvent>;

export const RevocationEvent = Schema.Struct({
  event_id: Schema.String.pipe(Schema.minLength(1)),
  kind: Schema.Literal("revocation"),
  registry_id: Schema.String.pipe(Schema.minLength(1)),
  signing_key_id: SigningKeyIdSchema,
  revoked_at: Iso8601UtcSchema,
  reason: Schema.String.pipe(Schema.minLength(1)),
  issued_at: Iso8601UtcSchema,
}).annotations({ identifier: "RevocationEvent" });
export type RevocationEvent = Schema.Schema.Type<typeof RevocationEvent>;

export const CompromiseEvent = Schema.Struct({
  event_id: Schema.String.pipe(Schema.minLength(1)),
  kind: Schema.Literal("compromise"),
  registry_id: Schema.String.pipe(Schema.minLength(1)),
  signing_key_id: SigningKeyIdSchema,
  detected_at: Iso8601UtcSchema,
  issued_at: Iso8601UtcSchema,
}).annotations({ identifier: "CompromiseEvent" });
export type CompromiseEvent = Schema.Schema.Type<typeof CompromiseEvent>;

export const TimeSourceReading = Schema.Struct({
  source_id: Schema.String.pipe(Schema.minLength(1)),
  observed_at: Iso8601UtcSchema,
  unix_ms: Schema.Number.pipe(Schema.int()),
  uncertainty_ms: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)),
  region: Schema.optionalWith(Schema.String.pipe(Schema.minLength(1)), { exact: true }),
}).annotations({ identifier: "TimeSourceReading" });
export type TimeSourceReading = Schema.Schema.Type<typeof TimeSourceReading>;

export const TimeHealthSnapshot = Schema.Struct({
  schema_version: Schema.Literal(SIGNING_KEY_CUSTODY_SCHEMA_VERSION),
  evaluated_at: Iso8601UtcSchema,
  database_unix_ms: Schema.Number.pipe(Schema.int()),
  authoritative_sources: Schema.Array(TimeSourceReading).pipe(Schema.minItems(1)),
  measured_offset_ms: Schema.optionalWith(Schema.Number.pipe(Schema.int()), { exact: true }),
  offset_uncertainty_ms: Schema.optionalWith(Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)), {
    exact: true,
  }),
  regional_divergence_ms: Schema.optionalWith(Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)), {
    exact: true,
  }),
  last_good_at: Schema.optionalWith(Iso8601UtcSchema, { exact: true }),
  intake_blocked: Schema.Boolean,
  block_reason: Schema.optionalWith(
    Schema.Literal(
      "database_clock_skew_exceeded",
      "database_clock_unknown",
      "insufficient_time_sources",
      "time_source_divergence",
    ),
    { exact: true },
  ),
}).annotations({ identifier: "TimeHealthSnapshot" });
export type TimeHealthSnapshot = Schema.Schema.Type<typeof TimeHealthSnapshot>;

export const decodeCustodySigningKey = Schema.decodeUnknownSync(CustodySigningKey, strictDecodeOptions);
export const decodeSigningKeyRegistryDocument = Schema.decodeUnknownSync(
  SigningKeyRegistryDocument,
  strictDecodeOptions,
);
export const decodeRotationEvent = Schema.decodeUnknownSync(RotationEvent, strictDecodeOptions);
export const decodeRevocationEvent = Schema.decodeUnknownSync(RevocationEvent, strictDecodeOptions);
export const decodeCompromiseEvent = Schema.decodeUnknownSync(CompromiseEvent, strictDecodeOptions);
export const decodeTimeHealthSnapshot = Schema.decodeUnknownSync(TimeHealthSnapshot, strictDecodeOptions);
