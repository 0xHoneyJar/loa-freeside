import {
  TRUST_ENVELOPE_SCHEMA_MAJOR,
  TRUST_ENVELOPE_SCHEMA_MINOR,
} from "./version.js";

/**
 * Mixed-minor acceptance rules for CR-009.
 *
 * - Unknown major always fails closed.
 * - Within the same major, a consumer accepts envelope minors <= its supported minor.
 * - Envelope minors greater than supported fail closed until the consumer upgrades.
 * - Strict decoders reject unknown fields regardless of minor (onExcessProperty: error).
 * - Optional future minors may add only optional fields; required-field additions require major bump.
 */
export const acceptsEnvelopeSchemaMinor = (
  envelopeMinor: number,
  consumerSupportedMinor: number = TRUST_ENVELOPE_SCHEMA_MINOR,
): boolean => envelopeMinor <= consumerSupportedMinor;

export const assertSupportedSchemaMajor = (major: number): void => {
  if (major !== TRUST_ENVELOPE_SCHEMA_MAJOR) {
    throw new Error(`unsupported trust-envelope schema major ${major}`);
  }
};

export const assertSupportedSchemaMinor = (
  minor: number,
  consumerSupportedMinor: number = TRUST_ENVELOPE_SCHEMA_MINOR,
): void => {
  if (!acceptsEnvelopeSchemaMinor(minor, consumerSupportedMinor)) {
    throw new Error(
      `unsupported trust-envelope schema minor ${minor} (consumer supports <= ${consumerSupportedMinor})`,
    );
  }
};

export const mixedMinorRules = Object.freeze({
  unknownMajor: "fail_closed",
  unknownRequiredField: "fail_closed",
  excessProperty: "fail_closed",
  higherMinorThanConsumer: "fail_closed",
  lowerOrEqualMinorWithinMajor: "accept_if_decoder_succeeds",
});
