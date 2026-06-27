#!/usr/bin/env bash
# =============================================================================
# tools/council-signoff.sh — SHIM. The implementation now lives in loa-cli: `loa council`.
# =============================================================================
# The cross-model FAGAN council → GitHub approving review (FAIL-CLOSED: a degraded or
# single-perspective panel is NEVER approved; approving requires council exit 0 AND
# verdict APPROVED AND >=2 surviving distinct model families) was HOISTED into the `loa`
# launcher so EVERY repo gets the gate through the one binary. The logic is now
# pure-node, zero-dep, with all I/O dependency-injected, and unit-tested in
# loa-cli/test/security/signoff_gate.mjs. loa-cli is the source of truth; this wrapper
# forwards every arg to `loa council` UNCHANGED.
#
# Same flags: <pr> | --repo owner/name | --dry-run | --comment-only | --preflight
# Same env:   LOA_COUNCIL_BIN · CONSTRUCT_FAGAN_DIR · LOA_SIGNOFF_REPO
# Exit codes are loa's, propagated verbatim (0 approved · 1 changes · 2 infra · 3 fail-closed).
# =============================================================================
set -euo pipefail
command -v loa >/dev/null 2>&1 || {
  echo "tools/council-signoff.sh: \`loa\` (loa-cli) is not on PATH — install loa-cli and \`npm link\` it globally." >&2; exit 2; }
# Verb-recognition probe by CONTENT, not --help's exit code (robust to whatever exit status help uses).
loa council --help 2>&1 | grep -q 'loa council <pr>' || {
  echo "tools/council-signoff.sh: this \`loa\` does not provide the 'council' verb (predates the hoist, or is broken) — update your loa-cli checkout (pull main + re-\`npm link\`)." >&2; exit 2; }
exec loa council "$@"
