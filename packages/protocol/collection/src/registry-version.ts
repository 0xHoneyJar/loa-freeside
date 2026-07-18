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

const digestMatches = (left: VersionedDigest, right: VersionedDigest): boolean =>
  left.algorithm === right.algorithm &&
  left.domain === right.domain &&
  left.major_version === right.major_version &&
  left.digest === right.digest;

export const decodeCapabilityRegistryBaseline = (input: unknown) =>
  decodeCapabilityRegistryBaselineStruct(input).pipe(
    Effect.flatMap((baseline) =>
      digestVersioned(
        CAPABILITY_REGISTRY_BASELINE_DIGEST_DOMAIN,
        1,
        baselineDigestMaterial(baseline),
      ).pipe(
        Effect.flatMap((expected) =>
          digestMatches(expected, baseline.baseline_digest)
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
  left: unknown,
  right: unknown,
) =>
  Effect.all({
    left: decodeCapabilityRegistryVersion(left),
    right: decodeCapabilityRegistryVersion(right),
  }).pipe(
    Effect.flatMap(({
      left: decodedLeft,
      right: decodedRight,
    }): Effect.Effect<RegistryVersionRelation, RegistryEpochMismatchError> => {
      if (decodedLeft.registry_epoch !== decodedRight.registry_epoch) {
        return Effect.fail(
          new RegistryEpochMismatchError({
            left_epoch: decodedLeft.registry_epoch,
            right_epoch: decodedRight.registry_epoch,
            reason: "cross-epoch ordering requires an installed complete baseline",
          }),
        );
      }

      const leftSequence = BigInt(decodedLeft.registry_sequence);
      const rightSequence = BigInt(decodedRight.registry_sequence);
      if (leftSequence < rightSequence) return Effect.succeed("older");
      if (leftSequence > rightSequence) return Effect.succeed("newer");
      return Effect.succeed("equal");
    }),
  );

export const advanceCapabilityRegistryVersion = (
  current: unknown,
  candidate: unknown,
  installedBaseline?: unknown,
) =>
  Effect.all({
    current: decodeCapabilityRegistryVersion(current),
    candidate: decodeCapabilityRegistryVersion(candidate),
    installedBaseline:
      installedBaseline === undefined
        ? Effect.succeed(undefined)
        : decodeCapabilityRegistryBaseline(installedBaseline),
  }).pipe(
    Effect.flatMap(
      ({
        current: decodedCurrent,
        candidate: decodedCandidate,
        installedBaseline: decodedBaseline,
      }): Effect.Effect<
        RegistryVersionAdvance,
        | RegistryBaselineRequiredError
        | InvalidRegistryBaselineError
        | RegistrySequenceRegressionError
      > => {
        if (decodedCurrent.registry_epoch === decodedCandidate.registry_epoch) {
          if (
            BigInt(decodedCandidate.registry_sequence) <=
            BigInt(decodedCurrent.registry_sequence)
          ) {
            return Effect.fail(
              new RegistrySequenceRegressionError({
                current_sequence: decodedCurrent.registry_sequence,
                candidate_sequence: decodedCandidate.registry_sequence,
              }),
            );
          }
          return Effect.succeed("sequence");
        }

        if (decodedBaseline === undefined) {
          return Effect.fail(
            new RegistryBaselineRequiredError({
              current_epoch: decodedCurrent.registry_epoch,
              candidate_epoch: decodedCandidate.registry_epoch,
            }),
          );
        }

        if (
          decodedBaseline.previous_registry_epoch !== decodedCurrent.registry_epoch ||
          decodedBaseline.version.registry_epoch !== decodedCandidate.registry_epoch ||
          decodedBaseline.version.registry_sequence !== decodedCandidate.registry_sequence ||
          decodedCandidate.registry_sequence !== "0"
        ) {
          return Effect.fail(
            new InvalidRegistryBaselineError({
              reason: "installed baseline does not authorize this exact zero-sequence epoch reset",
            }),
          );
        }

        return Effect.succeed("epoch_reset");
      },
    ),
  );
