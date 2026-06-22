#!/usr/bin/env bash
# reasoning-extraction-audit.sh — DOCTOR for the Fable-5 "reasoning_extraction" landmine.
#
# Fable-5 refuses prompts / skills / output-schemas that tell the MODEL to echo,
# transcribe, or explain its INTERNAL REASONING as response text. The refusal
# triggers a silent fallback to Opus 4.8 — quietly defeating a Fable upgrade for
# every review/council skill that demands a `reasoning` field in its output.
# (Source: Anthropic "Prompting Claude Fable 5" guide, reasoning_extraction category.)
#
# Only MODEL-authored fields are real triggers. Schema fields filled deterministically
# by a shell/script (e.g. bridge-triage.reasoning, written by post-pr-triage.sh) are
# NOT triggers — exempt those via the allowlist (reasoning-extraction-allowlist.txt),
# which keeps the exemption auditable and still trips on a genuinely model-authored field.
#
# DOCTOR only: reports with file:line + remediation; never edits. Exit non-zero to gate.
#
# Usage:  tools/fable-readiness/reasoning-extraction-audit.sh [ROOT] [--json]
#         ROOT defaults to .claude
# Exit:   0 = clean · 1 = review-level (MEDIUM) only · 2 = active HIGH triggers present
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ALLOWLIST="${REASONING_AUDIT_ALLOWLIST:-$SCRIPT_DIR/reasoning-extraction-allowlist.txt}"

ROOT=".claude"
JSON=0
for a in "$@"; do
  case "$a" in
    --json)    JSON=1 ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *)         ROOT="$a" ;;
  esac
done

ROOTS=()
for d in skills commands subagents data constructs/packs; do
  [ -d "$ROOT/$d" ] && ROOTS+=("$ROOT/$d")
done
[ ${#ROOTS[@]} -eq 0 ] && { [ -d "$ROOT" ] && ROOTS=("$ROOT") || { echo "no scannable root under '$ROOT'"; exit 0; }; }

high=0; med=0; allow=0
report_high=""; report_med=""; report_allow=""

# allowlist_match LOC TEXT -> prints the exemption reason if LOC+TEXT match an entry
allowlist_match() {
  local loc="$1" text="$2" line pathfrag textfrag reason
  [ -f "$ALLOWLIST" ] || return 0
  while IFS= read -r line; do
    case "$line" in ''|\#*) continue ;; esac
    IFS='|' read -r pathfrag textfrag reason <<< "$line"
    pathfrag="$(printf '%s' "$pathfrag" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
    textfrag="$(printf '%s' "$textfrag" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
    reason="$(printf '%s' "$reason" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
    [ -z "$pathfrag" ] && continue
    [ -z "$textfrag" ] && continue   # L1: require both — an empty fragment must not match-all
    if [[ "$loc" == *"$pathfrag"* && "$text" == *"$textfrag"* ]]; then
      printf '%s' "${reason:-allowlisted}"; return 0
    fi
  done < "$ALLOWLIST"
}

emit() { # tier loc rule text
  local tier="$1" loc="$2" rule="$3" text="$4" reason
  text="$(printf '%s' "$text" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
  local row="  ${loc}  [${rule}]  ${text}"
  if [ "$tier" = HIGH ]; then
    reason="$(allowlist_match "$loc" "$text")"
    if [ -n "$reason" ]; then
      report_allow+="${row}  -> ALLOWLISTED: ${reason}"$'\n'; allow=$((allow+1)); return
    fi
    report_high+="${row}"$'\n'; high=$((high+1))
  else
    report_med+="${row}"$'\n'; med=$((med+1))
  fi
}

# HIGH: output-schema fields forcing reasoning/CoT as a response field ("reasoning": { ).
while IFS=: read -r file line text; do
  [ -z "${file:-}" ] && continue
  emit HIGH "${file}:${line}" "schema-reasoning-field" "$text"
done < <(grep -rnE '"(reasoning|thought_process|chain_of_thought|reasoning_steps|cot)"[[:space:]]*:[[:space:]]*\{' "${ROOTS[@]}" --include='*.json' 2>/dev/null || true)

# HIGH (M2): same trigger in YAML output-schemas — a reasoning-class field key.
while IFS=: read -r file line text; do
  [ -z "${file:-}" ] && continue
  emit HIGH "${file}:${line}" "schema-reasoning-field-yaml" "$text"
done < <(grep -rnE '^[[:space:]]*(reasoning|thought_process|chain_of_thought|reasoning_steps):[[:space:]]*$' "${ROOTS[@]}" --include='*.yaml' --include='*.yml' 2>/dev/null || true)

# HIGH: imperative prose telling the model to surface its reasoning AS output.
# M2: extended verb set (provide/share/give/document/surface/articulate) + bare "thinking".
while IFS=: read -r file line text; do
  [ -z "${file:-}" ] && continue
  emit HIGH "${file}:${line}" "prose-echo-reasoning" "$text"
done < <(grep -rniE '(explain|describe|show|reproduce|transcribe|spell out|write out|output|provide|share|give|document|surface|articulate|walk (me |us )?through|include)[^.]{0,40}(your |the )?(reasoning|thought process|thinking|chain[- ]of[- ]thought|internal (reasoning|monologue|thinking))' "${ROOTS[@]}" --include='*.md' 2>/dev/null || true)

# MEDIUM (review): rationale/justification output-schema fields (grounds, not raw CoT).
while IFS=: read -r file line text; do
  [ -z "${file:-}" ] && continue
  emit MEDIUM "${file}:${line}" "schema-rationale-field" "$text"
done < <(grep -rnE '"(rationale|justification)"[[:space:]]*:[[:space:]]*\{' "${ROOTS[@]}" --include='*.json' 2>/dev/null || true)

# Advisory: refusal -> Opus fallback configured?
fallback_present=0
if grep -rniE 'refusal|reasoning_extraction' .claude/adapters 2>/dev/null | grep -qiE 'fallback|opus' 2>/dev/null; then
  fallback_present=1
fi

if [ "$JSON" = 1 ]; then
  printf '{"high":%d,"allowlisted":%d,"medium":%d,"refusal_fallback_configured":%s,"clean":%s}\n' \
    "$high" "$allow" "$med" \
    "$([ $fallback_present = 1 ] && echo true || echo false)" \
    "$([ $high = 0 ] && [ $med = 0 ] && echo true || echo false)"
else
  echo "Fable-5 reasoning_extraction audit — scanned: ${ROOTS[*]}"
  echo
  if [ "$high" -gt 0 ]; then
    echo "HIGH (${high}) — model-authored, refuse on Fable-5 -> silent Opus fallback:"
    printf '%s\n' "$report_high"
  fi
  if [ "$allow" -gt 0 ]; then
    echo "ALLOWLISTED (${allow}) — schema field name matches but NOT model-authored (verified):"
    printf '%s\n' "$report_allow"
  fi
  if [ "$med" -gt 0 ]; then
    echo "MEDIUM (${med}) — review: grounds-not-CoT fields, confirm they don't elicit internal reasoning:"
    printf '%s\n' "$report_med"
  fi
  if [ "$high" = 0 ] && [ "$med" = 0 ] && [ "$allow" = 0 ]; then
    echo "clean — no reasoning-extraction triggers found."
    echo
  fi
  echo "Remediation (apply under .claude/ via an operator-gated cycle — System Zone):"
  echo "  schema-reasoning-field : remove the reasoning/CoT output field; read reasoning from"
  echo "                          adaptive-thinking blocks instead of a response field. If the"
  echo "                          field is shell/script-authored (no model prompt), allowlist it."
  echo "  prose-echo-reasoning   : request the conclusion/evidence only; don't ask the model to"
  echo "                          surface its internal reasoning as response text."
  echo "  schema-rationale-field : if it elicits CoT, rename to a grounded field (evidence/"
  echo "                          decision_basis); otherwise confirm it asks for grounds, not CoT."
  if [ "$fallback_present" = 0 ]; then
    echo
    echo "  ADVISORY: no refusal -> Opus fallback detected in .claude/adapters. The Fable-5 guide"
    echo "            recommends configuring server-/client-side fallback to Opus 4.8 on refusal."
  fi
fi

if [ "$high" -gt 0 ]; then exit 2
elif [ "$med" -gt 0 ]; then exit 1
else exit 0
fi
