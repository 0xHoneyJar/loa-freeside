#!/usr/bin/env bash
# check-platform-membrane.sh — enforce the freeside platform↔world membranes (C1, FR-7/SKP-004).
#
# The whole decomposition relies on a one-directional membrane: the PLATFORM substrate
# (apps/{gateway,worker,ingestor}, packages/{core,adapters,sandbox}) must NEVER value-import
# the WORLD (themes/sietch) at runtime. The map confirmed this holds today (0 value-imports);
# this guard CODIFIES the clean state so it can never silently regress (it has regressed +
# been repaired before — coherence F4/F5). Same "declared → enforced" shape as
# tools/check-worker-schema-drift.sh.
#
# Two boundaries:
#   A) platform  ↛  themes/sietch            (the platform membrane — FAIL on any new value-import)
#   B) themes/sietch/src ↛ @freeside/adapters/agent  (the C2 ports-only contract; existing reach-ins
#      are baseline-allowlisted — teeth on NEW reach-ins; tests exempt)
#
# RULE: `import type … from '…'` AND inline `import { type Foo } from '…'` are PERMITTED across a
#       membrane (they erase at compile). VALUE imports (static `import {…}`/`import x`/`import *`/
#       side-effect, dynamic `import()`, CJS `require()`) are FORBIDDEN.
#
# SCANNER: an awk pass that reconstructs MULTI-LINE import statements before classifying (a line-by-line
# grep mis-handles `import type {\n …\n} from '…'`). It matches the specifier as a SUBSTRING (no quote
# escaping) and excludes whole-statement `import type` + all-inline-`type` brace clauses.
#
# TOOLING NOTE (honest, like block-destructive-bash's accepted-bypass list): madge is unavailable
# (no local node_modules linkage, NG-3), so this is a text scan, NOT a resolved import graph.
# DOCUMENTED BYPASS CLASSES — OUT OF SCOPE for v1, NOT claimed as covered:
#   - TS path-alias imports of the world (e.g. a hypothetical `@sietch/*` alias) — only the literal
#     `themes/sietch` / `@freeside/adapters/agent` specifier SUBSTRING is matched. No such alias today.
#   - Transitive reach-in (platform A → platform B → world): only DIRECT edges are scanned (1-hop).
#   - the specifier substring appearing inside a non-import string literal on an import-looking line.
# Upgrading to madge/ts-morph would only find MORE reach-ins, never fewer.
#
# Exit 0 = membranes intact · Exit 1 = violation (with ::error::file:line for CI annotation).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PLATFORM_DIRS=(apps/gateway apps/worker apps/ingestor packages/core packages/adapters packages/sandbox)
WORLD_SPECIFIER="themes/sietch"
WORLD_SRC="themes/sietch/src"
ADAPTER_SPECIFIER="@freeside/adapters/agent"

# Boundary B baseline-allowlist (C1.2): sietch SRC files that VALUE-import the agent adapter TODAY.
# Teeth on NEW reach-ins immediately; these are the C2 burndown list — DELETE each line as C2 relocates
# that file's seam to @freeside/core/ports. Empty list ⇒ boundary B fully enforced. TESTS EXEMPT.
# byok.routes.ts is NOT here: it is type-only.
BOUNDARY_B_ALLOWLIST=(
  "themes/sietch/src/api/server.ts"
  "themes/sietch/src/api/routes/agents.routes.ts"
  "themes/sietch/src/discord/commands/agent.ts"
  "themes/sietch/src/telegram/commands/agent.ts"
)

violations=0
flag() { echo "::error::membrane: $1"; violations=$((violations + 1)); }

# find_value_imports <file> <specifier-substring>
# Prints the start line number of each VALUE import of the specifier (multi-line aware; type-only excluded).
find_value_imports() {
  local file="$1" spec="$2"
  awk -v spec="$spec" '
    function emit_if_value(stmt, ln,    clause, n, i, p, anyType, allType, parts) {
      if (index(stmt, spec) == 0) return
      if (stmt ~ /^[ \t]*(import|export)[ \t]+type[ \t]/) return        # whole import type-only → allowed
      if (stmt ~ /\{/) {                                                # all-inline-type brace → allowed
        clause = stmt; sub(/^[^{]*\{/, "", clause); sub(/\}.*/, "", clause)
        n = split(clause, parts, ","); anyType = 0; allType = 1
        for (i = 1; i <= n; i++) { p = parts[i]; gsub(/^[ \t]+|[ \t]+$/, "", p); if (p == "") continue; anyType = 1; if (p !~ /^type[ \t]/) allType = 0 }
        if (anyType && allType) return
      }
      print ln
    }
    BEGIN { inblk = 0; buf = ""; start = 0 }
    {
      if (inblk) {                                                       # inside a multi-line brace import
        buf = buf " " $0
        # close on the module clause (from ...) or statement end — NOT on } alone:
        # a brace import may put } and `from '...'` on separate lines, and the specifier
        # lives in the from-clause, so closing on } would drop it (false negative).
        if ($0 ~ /(^|[ \t])from([ \t]|$)/ || $0 ~ /;[ \t]*$/) { emit_if_value(buf, start); inblk = 0; buf = "" }
        next
      }
      if ($0 ~ /^[ \t]*(import|export)([ \t]|\(|$)/) {
        if ($0 ~ /\{/ && $0 !~ /\}/) { inblk = 1; buf = $0; start = NR }  # opens multi-line brace
        else { emit_if_value($0, NR) }                                   # single-line / default / side-effect / dynamic-at-start
      } else if ($0 ~ /(import|require)[ \t]*\(/ && index($0, spec) > 0) {
        print NR                                                         # dynamic import()/require() mid-line
      }
    }
  ' "$file" 2>/dev/null | sort -un
}

scan_boundary_a() {
  echo "── Boundary A: platform ↛ ${WORLD_SPECIFIER} (value-imports forbidden; import type allowed) ──"
  local found=0
  while IFS= read -r -d '' file; do
    while IFS= read -r ln; do
      [ -n "${ln:-}" ] || continue
      flag "$file:$ln value-imports the world ($WORLD_SPECIFIER)"
      found=1
    done < <(find_value_imports "$file" "$WORLD_SPECIFIER")
  done < <(
    for d in "${PLATFORM_DIRS[@]}"; do
      [ -d "$d" ] && find "$d" -type f -name '*.ts' -not -name '*.d.ts' -print0
    done
  )
  [ "$found" -eq 0 ] && echo "  ✓ clean — no platform→world value-imports"
}

in_allowlist() { local f="$1"; for a in "${BOUNDARY_B_ALLOWLIST[@]}"; do [ "$f" = "$a" ] && return 0; done; return 1; }

scan_boundary_b() {
  echo "── Boundary B: ${WORLD_SRC} ↛ ${ADAPTER_SPECIFIER} (value-imports; baseline-allowlisted, tests exempt) ──"
  [ -d "$WORLD_SRC" ] || { echo "  (skip: $WORLD_SRC absent)"; return; }
  local grandfathered=0 fresh=0
  while IFS= read -r -d '' file; do
    local hits; hits="$(find_value_imports "$file" "$ADAPTER_SPECIFIER")"
    [ -n "$hits" ] || continue
    if in_allowlist "$file"; then
      echo "  ~ grandfathered (C2 burndown): $file"
      grandfathered=$((grandfathered + 1))
    else
      flag "$file value-imports $ADAPTER_SPECIFIER but is NOT in the C1.2 baseline-allowlist (a NEW reach-in)"
      fresh=$((fresh + 1))
    fi
  done < <(find "$WORLD_SRC" -type f -name '*.ts' -not -name '*.test.ts' -not -name '*.d.ts' -print0)
  echo "  → $grandfathered grandfathered (pending C2), $fresh new reach-in(s)"
}

scan_boundary_a
echo ""
scan_boundary_b

if [ "$violations" -ne 0 ]; then
  echo ""
  echo "::error::membrane breached — $violations violation(s)."
  echo "  Boundary A: platform must not import the world at runtime — use a port + inject at the"
  echo "  composition root, or convert to 'import type'."
  echo "  Boundary B: new sietch→adapters/agent value-imports are forbidden — depend on"
  echo "  @freeside/core/ports instead (the C2 contract). Existing reach-ins are allowlisted; do not add."
  exit 1
fi
echo "✓ membranes intact (boundary A + boundary B baseline clean)"
