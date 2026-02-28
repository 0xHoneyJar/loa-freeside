#!/usr/bin/env bash
# =============================================================================
# DNS Post-Migration Check — Propagation Monitor
# Cycle 046: Armitage Platform — Sprint 4, Task 4.2
# SDD §8.2: dns-post-migration-check.sh
# =============================================================================
#
# Monitors DNS propagation after NS change at registrar.
# Queries 8 diverse public resolvers, tracks A and MX agreement.
# Exits 0 when ≥95% agreement, exits 1 on 4-hour timeout.
#
# Usage:
#   ./dns-post-migration-check.sh [domain]
#   ./dns-post-migration-check.sh 0xhoneyjar.xyz

set -euo pipefail

DOMAIN="${1:-0xhoneyjar.xyz}"
RESOLVERS=("8.8.8.8" "1.1.1.1" "208.67.222.222" "9.9.9.9" "64.6.64.6"
           "185.228.168.9" "76.76.19.19" "94.140.14.14")
AGREEMENT_THRESHOLD=95  # ≥95% resolver agreement
TIMEOUT_HOURS=4
CHECK_INTERVAL=60  # 1 minute between full checks
MAX_CHECKS=$(( TIMEOUT_HOURS * 3600 / CHECK_INTERVAL ))

# Prerequisites
command -v dig >/dev/null 2>&1 || { echo "ERROR: dig required"; exit 1; }

echo "DNS Post-Migration Propagation Monitor"
echo "Domain:    $DOMAIN"
echo "Resolvers: ${#RESOLVERS[@]}"
echo "Threshold: ${AGREEMENT_THRESHOLD}%"
echo "Timeout:   ${TIMEOUT_HOURS}h (${MAX_CHECKS} checks)"
echo "════════════════════════════════════════"

check_propagation() {
  local record_type="$1" name="$2" expected="$3"
  local agree=0 total=${#RESOLVERS[@]}

  for resolver in "${RESOLVERS[@]}"; do
    local result
    result=$(dig +short "$name" "$record_type" "@${resolver}" 2>/dev/null | sed 's/\.$//' | sort) || result=""
    local expected_norm
    expected_norm=$(printf '%s\n' "$expected" | sed 's/\.$//' | sort)
    if printf '%s\n' "$result" | grep -Fxq "$expected_norm"; then
      agree=$((agree + 1))
    fi
  done

  local pct=$(( agree * 100 / total ))
  echo "$pct"
}

# Derive expected values from first resolver (assumed already propagated)
EXPECTED_A=$(dig +short "$DOMAIN" A @8.8.8.8 2>/dev/null | head -1)
EXPECTED_MX=$(dig +short "$DOMAIN" MX @8.8.8.8 2>/dev/null | awk '{print $2}' | sed 's/\.$//' | head -1)

if [[ -z "$EXPECTED_A" || -z "$EXPECTED_MX" ]]; then
  echo "ERROR: Unable to determine expected A/MX values for $DOMAIN from @8.8.8.8"
  exit 2
fi

echo ""
echo "Expected A:  $EXPECTED_A"
echo "Expected MX: $EXPECTED_MX"
echo ""

# Main monitoring loop
for (( i=1; i<=MAX_CHECKS; i++ )); do
  echo ""
  echo "Check $i/$MAX_CHECKS ($(date -u '+%Y-%m-%d %H:%M:%S UTC'))"

  a_pct=$(check_propagation "A" "$DOMAIN" "$EXPECTED_A")
  mx_pct=$(check_propagation "MX" "$DOMAIN" "$EXPECTED_MX")

  echo "  A record:  ${a_pct}% agreement (${#RESOLVERS[@]} resolvers)"
  echo "  MX record: ${mx_pct}% agreement (${#RESOLVERS[@]} resolvers)"

  if (( a_pct >= AGREEMENT_THRESHOLD )) && (( mx_pct >= AGREEMENT_THRESHOLD )); then
    echo ""
    echo "════════════════════════════════════════"
    echo "PROPAGATION COMPLETE: ≥${AGREEMENT_THRESHOLD}% agreement achieved"
    echo "  A record:  ${a_pct}%"
    echo "  MX record: ${mx_pct}%"
    echo ""
    echo "Next steps:"
    echo "  1. Send test email to verify MX within 1 hour"
    echo "  2. Check HTTPS certs on all subdomains (agents.*, www.*, api.*)"
    echo "  3. Verify no elevated error rates in CloudWatch"
    echo "════════════════════════════════════════"
    exit 0
  fi

  if (( i < MAX_CHECKS )); then
    sleep "$CHECK_INTERVAL"
  fi
done

echo ""
echo "════════════════════════════════════════"
echo "PROPAGATION TIMEOUT after ${TIMEOUT_HOURS}h"
echo ""
echo "Current state:"
echo "  A record:  ${a_pct:-0}% agreement"
echo "  MX record: ${mx_pct:-0}% agreement"
echo ""
echo "TRIGGER ROLLBACK ALERT:"
echo "  1. Revert NS records at Gandi registrar"
echo "  2. Verify Gandi re-asserts authority: dig NS $DOMAIN @8.8.8.8"
echo "  3. Wait ≤300s for TTL expiry"
echo "  4. Send test email to confirm MX recovery"
echo "════════════════════════════════════════"
exit 1
