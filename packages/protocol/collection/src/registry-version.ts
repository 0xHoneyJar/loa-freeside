import { Data, Effect, Schema } from "effect";
import type { ParseOptions } from "effect/SchemaAST";
import { VersionedDigest, digestVersioned } from "./canonical.js";
import {
  COLLECTION_PROTOCOL_SCHEMA_VERSION,
  RegistryEpoch,
  RegistrySequence,
} from "./scalars.js";

export const CapabilityRegistryVersion = Schema.Struct({
  registry_epoch: RegistryEpoch,
  registry_sequence: RegistrySequence,
}).annotations({ identifier: "CapabilityRegistryVersion" });
export interface CapabilityRegistryVersion
  extends Schema.Schema.Type<typeof CapabilityRegistryVersion> {}

export const CAPABILITY_REGISTRY_BASELINE_DIGEST_DOMAIN =
  "capability.registry-baseline";

export const CapabilityRegistryBaseline = Schema.Struct({
  schema_version: Schema.Literal(COLLECTION_PROTOCOL_SCHEMA_VERSION),
  previous_registry_epoch: RegistryEpoch,
  version: CapabilityRegistryVersion,
  baseline_digest: VersionedDigest,
}).pipe(
  Schema.filter(
    (baseline) =>
      baseline.previous_registry_epoch !== baseline.version.registry_epoch ||
      "registry baseline must introduce a new epoch",
  ),
  Schema.filter(
    (baseline) =>
      baseline.version.registry_sequence === "0" ||
      "registry baseline resets sequence to decimal string zero",
  ),
  Schema.filter(
    (baseline) =>
      (baseline.baseline_digest.domain === CAPABILITY_REGISTRY_BASELINE_DIGEST_DOMAIN &&
        baseline.baseline_digest.major_version === 1) ||
      "registry baseline digest must use the capability.registry-baseline v1 domain",
  ),
).annotations({ identifier: "CapabilityRegistryBaseline" });
export type CapabilityRegistryBaseline = Schema.Schema.Type<typeof CapabilityRegistryBaseline>;

export const RegistryVersionRelation = Schema.Literal("older", "equal", "newer").annotations({
  identifier: "RegistryVersionRelation",
});
export type RegistryVersionRelation = Schema.Schema.Type<typeof RegistryVersionRelation>;

export const RegistryVersionAdvance = Schema.Literal("sequence", "epoch_reset").annotations({
  identifier: "RegistryVersionAdvance",
});
export type RegistryVersionAdvance = Schema.Schema.Type<typeof RegistryVersionAdvance>;

export class RegistryEpochMismatchError extends Data.TaggedError(
  "RegistryEpochMismatchError",
)<{
  readonly left_epoch: string;
  readonly right_epoch: string;
  readonly reason: string;
}> {}

export class RegistryBaselineRequiredError extends Data.TaggedError(
  "RegistryBaselineRequiredError",
)<{
  readonly current_epoch: string;
  readonly candidate_epoch: string;
}> {}

export class InvalidRegistryBaselineError extends Data.TaggedError(
  "InvalidRegistryBaselineError",
)<{
  readonly reason: string;
}> {}

export class RegistryBaselineIntegrityError extends Data.TaggedError(
  "RegistryBaselineIntegrityError",
)<{
  readonly reason: string;
}> {}

export class RegistrySequenceRegressionError extends Data.TaggedError(
  "RegistrySequenceRegressionError",
)<{
  readonly current_sequence: string;
  readonly candidate_sequence: string;
}> {}

const strictOptions: ParseOptions = {
  errors: "all",
  onExcessProperty: "error",
};

export const decodeCapabilityRegistryVersion = Schema.decodeUnknown(
  CapabilityRegistryVersion,
  strictOptions,
);
const decodeCapabilityRegistryBaselineStruct = Schema.decodeUnknown(
  CapabilityRegistryBaseline,
  strictOptions,
);

const baselineDigestMaterial = (baseline: CapabilityRegistryBaseline): unknown => ({
  previous_registry_epoch: baseline.previous_registry_epoch,
  version: baseline.version,
});

export const decodeCapabilityRegistryBaseline = (input: unknown) =>
  decodeCapabilityRegistryBaselineStruct(input).pipe(
    Effect.flatMap((baseline) =>
      digestVersioned(
        CAPABILITY_REGISTRY_BASELINE_DIGEST_DOMAIN,
        1,
        baselineDigestMaterial(baseline),
      ).pipe(
        Effect.flatMap((expected) =>
          expected.digest === baseline.baseline_digest.digest
            ? Effect.succeed(baseline)
            : Effect.fail(
                new RegistryBaselineIntegrityError({
                  reason: "baseline_digest does not match the canonical epoch reset",
                }),
              ),
        ),
      ),
    ),
  );

export const compareCapabilityRegistryVersions = (
  left: CapabilityRegistryVersion,
  right: CapabilityRegistryVersion,
): Effect.Effect<RegistryVersionRelation, RegistryEpochMismatchError> => {
  if (left.registry_epoch !== right.registry_epoch) {
    return Effect.fail(
      new RegistryEpochMismatchError({
        left_epoch: left.registry_epoch,
        right_epoch: right.registry_epoch,
        reason: "cross-epoch ordering requires an installed complete baseline",
      }),
    );
  }

  const leftSequence = BigInt(left.registry_sequence);
  const rightSequence = BigInt(right.registry_sequence);
  if (leftSequence < rightSequence) return Effect.succeed("older");
  if (leftSequence > rightSequence) return Effect.succeed("newer");
  return Effect.succeed("equal");
};

export const advanceCapabilityRegistryVersion = (
  current: CapabilityRegistryVersion,
  candidate: CapabilityRegistryVersion,
  installedBaseline?: CapabilityRegistryBaseline,
): Effect.Effect<
  RegistryVersionAdvance,
  | RegistryBaselineRequiredError
  | InvalidRegistryBaselineError
  | RegistrySequenceRegressionError
> => {
  if (current.registry_epoch === candidate.registry_epoch) {
    if (BigInt(candidate.registry_sequence) <= BigInt(current.registry_sequence)) {
      return Effect.fail(
        new RegistrySequenceRegressionError({
          current_sequence: current.registry_sequence,
          candidate_sequence: candidate.registry_sequence,
        }),
      );
    }
    return Effect.succeed("sequence");
  }

  if (installedBaseline === undefined) {
    return Effect.fail(
      new RegistryBaselineRequiredError({
        current_epoch: current.registry_epoch,
        candidate_epoch: candidate.registry_epoch,
      }),
    );
  }

  if (
    installedBaseline.previous_registry_epoch !== current.registry_epoch ||
    installedBaseline.version.registry_epoch !== candidate.registry_epoch ||
    installedBaseline.version.registry_sequence !== candidate.registry_sequence ||
    candidate.registry_sequence !== "0"
  ) {
    return Effect.fail(
      new InvalidRegistryBaselineError({
        reason: "installed baseline does not authorize this exact zero-sequence epoch reset",
      }),
    );
  }

  return Effect.succeed("epoch_reset");
};
