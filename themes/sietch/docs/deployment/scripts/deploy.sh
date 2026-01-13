#!/bin/bash
# Zero-Downtime Deployment Script for Sietch Service
#
# Usage:
#   ./deploy.sh [branch]
#
# Arguments:
#   branch - Git branch to deploy (default: main)
#
# Prerequisites:
#   - SSH key configured for GitHub
#   - PM2 running with sietch process
#   - /opt/sietch directory structure created

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step() { echo -e "${BLUE}[STEP]${NC} $1"; }

# Configuration
DEPLOY_DIR="/opt/sietch"
REPO_URL="git@github.com:0xHoneyJar/arrakis.git"
BRANCH="${1:-main}"
TIMESTAMP=$(date +%Y%m%d%H%M%S)
RELEASE_DIR="$DEPLOY_DIR/releases/$TIMESTAMP"
CURRENT_LINK="$DEPLOY_DIR/current"
KEEP_RELEASES=5

log_info "Starting deployment..."
log_info "Repository: $REPO_URL"
log_info "Branch: $BRANCH"
log_info "Release Directory: $RELEASE_DIR"

# =============================================================================
# Pre-deployment Checks
# =============================================================================
log_step "Running pre-deployment checks..."

# Check if deploy directory exists
if [[ ! -d "$DEPLOY_DIR" ]]; then
    log_error "Deploy directory $DEPLOY_DIR does not exist. Run setup-vps.sh first."
    exit 1
fi

# Check if releases directory exists
if [[ ! -d "$DEPLOY_DIR/releases" ]]; then
    log_error "Releases directory does not exist. Run setup-vps.sh first."
    exit 1
fi

# Check if environment file exists
if [[ ! -f "$DEPLOY_DIR/.env" ]]; then
    log_error "Environment file $DEPLOY_DIR/.env does not exist."
    exit 1
fi

# Check if git is available
if ! command -v git &> /dev/null; then
    log_error "git is not installed"
    exit 1
fi

# Check if npm is available
if ! command -v npm &> /dev/null; then
    log_error "npm is not installed"
    exit 1
fi

# Check if pm2 is available
if ! command -v pm2 &> /dev/null; then
    log_error "pm2 is not installed"
    exit 1
fi

log_info "Pre-deployment checks passed"

# =============================================================================
# Clone Repository
# =============================================================================
log_step "Cloning repository..."

git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$RELEASE_DIR"

log_info "Repository cloned to $RELEASE_DIR"

# =============================================================================
# Install Dependencies
# =============================================================================
log_step "Installing dependencies..."

cd "$RELEASE_DIR/sietch-service"
npm ci --production=false

log_info "Dependencies installed"

# =============================================================================
# Build Application
# =============================================================================
log_step "Building application..."

npm run build

# Verify build output exists
if [[ ! -f "$RELEASE_DIR/sietch-service/dist/index.js" ]]; then
    log_error "Build failed - dist/index.js not found"
    exit 1
fi

log_info "Build completed successfully"

# =============================================================================
# Copy Environment File
# =============================================================================
log_step "Linking environment file..."

# Create symlink to shared environment file
ln -sf "$DEPLOY_DIR/.env" "$RELEASE_DIR/sietch-service/.env"

log_info "Environment file linked"

# =============================================================================
# Copy Ecosystem Config
# =============================================================================
log_step "Copying PM2 ecosystem config..."

# Copy ecosystem config to release
cp "$RELEASE_DIR/sietch-service/ecosystem.config.cjs" "$RELEASE_DIR/sietch-service/"

log_info "Ecosystem config ready"

# =============================================================================
# Run Database Migrations (if any)
# =============================================================================
log_step "Running database migrations..."

# SQLite migrations are auto-applied on startup via better-sqlite3
# This step is a placeholder for explicit migration commands if needed
log_info "Database migrations handled on startup (SQLite auto-schema)"

# =============================================================================
# Update Symlink
# =============================================================================
log_step "Updating symlink..."

# Store current release for potential rollback
PREVIOUS_RELEASE=$(readlink -f "$CURRENT_LINK" 2>/dev/null || echo "")

# Atomic symlink update
ln -sfn "$RELEASE_DIR" "$CURRENT_LINK"

log_info "Symlink updated: $CURRENT_LINK -> $RELEASE_DIR"

# =============================================================================
# Reload Application
# =============================================================================
log_step "Reloading application..."

# Check if sietch process exists in PM2
if pm2 describe sietch &> /dev/null; then
    # Use reload for zero-downtime restart
    pm2 reload sietch --update-env
    log_info "Application reloaded (zero-downtime)"
else
    # First deployment - start the process
    log_warn "Sietch process not found in PM2, starting fresh..."
    cd "$CURRENT_LINK/sietch-service"
    pm2 start ecosystem.config.cjs
    log_info "Application started"
fi

# Save PM2 process list
pm2 save

# =============================================================================
# Health Check
# =============================================================================
log_step "Running health check..."

# Wait for application to start
sleep 5

# Check health endpoint
HEALTH_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/health || echo "000")

if [[ "$HEALTH_RESPONSE" == "200" ]]; then
    log_info "Health check passed (HTTP $HEALTH_RESPONSE)"
else
    log_error "Health check failed (HTTP $HEALTH_RESPONSE)"
    log_warn "Rolling back to previous release..."

    if [[ -n "$PREVIOUS_RELEASE" && -d "$PREVIOUS_RELEASE" ]]; then
        ln -sfn "$PREVIOUS_RELEASE" "$CURRENT_LINK"
        pm2 reload sietch --update-env
        log_info "Rolled back to $PREVIOUS_RELEASE"
    else
        log_error "No previous release to roll back to"
    fi

    exit 1
fi

# =============================================================================
# Cleanup Old Releases
# =============================================================================
log_step "Cleaning up old releases..."

# Keep only the last N releases
cd "$DEPLOY_DIR/releases"
RELEASE_COUNT=$(ls -dt */ | wc -l)

if [[ "$RELEASE_COUNT" -gt "$KEEP_RELEASES" ]]; then
    RELEASES_TO_DELETE=$(ls -dt */ | tail -n +$((KEEP_RELEASES + 1)))
    for release in $RELEASES_TO_DELETE; do
        log_info "Removing old release: $release"
        rm -rf "$release"
    done
fi

log_info "Cleanup complete (keeping last $KEEP_RELEASES releases)"

# =============================================================================
# Summary
# =============================================================================
echo ""
echo "=============================================="
echo -e "  ${GREEN}DEPLOYMENT SUCCESSFUL${NC}"
echo "=============================================="
echo ""
echo "Release: $TIMESTAMP"
echo "Branch: $BRANCH"
echo "Path: $RELEASE_DIR"
echo ""
echo "PM2 Status:"
pm2 list
echo ""
echo "Health Check: curl http://127.0.0.1:3000/health"
echo ""
log_info "Deployment completed successfully!"
