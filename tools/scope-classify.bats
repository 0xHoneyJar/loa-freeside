#!/usr/bin/env bats
# tools/scope-classify.bats — hermetic tests for tools/lib/scope-classify.sh (S1-T1)
#
# Covers the FR-1a acceptance rows (sprint.md:84-87, sdd.md §1.4/§4.2):
#   (a) changed pkg X          -> X in scope
#   (b) peerDeps-only dependent -> IN scope (IMP-006)
#   (c) devDeps-only dependent  -> IN scope (IMP-006)
#   (d) cross-cutting path       -> __FALLBACK_TO_FULL__ (fallback-to-full)
#   + a seeded-failure isolation row: an unrelated pkg's change does NOT pull X in.
#
# Fixtures are a TEMP package tree (SCOPE_REPO_ROOT), never the repo's real graph.

setup() {
  source "$BATS_TEST_DIRNAME/lib/scope-classify.sh"

  FIXROOT="$(mktemp -d "${BATS_TMPDIR:-/tmp}/scope-fixture.XXXXXX")"
  export SCOPE_REPO_ROOT="$FIXROOT"

  # @fx/x — the changed leaf, no intra-graph deps.
  _mkpkg "packages/pkg-x" '{
    "name": "@fx/x",
    "dependencies": { "zod": "^3.0.0" }
  }'

  # @fx/runtime — depends on @fx/x via runtime `dependencies`.
  _mkpkg "packages/pkg-runtime" '{
    "name": "@fx/runtime",
    "dependencies": { "@fx/x": "file:../pkg-x" }
  }'

  # @fx/peer — depends on @fx/x via peerDependencies ONLY (IMP-006).
  _mkpkg "packages/pkg-peer" '{
    "name": "@fx/peer",
    "peerDependencies": { "@fx/x": "*" }
  }'

  # @fx/dev — depends on @fx/x via devDependencies ONLY (IMP-006).
  _mkpkg "packages/pkg-dev" '{
    "name": "@fx/dev",
    "devDependencies": { "@fx/x": "file:../pkg-x" }
  }'

  # @fx/unrelated — depends on nothing in the graph; must never pull X in.
  _mkpkg "packages/pkg-unrelated" '{
    "name": "@fx/unrelated",
    "dependencies": { "@fx/nope": "file:../does-not-exist" }
  }'
}

teardown() {
  # Hermetic cleanup — find -delete (not `rm -rf`) so no ambiguous-path removal.
  [ -n "${FIXROOT:-}" ] && [ -d "$FIXROOT" ] && find "$FIXROOT" -mindepth 0 -delete 2>/dev/null || true
}

# _mkpkg <dir-under-fixroot> <json-body>
_mkpkg() {
  local dir="$FIXROOT/$1"
  mkdir -p "$dir"
  printf '%s\n' "$2" > "$dir/package.json"
}

@test "classify_changed_packages: a file under pkg-x resolves to @fx/x" {
  run classify_changed_packages "packages/pkg-x/src/index.ts"
  [ "$status" -eq 0 ]
  [ "$output" = "@fx/x" ]
}

@test "reverse_dependents: @fx/x has runtime + peer + dev dependents" {
  run reverse_dependents "@fx/x"
  [ "$status" -eq 0 ]
  echo "$output" | grep -qx "@fx/runtime"
  echo "$output" | grep -qx "@fx/peer"
  echo "$output" | grep -qx "@fx/dev"
  # @fx/unrelated must NOT appear.
  ! echo "$output" | grep -qx "@fx/unrelated"
}

@test "(a) scope_for_diff: changed pkg X puts X + its dependents in scope" {
  run scope_for_diff "packages/pkg-x/src/index.ts"
  [ "$status" -eq 0 ]
  echo "$output" | grep -qx "@fx/x"
  echo "$output" | grep -qx "@fx/runtime"
}

@test "(b) scope_for_diff: peerDeps-only dependent is IN scope (IMP-006)" {
  run scope_for_diff "packages/pkg-x/src/index.ts"
  [ "$status" -eq 0 ]
  echo "$output" | grep -qx "@fx/peer"
}

@test "(c) scope_for_diff: devDeps-only dependent is IN scope (IMP-006)" {
  run scope_for_diff "packages/pkg-x/src/index.ts"
  [ "$status" -eq 0 ]
  echo "$output" | grep -qx "@fx/dev"
}

@test "(d) scope_for_diff: shared tsconfig -> fallback-to-full" {
  run scope_for_diff "tsconfig.base.json"
  [ "$status" -eq 3 ]
  [ "$output" = "__FALLBACK_TO_FULL__" ]
}

@test "(d) scope_for_diff: a .github workflow -> fallback-to-full" {
  run scope_for_diff ".github/workflows/ci.yml"
  [ "$status" -eq 3 ]
  [ "$output" = "__FALLBACK_TO_FULL__" ]
}

@test "(d) scope_for_diff: pnpm-lock.yaml -> fallback-to-full" {
  run scope_for_diff "pnpm-lock.yaml"
  [ "$status" -eq 3 ]
  [ "$output" = "__FALLBACK_TO_FULL__" ]
}

@test "(d) scope_for_diff: generated code -> fallback-to-full" {
  run scope_for_diff "packages/pkg-x/src/schema.gen.ts"
  [ "$status" -eq 3 ]
  [ "$output" = "__FALLBACK_TO_FULL__" ]
}

@test "(d) scope_for_diff: cross-cutting poisons a mixed diff (pkg + workflow)" {
  printf -v diff '%s\n%s' "packages/pkg-x/src/index.ts" ".github/workflows/ci.yml"
  run scope_for_diff "$diff"
  [ "$status" -eq 3 ]
  [ "$output" = "__FALLBACK_TO_FULL__" ]
}

@test "isolation: an unrelated pkg's change does NOT pull @fx/x into scope" {
  run scope_for_diff "packages/pkg-unrelated/src/index.ts"
  [ "$status" -eq 0 ]
  echo "$output" | grep -qx "@fx/unrelated"
  ! echo "$output" | grep -qx "@fx/x"
}
