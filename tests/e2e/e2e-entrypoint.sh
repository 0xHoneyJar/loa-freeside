#!/bin/sh
set -e

# E2E Entrypoint — starts the server and optionally exports JWKS to a shared volume.
# This breaks the JWKS bootstrap circular dependency: arrakis writes JWKS to a file
# that loa-finn reads, instead of loa-finn HTTP-fetching JWKS from arrakis.

# Start the Node.js server in the background
node dist/index.js &
SERVER_PID=$!

# Wait for health endpoint to become available
echo "[e2e-entrypoint] Waiting for server to start..."
attempts=0
max_attempts=30
while [ $attempts -lt $max_attempts ]; do
  if curl -sf http://localhost:3000/health > /dev/null 2>&1; then
    echo "[e2e-entrypoint] Server is healthy"
    break
  fi
  attempts=$((attempts + 1))
  if [ $attempts -eq $max_attempts ]; then
    echo "[e2e-entrypoint] ERROR: Server failed to start within ${max_attempts}s"
    kill "$SERVER_PID" 2>/dev/null || true
    exit 1
  fi
  sleep 1
done

# Export JWKS to file if JWKS_EXPORT_PATH is set (R9-3: atomic write with validation)
if [ -n "$JWKS_EXPORT_PATH" ]; then
  echo "[e2e-entrypoint] Exporting JWKS to $JWKS_EXPORT_PATH"
  jwks_dir=$(dirname "$JWKS_EXPORT_PATH")
  mkdir -p "$jwks_dir" 2>/dev/null || true

  tmp_path="${JWKS_EXPORT_PATH}.tmp"
  if ! curl -sf http://localhost:3000/.well-known/jwks.json > "$tmp_path"; then
    echo "[e2e-entrypoint] ERROR: failed to fetch JWKS"
    rm -f "$tmp_path"
    exit 1
  fi

  if command -v jq > /dev/null 2>&1; then
    if ! jq empty "$tmp_path" 2>/dev/null; then
      echo "[e2e-entrypoint] ERROR: JWKS is not valid JSON"
      rm -f "$tmp_path"
      exit 1
    fi
  else
    echo "[e2e-entrypoint] WARNING: jq not found, skipping JWKS JSON validation"
  fi

  # Atomic rename — POSIX guarantees readers never see partial data
  mv "$tmp_path" "$JWKS_EXPORT_PATH"
  echo "[e2e-entrypoint] JWKS exported successfully ($(wc -c < "$JWKS_EXPORT_PATH") bytes)"
fi

# Wait on the server process (foreground)
wait "$SERVER_PID"
