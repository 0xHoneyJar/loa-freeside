// estimate.mjs — the verdict heuristic (pure, testable, no I/O).
//
// HONEST LABEL: Dune has NO native dry-run / EXPLAIN (design doc §"The honest
// constraint"). Billing is dynamic (compute time + data scanned) and not
// previewable. So `estimate` is a PROBE-BASED HEURISTIC, never a true cost
// preview: a cheap COUNT(*) / LIMIT-1 probe on the SMALL engine gauges rows ×
// cols, and we project from that. The verdict thresholds here are the budget
// guard; the probe magnitude (in dune-client) is the input.
//
// Billing unit: 1 credit = 1,000 datapoints (rows × cols).

/** datapoints → credits. Dune bills per 1,000 datapoints, rounded up. */
export function creditsForDatapoints(datapoints) {
  if (!Number.isInteger(datapoints) || datapoints < 0) {
    throw new Error(`estimate: datapoints must be a non-negative integer (got ${datapoints})`);
  }
  return Math.ceil(datapoints / 1000);
}

/** estimated_datapoints = probed_rows × cols. Both integers. */
export function estimateDatapoints(rows, cols) {
  for (const [n, v] of [['rows', rows], ['cols', cols]]) {
    if (!Number.isInteger(v) || v < 0) throw new Error(`estimate: ${n} must be a non-negative integer (got ${v})`);
  }
  return rows * cols;
}

/**
 * The verdict, given an estimate and the remaining budget.
 *   REFUSE  — estimated_credits > remaining        (would overspend; exit 3)
 *   WARN    — estimated_credits > 25% of remaining  (large relative to budget)
 *   OK      — otherwise
 *
 * 25% boundary is inclusive on OK: est == 25% of remaining is OK; strictly
 * greater is WARN. Integer comparison (4·est vs remaining) avoids float drift.
 */
export function verdictFor(estimatedCredits, remainingCredits) {
  if (!Number.isInteger(estimatedCredits) || estimatedCredits < 0) {
    throw new Error(`estimate: estimatedCredits must be a non-negative integer (got ${estimatedCredits})`);
  }
  if (!Number.isInteger(remainingCredits) || remainingCredits < 0) {
    throw new Error(`estimate: remainingCredits must be a non-negative integer (got ${remainingCredits})`);
  }
  if (estimatedCredits > remainingCredits) return 'REFUSE';
  // WARN if est > 25% of remaining  ⇔  4·est > remaining
  if (4 * estimatedCredits > remainingCredits) return 'WARN';
  return 'OK';
}

/**
 * Full estimate result from a probe (rows × cols) and the current ledger
 * remaining. The honest-heuristic flag is always true — this is never a true
 * preview.
 */
export function buildEstimate({ rows, cols, remainingCredits }) {
  const estimated_datapoints = estimateDatapoints(rows, cols);
  const estimated_credits = creditsForDatapoints(estimated_datapoints);
  const verdict = verdictFor(estimated_credits, remainingCredits);
  return {
    estimated_datapoints,
    estimated_credits,
    remaining_budget: remainingCredits,
    verdict,
    heuristic: true,
    note: 'probe-based heuristic — Dune has no native cost preview',
  };
}
