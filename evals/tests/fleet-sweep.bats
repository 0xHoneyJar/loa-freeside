#!/usr/bin/env bats
# fleet-sweep.bats — fixture tests for evals/environment-design/fleet-sweep.py
# (cycle-construct-grounding-c7, Sprint 407 T1.5; SDD sdd.md:394-397).
#
# Three synthetic construct repos exercise the D-2 conformance verdicts:
#   conforming      → c7_pass true
#   absence-stub    → c7_pass false (not_absence_stub fails)
#   copied-section  → c7_pass false (no_copied_shared_sections fails)
# Plus: the D-4 hard constraint — the sweep never modifies construct-rubric.py.
# Run: bats evals/tests/fleet-sweep.bats

GROUND_URL="https://github.com/0xHoneyJar/loa-constructs/blob/main/docs/the-ground.md"

setup() {
  TEST_DIR="$(mktemp -d)"
  REPO_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/../.." && pwd)"
  SWEEP="$REPO_ROOT/evals/environment-design/fleet-sweep.py"

  mk_repo() { # $1=name — construct.yaml + identity/
    mkdir -p "$TEST_DIR/$1/identity"
    printf 'schema_version: 3\nname: %s\nslug: %s\nversion: 0.1.0\n' "$1" "$1" \
      > "$TEST_DIR/$1/construct.yaml"
  }

  # conforming: citation + probe sha + specific content, no shared sections
  mk_repo construct-conforming
  cat > "$TEST_DIR/construct-conforming/identity/environment.md" <<EOF
# The Ground CONFORMING Stands On

> Shared ground: $GROUND_URL
> — this file carries ONLY the conforming-specific layer.
> Probed from the live harness at construct-conforming @ abc1234, 2026-07-03.

## 1. Runtime contract (probed)
| Axis | Value | Source |
|---|---|---|
| model_tier | sonnet | construct.yaml:7 |
EOF

  # absence stub: the honest-absence marker in the first 200 bytes
  mk_repo construct-stub
  printf '# reality.md — ABSENT IN SOURCE\n\nno grounding file exists.\n' \
    > "$TEST_DIR/construct-stub/identity/environment.md"

  # copied section: carries a shared H2 title (clone, not cite)
  mk_repo construct-copied
  cat > "$TEST_DIR/construct-copied/identity/environment.md" <<EOF
# The Ground COPIED Stands On

> Shared ground: $GROUND_URL
> Probed from the live harness at construct-copied @ def5678, 2026-07-03.

## I. Intelligence tiers — the model ladder
(cloned shared content)
EOF
}

teardown() { rm -rf "$TEST_DIR"; }

@test "conforming repo passes all C7 checks" {
  run python3 "$SWEEP" --src-root "$TEST_DIR" --json
  [ "$status" -eq 0 ]
  echo "$output" | python3 -c '
import json,sys
r={x["construct"]:x for x in json.load(sys.stdin)["results"]}
assert r["construct-conforming"]["c7_pass"] is True, r["construct-conforming"]'
}

@test "absence stub fails not_absence_stub" {
  run python3 "$SWEEP" --src-root "$TEST_DIR" --json
  [ "$status" -eq 0 ]
  echo "$output" | python3 -c '
import json,sys
r={x["construct"]:x for x in json.load(sys.stdin)["results"]}
c=r["construct-stub"]
assert c["c7_pass"] is False and c["c7"]["not_absence_stub"] is False, c'
}

@test "copied shared section fails no_copied_shared_sections" {
  run python3 "$SWEEP" --src-root "$TEST_DIR" --json
  [ "$status" -eq 0 ]
  echo "$output" | python3 -c '
import json,sys
r={x["construct"]:x for x in json.load(sys.stdin)["results"]}
c=r["construct-copied"]
assert c["c7_pass"] is False and c["c7"]["no_copied_shared_sections"] is False, c
assert c["c7"]["citation_present"] is True, c  # it cited AND cloned — the clone is the defect'
}

@test "summary counts one grounded of three" {
  run python3 "$SWEEP" --src-root "$TEST_DIR" --json
  [ "$status" -eq 0 ]
  echo "$output" | python3 -c '
import json,sys
s=json.load(sys.stdin)["summary"]
assert s["repos_graded"]==3 and s["c7_grounded"]==1, s'
}

@test "D-4: sweep never modifies construct-rubric.py (byte-frozen)" {
  before="$(shasum -a 256 "$REPO_ROOT/evals/environment-design/construct-rubric.py" | cut -d' ' -f1)"
  run python3 "$SWEEP" --src-root "$TEST_DIR" --json
  [ "$status" -eq 0 ]
  after="$(shasum -a 256 "$REPO_ROOT/evals/environment-design/construct-rubric.py" | cut -d' ' -f1)"
  [ "$before" = "$after" ]
  # the sweep also self-reports the rubric hash it loaded
  echo "$output" | python3 -c "
import json,sys
assert json.load(sys.stdin)['summary']['rubric_sha256'] == '$after'"
}
