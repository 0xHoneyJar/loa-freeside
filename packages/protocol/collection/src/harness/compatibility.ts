import { Data, Effect, Schema } from "effect";
import {
  COLLECTION_PROTOCOL_SCHEMA_MAJOR,
  COLLECTION_PROTOCOL_SCHEMA_MINOR,
} from "../scalars.js";
import { ContractSchemaVersion } from "./manifest.js";

/**
 * Consumer-declared support window for the collection contract.
 *
 * Dependency direction: consumers depend on `@freeside/collection-protocol`.
 * The protocol package never imports Dashboard, Sonar, Inventory, or Ordering.
 */
export const ConsumerSupport = Schema.Struct({
  major: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(1)),
  min_minor: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)),
  max_minor: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)),
}).pipe(
  Schema.filter(
    (value) =>
      value.max_minor >= value.min_minor ||
      "max_minor must be greater than or equal to min_minor",
  ),
).annotations({ identifier: "ConsumerSupport" });
export type ConsumerSupport = Schema.Schema.Type<typeof ConsumerSupport>;

export const decodeConsumerSupport = Schema.decodeUnknown(ConsumerSupport, {
  errors: "all",
  onExcessProperty: "error",
});

export class UnsupportedContractMajor extends Data.TaggedError(
  "UnsupportedContractMajor",
)<{
  readonly produced_major: number;
  readonly supported_major: number;
  readonly reason: string;
}> {}

export class UnsupportedContractMinor extends Data.TaggedError(
  "UnsupportedContractMinor",
)<{
  readonly produced_major: number;
  readonly produced_minor: number;
  readonly min_minor: number;
  readonly max_minor: number;
  readonly reason: string;
}> {}

export type ContractCompatibilityError =
  | UnsupportedContractMajor
  | UnsupportedContractMinor;

/**
 * Fail closed on unknown major. Accept mixed-minor only inside the consumer's
 * declared inclusive minor window for that major.
 */
export const checkContractCompatibility = (
  produced: ContractSchemaVersion,
  supported: ConsumerSupport,
): Effect.Effect<void, ContractCompatibilityError> => {
  if (produced.major !== supported.major) {
    return Effect.fail(
      new UnsupportedContractMajor({
        produced_major: produced.major,
        supported_major: supported.major,
        reason: `contract major ${produced.major} is outside supported major ${supported.major}`,
      }),
    );
  }
  if (produced.minor < supported.min_minor || produced.minor > supported.max_minor) {
    return Effect.fail(
      new UnsupportedContractMinor({
        produced_major: produced.major,
        produced_minor: produced.minor,
        min_minor: supported.min_minor,
        max_minor: supported.max_minor,
        reason: `contract minor ${produced.minor} is outside supported range ${supported.min_minor}..${supported.max_minor} for major ${supported.major}`,
      }),
    );
  }
  return Effect.void;
};

/** Wire envelopes carry integer major only; treat absent minor as 0. */
export const contractSchemaFromWireMajor = (
  schemaVersion: number,
  minor = 0,
): ContractSchemaVersion => ({
  major: schemaVersion,
  minor,
});

export const currentPublishedSupport = (): ConsumerSupport => ({
  major: COLLECTION_PROTOCOL_SCHEMA_MAJOR,
  min_minor: 0,
  max_minor: COLLECTION_PROTOCOL_SCHEMA_MINOR,
});
