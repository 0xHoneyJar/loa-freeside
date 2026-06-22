#!/usr/bin/env bash
# triage-sweep.sh — the deterministic triage spine for the AFK loop.
#
# For each open issue: classify via the canon autolabel regex (free, zero tokens),
# emit the colon-form labels + a route (bug vs operator-queue), and write a manifest.
# DRY by default; --apply writes the 3 canonical labels (+ a routing label) to each issue.
#
# The Cloud Routine's agent consumes the manifest:
#   route=bug      -> /bug -> prepare PR -> Bridgebuilder+Fagan review -> auto-merge(allowlist)/stage
#   route=operator -> left in the queue (labeled). The regex UNDER-detects bugs in the
#                     SAFE direction (a missed bug lands in your queue, never wrongly auto-fixed),
#                     so the routine's sonnet layer re-reads operator-routed issues to catch them.
#
# Usage:  triage-sweep.sh [--apply] [--limit=N]
#   TRIAGE_REPO env overrides the repo (default 0xHoneyJar/loa-freeside).
#   --apply requires the routing labels to exist (triage:operator-review, triage:bug-queued);
#   create them once with: gh label create "triage:operator-review" --color fbca04 ...
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="${TRIAGE_REPO:-0xHoneyJar/loa-freeside}"
APPLY=0; LIMIT=200
for a in "$@"; do case "$a" in --apply) APPLY=1;; --limit=*) LIMIT="${a#*=}";; esac; done

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo .)"
MDIR="$ROOT/.run/hivemind"; mkdir -p "$MDIR"
MANIFEST="$MDIR/triage-manifest.json"
ROWS="$MDIR/.rows.jsonl"; : > "$ROWS"

issues="$(gh issue list --repo "$REPO" --state open --limit "$LIMIT" --json number,title,body,labels 2>/dev/null)"
[ -z "$issues" ] && { echo "triage-sweep: no issues (gh failed or none open) in $REPO" >&2; exit 1; }
n="$(printf '%s' "$issues" | jq 'length')"
echo "triage-sweep: $n open issues in $REPO  (apply=$APPLY)"
echo

bugs=0; ops=0
for i in $(seq 0 $((n-1))); do
  num="$(printf '%s' "$issues" | jq -r ".[$i].number")"
  title="$(printf '%s' "$issues" | jq -r ".[$i].title")"
  body="$(printf '%s' "$issues" | jq -r ".[$i].body // \"\"")"
  dims="$(ISSUE_TITLE="$title" ISSUE_BODY="$body" node "$SCRIPT_DIR/autolabel.mjs" --json 2>/dev/null)"
  if [ -z "$dims" ]; then
    # M4: never silently drop — a failed classification still reaches the operator queue
    # (the "never silently default" brake). Default to discovery/product-spec → route=operator.
    echo "    ! #$num: classify failed — routing to operator queue" >&2
    dims='{"workstream":"discovery","artifact_type":"product-spec","priority":"medium"}'
  fi
  art="$(printf '%s' "$dims" | jq -r '.artifact_type')"
  ws="$(printf '%s' "$dims" | jq -r '.workstream')"
  pri="$(printf '%s' "$dims" | jq -r '.priority')"
  if [ "$art" = "bug-report" ]; then route="bug"; bugs=$((bugs+1)); else route="operator"; ops=$((ops+1)); fi
  jq -nc --argjson num "$num" --arg t "$title" --arg ws "$ws" --arg art "$art" --arg pri "$pri" --arg r "$route" \
    '{number:$num,title:$t,labels:["workstream:\($ws)","artifact-type:\($art)","priority:\($pri)"],route:$r}' >> "$ROWS"
  if [ "$APPLY" -eq 1 ]; then
    # add labels individually — gh rejects the whole batch if any one label is missing,
    # so a single absent label must not nuke the others.
    rl="triage:operator-review"; [ "$route" = bug ] && rl="triage:bug-queued"
    for L in "workstream:$ws" "artifact-type:$art" "priority:$pri" "$rl"; do
      gh issue edit "$num" --repo "$REPO" --add-label "$L" >/dev/null 2>&1 || echo "    ! #$num: could not add '$L' (label missing?)" >&2
    done
  fi
  printf '  #%-5s %-16s %-24s %-7s -> %s\n' "$num" "$ws" "$art" "$pri" "$route"
done

jq -s '.' "$ROWS" > "$MANIFEST" 2>/dev/null && rm -f "$ROWS"
echo
echo "summary: $bugs bug-routed · $ops operator-routed · manifest: $MANIFEST"
[ "$APPLY" -eq 0 ] && echo "(DRY-RUN — re-run with --apply to write labels; needs triage:* labels created first)"
exit 0
