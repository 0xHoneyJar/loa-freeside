export {
  EventEnvelopeSchema,
  GENESIS_PREV_HASH,
  SCHEMA_VERSION,
  envelopeSigningBytes,
  type EventEnvelope,
  type EventEnvelopePayload,
} from "./envelope.js";

export { jcsCanonicalize, sha256Hex } from "./jcs.js";

export {
  LocalEd25519Signer,
  JwksVerifier,
  StaticPubkeyVerifier,
  type Signer,
  type Verifier,
  type SigningKeyId,
  type JwksVerifierOptions,
} from "./signer.js";

export {
  nftMintDetectedTopic,
  NFT_MINT_DETECTED_WILDCARD,
  buildTopic,
  type TopicSegments,
} from "./topics.js";

export {
  publishEnvelope,
  InMemoryPrevHashStore,
  type PrevHashStore,
  type PublishOptions,
  type PublishResult,
} from "./publisher.js";

export {
  subscribeEnvelope,
  type SubscribeOptions,
  type EnvelopeHandler,
  type EnvelopeHandlerContext,
  type VerificationFailureReason,
  type InitialPrevHashPolicy,
} from "./subscriber.js";

export {
  NftMintDetectedSchema,
  type NftMintDetected,
} from "./schemas/nft-mint-detected.js";

// --- cycle-112 schema-emission floor -----------------------------------------

// The event_type -> payload-schema registry (the keystone). Cells reference
// entries; they never mutate the registry.
export {
  schemaId,
  lookupSchema,
  NftMintDetectedId,
  ParallelModeEnabledId,
  REGISTRY_ENTRIES,
  REVIEWED_TRANSFORMS,
  type SchemaId,
  type PayloadOf,
  type RegistryEntry,
} from "./registry.js";

// The transport capability. `createNatsTransport` is the ONLY way a cell obtains
// a transport; `internalPublish` is deliberately NOT exported (FR-7, SKP-002) —
// emit.ts/publisher.ts import it directly from "./transport.js".
export {
  createNatsTransport,
  type NatsTransport,
  type RawNats,
} from "./transport.js";

// The emit facade — the sanctioned NATS emission path.
export {
  makeEmitter,
  SchemaEmitError,
  UnknownSchemaIdError,
  TransportEmitError,
  SubjectFamilyError,
  MissingSignerError,
  type Emitter,
  type EmitterDeps,
  type EmitReceipt,
  type EmitError,
  type RecoveryConfig,
  type DeadLetterInfo,
} from "./emit.js";

// The pilot event (cycle-112 S4) + its config-hash helper.
export {
  ParallelModeEnabledSchema,
  configHash,
  type ParallelModeEnabled,
} from "./schemas/parallel-mode-enabled.js";

// The per-cell chain mutex + its timeout error.
export { Mutex, TimeoutError, DEFAULT_LOCK_TIMEOUT_MS } from "./mutex.js";
