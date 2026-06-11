#!/usr/bin/env bash
# legba-baseline.sh — rung-0 consumption-gradient baseline (Legba cycle 1, Task 1.1)
#
# Measures the mechanical cost of producing a run that COUNTS (compose-verify-run
# --require-executed → valid_run) via the governed path, vs the role-play path
# (zero steps, byte-identical-looking artifact). PRD G-2 / IMP-004: this baseline
# is captured BEFORE any Legba rung mutates the process, so later rungs have an
# honest before/after.
#
# The run is FRESH and hermetic: the pilot composition is compiled into a temp
# LOA_PROJECT_ROOT, the segment executes via the runtime's own deterministic
# dry-run harness (run-emitted-segment.js — no model spend), seeds are wrapped
# through compose-handoff-wrap.sh, and the terminal gate proves the run. The
# playtest run (ptt-20260611) is deliberately NOT reused (Flatline sprint B2).
#
# Usage: scripts/legba-baseline.sh [--run-id ID] [--out-dir DIR]
set -euo pipefail

RT="${LOA_COMPOSE_RUNTIME:-$HOME/.loa/constructs/substrates/construct-rooms-substrate}"
SCHEMA="${LOA_COMPOSE_SCHEMA:-$HOME/Documents/GitHub/loa-constructs/.claude/schemas/runtime/composition.schema.json}"
PILOT="$RT/compositions/code-implement-and-review.yaml"
RUN_ID="${2:-legba-baseline-$(date -u +%Y%m%d-%H%M%S)}"
[[ "${1:-}" == "--run-id" ]] && RUN_ID="$2"
OUT_DIR="grimoires/loa/context"
mkdir -p "$OUT_DIR"

for f in "$RT/scripts/compose-dispatch.sh" "$PILOT" "$SCHEMA"; do
  [[ -e "$f" ]] || { echo "LEGBA_SETUP_REQUIRED: missing $f" >&2; exit 2; }
done

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT
RUN_DIR="$ROOT/.run/compose/$RUN_ID"
STEPS=0; ENV_VARS=2  # LOA_PROJECT_ROOT + LOA_COMPOSE_SCHEMA — both load-bearing
BASE_DIR_HOPS=1      # verify-run verdict is base-dir-dependent (playtest finding):
                     # the gate must run against the SAME project root or a real
                     # run reads not_a_run. One hop, counted honestly.

# step 1 — compile (validate-before-spend, cut, emit)
env LOA_PROJECT_ROOT="$ROOT" LOA_COMPOSE_SCHEMA="$SCHEMA" \
  "$RT/scripts/compose-dispatch.sh" "$PILOT" --form-c --run-id "$RUN_ID" --json \
  >/dev/null 2>&1 || [[ $? -eq 3 ]]
STEPS=$((STEPS+1))

# step 2 — read the manifest (the executor's contract)
MANIFEST="$RUN_DIR/form-c-manifest.json"
SEG="$(python3 -c "import json;print(json.load(open('$MANIFEST'))['segments'][0]['workflow_file'])")"
STEPS=$((STEPS+1))

# step 3 — execute the segment (deterministic dry-run harness; in a live session
# this is the Workflow tool call)
RESULT="$(node "$RT/scripts/lib/run-emitted-segment.js" "$SEG" '{
  "general-purpose": {"output": "baseline artifact", "rationale": "legba rung-0 baseline dry-run"},
  "construct-fagan": {"verdict": "APPROVED", "findings": []}
}' '{}')"
STEPS=$((STEPS+1))

# step 4 — wrap every handoff seed into a validated envelope
SEED_COUNT="$(python3 -c "import json,sys;print(len(json.loads(sys.argv[1]).get('handoff_seeds',[])))" "$RESULT")"
python3 -c "
import json,sys
for s in json.loads(sys.argv[1]).get('handoff_seeds',[]): print(json.dumps(s))
" "$RESULT" | while IFS= read -r seed; do
  printf '%s' "$seed" | env LOA_PROJECT_ROOT="$ROOT" \
    "$RT/scripts/compose-handoff-wrap.sh" --seed - --cycle-id legba-baseline --run-id "$RUN_ID" --json >/dev/null
done
STEPS=$((STEPS+1))

# step 5 — terminal gate, executed-envelope mode
VERDICT="$(env LOA_PROJECT_ROOT="$ROOT" "$RT/scripts/compose-verify-run.sh" "$RUN_ID" --require-executed --json \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['verdict'])")"
STEPS=$((STEPS+1))

NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
python3 - "$RUN_ID" "$VERDICT" "$STEPS" "$ENV_VARS" "$BASE_DIR_HOPS" "$NOW" "$SEED_COUNT" <<'PY'
import json, sys
run_id, verdict, steps, env_vars, hops, now, seeds = sys.argv[1:8]
json.dump({
  "run_id_used": run_id, "run_verdict": verdict,
  "steps": int(steps), "env_vars": int(env_vars), "base_dir_hops": int(hops),
  "envelopes_wrapped": int(seeds),
  "role_play_steps": 0,
  "measured_at": now,
  "pilot": "code-implement-and-review (runtime pilot, dry-run harness, no model spend)",
}, open("grimoires/loa/context/legba-rung0-baseline.json", "w"), indent=2)
PY

cat > "$OUT_DIR/legba-rung0-baseline.md" <<MD
# Legba rung-0 gradient baseline — $NOW

Fresh governed run \`$RUN_ID\` → **$VERDICT** (pilot composition, deterministic
dry-run harness, zero model spend). The playtest run was NOT reused (B2).

| step | command | what it is |
|---|---|---|
| 1 | \`compose-dispatch.sh <pilot> --form-c --run-id …\` | validate-before-spend, cut, emit |
| 2 | read \`form-c-manifest.json\` | the executor's contract |
| 3 | run segment (Workflow tool / \`run-emitted-segment.js\`) | the actual work |
| 4 | \`compose-handoff-wrap.sh --seed -\` × $SEED_COUNT | seeds → validated envelopes |
| 5 | \`compose-verify-run.sh <id> --require-executed\` | the terminal gate |

**Governed path: $STEPS steps + $ENV_VARS load-bearing env vars + $BASE_DIR_HOPS base-dir hop.**
**Role-play path: 0 steps**, byte-identical-looking artifact, caught only if someone
runs the gate — which nothing auto-fires today.

The gradient Legba must invert: the governed path's marginal cost over role-play
is the defection incentive. Rungs 2–4 (recorder/gatekeeper/turnstile) succeed if a
post-rung re-measure shows the governed path at ≤ the cost above while role-play
becomes structurally unable to produce a counting result.
MD

echo "baseline: $VERDICT in $STEPS steps ($RUN_ID) → $OUT_DIR/legba-rung0-baseline.{json,md}"
[[ "$VERDICT" == "valid_run" ]] || { echo "BASELINE_NOT_VALID_RUN: $VERDICT" >&2; exit 3; }
