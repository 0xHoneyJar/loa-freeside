#!/usr/bin/env bash
# =============================================================================
# tools/check-nats-allowlist-shrinks.sh
#
# cycle-112 schema-emission floor — the monotonic-shrink gate (FR-9a, the
# CRITICAL property that makes G-1's "drift can't grow" true).
#
# The raw-NATS allowlist (packages/events/raw-nats-allowlist.yaml) enumerates
# every site that still reaches NATS via a raw `.publish` instead of the
# sanctioned emit()/emitRaw() facade. This gate enforces that the SET of
# allowlisted site-ids can only SHRINK relative to the base branch:
#
#   • Appending a new raw emit + allowlisting it  → the new id is an ADDITION → FAIL
#   • A count-preserving swap (remove a migrated id, add a new raw id)
#                                                 → the new id is an ADDITION → FAIL
#   • Removing an id (a site migrated onto emit())→ shrink                    → PASS
#   • Moving an id between `entries` and `emitRaw_allowlist` (S3 raw→emitRaw,
#     SAME id) → union unchanged                  → PASS
#
# It compares the UNION of all `- id:` values (both `entries` and
# `emitRaw_allowlist`) because the id identifies the SITE, not which list it
# sits in. Set comparison, NOT count — this is the Flatline SPRINT review fix
# (IMP-003): a count-only gate is bypassable by a count-preserving swap.
#
# **Tripwire scope (honest, not exhaustive).** The gate trusts the allowlist
# file as the source of truth for "known raw emits". The DETECTION of an
# un-allowlisted raw emit (a developer who writes a raw .publish but does NOT
# allowlist it) is the job of the companion scanner (events-lint /
# tools/check-no-raw-nats-publish). Together: the scanner forces a new raw emit
# to be allowlisted to pass; this gate forces allowlisting to be an addition
# that fails. The only way through both is emit().
#
# Modes:
#   (default)            report-only flip target: exit 0 always, but PRINT the
#                        verdict + an annotation. Used in cycle-112 S2 per the
#                        FR-ADOPT-8 ramp (lint report-only >= 1 sprint before
#                        fail-block).
#   --enforce            fail-block: exit 1 on any addition. Flipped on in S5
#                        (T5.5) once the facade + codemod have landed.
#
# Env:
#   BASE   base ref to compare against (default: main)
# =============================================================================
set -uo pipefail

ALLOWLIST="${ALLOWLIST:-packages/events/raw-nats-allowlist.yaml}"  # env-overridable for the smoke test
BASE="${BASE:-main}"
ENFORCE=0
[ "${1:-}" = "--enforce" ] && ENFORCE=1

# Extract the union of `- id: "..."` values from a YAML stream on stdin.
extract_ids() {
  grep -E '^[[:space:]]*-[[:space:]]+id:' \
    | sed -E 's/^[[:space:]]*-[[:space:]]+id:[[:space:]]*//; s/^"//; s/"[[:space:]]*$//' \
    | sort -u
}

if [ ! -f "$ALLOWLIST" ]; then
  echo "::notice::[nats-allowlist] $ALLOWLIST absent — nothing to gate."
  exit 0
fi

head_ids="$(extract_ids < "$ALLOWLIST")"

# BB F1: resolve a USABLE base ref. actions/checkout@v4 checks the PR out in
# DETACHED HEAD and does NOT create a local `refs/heads/main`, so a bare `main`
# (the workflow's BASE default) does not resolve and `git show main:…` silently
# fell through to the "introduction commit" branch — making the gate a no-op that
# passed unconditionally in PR CI. Resolve origin/<base>, then local <base>, then
# a shallow fetch; if NONE resolve, that is a CI fault, not an introduction:
# error under --enforce rather than pass an unverifiable gate.
base_ref=""
for cand in "origin/${BASE}" "${BASE}"; do
  if git rev-parse --verify --quiet "${cand}^{commit}" >/dev/null 2>&1; then
    base_ref="$cand"; break
  fi
done
if [ -z "$base_ref" ] && git fetch --quiet --depth=1 origin "${BASE}" 2>/dev/null; then
  base_ref="FETCH_HEAD"
fi

if [ -z "$base_ref" ]; then
  msg="[nats-allowlist] cannot resolve base ref '${BASE}' (no origin/${BASE}, no local ${BASE}, fetch failed)"
  if [ "$ENFORCE" = "1" ]; then
    echo "::error::${msg} — refusing to pass an UNVERIFIABLE shrink-gate (a gate that can never fail is worse than none, BB F1)."
    exit 1
  fi
  echo "::warning::${msg} — report-only, skipping."
  exit 0
fi

# Base resolved. If the file is absent ON THE BASE, this is the genuine
# introduction commit — establish the baseline, do not gate.
if ! base_blob="$(git show "${base_ref}:${ALLOWLIST}" 2>/dev/null)"; then
  echo "::notice::[nats-allowlist] $ALLOWLIST not present on ${base_ref} — introduction commit, baseline established."
  exit 0
fi
base_ids="$(printf '%s\n' "$base_blob" | extract_ids)"

# Additions = ids in head that are NOT in base (comm -13 of base vs head).
additions="$(comm -13 <(printf '%s\n' "$base_ids") <(printf '%s\n' "$head_ids"))"
additions="$(printf '%s' "$additions" | sed '/^$/d')"

base_n="$(printf '%s\n' "$base_ids" | sed '/^$/d' | wc -l | tr -d ' ')"
head_n="$(printf '%s\n' "$head_ids" | sed '/^$/d' | wc -l | tr -d ' ')"
echo "[nats-allowlist] base(${BASE})=${base_n} ids · head=${head_n} ids"

if [ -n "$additions" ]; then
  echo "::error::[nats-allowlist] the raw-NATS allowlist GAINED id(s) — the floor is shrink-only."
  echo "  New allowlisted site-id(s):"
  printf '%s\n' "$additions" | sed 's/^/    + /'
  echo ""
  echo "  A new raw NATS .publish — even one that swaps for a migrated id — is forbidden."
  echo "  Fix: use the cell's emit() (FR-3). Add a new event family with:"
  echo "       freeside events:new-schema <name>"
  echo "  Doc: grimoires/loa/cycles/cycle-112-schema-emission-floor/sdd.md §5"
  if [ "$ENFORCE" = "1" ]; then
    exit 1
  fi
  echo "::notice::[nats-allowlist] REPORT-ONLY (cycle-112 S2 ramp) — not failing the build yet. Pass --enforce to fail-block (S5/T5.5)."
  exit 0
fi

echo "[nats-allowlist] OK — allowlist did not grow (additions: 0)."

# publishEnvelope_allowlist: same shrink-only gate (OQ-2 / events #255).
# The `// []` fallback makes this safe when the base branch predates the section.
comm -13 \
  <(printf '%s\n' "$base_blob" \
    | yq -r '(.publishEnvelope_allowlist // []) | .[].id' 2>/dev/null | sort) \
  <(yq -r '(.publishEnvelope_allowlist // []) | .[].id' \
    "$ALLOWLIST" 2>/dev/null | sort) \
  > /tmp/added_pe_ids
if [ -s /tmp/added_pe_ids ]; then
  echo "::error::publishEnvelope_allowlist gained id(s) — shrink-only gate:"
  cat /tmp/added_pe_ids
  echo "A genuinely-needed bypass must be documented as an operator decision first."
  if [ "$ENFORCE" = "1" ]; then
    exit 1
  fi
  echo "::notice::[nats-allowlist] REPORT-ONLY — not failing. Pass --enforce to fail-block."
  exit 0
fi

echo "[nats-allowlist] OK — publishEnvelope_allowlist did not grow."
exit 0
