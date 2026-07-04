#!/usr/bin/env bats
# tools/scope-checks-sensor.bats — S1-T2 acceptance (SDD §4.2, §6.1 FR-1a rows).
# Hermetic: the SCOPE_DIFF_CMD seam supplies the changed-file set, so no live git/CI.

setup() {
  ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
  SENSOR="$ROOT/tools/scope-checks-sensor.sh"
}

@test "cross-cutting change (lockfile) -> verdict=full, exit 0 (fallback-to-full)" {
  run env SCOPE_DIFF_CMD='printf "pnpm-lock.yaml\n"' "$SENSOR" --json
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.verdict == "full"'
  echo "$output" | jq -e '.exit_code == 0'
  echo "$output" | jq -e '.evidence.mode == "fallback-to-full"'
}

@test "cross-cutting change (.github workflow) -> verdict=full" {
  run env SCOPE_DIFF_CMD='printf ".github/workflows/ci.yml\n"' "$SENSOR" --json
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.verdict == "full"'
}

@test "scoped single-package change -> verdict=pass with a concrete pnpm --filter command" {
  run env SCOPE_DIFF_CMD='printf "packages/services/ordering/src/x.ts\n"' "$SENSOR" --json
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.verdict == "pass"'
  echo "$output" | jq -e '.evidence.packages | length >= 1'
  # every emitted command is a concrete pnpm --filter invocation (never an abstract pkg list)
  echo "$output" | jq -e '.evidence.commands | length >= 1'
  echo "$output" | jq -e '.evidence.commands | all(startswith("pnpm --filter "))'
}

@test "diff cannot be grounded -> verdict=insufficient, exit 1 (never a false pass)" {
  run env SCOPE_DIFF_CMD='exit 7' "$SENSOR" --json
  [ "$status" -eq 1 ]
  echo "$output" | jq -e '.verdict == "insufficient"'
  echo "$output" | jq -e '.exit_code == 1'
}

@test "emitted --json record conforms to immune-verdict.schema.json (NFR-7)" {
  run env SCOPE_DIFF_CMD='printf "packages/services/ordering/src/x.ts\n"' "$SENSOR" --json
  [ "$status" -eq 0 ]
  echo "$output" | node "$ROOT/tools/validate-immune-verdict.mjs"
}

@test "--probe emits a single-line tile carrying the verdict + exit code" {
  run env SCOPE_DIFF_CMD='printf "pnpm-lock.yaml\n"' "$SENSOR" --probe
  [ "$status" -eq 0 ]
  [ "$(printf '%s\n' "$output" | wc -l | tr -d ' ')" -eq 1 ]
  [[ "$output" == *"verdict=full"* ]]
}

# immune-lint:allow — this is the bats test fixture for scope-checks-sensor.sh,
# not an immune instrument itself (it emits no verdict record / has no ground source).
