import {
  type CanonicalEncodingError,
  type DigestComputationError,
  type VersionedDigest,
  digestVersioned,
} from "@freeside/collection-protocol";
import { Data, Effect, type ParseResult, Schema } from "effect";
import { SchemaVersion } from "./scalars.js";

export const GATE_LEAK_DIGEST_DOMAINS = Object.freeze({
  gate_rule: "gate-leak.gate-rule",
  deployment_set: "gate-leak.deployment-set",
  mapping_version: "gate-leak.mapping-version",
  mapping_config: "gate-leak.mapping-config",
  mapping_command: "gate-leak.mapping-command",
  integration_evidence: "gate-leak.integration-evidence",
  ownership_finality: "gate-leak.ownership-finality",
  subject_cohort: "gate-leak.subject-cohort",
  mvcc_token: "gate-leak.mvcc-token",
  page_root: "gate-leak.page-root",
  work_key: "gate-leak.work-key",
  evidence: "gate-leak.evidence",
  compute_input: "gate-leak.compute-input",
  disclosure_key: "gate-leak.disclosure-key",
});

/**
 * The exact V1 eligibility rule: any selected deployment with total eligible
 * NFT balance at least one, every token in the selected collection in scope.
 * The literals make a different threshold or scope unrepresentable in v1.
 */
export const GateRuleV1 = Schema.Struct({
  schema_version: SchemaVersion,
  kind: Schema.Literal("hold_at_least_one"),
  minimum_balance: Schema.Literal(1),
  deployment_scope: Schema.Literal("any_selected_deployment"),
  token_scope: Schema.Literal("all_collection_tokens"),
}).annotations({ identifier: "GateRuleV1" });
export interface GateRuleV1 extends Schema.Schema.Type<typeof GateRuleV1> {}

export const GATE_RULE_V1: GateRuleV1 = Object.freeze({
  schema_version: 1,
  kind: "hold_at_least_one",
  minimum_balance: 1,
  deployment_scope: "any_selected_deployment",
  token_scope: "all_collection_tokens",
});

/**
 * Rule shapes V1 must refuse. They are named so refusal is typed and honest;
 * the report never approximates them.
 */
export const UNSUPPORTED_GATE_RULE_KINDS = Object.freeze([
  "quantity_threshold",
  "all_of_deployments",
  "token_id_set",
  "trait_filter",
  "time_held",
  "staking",
  "delegation",
  "composite",
] as const);

export const UnsupportedGateRuleKind = Schema.Literal(
  ...UNSUPPORTED_GATE_RULE_KINDS,
).annotations({ identifier: "UnsupportedGateRuleKind" });
export type UnsupportedGateRuleKind = Schema.Schema.Type<
  typeof UnsupportedGateRuleKind
>;

/** A requested rule at the admission boundary: the V1 rule or a named refusal shape. */
export const RequestedGateRule = Schema.Union(
  GateRuleV1,
  Schema.Struct({
    schema_version: SchemaVersion,
    kind: UnsupportedGateRuleKind,
  }),
).annotations({ identifier: "RequestedGateRule" });
export type RequestedGateRule = Schema.Schema.Type<typeof RequestedGateRule>;

export class UnsupportedGateRuleError extends Data.TaggedError(
  "UnsupportedGateRuleError",
)<{
  readonly reason_code: "unsupported_gate_rule";
  readonly requested_kind: UnsupportedGateRuleKind;
}> {}

const decodeRequestedGateRuleStruct = Schema.decodeUnknown(RequestedGateRule, {
  errors: "all",
  onExcessProperty: "error",
});

/**
 * Admission decoder for gate rules. Anything but the exact V1 rule fails with
 * `unsupported_gate_rule`; unknown shapes fail as parse errors (fail closed).
 */
export const admitGateRule = (
  input: unknown,
): Effect.Effect<GateRuleV1, ParseResult.ParseError | UnsupportedGateRuleError> =>
  decodeRequestedGateRuleStruct(input).pipe(
    Effect.flatMap((rule) =>
      rule.kind === "hold_at_least_one"
        ? Effect.succeed(rule)
        : Effect.fail(
            new UnsupportedGateRuleError({
              reason_code: "unsupported_gate_rule",
              requested_kind: rule.kind,
            }),
          ),
    ),
  );

export const digestGateRule = (
  rule: GateRuleV1,
): Effect.Effect<
  VersionedDigest,
  CanonicalEncodingError | DigestComputationError
> => digestVersioned(GATE_LEAK_DIGEST_DOMAINS.gate_rule, 1, rule);
