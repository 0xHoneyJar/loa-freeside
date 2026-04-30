#!/usr/bin/env bash
# =============================================================================
# cdn-parity.sh — bytes-identical probe between two CDN distributions
# =============================================================================
#
# Compares ETag + Content-Length on representative keys served by two CDNs.
# Used during cutovers to verify the new distribution serves identical bytes
# as the legacy one (catches origin-config drift, encoding mismatches,
# bucket-policy gaps before users notice).
#
# Layer 2 of the SDD §10 three-layer validation gate.
#
# Run as part of pre-flip verification:
#   bash scripts/cdn-parity.sh
#   bash scripts/cdn-parity.sh --new assets.0xhoneyjar.xyz --legacy d163aeqznbc6js.cloudfront.net
#
# Exit codes:
#   0 — all probes have identical etag + content-length
#   1 — at least one probe drifted (different bytes)
#   2 — bad invocation / both failed
# =============================================================================
set -euo pipefail

NEW="${NEW:-assets.0xhoneyjar.xyz}"
LEGACY="${LEGACY:-d163aeqznbc6js.cloudfront.net}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --new)     NEW="$2"; shift 2 ;;
    --legacy)  LEGACY="$2"; shift 2 ;;
    --help|-h) sed -n '2,20p' "$0"; exit 0 ;;
    *)         echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

# Sample paths — webp-direct fast path on both distributions.
# Optimizer paths (/images/{proxy+}, /_next/image*) are NOT compared
# because they intentionally diverge per ADR-006.
PATHS=(
  "Mibera/generated/0.webp"
  "Mibera/generated/1.webp"
  "Mibera/generated/100.webp"
  "Mibera/layers_webp/background_thumb/74_basque.webp"
  "Mibera/quiz_archetypes/1.webp"
)

identical=0
drifted=0
errors=0
findings=()

echo "📐 cdn-parity · new=$NEW · legacy=$LEGACY"
echo ""

for path in "${PATHS[@]}"; do
  new_h=$(curl -sI --max-time 8 "https://$NEW/$path"    2>/dev/null | tr -d '\r')
  leg_h=$(curl -sI --max-time 8 "https://$LEGACY/$path" 2>/dev/null | tr -d '\r')

  new_etag=$(echo "$new_h" | grep -i '^etag:' | head -n1 | awk -F': ' '{print $2}')
  new_len=$(echo "$new_h"  | grep -i '^content-length:' | head -n1 | awk -F': ' '{print $2}')
  leg_etag=$(echo "$leg_h" | grep -i '^etag:' | head -n1 | awk -F': ' '{print $2}')
  leg_len=$(echo "$leg_h"  | grep -i '^content-length:' | head -n1 | awk -F': ' '{print $2}')

  if [[ -z "$new_etag" || -z "$leg_etag" ]]; then
    printf "  ⚠ ERROR /%s · new_etag=%s · legacy_etag=%s\n" "$path" "${new_etag:-<missing>}" "${leg_etag:-<missing>}"
    findings+=("/$path  one or both responses returned no etag")
    errors=$((errors + 1))
    continue
  fi

  if [[ "$new_etag" == "$leg_etag" && "$new_len" == "$leg_len" ]]; then
    printf "  ✅ identical · etag=%s · %sB · /%s\n" "$new_etag" "$new_len" "$path"
    identical=$((identical + 1))
  else
    printf "  ❌ DRIFT /%s\n" "$path"
    printf "       new:    etag=%s · len=%s\n" "$new_etag" "$new_len"
    printf "       legacy: etag=%s · len=%s\n" "$leg_etag" "$leg_len"
    findings+=("/$path  new etag=$new_etag len=$new_len  legacy etag=$leg_etag len=$leg_len")
    drifted=$((drifted + 1))
  fi
done

echo ""
echo "summary: $identical identical · $drifted drifted · $errors errors"

if [[ $drifted -gt 0 || $errors -gt 0 ]]; then
  echo ""
  echo "findings:"
  for f in "${findings[@]}"; do
    echo "  - $f"
  done
  exit 1
fi

exit 0
