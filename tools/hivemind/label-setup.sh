#!/usr/bin/env bash
# label-setup.sh <org/repo> — create/recolor the canonical hivemind colon-labels in a repo.
# Idempotent (gh label create --force upserts name+color). Reusable across repos (multi-repo).
# Colors: priority = severity gradient; workstream/artifact/learning-status = distinguishable hues.
set -uo pipefail
REPO="${1:?usage: label-setup.sh <org/repo>}"
# name|color (6-hex, no #)
LABELS='
workstream:delivery|1d76db
workstream:discovery|5319e7
workstream:experimentation|0e8a16
workstream:tech-debt|5a5a5a
workstream:sorry-for-ur-loss|b60205
artifact-type:bug-report|d73a4a
artifact-type:incident-postmortem|b60205
artifact-type:technical-rfc|1d76db
artifact-type:product-spec|0052cc
artifact-type:experiment-design|8250df
artifact-type:atomic-learning|0e8a16
artifact-type:user-truth-canvas|fbca04
artifact-type:user-interview-synthesis|fef2c0
artifact-type:competitor-analysis|c5def5
artifact-type:launch-plan|d4c5f9
artifact-type:meeting-notes|cfd3d7
priority:urgent|b60205
priority:high|d93f0b
priority:medium|fbca04
priority:low|0e8a16
learning-status:strongly-validated|0e8a16
learning-status:directionally-correct|fbca04
learning-status:hypothesis-failed|d93f0b
learning-status:smol-evidence|e4e669
learning-status:cant-make-a-conclusion|cfd3d7
source:team-internal|5a5a5a
source:dm-to-team-member|1d76db
source:analytics-anomaly|5319e7
source:discord-support-or-feedback|8250df
triage:bug-queued|d73a4a
triage:operator-review|fbca04
'
n=0
while IFS='|' read -r name color; do
  [ -z "$name" ] && continue
  gh label create "$name" -R "$REPO" --color "$color" --description "hivemind taxonomy" --force >/dev/null 2>&1 && n=$((n+1)) || echo "  ! failed: $name" >&2
done <<< "$LABELS"
echo "$REPO: ensured $n canonical colored labels"
