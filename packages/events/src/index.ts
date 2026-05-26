export {
  EventEnvelopeSchema,
  SCHEMA_VERSION,
  type EventEnvelope,
  type EventEnvelopePayload,
} from "./envelope.js";

export { jcsCanonicalize, sha256Hex } from "./jcs.js";

export {
  LocalEd25519Signer,
  JwksVerifier,
  type Signer,
  type Verifier,
  type SigningKeyId,
} from "./signer.js";

export {
  nftMintDetectedTopic,
  NFT_MINT_DETECTED_WILDCARD,
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
  type VerificationFailureReason,
} from "./subscriber.js";

export {
  NftMintDetectedSchema,
  type NftMintDetected,
} from "./schemas/nft-mint-detected.js";
