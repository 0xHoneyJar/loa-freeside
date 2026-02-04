#!/bin/sh
# =============================================================================
# Stillsuit Development Startup Script
# =============================================================================
# Hot-reload development server using entr file watcher.
# Falls back to tsx watch if entr is unavailable.
#
# Environment variables:
#   DATABASE_URL     - PostgreSQL connection (required)
#   REDIS_URL        - Redis connection (optional, defaults work)
#   DISCORD_TOKEN    - Discord bot token (optional, warns if missing)
# =============================================================================
set -e

LOG_PREFIX="[arrakis-dev]"

# -----------------------------------------------------------------------------
# Logging helpers
# -----------------------------------------------------------------------------
log() { echo "$LOG_PREFIX $(date '+%H:%M:%S') $1"; }
log_error() { echo "$LOG_PREFIX $(date '+%H:%M:%S') ERROR: $1" >&2; }
log_warn() { echo "$LOG_PREFIX $(date '+%H:%M:%S') WARN: $1" >&2; }

# -----------------------------------------------------------------------------
# Graceful shutdown handler
# -----------------------------------------------------------------------------
cleanup() {
    log "Shutting down..."
    # Kill all child processes
    pkill -P $$ 2>/dev/null || true
    exit 0
}
trap cleanup SIGTERM SIGINT

# -----------------------------------------------------------------------------
# Environment validation (FR-6.4)
# -----------------------------------------------------------------------------
validate_env() {
    log "Validating environment..."

    # DATABASE_URL is required
    if [ -z "$DATABASE_URL" ]; then
        log_error "DATABASE_URL not set"
        log_error "This variable is auto-configured by docker-compose."
        log_error "If running outside docker, set DATABASE_URL manually."
        exit 1
    fi

    # DISCORD_TOKEN is optional but warns
    if [ -z "$DISCORD_TOKEN" ]; then
        log_warn "DISCORD_TOKEN not set - Discord features will be disabled"
        log_warn "Set DISCORD_TOKEN in .env.development for full functionality"
    fi

    # REDIS_URL defaults to localhost
    if [ -z "$REDIS_URL" ]; then
        log_warn "REDIS_URL not set - using default redis://localhost:6379"
    fi

    log "Environment OK"
}

# -----------------------------------------------------------------------------
# Wait for dependencies (backup for healthcheck)
# -----------------------------------------------------------------------------
wait_for_deps() {
    log "Checking dependencies..."

    # Extract host from DATABASE_URL for pg_isready
    # postgresql://user:pass@host:port/db -> host
    PG_HOST=$(echo "$DATABASE_URL" | sed -E 's|.*@([^:]+):.*|\1|')

    # PostgreSQL
    until pg_isready -h "$PG_HOST" -U arrakis -q 2>/dev/null; do
        log "Waiting for PostgreSQL at $PG_HOST..."
        sleep 1
    done
    log "PostgreSQL ready"

    # Redis (extract host from REDIS_URL or use default)
    REDIS_HOST=$(echo "${REDIS_URL:-redis://redis:6379}" | sed -E 's|redis://([^:]+):.*|\1|')
    until redis-cli -h "$REDIS_HOST" ping 2>/dev/null | grep -q PONG; do
        log "Waiting for Redis at $REDIS_HOST..."
        sleep 1
    done
    log "Redis ready"
}

# -----------------------------------------------------------------------------
# Main execution
# -----------------------------------------------------------------------------
main() {
    log "=============================================="
    log "Starting Stillsuit development environment"
    log "=============================================="

    validate_env
    wait_for_deps

    cd /repo/themes/sietch

    # Check for entr availability
    if command -v entr >/dev/null 2>&1; then
        log "Using entr for hot-reload"
        log ""
        log "=============================================="
        log "HOT-RELOAD SCOPE:"
        log "  ✅ themes/sietch/src/**/*.ts (hot-reloaded)"
        log "  ❌ packages/* (requires: make dev-build)"
        log "=============================================="
        log ""

        # entr -r pattern:
        # - Watches stdin for file list
        # - -r: Restart command on file change
        # - find generates file list, piped to entr
        # - When files change, entr kills and restarts tsx
        while true; do
            # Find all TypeScript files in src directory
            # Using find to allow entr to detect new files
            find src -name "*.ts" -type f 2>/dev/null | \
                entr -r -s "exec npx tsx src/index.ts" &

            ENTR_PID=$!
            wait $ENTR_PID || true

            # Brief pause before restart to avoid rapid cycling
            log "Restarting in 2s..."
            sleep 2
        done
    else
        log "entr not found, falling back to tsx watch"
        log ""
        log "=============================================="
        log "HOT-RELOAD SCOPE:"
        log "  ✅ themes/sietch/src/**/*.ts (hot-reloaded)"
        log "  ❌ packages/* (requires: make dev-build)"
        log "=============================================="
        log ""

        # Fallback to tsx watch (less reliable in containers but works)
        exec npx tsx watch src/index.ts
    fi
}

main "$@"
