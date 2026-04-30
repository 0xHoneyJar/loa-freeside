#!/usr/bin/env bash
# =============================================================================
# cdn-cors-smoke.sh — CORS smoke test for the assets.0xhoneyjar.xyz CDN
# =============================================================================
#
# Exit codes:
#   0 — all probes returned HTTP 200 with `access-control-allow-origin`
#   1 — at least one probe missing CORS or non-200
#   2 — bad invocation
#
# Catches the class of bug surfaced 2026-04-30: T4 terraform skeleton
# created a new CloudFront distribution without attaching the
# `Managed-CORS-With-Preflight` response headers policy. Browser canvas
# consumers (img crossOrigin="anonymous" + drawImage) silently failed
# because Access-Control-Allow-Origin was missing on every response.
#
# Run before promoting any cutover to production:
#   bash scripts/cdn-cors-smoke.sh
#   bash scripts/cdn-cors-smoke.sh --host assets.0xhoneyjar.xyz --origin https://mibera.0xhoneyjar.xyz
#
# Or wire as a CI gate (smoke-cutover.yml workflow per SDD §10.2).
# =============================================================================
set -euo pipefail

HOST="${HOST:-assets.0xhoneyjar.xyz}"
ORIGIN="${ORIGIN:-https://mibera.0xhoneyjar.xyz}"

# Parse flags (override env via CLI)
while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)    HOST="$2"; shift 2 ;;
    --origin)  ORIGIN="$2"; shift 2 ;;
    --help|-h) sed -n '2,20p' "$0"; exit 0 ;;
    *)         echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

# Representative paths covering all the cache behaviors we ship:
#   *.webp behavior        — Mibera/generated, Mibera/layers_webp, Mibera/quiz_archetypes
#   default behavior       — reveal_phase{N}/images/*.png (codex-mcp surface)
#   default + path-shape   — Purupuru, sprawl
PATHS=(
  "Mibera/generated/0.webp"
  "Mibera/generated/1.webp"
  "Mibera/layers_webp/background_thumb/74_basque.webp"
  "Mibera/quiz_archetypes/1.webp"
  "reveal_phase8/images/8a7e39404ebf86073fab1d068d7037930298d121.png"
)

pass=0
fail=0
failures=()

echo "🌐 cdn-cors-smoke · host=$HOST · origin=$ORIGIN"
echo ""

for path in "${PATHS[@]}"; do
  url="https://$HOST/$path"
  headers=$(curl -sI --max-time 8 -H "Origin: $ORIGIN" "$url" 2>/dev/null | tr -d '\r')

  status=$(echo "$headers" | head -n1 | awk '{print $2}')
  acao=$(echo "$headers" | grep -i '^access-control-allow-origin:' | head -n1 | awk -F': ' '{print $2}')
  cache=$(echo "$headers" | grep -i '^x-cache:' | head -n1 | awk -F': ' '{print $2}')

  if [[ "$status" == "200" && -n "$acao" ]]; then
    printf "  ✅ %s · %s · %s\n" "$status" "${acao:-<missing>}" "/$path"
    pass=$((pass + 1))
  else
    printf "  ❌ %s · ACAO=%s · cache=%s · /%s\n" "${status:-<no-response>}" "${acao:-<missing>}" "${cache:-<n/a>}" "$path"
    failures+=("/$path  status=${status:-none}  acao=${acao:-missing}")
    fail=$((fail + 1))
  fi
done

echo ""
echo "summary: $pass passed · $fail failed"

if [[ $fail -gt 0 ]]; then
  echo ""
  echo "failures:"
  for f in "${failures[@]}"; do
    echo "  - $f"
  done
  echo ""
  echo "🩹 if ACAO is <missing>: the CloudFront distribution lacks a Response Headers Policy."
  echo "   Attach the AWS-managed Managed-CORS-With-Preflight policy via terraform"
  echo "   (see infrastructure/terraform/freeside-storage/main.tf locals.cors_response_headers_policy_id)"
  echo "   or via aws-cli for emergency:"
  echo "   aws cloudfront update-distribution --id <DIST_ID> ..."
  exit 1
fi

exit 0
