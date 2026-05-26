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
