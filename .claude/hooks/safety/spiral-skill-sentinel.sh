#!/usr/bin/env bash
# =============================================================================
# PreToolUse:Skill — Spiral Sentinel Activation
# =============================================================================
# When /spiraling is invoked, automatically creates the dispatch sentinel
# that activates the Write/Edit guard (spiral-dispatch-guard.sh).
#
# This closes the last mechanical enforcement gap: the agent doesn't need
# to remember to create the sentinel. The hook does it automatically at
# the platform level before the skill even loads.
#
# Exit 0 = allow (always — this hook never blocks, only creates sentinel).
#
# Registered in settings.hooks.json as PreToolUse matcher: "Skill"
# Part of Spiral Mechanical Enforcement (cycle-072)
# =============================================================================

input=$(cat)
skill=$(echo "$input" | jq -r '.tool_input.skill // empty' 2>/dev/null) || true

# Strip namespace prefix if present
skill="${skill##*:}"

if [[ "$skill" == "spiraling" ]]; then
    sentinel="${LOA_PROJECT_ROOT:-.}/.run/spiral-dispatch-active"
    mkdir -p "$(dirname "$sentinel")" 2>/dev/null || true
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) hook=spiral-skill-sentinel" > "$sentinel"
fi

# Always allow — this hook only creates the sentinel, never blocks
exit 0
