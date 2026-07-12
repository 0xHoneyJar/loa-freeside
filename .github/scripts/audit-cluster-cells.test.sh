#!/usr/bin/env bash
# Hermetic test for audit-cluster-cells.sh — no network, no live registry.
# Grounds bead arrakis-cluster-compliance-audit-crash-88ah (SDD §4.5 FR-1c):
# an in-monolith cell (git_url=loa-freeside, e.g. events-api) must not make the
# aggregating `jq --argjson` crash the whole cluster-compliance audit.
#
# Uses the AUDIT_REGISTRY_FILE + GITHUB_DIR seams for full isolation.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUDIT="$SCRIPT_DIR/audit-cluster-cells.sh"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# --- Fixture registry: one in-monolith cell + one external cell -------------
REG="$WORK/registry.yaml"
cat > "$REG" <<'YAML'
modules:
  events-api:
    # in-monolith library building — git_url is the monolith itself
    git_url: https://github.com/0xHoneyJar/loa-freeside.git
    runtime_state: not-built
  sonar-api:
    git_url: https://github.com/0xHoneyJar/sonar-api.git
    runtime_state: deployed
YAML

# --- Fixture GITHUB_DIR: a real sibling for sonar-api's happy path -----------
GH="$WORK/gh"
mkdir -p "$GH/freeside-sonar/.claude" "$GH/freeside-sonar/grimoires/loa" "$GH/freeside-sonar/.beads"
: > "$GH/freeside-sonar/CLAUDE.md"

PASS=0; FAIL=0
ok()   { echo "  ok   - $1"; PASS=$((PASS + 1)); }
bad()  { echo "  FAIL - $1"; FAIL=$((FAIL + 1)); }

run_cell() { AUDIT_REGISTRY_FILE="$REG" GITHUB_DIR="$GH" bash "$AUDIT" --json --cell "$1"; }

echo "T1: in-monolith cell (events-api) produces valid JSON, exits 0, no crash"
set +e
OUT="$(run_cell events-api 2>&1)"; RC=$?
set -e
[ "$RC" -eq 0 ] && ok "exit 0" || bad "exit $RC (expected 0 — a jq crash would be non-zero)"
if printf '%s' "$OUT" | jq empty 2>/dev/null; then ok "output is valid JSON"; else bad "output is NOT valid JSON: $OUT"; fi
FS="$(printf '%s' "$OUT" | jq -r '.cells[0].fs_path')"
[ "$FS" = "IN_MONOLITH" ] && ok "classified IN_MONOLITH (not misleading NOT_FOUND)" || bad "fs_path=$FS (expected IN_MONOLITH)"
DRIFT="$(printf '%s' "$OUT" | jq -r '.cells[0].drift_findings')"
[ "$DRIFT" = "clean" ] && ok "in-monolith drift=clean (no false-fail on the gate)" || bad "drift=$DRIFT"

echo "T2: the workflow's aggregating jq --argjson does NOT crash on events-api"
# Mirrors .github/workflows/cluster-compliance.yml:126-131 exactly.
set +e
EXISTENCE_JSON="$(run_cell events-api 2>&1 || echo '{}')"
jq -n --arg slug events-api --argjson existence "$EXISTENCE_JSON" \
  '{slug: $slug, existence: $existence}' >/dev/null 2>&1
RC=$?
set -e
[ "$RC" -eq 0 ] && ok "jq --argjson consumed the record (no 'invalid JSON' crash)" || bad "jq --argjson crashed (exit $RC)"

echo "T3: happy path — full audit is one valid JSON doc; external cell probed via its real sibling"
# Full audit keeps the roster intact (the `--cell` filter has a pre-existing
# parallel-array quirk unrelated to this fix), so sonar-api resolves to its
# freeside-sonar sibling correctly.
set +e
OUT="$(AUDIT_REGISTRY_FILE="$REG" GITHUB_DIR="$GH" bash "$AUDIT" --json 2>&1)"; RC=$?
set -e
[ "$RC" -eq 0 ] && ok "exit 0" || bad "exit $RC"
if printf '%s' "$OUT" | jq -e '.cells | length' >/dev/null 2>&1; then ok "aggregate is valid JSON"; else bad "aggregate invalid: $OUT"; fi
SONAR="$(printf '%s' "$OUT" | jq -r '.cells[] | select(.slug=="sonar-api")')"
FS="$(printf '%s' "$SONAR" | jq -r '.fs_path')"
case "$FS" in
  *"/freeside-sonar") ok "external cell probed its real sibling (fs_path=$FS)" ;;
  *) bad "sonar-api fs_path=$FS (expected the freeside-sonar sibling path)" ;;
esac
CMD="$(printf '%s' "$SONAR" | jq -r '.claude_md_present')"
[ "$CMD" = "true" ] && ok "detected CLAUDE.md in the external cell" || bad "claude_md_present=$CMD"

echo ""
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
