#!/usr/bin/env bash
# gv6-cert-parity-grader.sh — the GV6 cross-org cert_hash byte-match gate, as a CI
# regression gate (issue AITOBIAS04/echelon-core#178, Ring 0).
#
# Locks the "any-party re-derivation" contract both orgs ratified: an Echelon
# verdict-integrity cert recomputed through OUR canonicalizer (loa_cheval.jcs,
# RFC 8785) MUST byte-match the published cert_hash. Echelon's jcs-subset/v0 is
# RFC 8785 narrowed to a validated domain (byte-identical there, FORGE spec §4),
# so a divergence here means either our canonicalizer drifted or the pinned spec
# moved — both are seam events that must go RED, never silent.
#
# FIXTURE-based, like genome-integrity-grader.sh:
#   * evals/fixtures/gv6-cert-vector/gv6-cert-vector.json
#       — the shared vector published by Echelon (echelon-core PR #249,
#         grimoires/loa/a2a/external/gv6-canonicalizer-sync/), expected
#         cert_hash sha256:2866a4e0…c56bcb. MUST fully match.
#   * evals/fixtures/gv6-cert-vector/forge-cycle003-jcs-test-vectors.json
#       — FORGE's primitive canonicalizer vectors. All input-bearing
#         canonical_vectors MUST match byte-for-byte.
#
# The recompute core is evals/environment-design/gv6-cert-parity.py
# (self-resolving loa_cheval.jcs — the same RFC-8785 core the audit-envelope
# and genome chains use).
#
# Args: $1=workspace (unused — repo artifacts)  $2=board-subdir (default environment-design)
# Exit: 0=pass 1=fail 2=error. JSON: {pass,score,details,grader_version}. Version: 1.0.0
set -uo pipefail

GRADER_VERSION="1.0.0"
fail() { printf '{"pass":false,"score":%s,"details":"%s","grader_version":"%s"}\n' "${2:-0}" "$1" "$GRADER_VERSION"; exit "${3:-1}"; }
ok()   { printf '{"pass":true,"score":%s,"details":"%s","grader_version":"%s"}\n' "$1" "$2" "$GRADER_VERSION"; exit 0; }

GRADER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
board_subdir="${2:-environment-design}"
case "$board_subdir" in *..*|/*) fail "invalid board subdir '$board_subdir'" 0 2 ;; esac
gp="$GRADER_DIR/../$board_subdir/gv6-cert-parity.py"
fx="$GRADER_DIR/../fixtures/gv6-cert-vector"

command -v python3 >/dev/null 2>&1 || fail "python3 not on PATH" 0 2
[ -f "$gp" ] || fail "recompute core absent: ${gp##*/loa-freeside/}" 0 2
[ -f "$fx/gv6-cert-vector.json" ] || fail "missing shared cert vector fixture" 0 2
[ -f "$fx/forge-cycle003-jcs-test-vectors.json" ] || fail "missing FORGE primitive vectors fixture" 0 2

python3 "$gp" verify --vector "$fx/gv6-cert-vector.json" >/dev/null 2>&1
cert_rc=$?
[ "$cert_rc" = "70" ] && fail "recompute could not import loa_cheval.jcs (RFC-8785 core) — adapters missing in workspace" 0 2

python3 "$gp" primitives --vectors "$fx/forge-cycle003-jcs-test-vectors.json" >/dev/null 2>&1
prim_rc=$?

problems=""
[ "$cert_rc" = "0" ] || problems="cert vector MISMATCH (rc=$cert_rc) — our recompute no longer byte-matches the pinned Echelon cert_hash (canonicalizer drift or spec seam event)"
if [ "$prim_rc" != "0" ]; then
  [ -n "$problems" ] && problems="$problems | "
  problems="${problems}FORGE primitive vectors diverged (rc=$prim_rc) — loa_cheval.jcs no longer matches jcs-subset/v0 at the serialization-rule level"
fi

[ -z "$problems" ] || fail "$problems" 0 1
ok 100 "gv6-cert-parity: shared cert vector byte-matches (cert_hash + canonical bytes + verdict_id) AND all FORGE primitive vectors reproduce — any-party re-derivation holds"
