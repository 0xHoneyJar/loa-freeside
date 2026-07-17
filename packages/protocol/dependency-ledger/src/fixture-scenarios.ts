import { Schema } from "effect";
import type { TrustEnvelope } from "@freeside/trust-envelope-protocol";
import type { SigningKeyRegistryDocument } from "@freeside/signing-key-custody-protocol";

export const FixtureLedgerScenario = Schema.Struct({
  id: Schema.String,
  envelope: Schema.Unknown,
  expect: Schema.Literal("accept", "reject"),
  reject_reason: Schema.optionalWith(Schema.String, { exact: true }),
}).annotations({ identifier: "FixtureLedgerScenario" });

export const FixtureLedgerScenarioBundle = Schema.Struct({
  schema_version: Schema.Literal(1),
  accepted_at_ms: Schema.Number,
  registry: Schema.Unknown,
  time_health: Schema.Unknown,
  envelopes: Schema.Array(FixtureLedgerScenario),
  reconciliation: Schema.optionalWith(
    Schema.Array(
      Schema.Struct({
        derivative_key: Schema.String,
        expected_edge_ids: Schema.Array(Schema.String),
      }),
    ),
    { exact: true },
  ),
}).annotations({ identifier: "FixtureLedgerScenarioBundle" });

export type FixtureLedgerScenarioBundle = Schema.Schema.Type<
  typeof FixtureLedgerScenarioBundle
> & {
  registry: SigningKeyRegistryDocument;
  envelopes: ReadonlyArray<{
    id: string;
    envelope: TrustEnvelope;
    expect: "accept" | "reject";
    reject_reason?: string;
  }>;
};

export const decodeFixtureLedgerScenarioBundle = (
  raw: unknown,
): FixtureLedgerScenarioBundle =>
  Schema.decodeUnknownSync(FixtureLedgerScenarioBundle)(raw) as FixtureLedgerScenarioBundle;
