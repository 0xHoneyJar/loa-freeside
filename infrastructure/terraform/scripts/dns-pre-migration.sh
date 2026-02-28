#!/usr/bin/env bash
# =============================================================================
# DNS Pre-Migration Validation
# Cycle 046: Armitage Platform — Sprint 4, Task 4.1
# SDD §8.1: dns-pre-migration.sh
# =============================================================================
#
# Validates Route 53 records match Gandi before NS cutover.
# Compares apex records (A, AAAA, MX, TXT, CAA) and all critical subdomains.
# Diff allowlist for expected SOA/NS differences.
#
# Usage:
#   ./dns-pre-migration.sh [domain]
#   ./dns-pre-migration.sh 0xhoneyjar.xyz

set -euo pipefail

DOMAIN="${1:-0xhoneyjar.xyz}"

# Prerequisites
command -v aws >/dev/null 2>&1 || { echo "ERROR: aws CLI required"; exit 1; }
command -v dig >/dev/null 2>&1 || { echo "ERROR: dig required"; exit 1; }

# Resolve hosted zone ID
ZONE_ID=$(aws route53 list-hosted-zones-by-name --dns-name "$DOMAIN" \
  --query "HostedZones[0].Id" --output text | sed 's|/hostedzone/||')

if [[ -z "$ZONE_ID" || "$ZONE_ID" == "None" ]]; then
  echo "ERROR: No Route 53 hosted zone found for $DOMAIN"
  exit 2
fi

echo "Zone ID: $ZONE_ID"
echo "Domain:  $DOMAIN"
echo "════════════════════════════════════════"

# Records to compare (diff allowlist: SOA, NS, TTL differences expected)
DIFF_ALLOWLIST=("SOA" "NS")

MISMATCHES=0
MATCHES=0
EXPECTED_DIFFS=0

# Get Gandi authoritative nameservers — verify delegation is still at Gandi
mapfile -t GANDI_NS_LIST < <(dig +short NS "$DOMAIN" | sed 's/\.$//')
if [[ ${#GANDI_NS_LIST[@]} -eq 0 ]]; then
  echo "ERROR: Could not resolve NS for $DOMAIN"
  exit 3
fi

# Ensure we are querying current Gandi authoritative servers only
GANDI_NS=""
for ns in "${GANDI_NS_LIST[@]}"; do
  if [[ "$ns" == *.gandi.net ]]; then
    GANDI_NS="$ns"
    break
  fi
done

if [[ -z "$GANDI_NS" ]]; then
  echo "ERROR: Current delegation for $DOMAIN is not pointing to Gandi NS; pre-migration comparison against Gandi is invalid"
  echo "Resolved NS set: ${GANDI_NS_LIST[*]}"
  exit 4
fi
echo "Gandi NS: $GANDI_NS"
echo ""

# Canonicalize DNS record values for cross-source comparison.
# AWS CLI --output text uses tabs between values; dig uses newlines.
# Normalizations: tab→newline, strip trailing dots, strip outer TXT quotes,
# collapse whitespace, sort.
canonicalize_dns_value() {
  local type="$1" raw="$2"
  local canonical

  # Tab → newline (AWS CLI --output text separates with tabs)
  canonical=$(printf '%s' "$raw" | tr '\t' '\n')

  # Per-type canonicalization
  case "$type" in
    MX)
      # Normalize "priority target." → "priority target" (strip trailing dot on target)
      canonical=$(printf '%s\n' "$canonical" | sed 's/\.$//')
      ;;
    TXT)
      # Strip only outermost surrounding quotes per line
      canonical=$(printf '%s\n' "$canonical" | sed 's/^"//; s/"$//')
      ;;
    CNAME|NS)
      # Strip trailing dots
      canonical=$(printf '%s\n' "$canonical" | sed 's/\.$//')
      ;;
    CAA)
      # Strip trailing dots on domain values; quotes stay
      canonical=$(printf '%s\n' "$canonical" | sed 's/\.$//')
      ;;
  esac

  # Collapse whitespace within each line, strip blank lines, sort
  printf '%s\n' "$canonical" | sed 's/[[:space:]]\+/ /g; s/^ //; s/ $//' | grep -v '^$' | sort
}

compare_record() {
  local type="$1" name="$2" ns="${3:-$GANDI_NS}"
  local r53_raw gandi_raw r53_value gandi_value

  r53_raw=$(aws route53 list-resource-record-sets --hosted-zone-id "$ZONE_ID" \
    --query "ResourceRecordSets[?Name=='${name}.' && Type=='${type}'].ResourceRecords[].Value" \
    --output text 2>/dev/null) || r53_raw=""

  gandi_raw=$(dig +short "$name" "$type" "@${ns}" 2>/dev/null) || gandi_raw=""

  r53_value=$(canonicalize_dns_value "$type" "$r53_raw")
  gandi_value=$(canonicalize_dns_value "$type" "$gandi_raw")

  if [[ "$r53_value" == "$gandi_value" ]]; then
    echo "  MATCH: $type $name"
    MATCHES=$((MATCHES + 1))
  elif printf '%s\n' "${DIFF_ALLOWLIST[@]}" | grep -q "^${type}$"; then
    echo "  EXPECTED_DIFF: $type $name (in allowlist)"
    EXPECTED_DIFFS=$((EXPECTED_DIFFS + 1))
  else
    echo "  MISMATCH: $type $name"
    echo "    Route 53: ${r53_value:-<empty>}"
    echo "    Gandi:    ${gandi_value:-<empty>}"
    MISMATCHES=$((MISMATCHES + 1))
  fi
}

# Apex records
echo "Apex Records ($DOMAIN):"
for type in A AAAA MX TXT CAA; do
  compare_record "$type" "$DOMAIN"
done

# Explicit subdomains
echo ""
echo "Subdomain Records:"
compare_record "CNAME" "www.${DOMAIN}"
compare_record "CNAME" "*.${DOMAIN}"
compare_record "TXT" "_dmarc.${DOMAIN}"
compare_record "TXT" "google._domainkey.${DOMAIN}"

# Agent economy records
echo ""
echo "Agent Economy Records:"
compare_record "CNAME" "*.agents.${DOMAIN}"
compare_record "A" "agents.${DOMAIN}"

# ACME delegation records (NS type)
echo ""
echo "ACME Delegation Records:"
compare_record "NS" "_acme-challenge.${DOMAIN}"
compare_record "NS" "_acme-challenge.agents.${DOMAIN}"

# Report
echo ""
echo "════════════════════════════════════════"
echo "Results: $MATCHES matched, $EXPECTED_DIFFS expected diffs, $MISMATCHES mismatches"
echo "════════════════════════════════════════"

if (( MISMATCHES > 0 )); then
  echo "PRE-MIGRATION CHECK FAILED: $MISMATCHES mismatches"
  exit 1
fi
echo "PRE-MIGRATION CHECK PASSED: All records match (or in diff allowlist)"
