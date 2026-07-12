/**
 * cutover-readiness.ts — the pure decision for whether a coexistence migration may
 * graduate to a PRIMARY cutover (which grants real community-access roles).
 *
 * Extracted from MigrationEngine.checkReadiness (that file is `// @ts-nocheck`) so
 * the highest-stakes gate in the system is TYPE-CHECKED and unit-testable in
 * isolation: a pure decision (Construct plane), no I/O (Execution plane). The host
 * gathers the inputs (migration state, divergence summary) and delegates the verdict
 * here.
 *
 * It carries the minimum-sample-size FLOOR (arrakis-dkf9): an accuracy percentage is
 * only meaningful over a sufficient sample, so a tiny sample (e.g. 3 compared members
 * at 3/3 = 100%) must NOT clear the 95% accuracy gate and grant real access on
 * statistically meaningless data. The floor is an INPUT (`minSampleSize`), so the
 * threshold policy stays co-located with the other thresholds in the host.
 */

export interface CutoverReadinessInput {
  readonly shadowDays: number;
  readonly minShadowDays: number;
  readonly accuracyPercent: number;
  readonly minAccuracyPercent: number;
  /**
   * The number of compared members the accuracy % is computed over — the accuracy
   * DENOMINATOR (`divergenceSummary.totalMembers`). This is the signal dkf9 ignored.
   */
  readonly sampleSize: number;
  readonly minSampleSize: number;
  readonly incumbentConfigured: boolean;
  readonly modeValid: boolean;
  /** Current mode label — used only for the human-readable reason, not the decision. */
  readonly currentMode?: string;
}

export interface CutoverReadinessChecks {
  readonly shadowDaysCheck: boolean;
  readonly accuracyCheck: boolean;
  readonly sampleSizeCheck: boolean;
  readonly incumbentConfigured: boolean;
  readonly modeCheck: boolean;
}

export interface CutoverReadinessDecision {
  readonly ready: boolean;
  readonly checks: CutoverReadinessChecks;
  readonly reason?: string;
}

/**
 * Pure cutover-graduation verdict. `ready` is the conjunction of ALL gates — shadow
 * days, accuracy, SAMPLE SIZE, incumbent configured, and a valid mode — so any
 * failing gate (including an under-sized accuracy sample) fails CLOSED to not-ready.
 */
export function evaluateCutoverReadiness(
  input: CutoverReadinessInput,
): CutoverReadinessDecision {
  const shadowDaysCheck = input.shadowDays >= input.minShadowDays;
  const accuracyCheck = input.accuracyPercent >= input.minAccuracyPercent;
  // SAMPLE-SIZE FLOOR (arrakis-dkf9): a high accuracy % over too few comparisons is
  // not yet trustworthy — require a minimum sample before the accuracy gate counts.
  const sampleSizeCheck = input.sampleSize >= input.minSampleSize;
  const incumbentConfigured = input.incumbentConfigured;
  const modeCheck = input.modeValid;

  const ready =
    shadowDaysCheck &&
    accuracyCheck &&
    sampleSizeCheck &&
    incumbentConfigured &&
    modeCheck;

  let reason: string | undefined;
  if (!ready) {
    const reasons: string[] = [];
    if (!incumbentConfigured) {
      reasons.push('No incumbent bot configured');
    }
    if (!modeCheck) {
      reasons.push(
        `Invalid mode for migration: ${input.currentMode ?? 'unknown'} (must be shadow or parallel)`,
      );
    }
    if (!shadowDaysCheck) {
      reasons.push(`Insufficient shadow days: ${input.shadowDays}/${input.minShadowDays}`);
    }
    if (!sampleSizeCheck) {
      reasons.push(
        `Insufficient sample size: ${input.sampleSize}/${input.minSampleSize} compared members (accuracy not yet statistically meaningful)`,
      );
    }
    if (!accuracyCheck) {
      reasons.push(
        `Insufficient accuracy: ${input.accuracyPercent.toFixed(1)}%/${input.minAccuracyPercent}%`,
      );
    }
    reason = reasons.join('; ');
  }

  return {
    ready,
    checks: { shadowDaysCheck, accuracyCheck, sampleSizeCheck, incumbentConfigured, modeCheck },
    reason,
  };
}
