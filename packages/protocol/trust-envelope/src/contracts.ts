import { Schema } from "effect";
import type { ParseOptions } from "effect/SchemaAST";
import {
  TRUST_ENVELOPE_SCHEMA_MAJOR,
  TRUST_ENVELOPE_SCHEMA_MINOR,
} from "./version.js";

const SchemaMajor = Schema.Literal(TRUST_ENVELOPE_SCHEMA_MAJOR);
const SchemaMinor = Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0));

const Hex64Schema = Schema.String.pipe(
  Schema.pattern(/^[0-9a-f]{64}$/, {
    message: () => "must be 64 lowercase hex chars (sha256)",
  }),
);

const Base64UrlSchema = Schema.String.pipe(
  Schema.pattern(/^[A-Za-z0-9_-]+$/, {
    message: () => "must be base64url-encoded (no padding)",
  }),
);

const Iso8601UtcSchema = Schema.String.pipe(
  Schema.pattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/, {
    message: () => "must be ISO-8601 UTC with trailing Z",
  }),
);

const CellSlugSchema = Schema.String.pipe(
  Schema.pattern(/^[a-z][a-z0-9-]*$/, {
    message: () => "must be lowercase kebab-case producer slug",
  }),
);

const SigningKeyIdSchema = Schema.String.pipe(
  Schema.pattern(/^[A-Za-z0-9_.:-]{1,128}$/),
);

const EventIdSchema = Schema.String.pipe(
  Schema.pattern(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/),
);

const StreamIdSchema = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(256));
const CapabilitySchema = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(256));
const ContractNameSchema = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(128));

export const strictDecodeOptions: ParseOptions = {
  errors: "all",
  onExcessProperty: "error",
};

export const TrustContractRef = Schema.Struct({
  name: ContractNameSchema,
  major_version: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(1)),
  minor_version: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)),
}).annotations({ identifier: "TrustContractRef" });
export type TrustContractRef = Schema.Schema.Type<typeof TrustContractRef>;

export const TrustEnvelopeHeader = Schema.Struct({
  schema_version: SchemaMajor,
  schema_minor: SchemaMinor,
  algorithm: Schema.Literal("Ed25519"),
  signing_key_id: SigningKeyIdSchema,
  producer: CellSlugSchema,
  contract: TrustContractRef,
  event_id: EventIdSchema,
  stream_id: StreamIdSchema,
  stream_epoch: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(1)),
  sequence: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(1)),
  trust_stream: Schema.Boolean,
  issued_at: Iso8601UtcSchema,
  expires_at: Iso8601UtcSchema,
  tenant_scope_digest: Hex64Schema,
  capability: CapabilitySchema,
  body_digest: Hex64Schema,
}).annotations({ identifier: "TrustEnvelopeHeader" });
export type TrustEnvelopeHeader = Schema.Schema.Type<typeof TrustEnvelopeHeader>;

export const TrustEnvelope = Schema.Struct({
  header: TrustEnvelopeHeader,
  body: Schema.Unknown,
  signature: Base64UrlSchema,
}).annotations({ identifier: "TrustEnvelope" });
export type TrustEnvelope = Schema.Schema.Type<typeof TrustEnvelope>;

export const StreamEpochBaseline = Schema.Struct({
  schema_version: SchemaMajor,
  schema_minor: SchemaMinor,
  algorithm: Schema.Literal("Ed25519"),
  signing_key_id: SigningKeyIdSchema,
  producer: CellSlugSchema,
  stream_id: StreamIdSchema,
  stream_epoch: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(1)),
  highest_sequence: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)),
  envelope_count: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)),
  baseline_digest: Hex64Schema,
  issued_at: Iso8601UtcSchema,
  signature: Base64UrlSchema,
}).annotations({ identifier: "StreamEpochBaseline" });
export type StreamEpochBaseline = Schema.Schema.Type<typeof StreamEpochBaseline>;

export const ServiceSigningKey = Schema.Struct({
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
}).annotations({ identifier: "ServiceSigningKey" });
export type ServiceSigningKey = Schema.Schema.Type<typeof ServiceSigningKey>;

export const FixtureKeyRegistry = Schema.Struct({
  schema_version: SchemaMajor,
  keys: Schema.Array(ServiceSigningKey).pipe(Schema.minItems(1)),
}).annotations({ identifier: "FixtureKeyRegistry" });
export type FixtureKeyRegistry = Schema.Schema.Type<typeof FixtureKeyRegistry>;

export const decodeTrustEnvelope = Schema.decodeUnknownSync(TrustEnvelope, strictDecodeOptions);
export const decodeStreamEpochBaseline = Schema.decodeUnknownSync(
  StreamEpochBaseline,
  strictDecodeOptions,
);
export const decodeFixtureKeyRegistry = Schema.decodeUnknownSync(
  FixtureKeyRegistry,
  strictDecodeOptions,
);

export const supportedSchemaMinor = (): number => TRUST_ENVELOPE_SCHEMA_MINOR;
