#!/usr/bin/env bash
# events-lint smoke test — prove the unhandled-emit-either rule is DISCRIMINATING,
# not merely quiet.
#
# The rule matches on the bare name `emit`/`emitRaw`. Before the EMITTER_BEARING
# precondition it fired on any local function sharing that name — seven such
# false positives in packages/freeside-cli fail-blocked CI, and because this kind
# is hardcoded `allowlisted: false` they could not be suppressed.
#
# Narrowing a fail-blocking rule is only safe if you can show it still fires. Both
# directions are asserted here against throwaway fixtures:
#   1. real emitter + unhandled result  -> MUST be reported (rule alive)
#   2. lookalike void emit()            -> MUST NOT be reported (false positive gone)
#   3. real emitter + handled result    -> MUST NOT be reported (CONSUMED still works)
#
# Mirrors tools/check-nats-allowlist-shrinks.test.sh, which does the same for the
# shrink-gate. Wired into .github/workflows/schema-emission-floor.yml.
set -euo pipefail

LINT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/events-lint.mjs"
FIXTURE_ROOT="$(mktemp -d)"
trap 'rm -rf "$FIXTURE_ROOT"' EXIT

mkdir -p "$FIXTURE_ROOT/src"

# (1) A genuine consumer: builds an emitter from @freeside/events, drops the Either.
cat > "$FIXTURE_ROOT/src/real-emitter.ts" <<'TS'
import { makeEmitter } from "@freeside/events";
const emit = makeEmitter({ cell: "demo" } as never);
export function publishThing(payload: unknown): void {
  emit("demo.thing.v1", payload);
}
TS

# (2) The freeside-cli shape: a local void `emit`, no relationship to the package.
cat > "$FIXTURE_ROOT/src/lookalike.ts" <<'TS'
export function emit(value: unknown): void {
  console.log(JSON.stringify(value));
}
export function report(v: unknown): void {
  emit(v);
}
TS

# (3) A genuine consumer that DOES handle the Either.
cat > "$FIXTURE_ROOT/src/handled.ts" <<'TS'
import { makeEmitter } from "@freeside/events";
const emit = makeEmitter({ cell: "demo" } as never);
export function publishThing(payload: unknown): boolean {
  const res = emit("demo.thing.v1", payload);
  return !res.isLeft;
}
TS

out="$(node "$LINT" --root "$FIXTURE_ROOT" --json 2>/dev/null)"
hits="$(echo "$out" | node -e '
  let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
    const j=JSON.parse(s);
    console.log(j.findings.filter(f=>f.kind==="unhandled-emit-either").map(f=>f.file).sort().join("\n"));
  });')"

fail=0
check() { # check <should-be-present:0|1> <substring> <message>
  if [ "$1" = "1" ]; then
    echo "$hits" | grep -q "$2" || { echo "FAIL: $3"; fail=1; }
  else
    echo "$hits" | grep -q "$2" && { echo "FAIL: $3"; fail=1; }
  fi
  return 0
}

check 1 "real-emitter.ts" "rule is DEAD — an unhandled Either on a real makeEmitter consumer was not reported"
check 0 "lookalike.ts"    "false positive — a local void emit() was reported as an unhandled Either"
check 0 "handled.ts"      "over-reporting — a handled Either was reported as unhandled"

if [ "$fail" -ne 0 ]; then
  echo "--- reported unhandled-emit-either files ---"
  echo "$hits"
  exit 1
fi

echo "events-lint smoke test passed: rule fires on a real unhandled emit, stays silent on a void lookalike and on a handled Either."
