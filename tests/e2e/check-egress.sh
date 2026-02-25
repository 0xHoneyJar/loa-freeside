#!/usr/bin/env bash
# =============================================================================
# Static Egress Assertion — Post-E2E Network Verification
# =============================================================================
# Inspects container /proc/net/tcp for unexpected non-RFC1918 outbound
# connections. Flags any ESTABLISHED connection to non-allowlisted remotes.
#
# Usage:
#   ./tests/e2e/check-egress.sh [compose-file]
#
# Exit codes:
#   0 — No unexpected external connections
#   1 — Unexpected external connections found
#
# @see SDD §3.4, Layer 3 Static Egress Assertion
# @see Sprint 356, Task 2.5
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE="${1:-$SCRIPT_DIR/docker-compose.e2e.yml}"

SERVICES=("arrakis-e2e" "loa-finn-e2e")
violations=()

# ---------------------------------------------------------------------------
# Get Docker bridge subnet for allowlisting
# ---------------------------------------------------------------------------

get_docker_subnet() {
  local network_name
  network_name=$(docker compose -f "$COMPOSE_FILE" config --format json 2>/dev/null \
    | jq -r '.networks | to_entries[0].value.name // empty' 2>/dev/null) || true

  if [ -z "$network_name" ]; then
    # Fallback: infer from compose project name
    local project
    project=$(basename "$(dirname "$COMPOSE_FILE")")
    network_name="${project}_default"
  fi

  docker network inspect "$network_name" --format '{{range .IPAM.Config}}{{.Subnet}}{{end}}' 2>/dev/null || echo ""
}

DOCKER_SUBNET=$(get_docker_subnet)

# ---------------------------------------------------------------------------
# Hex IP decoder
# ---------------------------------------------------------------------------

hex_to_ip() {
  local hex="$1"
  # /proc/net/tcp stores IPv4 in little-endian hex
  printf "%d.%d.%d.%d" \
    "0x${hex:6:2}" "0x${hex:4:2}" "0x${hex:2:2}" "0x${hex:0:2}"
}

# ---------------------------------------------------------------------------
# RFC1918 / loopback / link-local check
# ---------------------------------------------------------------------------

is_private_ip() {
  local ip="$1"
  local IFS='.'
  read -ra octets <<< "$ip"
  local a="${octets[0]}"
  local b="${octets[1]}"

  # 0.0.0.0 (LISTEN placeholder)
  [ "$ip" = "0.0.0.0" ] && return 0
  # 127.0.0.0/8
  [ "$a" -eq 127 ] && return 0
  # 10.0.0.0/8
  [ "$a" -eq 10 ] && return 0
  # 172.16.0.0/12
  [ "$a" -eq 172 ] && [ "$b" -ge 16 ] && [ "$b" -le 31 ] && return 0
  # 192.168.0.0/16
  [ "$a" -eq 192 ] && [ "$b" -eq 168 ] && return 0
  # 169.254.0.0/16 (link-local)
  [ "$a" -eq 169 ] && [ "$b" -eq 254 ] && return 0

  return 1
}

# Check if IP is within Docker bridge subnet (proper CIDR arithmetic)
is_docker_subnet() {
  local ip="$1"
  [ -z "$DOCKER_SUBNET" ] && return 1

  local subnet_ip="${DOCKER_SUBNET%%/*}"
  local cidr="${DOCKER_SUBNET##*/}"
  local -a s_octets i_octets
  IFS='.' read -ra s_octets <<< "$subnet_ip"
  IFS='.' read -ra i_octets <<< "$ip"
  local s_int=$(( (s_octets[0]<<24) + (s_octets[1]<<16) + (s_octets[2]<<8) + s_octets[3] ))
  local i_int=$(( (i_octets[0]<<24) + (i_octets[1]<<16) + (i_octets[2]<<8) + i_octets[3] ))
  local mask=$(( 0xFFFFFFFF << (32-cidr) & 0xFFFFFFFF ))
  [ $(( s_int & mask )) -eq $(( i_int & mask )) ]
}

# ---------------------------------------------------------------------------
# Scan containers
# ---------------------------------------------------------------------------

echo "═══════════════════════════════════════════════════════"
echo "  Static Egress Assertion"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "  Docker subnet: ${DOCKER_SUBNET:-unknown}"
echo ""

for svc in "${SERVICES[@]}"; do
  echo "[egress] Scanning $svc..."

  # Read /proc/net/tcp and /proc/net/tcp6
  tcp_data=$(docker compose -f "$COMPOSE_FILE" exec -T "$svc" \
    cat /proc/net/tcp /proc/net/tcp6 2>/dev/null || true)

  if [ -z "$tcp_data" ]; then
    echo "[egress] WARNING: Could not read /proc/net/tcp from $svc"
    continue
  fi

  # Parse ESTABLISHED connections (state 01)
  while IFS= read -r line; do
    # Skip header
    [[ "$line" =~ ^[[:space:]]*sl ]] && continue

    # Fields: sl local_address rem_address st ...
    local_addr=$(echo "$line" | awk '{print $2}')
    rem_addr=$(echo "$line" | awk '{print $3}')
    state=$(echo "$line" | awk '{print $4}')

    # Only check ESTABLISHED (01)
    [ "$state" != "01" ] && continue

    # Extract remote IP (hex before colon)
    rem_hex="${rem_addr%%:*}"

    # Skip IPv6 entries (64-char hex) — check only IPv4
    [ ${#rem_hex} -gt 8 ] && continue

    rem_ip=$(hex_to_ip "$rem_hex")

    # Check if remote is private/loopback/docker
    if is_private_ip "$rem_ip"; then
      continue
    fi
    if is_docker_subnet "$rem_ip"; then
      continue
    fi

    # Non-allowlisted external connection found
    rem_port_hex="${rem_addr##*:}"
    rem_port=$((16#$rem_port_hex))
    violations+=("$svc → $rem_ip:$rem_port")
    echo "[egress] VIOLATION: $svc has ESTABLISHED connection to $rem_ip:$rem_port"

  done <<< "$tcp_data"
done

# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------

echo ""
if [ ${#violations[@]} -gt 0 ]; then
  echo "═══════════════════════════════════════════════════════"
  echo "  EGRESS ASSERTION FAILED"
  echo "═══════════════════════════════════════════════════════"
  echo ""
  echo "  Unexpected external connections detected:"
  for v in "${violations[@]}"; do
    echo "    - $v"
  done
  echo ""
  echo "  E2E tests must not make external network calls."
  echo "  Verify test isolation and metadata endpoint blocking."
  exit 1
else
  echo "═══════════════════════════════════════════════════════"
  echo "  EGRESS ASSERTION PASSED"
  echo "═══════════════════════════════════════════════════════"
  echo "  No unexpected external connections detected."
  exit 0
fi
