#!/usr/bin/env bats
# tools/consumption-doctor.bats — S2-T2 (SDD §4.3/§5.2, §6.1, FR-2b, G-2).
# Hermetic: a fixture packages/ tree via CONSUMPTION_ROOT + the CONSUMPTION_PROBE_CMD
# seam stubs the per-consumer import smoke. No real pnpm build/install. Fixture
# packages use @freeside/* names so --all (which scans shared @freeside/* pkgs) finds them.

setup() {
  ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
  DOC="$ROOT/tools/consumption-doctor.sh"
  T="$BATS_TEST_TMPDIR/tree"
  mkdir -p "$T/packages/lib" "$T/packages/app" "$T/packages/orphan"
  # @freeside/fx-lib ships dist; @freeside/fx-app consumes it; @freeside/fx-orphan has no consumer.
  printf '%s' '{"name":"@freeside/fx-lib","main":"dist/index.js","exports":{".":{"import":"./dist/index.js"}}}' > "$T/packages/lib/package.json"
  printf '%s' '{"name":"@freeside/fx-app","dependencies":{"@freeside/fx-lib":"workspace:*"}}' > "$T/packages/app/package.json"
  printf '%s' '{"name":"@freeside/fx-orphan","main":"src/index.ts","exports":{".":"./src/index.ts"}}' > "$T/packages/orphan/package.json"
}

@test "dist-shipping pkg whose import FAILS -> flag (exit 2) — the unconsumable catch" {
  run env CONSUMPTION_ROOT="$T" CONSUMPTION_PROBE_CMD='exit 1' "$DOC" @freeside/fx-lib --json
  [ "$status" -eq 2 ]
  echo "$output" | jq -e '.verdict == "flag" and .exit_code == 2'
}

@test "pkg whose import SUCCEEDS -> pass (exit 0)" {
  run env CONSUMPTION_ROOT="$T" CONSUMPTION_PROBE_CMD='exit 0' "$DOC" @freeside/fx-lib --json
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.verdict == "pass"'
}

@test "pkg with zero real consumers -> no-consumer (exit 0), NOT pass, NOT flag" {
  run env CONSUMPTION_ROOT="$T" CONSUMPTION_PROBE_CMD='exit 1' "$DOC" @freeside/fx-orphan --json
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.verdict == "no-consumer"'
  echo "$output" | jq -e '.verdict != "pass" and .verdict != "flag"'
}

@test "--all aggregates: one unconsumable pkg -> worst exit 2" {
  run env CONSUMPTION_ROOT="$T" CONSUMPTION_PROBE_CMD='exit 1' "$DOC" --all --probe
  [ "$status" -eq 2 ]
  [[ "$output" == *"@freeside/fx-lib"* ]]
  [[ "$output" == *"flag"* ]]
}

@test "--json record conforms to immune-verdict.schema.json (NFR-7)" {
  run env CONSUMPTION_ROOT="$T" CONSUMPTION_PROBE_CMD='exit 1' "$DOC" @freeside/fx-lib --json
  [ "$status" -eq 2 ]
  echo "$output" | node "$ROOT/tools/validate-immune-verdict.mjs"
}

# immune-lint:allow — bats test fixture for consumption-doctor.sh, not an instrument itself.
