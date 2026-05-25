#!/usr/bin/env bash
# tools/lib/domain-classify.sh — single source of truth for ADR-007 §D-3 path classification
#
# Used by:
#   - .github/workflows/path-domain-check.yml (CI enforcement)
#   - tools/check-beacon-domain.sh (local pre-commit hook)
#
# Reference: decisions/007-loa-freeside-absorption.md §D-1, §D-3
#            grimoires/loa/context/base-layer-topology.md (full topology map)
#
# ── Two orthogonal axes (per ADR-008 §D-8 "Plane ≠ Domain") ───────────────
#
# AXIS 1 — DOMAIN (firewall-enforced, mutually exclusive):
#   platform · network. A single PR must not mix the two — that is the
#   cross-domain coupling guard the ADR-007 absorption was built to prevent.
#
# AXIS 2 — CROSS-CUTTING CONCERN (firewall-NEUTRAL):
#   evals — verification infrastructure. An eval suite targets platform
#   things, network things, and buildings alike: one harness, subjects
#   spanning the whole stack. An `evals/`-only change therefore must NEVER
#   trip the cross-domain guard. `evals` is classified so the topology is
#   legible, but classify_changes deliberately does not count it toward
#   either domain.
#
# `shared` is the EXPLICIT default for genuinely repo-wide areas — Loa state
# (grimoires/), tooling (tools/, scripts/), docs/, tests/, spec/, sites/,
# config/, lib/, decisions/, .github/, packages/shared/. These belong to
# neither domain by design — "shared", not "unclassified".
#
# Usage:
#   source tools/lib/domain-classify.sh
#   classify_path "<file>" → echoes "platform", "network", "evals", or "shared"

classify_path() {
  local f="$1"
  case "$f" in
    # ── NETWORK domain (per ADR-007 §D-1) ──────────────────────────────────
    grimoires/freeside-network/*) echo "network" ;;
    apps/mcp-gateway/*)           echo "network" ;;
    packages/freeside-cli/*)      echo "network" ;;
    packages/freeside-registry/*) echo "network" ;;
    packages/beacon-schema/*)     echo "network" ;;

    # ── PLATFORM domain (per ADR-007 §D-1) ─────────────────────────────────
    grimoires/freeside-platform/*) echo "platform" ;;
    apps/gateway/*)                echo "platform" ;;
    apps/ingestor/*)               echo "platform" ;;
    apps/worker/*)                 echo "platform" ;;
    packages/cli/*)                echo "platform" ;;
    packages/core/*)               echo "platform" ;;
    packages/adapters/*)           echo "platform" ;;
    packages/auth-module/*)        echo "platform" ;;
    packages/sandbox/*)            echo "platform" ;;
    packages/routes/*)             echo "platform" ;;
    packages/services/*)           echo "platform" ;;
    infrastructure/*)              echo "platform" ;;
    drizzle/*)                     echo "platform" ;;
    # themes/* is in-monolith today. ADR-008 marks themes/sietch/src/{discord,
    # telegram,services} as *buildings* destined for external freeside-* repos;
    # until that extraction lands they are platform-classified (not network).
    themes/*)                      echo "platform" ;;

    # ── EVALS — cross-cutting verification axis (firewall-NEUTRAL) ──────────
    evals/*)                       echo "evals" ;;

    # ── SHARED by design — repo-wide state/tooling (see header) ────────────
    *)                             echo "shared" ;;
  esac
}

# classify_changes <file_list> → sets platform_touched / network_touched and
# the platform_files / network_files arrays (side effect when sourced).
# `evals` and `shared` are firewall-neutral — they never set a touched-flag,
# so an evals-only or shared-only PR reports "shared/cross-domain" and is
# never blocked by the cross-domain guard.
classify_changes() {
  local files="$1"
  platform_touched=false
  network_touched=false
  platform_files=()
  network_files=()

  while IFS= read -r f; do
    [ -z "$f" ] && continue
    case "$(classify_path "$f")" in
      platform) platform_touched=true; platform_files+=("$f") ;;
      network)  network_touched=true; network_files+=("$f") ;;
      evals)    : ;;  # cross-cutting verification — deliberately firewall-neutral
      # shared → no-op (firewall-neutral by design)
    esac
  done <<< "$files"
}
