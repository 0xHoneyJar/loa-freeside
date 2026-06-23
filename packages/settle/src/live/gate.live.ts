/**
 * SyncGate — the synchronous, fail-closed pre-action gate. (T1.5)
 *
 * `checkSync` (SKP-001a) does NO I/O: it classifies the domain, reads the
 * precomputed signed snapshot synchronously, verifies it (trusted-key + signature
 * + TTL), and decides `proceed = earned_tier >= required_tier`. Every decision is
 * appended to the trail. This synchronous block is what makes G-2 real — a
 * must-settle action whose claim is not `settled` cannot proceed.
 *
 * Fail-closed everywhere: missing snapshot, untrusted signer, bad signature, or
 * an expired snapshot all yield `abstained` (proceed:false), never `settled`.
 * FEEDBACK_LOOP domains (taste/feel/voice) are the one non-blocking posture —
 * claimed-ok, never forced to settle (SDD §5.2).
 */

import type { Gate, GateAction, GateDecision } from "../ports/gate.port.js";
import type { Classifier } from "../ports/classifier.port.js";
import type { SnapshotStore } from "../ports/snapshot.port.js";
import type { TrailWriter, TrailEntry, TrailLevel } from "../ports/trail.port.js";
import type { Tier, TierStamp } from "../domain/tier.js";
import type { PostureLevel } from "../domain/posture.js";
import type { SignedSnapshot } from "../domain/snapshot.js";
import { tierGte, makeTetlockForecast } from "../domain/tier.js";
import { postureToRequiredTier, postureIsFeedbackLoop } from "../domain/posture.js";
import { verifySnapshotSignature } from "./snapshot-signer.live.js";

export interface GateConfig {
  readonly classifier: Classifier;
  readonly store: SnapshotStore;
  readonly trail: TrailWriter;
  /** base64 SPKI-DER of the verifier key; only snapshots from this key can settle. */
  readonly trustedVerifierPublicKey: string;
  /** Injected logical clock (integer) for TTL checks + trail timestamps. */
  readonly now: () => number;
}

/** The gate enforces; it does not forecast. Confidence is instrument-supplied in
 *  a later phase — at the gate it is a fixed neutral value. */
const NEUTRAL_CONFIDENCE = makeTetlockForecast(0, null, null);

interface DecisionInputs {
  readonly action: GateAction;
  readonly now: number;
  readonly posture: PostureLevel;
  readonly required: Tier;
  readonly earned: Tier;
  readonly proceed: boolean;
  readonly reason: string;
  readonly level: TrailLevel;
  readonly instrumentId: string;
  readonly instrumentSha: string;
}

export class SyncGate implements Gate {
  constructor(private readonly cfg: GateConfig) {}

  checkSync(action: GateAction): GateDecision {
    const now = this.cfg.now();
    const posture = this.cfg.classifier.classify(action.domain);
    const required = postureToRequiredTier(posture);

    // FEEDBACK_LOOP: taste/feel/voice — claimed-ok, never forced to settle.
    if (postureIsFeedbackLoop(posture)) {
      return this.decide({
        action, now, posture, required,
        earned: "claimed", proceed: true,
        reason: "FEEDBACK_LOOP posture: claimed-ok, settlement not required",
        level: "INFO", instrumentId: "none", instrumentSha: "none",
      });
    }

    const signed = this.cfg.store.getSync(action.claim.id);
    if (!signed) {
      // Missing evidence/instrument → abstained, never settled (fail-closed).
      return this.decide({
        action, now, posture, required,
        earned: "abstained", proceed: false,
        reason: "no verification snapshot for claim (missing evidence) → abstained",
        level: "WARN", instrumentId: "none", instrumentSha: "none",
      });
    }

    const policy = this.checkSnapshotPolicy(signed, now);
    if (!policy.ok) {
      return this.decide({
        action, now, posture, required,
        earned: "abstained", proceed: false,
        reason: `snapshot rejected: ${policy.reason} → abstained`,
        level: "WARN",
        instrumentId: signed.snapshot.instrument_id,
        instrumentSha: signed.snapshot.instrument_sha,
      });
    }

    const earned = signed.snapshot.earned_tier;
    const proceed = tierGte(earned, required);
    return this.decide({
      action, now, posture, required, earned, proceed,
      reason: proceed
        ? `earned ${earned} >= required ${required}`
        : `earned ${earned} < required ${required} → ABSTAIN/HALT`,
      level: proceed ? "INFO" : "WARN",
      instrumentId: signed.snapshot.instrument_id,
      instrumentSha: signed.snapshot.instrument_sha,
    });
  }

  /** Trusted-key + signature + TTL, all synchronous. */
  private checkSnapshotPolicy(signed: SignedSnapshot, now: number): { ok: boolean; reason: string } {
    if (signed.public_key !== this.cfg.trustedVerifierPublicKey) {
      return { ok: false, reason: "untrusted signer key" }; // threat A-6
    }
    const sig = verifySnapshotSignature(signed);
    if (!sig.ok) return { ok: false, reason: sig.reason };
    const { prepared_at, ttl } = signed.snapshot;
    if (now > prepared_at + ttl) {
      return { ok: false, reason: `snapshot expired (now ${now} > ${prepared_at}+${ttl})` }; // SKP-005a
    }
    return { ok: true, reason: "ok" };
  }

  private decide(d: DecisionInputs): GateDecision {
    const stamp: TierStamp = {
      tier: d.earned,
      provenance: {
        by: "settle.gate",
        at_ppm: d.now,
        instrument_id: d.instrumentId,
        instrument_sha: d.instrumentSha,
      },
      confidence: NEUTRAL_CONFIDENCE,
      verify_ref: `${d.action.claim.id}@${d.instrumentId}`,
    };
    const entry: TrailEntry = {
      at: d.now,
      domain: d.action.domain,
      claim_id: d.action.claim.id,
      posture: d.posture,
      required: d.required,
      earned: d.earned,
      proceed: d.proceed,
      reason: d.reason,
      level: d.level,
    };
    this.cfg.trail.append(entry);
    return { proceed: d.proceed, reason: d.reason, stamp };
  }
}
