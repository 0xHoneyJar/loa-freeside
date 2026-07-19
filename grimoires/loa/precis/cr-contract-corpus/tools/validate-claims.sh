#!/usr/bin/env bash
# S3 gate: schema-validate extraction JSONL before normalization.
# Usage: validate-claims.sh <file.jsonl> [...]  — exit 1 on any violation.
set -euo pipefail
fail=0
for f in "$@"; do
  n=0; bad=0
  while IFS= read -r line; do
    n=$((n+1))
    err=$(jq -r '
      if type != "object" then "not-object"
      elif (.id // "") == "" then "missing-id"
      elif ([.class] | inside(["invariant","rationale","rejected-alternative","boundary","versioning","unresolved-tension"]) | not) then "bad-class:\(.class)"
      elif (.claim // "") == "" then "missing-claim"
      elif (.source // "") == "" then "missing-source"
      elif (.quote // "") == "" then "missing-quote"
      elif ([.provenance] | inside(["author","model_output"]) | not) then "bad-provenance:\(.provenance)"
      elif ((.confidence | type) != "number" or .confidence < 0 or .confidence > 1) then "bad-confidence"
      else empty end' <<<"$line" 2>&1) || err="unparseable-json"
    if [[ -n "$err" ]]; then bad=$((bad+1)); echo "$f:$n: $err" >&2; fi
  done < "$f"
  echo "$f: $n lines, $bad violations"
  [[ $bad -gt 0 ]] && fail=1
done
exit $fail
