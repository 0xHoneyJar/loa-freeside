#!/bin/bash
#
# SQLite Database Backup Script
# Backs up the Sietch database to a git repository
#
# Usage: ./backup-db.sh
# Cron: 0 */6 * * * /opt/sietch-service/deploy/scripts/backup-db.sh
#

set -euo pipefail

# Configuration
DB_PATH="${DB_PATH:-/opt/sietch-service/data/sietch.db}"
BACKUP_REPO="${BACKUP_REPO:-/opt/sietch-backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
DATE=$(date +%Y-%m-%d_%H-%M-%S)
BACKUP_FILE="sietch_${DATE}.db"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1"
}

error() {
    echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')] ERROR:${NC} $1" >&2
}

warn() {
    echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')] WARN:${NC} $1"
}

# Check if database exists
if [ ! -f "$DB_PATH" ]; then
    error "Database not found at $DB_PATH"
    exit 1
fi

# Check if backup repo exists
if [ ! -d "$BACKUP_REPO" ]; then
    error "Backup repository not found at $BACKUP_REPO"
    error "Initialize with: git clone <backup-repo-url> $BACKUP_REPO"
    exit 1
fi

log "Starting database backup..."

# Navigate to backup repo
cd "$BACKUP_REPO"

# Pull latest (in case of remote changes)
if git remote -v | grep -q origin; then
    log "Pulling latest from remote..."
    git pull --rebase origin main 2>/dev/null || warn "Could not pull from remote (may be offline)"
fi

# Create backup directory for today if not exists
BACKUP_DIR="backups/$(date +%Y/%m)"
mkdir -p "$BACKUP_DIR"

# Use SQLite's backup command for consistency (hot backup)
log "Creating backup: $BACKUP_DIR/$BACKUP_FILE"
sqlite3 "$DB_PATH" ".backup '$BACKUP_DIR/$BACKUP_FILE'"

# Compress the backup
log "Compressing backup..."
gzip -9 "$BACKUP_DIR/$BACKUP_FILE"
BACKUP_FILE="${BACKUP_FILE}.gz"

# Get backup size
BACKUP_SIZE=$(du -h "$BACKUP_DIR/$BACKUP_FILE" | cut -f1)
log "Backup size: $BACKUP_SIZE"

# Update latest symlink
ln -sf "$BACKUP_DIR/$BACKUP_FILE" "backups/latest.db.gz"

# Clean up old backups (keep last RETENTION_DAYS days)
log "Cleaning up backups older than $RETENTION_DAYS days..."
find backups -name "*.db.gz" -mtime +$RETENTION_DAYS -delete 2>/dev/null || true

# Count remaining backups
BACKUP_COUNT=$(find backups -name "*.db.gz" | wc -l)
log "Total backups: $BACKUP_COUNT"

# Commit and push
log "Committing backup..."
git add -A
git commit -m "Backup: $DATE ($BACKUP_SIZE)" || warn "No changes to commit"

# Push to remote
if git remote -v | grep -q origin; then
    log "Pushing to remote..."
    git push origin main 2>/dev/null || warn "Could not push to remote (may be offline)"
fi

log "Backup complete: $BACKUP_DIR/$BACKUP_FILE"

# Output JSON for monitoring integration
echo "{\"status\":\"success\",\"timestamp\":\"$(date -Iseconds)\",\"file\":\"$BACKUP_FILE\",\"size\":\"$BACKUP_SIZE\",\"total_backups\":$BACKUP_COUNT}"
