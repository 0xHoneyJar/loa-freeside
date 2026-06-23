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
import { postureToRequiredTier } from "../domain/posture.js";
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

    // Non-blocking postures (FEEDBACK_LOOP, FREE): claimed-ok, never forced to
    // settle. A FEEDBACK_LOOP domain with no evidence still proceeds but emits a
    // WARN — not a silent INFO (SDD SKP-003: missing instrument in a FEEDBACK_LOOP
    // domain proceeds AND warns). FREE proceeds quietly and requires no snapshot.
    if (posture === "FEEDBACK_LOOP" || posture === "FREE") {
      const hasEvidence = this.cfg.store.getSync(action.claim.id) !== null;
      const warn = posture === "FEEDBACK_LOOP" && !hasEvidence;
      const reason = warn
        ? "FEEDBACK_LOOP: missing evidence — proceeding on claimed (WARN, not silent)"
        : posture === "FEEDBACK_LOOP"
          ? "FEEDBACK_LOOP posture: claimed-ok, settlement not required"
          : "FREE posture: proceed (no settlement required)";
      return this.decide({
        action, now, posture, required,
        earned: "claimed", proceed: true,
        reason,
        level: warn ? "WARN" : "INFO",
        instrumentId: "none", instrumentSha: "none",
      });
    }

    // Blocking postures (FAIL_CLOSED, VERIFY_THEN_PROCEED): require valid, bound evidence.
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

    const policy = this.checkSnapshotPolicy(signed, action, now);
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

    // G-7: a degraded verification chain (missing voice / hash mismatch / partial
    // chain) cannot be honored as `settled` — cap it below settled.
    const rawEarned = signed.snapshot.earned_tier;
    const degradedCap = signed.snapshot.chain_health === "degraded" && rawEarned === "settled";
    const earned = degradedCap ? "pinned" : rawEarned;
    const proceed = tierGte(earned, required);
    const reason = degradedCap
      ? `degraded chain capped settled→pinned (G-7); ${proceed ? `pinned >= required ${required}` : `pinned < required ${required} → ABSTAIN/HALT`}`
      : proceed
        ? `earned ${earned} >= required ${required}`
        : `earned ${earned} < required ${required} → ABSTAIN/HALT`;
    return this.decide({
      action, now, posture, required, earned, proceed,
      reason,
      level: proceed ? "INFO" : "WARN",
      instrumentId: signed.snapshot.instrument_id,
      instrumentSha: signed.snapshot.instrument_sha,
    });
  }

  /** Binding + trusted-key + signature + TTL, all synchronous. */
  private checkSnapshotPolicy(
    signed: SignedSnapshot,
    action: GateAction,
    now: number,
  ): { ok: boolean; reason: string } {
    // The snapshot is cryptographically bound to a claim + domain; enforce both
    // (the binding fields are inside the signed bytes). Without this, a valid
    // `settled` snapshot for a low-stakes domain replays as a skeleton key for a
    // must-settle action sharing the claim id (confused-deputy). threat A-6.
    if (signed.snapshot.claim_id !== action.claim.id) {
      return { ok: false, reason: "snapshot claim_id mismatch" };
    }
    if (signed.snapshot.domain !== action.domain) {
      return { ok: false, reason: "snapshot domain mismatch (cross-domain replay)" };
    }
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
