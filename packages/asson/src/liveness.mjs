/**
 * liveness.mjs — the clock at the crossroads. Forward-progress enforcement over spans.
 *
 * Safety (legba) says nothing bad happens: no skipped gate, no forged token, no tampered
 * move. Liveness says something good EVENTUALLY happens. They are formally independent —
 * a span that sits forever violates no safety invariant. This module is the F_t side
 * (hounfour src/integrity/liveness-properties.ts is the law; this is the street version),
 * operating directly on legba-format span logs: [{record:{kind,tool,input_hash,ts,seq,...},
 * record_hash}].
 *
 * Doctrine encoded here:
 *   - meter the span, make the gate free: arrival is never punished, eviction never
 *     discards work (the chess clock: when your time runs out you MOVE, you don't lose)
 *   - the move log IS the heartbeat: silence and spin are detectable from hashes alone,
 *     no semantic judgment required (silence is the worst mode; the recorder ends it)
 *   - soundness model-free: every detector here works identically on a brilliant agent
 *     and a wedged one. Budget MAGNITUDES are ergonomics (tune per model tier);
 *     having a clock is soundness (never optional).
 *
 * Zero dependencies. Pairs with legba-substrate; consumes its logs, emits its packets.
 */

export const DEFAULT_POLICY = {
  budget: { tool_calls: 50, wall_s: 120 },
  soft_walls: { warn: 0.6, compact: 0.8 },
  stall: { no_moves_s: 90 },
  spin: { repeat_window: 5, threshold: 3 },
  pace: { p95_s: null },                 // null = no pace data yet (gecko fills this)
  rotation: { after_evictions: 2 },
};

const ts = (m) => Date.parse(m.record.ts);

/** Budget accounting with soft walls. phase: ok → warn → compact → exhausted. */
export function budgetStatus(log, policy = DEFAULT_POLICY, { nowMs = Date.now() } = {}) {
  const calls = log.filter(m => m.record.kind === 'tool_call').length;
  const wall_s = log.length ? Math.max(0, (nowMs - ts(log[0])) / 1000) : 0;
  const frac = Math.max(
    policy.budget.tool_calls ? calls / policy.budget.tool_calls : 0,
    policy.budget.wall_s ? wall_s / policy.budget.wall_s : 0,
  );
  const phase = frac >= 1 ? 'exhausted'
    : frac >= policy.soft_walls.compact ? 'compact'
    : frac >= policy.soft_walls.warn ? 'warn' : 'ok';
  return { calls, wall_s: +wall_s.toFixed(1), fraction: +frac.toFixed(2), phase };
}

/** Stall: no moves inside the heartbeat window. The recorder makes silence loud. */
export function detectStall(log, policy = DEFAULT_POLICY, { nowMs = Date.now() } = {}) {
  if (!log.length) return { stalled: true, silent_s: Infinity, reason: 'no moves recorded' };
  const silent_s = (nowMs - ts(log[log.length - 1])) / 1000;
  return { stalled: silent_s > policy.stall.no_moves_s, silent_s: +silent_s.toFixed(1) };
}

/** Spin: repeated (tool + input_hash) pairs inside the window — a cycle visible from
 *  hashes alone. Re-running the SAME deterministic tool on the SAME input is, by the
 *  substrate's own physics, incapable of producing new information. */
export function detectSpin(log, policy = DEFAULT_POLICY) {
  const calls = log.filter(m => m.record.kind === 'tool_call').slice(-policy.spin.repeat_window);
  const seen = new Map();
  for (const m of calls) {
    const k = m.record.tool + '|' + m.record.input_hash;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const worst = Math.max(0, ...seen.values());
  return { spinning: worst >= policy.spin.threshold, max_repeats: worst,
    repeated: [...seen.entries()].filter(([, n]) => n >= policy.spin.threshold).map(([k]) => k) };
}

/** Pace: wall time vs declared/observed p95 for this phase (splits, from speedrunning).
 *  Early-warning tier under the enrage tier — off-pace is visible before any wall hits. */
export function paceCheck(log, policy = DEFAULT_POLICY, { nowMs = Date.now() } = {}) {
  if (!policy.pace.p95_s || !log.length) return { tracked: false };
  const wall_s = (nowMs - ts(log[0])) / 1000;
  return { tracked: true, wall_s: +wall_s.toFixed(1), p95_s: policy.pace.p95_s, off_pace: wall_s > policy.pace.p95_s };
}

/** Checkpoint-on-eviction: forced arrival ≠ failure. Emits a legba-compatible partial
 *  packet so the gate can judge pass-partial / refuse-with-direction / escalate.
 *  Work is never lost to the clock — if eviction destroyed work, agents would hide
 *  from the wall, and the wall would become a loiter incentive. */
export function checkpointPacket(spanMeta, log, reason) {
  return {
    packet_kind: 'liveness_checkpoint',
    span_id: spanMeta.span_id,
    run_id: spanMeta.run_id ?? null,
    reason,                                  // 'budget_exhausted' | 'stall_reaped' | 'spin_compacted' | 'cancelled'
    verdict: { status: 'incomplete', reason },
    move_count: log.length,
    last_move_hash: log.length ? log[log.length - 1].record_hash : null,
    ts: new Date().toISOString(),
  };
}

/** The aggregate verdict the watchdog acts on. Precedence: stall (reap) > exhausted
 *  (checkpoint+present) > spin (compact then present) > compact wall > warn > pace > ok. */
export function livenessVerdict(log, policy = DEFAULT_POLICY, opts = {}) {
  const stall = detectStall(log, policy, opts);
  const spin = detectSpin(log, policy);
  const budget = budgetStatus(log, policy, opts);
  const pace = paceCheck(log, policy, opts);
  const action =
    stall.stalled ? 'reap' :
    budget.phase === 'exhausted' ? 'checkpoint_and_present' :
    spin.spinning ? 'compact_then_present' :
    budget.phase === 'compact' ? 'compact' :
    budget.phase === 'warn' ? 'warn' :
    pace.tracked && pace.off_pace ? 'pace_alert' : 'continue';
  return { action, stall, spin, budget, pace };
}
