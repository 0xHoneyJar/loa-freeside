#!/usr/bin/env bash
# =============================================================================
# Terraform Plan Guard — CI Gate for Destructive Actions
# Cycle 046: Armitage Platform — Sprint 2, Task 2.6
# SDD §5.3 IMP-009: tf-plan-guard.sh
# =============================================================================
#
# Scans terraform plan JSON output for replace/destroy actions on
# prevent_destroy resource types. Blocks CI pipeline if found.
#
# Usage:
#   terraform show -json plan.tfplan > plan.json
#   ./tf-plan-guard.sh plan.json

set -euo pipefail

PLAN_JSON="${1:-}"

command -v jq >/dev/null 2>&1 || { echo "ERROR: jq required"; exit 1; }

if [[ -z "$PLAN_JSON" ]]; then
  echo "Usage: tf-plan-guard.sh <plan.json|->"
  exit 2
fi

# Accept regular files, pipes, process substitution (/dev/fd/*), or stdin via '-'
if [[ "$PLAN_JSON" == "-" ]]; then
  TMP_PLAN_JSON="$(mktemp)"
  trap 'rm -f "$TMP_PLAN_JSON"' EXIT
  cat > "$TMP_PLAN_JSON"
  PLAN_JSON="$TMP_PLAN_JSON"
elif [[ ! -e "$PLAN_JSON" && ! -p "$PLAN_JSON" ]]; then
  echo "ERROR: Plan input not found/readable: $PLAN_JSON"
  exit 2
fi

# Fail closed on malformed JSON
if ! jq -e . "$PLAN_JSON" >/dev/null 2>&1; then
  echo "ERROR: Invalid terraform plan JSON input"
  exit 2
fi

CRITICAL_RESOURCES=(
  "aws_elasticache_replication_group"
  "aws_dynamodb_table"
  "aws_s3_bucket"
  "aws_kms_key"
  "aws_route53_zone"
)

BLOCKED=0

for resource_type in "${CRITICAL_RESOURCES[@]}"; do
  replacements=$(jq -r --arg rt "$resource_type" '
    [.resource_changes[] //empty |
     select(.type == $rt and (.change.actions | contains(["delete"]) or contains(["create","delete"])))] |
     length' "$PLAN_JSON" 2>/dev/null) || replacements=0

  if (( replacements > 0 )); then
    echo "BLOCKED: Plan contains replace/destroy for $resource_type ($replacements actions)"
    echo "  This requires manual approval — prevent_destroy resource would be recreated."
    BLOCKED=$((BLOCKED + replacements))
  fi
done

if (( BLOCKED > 0 )); then
  echo ""
  echo "Plan guard FAILED: $BLOCKED destructive actions on critical resources."
  echo "Review the plan carefully and approve manually if intended."
  exit 1
fi

echo "Plan guard PASSED: No destructive actions on critical resources."
