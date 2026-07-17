/**
 * @freeside/trust-envelope-protocol
 *
 * CR-009 signed trust-envelope wire contract for Ordering dependency intake.
 * Distinct from events-pillar acvp-l1-v2 NATS envelopes.
 */

export {
  TRUST_ENVELOPE_SCHEMA_MAJOR,
  TRUST_ENVELOPE_SCHEMA_MINOR,
  TRUST_ENVELOPE_PROTOCOL_VERSION,
  TRUST_ENVELOPE_CONTRACT,
  TRUST_ENVELOPE_MAX_FUTURE_SKEW_MS,
  TRUST_STREAM_MIN_RETENTION_MS,
  TRUST_ENVELOPE_DEFAULT_TTL_MS,
} from "./version.js";

export {
  ContractIntegrityError,
  TrustEnvelopeRejectedError,
  StreamEpochBaselineRejectedError,
} from "./errors.js";

export {
  TrustContractRef,
  TrustEnvelopeHeader,
  TrustEnvelope,
  StreamEpochBaseline,
  ServiceSigningKey,
  FixtureKeyRegistry,
  decodeTrustEnvelope,
  decodeStreamEpochBaseline,
  decodeFixtureKeyRegistry,
  supportedSchemaMinor,
  strictDecodeOptions,
} from "./contracts.js";

export {
  acceptsEnvelopeSchemaMinor,
  assertSupportedSchemaMajor,
  assertSupportedSchemaMinor,
  mixedMinorRules,
} from "./versioning.js";

export {
  jcsCanonicalize,
  sha256Hex,
  digestJcs,
} from "./jcs.js";

export {
  computeBodyDigest,
  envelopeSigningBytes,
  baselineSigningBytes,
  verifyEd25519Signature,
  signTrustEnvelope,
  signStreamEpochBaseline,
  digestEpochBaselineMaterial,
  LocalEd25519TrustSigner,
  type TrustEnvelopeSigner,
} from "./signing.js";

export { ServiceKeyRegistry } from "./registry.js";

export {
  verifyTrustEnvelope,
  verifyStreamEpochBaseline,
  resolveActiveKey,
  type VerifyTrustEnvelopeInput,
  type VerifyStreamEpochBaselineInput,
} from "./verify.js";

export {
  buildTrustEnvelopeHeader,
  emitTrustEnvelope,
  createTrustStreamProducerState,
  advanceTrustStreamProducer,
  resetTrustStreamEpoch,
  type BuildTrustEnvelopeHeaderInput,
  type EmitTrustEnvelopeInput,
  type TrustStreamProducerState,
} from "./producer.js";

export {
  createStreamConsumerState,
  ingestTrustEnvelope,
  installEpochBaseline,
  requestGapRepairRange,
  replayEnvelopeIdempotently,
  type StreamConsumerState,
  type IngestTrustEnvelopeInput,
  type IngestTrustEnvelopeResult,
  type InstallEpochBaselineInput,
} from "./consumer.js";

export {
  FIXTURE_SIGNING_SEEDS,
  FIXTURE_SIGNING_KEY_IDS,
  FIXTURE_STREAM_ID,
  FIXTURE_TENANT_SCOPE_DIGEST,
  FIXTURE_CAPABILITY,
  fixtureSigners,
  fixturePublicKeys,
} from "./fixture-keys.js";

export {
  decodeFixtureScenarioBundle,
  fixtureRegistryFromBundle,
  type FixtureScenarioBundle,
} from "./fixture-scenarios.js";
