import { Schema } from "effect";
import type { ParseOptions } from "effect/SchemaAST";
import { DEPENDENCY_LEDGER_SCHEMA_MAJOR } from "./version.js";

const SchemaMajor = Schema.Literal(DEPENDENCY_LEDGER_SCHEMA_MAJOR);
const SchemaMinor = Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0));

const Hex64Schema = Schema.String.pipe(
  Schema.pattern(/^[0-9a-f]{64}$/, {
    message: () => "must be 64 lowercase hex chars (sha256)",
  }),
);

const UuidSchema = Schema.String.pipe(
  Schema.pattern(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/),
);

const EdgeIdSchema = UuidSchema;
const DerivativeKindSchema = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(64));
const DerivativeIdSchema = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(256));

export const strictDecodeOptions: ParseOptions = {
  errors: "all",
  onExcessProperty: "error",
};

export const ProducerWatermark = Schema.Struct({
  stream_id: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(256)),
  stream_epoch: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(1)),
  sequence: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(1)),
}).annotations({ identifier: "ProducerWatermark" });
export type ProducerWatermark = Schema.Schema.Type<typeof ProducerWatermark>;

export const DerivativeRef = Schema.Struct({
  derivative_kind: DerivativeKindSchema,
  derivative_id: DerivativeIdSchema,
  community_scope_digest: Schema.optionalWith(Hex64Schema, { exact: true }),
}).annotations({ identifier: "DerivativeRef" });
export type DerivativeRef = Schema.Schema.Type<typeof DerivativeRef>;

export const InvalidationPayload = Schema.Struct({
  reason: Schema.Literal(
    "collection_equivalence_revoked",
    "signing_key_compromised",
  ),
  equivalence_digest: Schema.optionalWith(Hex64Schema, { exact: true }),
  compromised_signing_key_id: Schema.optionalWith(Schema.String, { exact: true }),
}).annotations({ identifier: "InvalidationPayload" });
export type InvalidationPayload = Schema.Schema.Type<typeof InvalidationPayload>;

export const DependencyEdgeBody = Schema.Struct({
  schema_version: SchemaMajor,
  schema_minor: SchemaMinor,
  edge_kind: Schema.Literal("evidence", "invalidation"),
  edge_id: EdgeIdSchema,
  derivative: DerivativeRef,
  required_edge_ids: Schema.Array(EdgeIdSchema),
  source_watermark: ProducerWatermark,
  invalidation: Schema.optionalWith(InvalidationPayload, { exact: true }),
}).annotations({ identifier: "DependencyEdgeBody" });
export type DependencyEdgeBody = Schema.Schema.Type<typeof DependencyEdgeBody>;

export const decodeDependencyEdgeBody = Schema.decodeUnknownSync(
  DependencyEdgeBody,
  strictDecodeOptions,
);

export const derivativeKey = (derivative: DerivativeRef): string =>
  `${derivative.derivative_kind}:${derivative.derivative_id}`;

export type DerivativeFulfillmentState = "quarantined" | "closed" | "denied";

export interface LedgerEdgeRecord {
  readonly edge_id: string;
  readonly edge_kind: DependencyEdgeBody["edge_kind"];
  readonly event_id: string;
  readonly signing_key_id: string;
  readonly producer: string;
  readonly derivative_key: string;
  readonly derivative: DerivativeRef;
  readonly required_edge_ids: readonly string[];
  readonly source_watermark: ProducerWatermark;
  readonly invalidation?: InvalidationPayload;
  readonly accepted_at_ms: number;
  readonly schema_minor: number;
}

export interface DerivativeClosureRecord {
  readonly derivative_key: string;
  readonly derivative: DerivativeRef;
  readonly required_edge_ids: readonly string[];
  readonly received_edge_ids: readonly string[];
  readonly source_watermarks: Readonly<Record<string, ProducerWatermark>>;
  readonly state: DerivativeFulfillmentState;
  readonly fulfillable: boolean;
  readonly quarantine_reason?: string;
  readonly denied_reason?: string;
  readonly repair_deadline_ms?: number;
}

export interface QuarantineMetrics {
  quarantined_derivatives: number;
  denied_derivatives: number;
  closed_derivatives: number;
  pending_edges: number;
  lost_edges: number;
  duplicate_replays: number;
}

export interface DependencyLedgerInboxState {
  readonly streamConsumers: Map<string, import("@freeside/trust-envelope-protocol").StreamConsumerState>;
  readonly edgesByEventId: Map<string, LedgerEdgeRecord>;
  readonly edgesByEdgeId: Map<string, LedgerEdgeRecord>;
  readonly derivatives: Map<string, DerivativeClosureRecord>;
  readonly reverseBySigningKey: Map<string, Set<string>>;
  readonly reverseByEquivalenceDigest: Map<string, Set<string>>;
  metrics: QuarantineMetrics;
}

export const createDependencyLedgerInboxState = (): DependencyLedgerInboxState => ({
  streamConsumers: new Map(),
  edgesByEventId: new Map(),
  edgesByEdgeId: new Map(),
  derivatives: new Map(),
  reverseBySigningKey: new Map(),
  reverseByEquivalenceDigest: new Map(),
  metrics: {
    quarantined_derivatives: 0,
    denied_derivatives: 0,
    closed_derivatives: 0,
    pending_edges: 0,
    lost_edges: 0,
    duplicate_replays: 0,
  },
});
