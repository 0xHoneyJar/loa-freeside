#!/usr/bin/env bash
# genome-integrity-grader.sh — the construct genome-hash-chain VERIFIER, as a CI
# regression gate (bd-uze Track B / arrakis-u6xh). Locks the genome chain's
# integrity contract: a tampered chain CANNOT verify, a valid chain MUST.
#
# loa-freeside CI has no live construct estate (the genomes live across construct
# repos), so this is FIXTURE-based — it proves the VERIFIER itself is correct, in
# both directions, against committed fixtures whose hashes were minted by the
# canonical genome-chain.py:
#   * evals/fixtures/genome/valid/      — a real 2-link chain → MUST verify (rc 0)
#   * evals/fixtures/genome/tampered/   — e1's content altered post-mint → the
#                                         stored genome_hash no longer matches the
#                                         recompute → MUST be REJECTED (rc != 0)
#
# The verifier is evals/environment-design/genome-chain.py — VENDORED byte-identical
# from loa-constructs/.claude/scripts/genome-chain.py and self-resolving loa_cheval.jcs
# (the RFC-8785 core). If a change makes the verifier accept tampered OR reject valid,
# this grader goes RED — that is the regression guard on the incorruptibility math.
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
gc="$GRADER_DIR/../$board_subdir/genome-chain.py"
fx="$GRADER_DIR/../fixtures/genome"

command -v python3 >/dev/null 2>&1 || fail "python3 not on PATH" 0 2
[ -f "$gc" ] || fail "vendored verifier absent: ${gc##*/loa-freeside/}" 0 2
for d in valid tampered; do
  [ -f "$fx/$d/construct.yaml" ] && [ -f "$fx/$d/LEARNINGS.jsonl" ] || fail "missing genome fixture: $d" 0 2
done

_verify() {  # $1=fixture subdir → exit code of the verifier
  python3 "$gc" verify --construct-yaml "$fx/$1/construct.yaml" --learnings "$fx/$1/LEARNINGS.jsonl" >/dev/null 2>&1
  echo $?
}

# import sanity: a 70 from either run means the verifier could not load loa_cheval.jcs
valid_rc="$(_verify valid)"
[ "$valid_rc" = "70" ] && fail "verifier could not import loa_cheval.jcs (RFC-8785 core) — adapters missing in workspace" 0 2
tamp_rc="$(_verify tampered)"

# Positive: valid chain MUST verify (rc 0). Negative: tampered MUST be rejected (rc != 0).
problems=""
[ "$valid_rc" = "0" ] || problems="valid fixture did NOT verify (rc=$valid_rc) — the verifier rejects a real chain (canonical-hash drift or broken verify)"
if [ "$tamp_rc" = "0" ]; then
  [ -n "$problems" ] && problems="$problems | "
  problems="${problems}TAMPERED fixture VERIFIED (rc=0) — the verifier accepts a forged chain (incorruptibility broken)"
fi

[ -z "$problems" ] || fail "$problems" 0 1
ok 100 "genome-integrity: valid chain verifies (rc0) AND tampered chain rejected (rc$tamp_rc) — verifier discriminates correctly in both directions"
