/**
 * @freeside/settle — the Settle Substrate.
 *
 * Public surface: domain types, ports, live implementations, and the gated facade.
 * NOT exported: `live/_internal/must-settle-capability` — the raw must-settle
 * capability is reachable only through `performGatedAction` (SKP-001b).
 */

// Domain
export type { Tier, TierStamp, TetlockForecast } from "./domain/tier.js";
export { tierRank, tierGte, isTerminal, assertPpm, makeTetlockForecast } from "./domain/tier.js";
export type { Verdict, Bar, ClaimInput, VerdictEnvelope } from "./domain/claim.js";
export { verdictToEarnedTier } from "./domain/claim.js";
export type { PostureLevel } from "./domain/posture.js";
export { postureToRequiredTier, postureIsFeedbackLoop } from "./domain/posture.js";
export type { VerificationSnapshot, SignedSnapshot, ChainHealth } from "./domain/snapshot.js";
export { SNAPSHOT_SCHEMA } from "./domain/snapshot.js";

// Ports
export type { SettleInstrument, InstrumentResult } from "./ports/settle-instrument.port.js";
export type { Verifier } from "./ports/verifier.port.js";
export type { Gate, GateAction, GateDecision } from "./ports/gate.port.js";
export type { Classifier } from "./ports/classifier.port.js";
export type { SnapshotSigner, SnapshotStore, SnapshotVerification } from "./ports/snapshot.port.js";
export type { TrailWriter, TrailEntry, TrailLevel } from "./ports/trail.port.js";
export type { BarRegistrar, BarRegistration } from "./ports/bar-registry.port.js";
export type { Detector, MismatchTile, MismatchRecord } from "./ports/detector.port.js";

// Live
export { GlobClassifier, PINNED_MAP_SHA } from "./live/classifier.live.js";
export { IndependentVerifier, instrumentKey } from "./live/verifier.live.js";
export { Ed25519SnapshotSigner, verifySnapshotSignature } from "./live/snapshot-signer.live.js";
export { InMemorySnapshotStore } from "./live/snapshot-store.live.js";
export { AppendOnlyFileTrail, MAX_ROW_BYTES } from "./live/trail.live.js";
export { SyncGate, type GateConfig } from "./live/gate.live.js";
export { BarRegistry } from "./live/bar-registry.live.js";
export { TrailDetector } from "./live/detector.live.js";
export {
  DeployedTruthInstrument,
  DEPLOYED_TRUTH_ID,
  type DeployedTruthReaders,
  type DeployedTruthExpectation,
  type RailwayMeta,
  type OnChainRead,
} from "./live/deployed-truth.instrument.js";

// Facade — the only path to a must-settle action
export { performGatedAction, type GatedOutcome } from "./live/gated-facade.js";

// Lib
export { jcsCanonicalize, sha256Hex, jcsHash } from "./lib/jcs.js";
