#!/usr/bin/env bash
# =============================================================================
# tools/loa-signoff.sh — SHIM. The implementation now lives in loa-cli: `loa signoff`.
# =============================================================================
# The local-green attestation (run the suite; on GREEN post a `loa-signoff` commit
# status — a RED suite signs off NOTHING) was HOISTED into the `loa` launcher so EVERY
# repo gets the door through the one binary, not a per-repo copy of this script. The
# logic is now pure-node, zero-dep, finn-safe, and unit-tested in
# loa-cli/test/security/signoff_gate.mjs (30 assertions; the privilege boundary +
# fail-closed floor). loa-cli is the source of truth; this wrapper preserves the
# freeside-local path `tools/loa-signoff.sh <pr>` (muscle memory + the door doc's
# examples) by forwarding every arg to `loa signoff` UNCHANGED.
#
# Same flags: <pr> | --sha <SHA> | --repo owner/name | --dry-run
# Same env:   LOA_SIGNOFF_SUITE_CMD · LOA_SIGNOFF_SUITE_DIR · LOA_SIGNOFF_CONTEXT
#             · LOA_SIGNOFF_OPERATOR · LOA_SIGNOFF_REPO
# Exit codes are loa's, propagated verbatim (0 signed-off · 1 suite RED · 2 usage/infra).
# =============================================================================
set -euo pipefail
command -v loa >/dev/null 2>&1 || {
  echo "tools/loa-signoff.sh: \`loa\` (loa-cli) is not on PATH — install loa-cli and \`npm link\` it globally." >&2; exit 2; }
# Verb-recognition probe by CONTENT, not --help's exit code (a loa predating the hoist prints the
# generic launcher banner instead of the signoff usage). Robust to whatever exit status help uses.
loa signoff --help 2>&1 | grep -q 'loa signoff <pr>' || {
  echo "tools/loa-signoff.sh: this \`loa\` does not provide the 'signoff' verb (predates the hoist, or is broken) — update your loa-cli checkout (pull main + re-\`npm link\`)." >&2; exit 2; }
# freeside's suite lives in themes/sietch; loa signoff now defaults to '.' (generic), so this repo's
# shim pins its own dir. Operator override still wins (only set when unset).
export LOA_SIGNOFF_SUITE_DIR="${LOA_SIGNOFF_SUITE_DIR:-themes/sietch}"
exec loa signoff "$@"
