#!/bin/bash
# Sietch Service Backup Script
#
# Usage:
#   ./backup.sh
#
# This script creates backups of:
#   - SQLite database (online backup)
#   - Environment configuration
#   - Current release info
#
# Features:
#   - AES-256 encryption (enabled by default)
#   - Integrity verification
#   - Automatic retention cleanup
#
# Schedule with cron:
#   0 3 * * * /opt/sietch/scripts/backup.sh >> /opt/sietch/logs/backup.log 2>&1
#
# Encryption Setup (one-time):
#   echo 'your-secure-passphrase' > /opt/sietch/.backup-passphrase
#   chmod 600 /opt/sietch/.backup-passphrase
#
# Environment Variables:
#   BACKUP_ENCRYPTION=true|false  (default: true)
#   BACKUP_PASSPHRASE=string      (alternative to passphrase file)
#   RETENTION_DAYS=7              (default: 7)
#
# Restore encrypted backup:
#   gpg --decrypt backup.tar.gz.gpg | tar -xzf -
#
# Backup retention: 7 days (configurable)

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"; }

# Configuration
SIETCH_DIR="/opt/sietch"
BACKUP_DIR="$SIETCH_DIR/backups"
DATA_DIR="$SIETCH_DIR/data"
DATABASE_FILE="$DATA_DIR/sietch.db"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="sietch_backup_$TIMESTAMP"
BACKUP_PATH="$BACKUP_DIR/$BACKUP_NAME"
RETENTION_DAYS="${RETENTION_DAYS:-7}"

# Encryption configuration
# Set BACKUP_ENCRYPTION=true and provide passphrase to enable
BACKUP_ENCRYPTION="${BACKUP_ENCRYPTION:-true}"
BACKUP_PASSPHRASE="${BACKUP_PASSPHRASE:-}"
BACKUP_PASSPHRASE_FILE="${BACKUP_PASSPHRASE_FILE:-$SIETCH_DIR/.backup-passphrase}"

# Verify directories exist
if [[ ! -d "$BACKUP_DIR" ]]; then
    log_error "Backup directory does not exist: $BACKUP_DIR"
    exit 1
fi

if [[ ! -d "$DATA_DIR" ]]; then
    log_warn "Data directory does not exist: $DATA_DIR"
fi

log_info "Starting backup: $BACKUP_NAME"
log_info "Backup directory: $BACKUP_PATH"

# Create backup directory
mkdir -p "$BACKUP_PATH"

# =============================================================================
# Backup SQLite Database
# =============================================================================
log_info "Backing up SQLite database..."

if [[ -f "$DATABASE_FILE" ]]; then
    # Use SQLite online backup API for consistency
    # This creates a consistent snapshot even while the database is in use
    sqlite3 "$DATABASE_FILE" ".backup '$BACKUP_PATH/sietch.db'"

    # Verify backup integrity
    if sqlite3 "$BACKUP_PATH/sietch.db" "PRAGMA integrity_check;" | grep -q "ok"; then
        log_info "Database backup verified: $BACKUP_PATH/sietch.db"

        # Get database stats
        TABLES=$(sqlite3 "$BACKUP_PATH/sietch.db" "SELECT COUNT(*) FROM sqlite_master WHERE type='table';")
        log_info "Database contains $TABLES tables"
    else
        log_error "Database backup integrity check failed!"
        rm -rf "$BACKUP_PATH"
        exit 1
    fi
else
    log_warn "Database file not found: $DATABASE_FILE"
fi

# =============================================================================
# Backup Environment Configuration (sanitized)
# =============================================================================
log_info "Backing up environment configuration..."

if [[ -f "$SIETCH_DIR/.env" ]]; then
    # Create sanitized copy (mask sensitive values)
    # This preserves the structure but not the actual secrets
    sed -E 's/(TOKEN|KEY|SECRET|PASSWORD)=.*/\1=***REDACTED***/gi' \
        "$SIETCH_DIR/.env" > "$BACKUP_PATH/env.sanitized"

    # Store hash of actual env file for change detection
    sha256sum "$SIETCH_DIR/.env" | cut -d' ' -f1 > "$BACKUP_PATH/env.sha256"

    log_info "Environment configuration backed up (sanitized)"
else
    log_warn "Environment file not found: $SIETCH_DIR/.env"
fi

# =============================================================================
# Backup Current Release Info
# =============================================================================
log_info "Recording release information..."

# Record current release path
if [[ -L "$SIETCH_DIR/current" ]]; then
    CURRENT_RELEASE=$(readlink -f "$SIETCH_DIR/current")
    echo "$CURRENT_RELEASE" > "$BACKUP_PATH/current_release.txt"

    # Get git info if available
    if [[ -d "$CURRENT_RELEASE/.git" ]]; then
        cd "$CURRENT_RELEASE"
        git rev-parse HEAD > "$BACKUP_PATH/git_commit.txt" 2>/dev/null || true
        git log -1 --format="%H %s" > "$BACKUP_PATH/git_log.txt" 2>/dev/null || true
    fi

    log_info "Release info recorded: $CURRENT_RELEASE"
else
    log_warn "Current release symlink not found"
fi

# =============================================================================
# Record System State
# =============================================================================
log_info "Recording system state..."

{
    echo "=== Backup Timestamp ==="
    date -Iseconds
    echo ""
    echo "=== PM2 Process List ==="
    pm2 list 2>/dev/null || echo "PM2 not available"
    echo ""
    echo "=== Disk Usage ==="
    df -h "$SIETCH_DIR"
    echo ""
    echo "=== Directory Sizes ==="
    du -sh "$SIETCH_DIR"/* 2>/dev/null || true
} > "$BACKUP_PATH/system_state.txt"

log_info "System state recorded"

# =============================================================================
# Compress Backup
# =============================================================================
log_info "Compressing backup..."

cd "$BACKUP_DIR"
tar -czf "$BACKUP_NAME.tar.gz" "$BACKUP_NAME"
rm -rf "$BACKUP_PATH"

BACKUP_SIZE=$(du -h "$BACKUP_NAME.tar.gz" | cut -f1)
log_info "Backup compressed: $BACKUP_NAME.tar.gz ($BACKUP_SIZE)"

# =============================================================================
# Encrypt Backup (Optional but recommended)
# =============================================================================
FINAL_BACKUP_FILE="$BACKUP_NAME.tar.gz"

if [[ "$BACKUP_ENCRYPTION" == "true" ]]; then
    log_info "Encrypting backup..."

    # Get passphrase from file or environment
    if [[ -n "$BACKUP_PASSPHRASE" ]]; then
        PASSPHRASE="$BACKUP_PASSPHRASE"
    elif [[ -f "$BACKUP_PASSPHRASE_FILE" ]]; then
        PASSPHRASE=$(cat "$BACKUP_PASSPHRASE_FILE")
    else
        log_warn "Encryption enabled but no passphrase provided."
        log_warn "Create passphrase file: echo 'your-secure-passphrase' > $BACKUP_PASSPHRASE_FILE && chmod 600 $BACKUP_PASSPHRASE_FILE"
        log_warn "Skipping encryption for this backup."
        BACKUP_ENCRYPTION="false"
    fi

    if [[ "$BACKUP_ENCRYPTION" == "true" && -n "$PASSPHRASE" ]]; then
        # Encrypt using GPG with AES-256 symmetric encryption
        echo "$PASSPHRASE" | gpg --batch --yes --passphrase-fd 0 \
            --symmetric --cipher-algo AES256 \
            --output "$BACKUP_NAME.tar.gz.gpg" \
            "$BACKUP_NAME.tar.gz"

        if [[ -f "$BACKUP_NAME.tar.gz.gpg" ]]; then
            # Remove unencrypted backup
            rm -f "$BACKUP_NAME.tar.gz"
            FINAL_BACKUP_FILE="$BACKUP_NAME.tar.gz.gpg"
            BACKUP_SIZE=$(du -h "$FINAL_BACKUP_FILE" | cut -f1)
            log_info "Backup encrypted: $FINAL_BACKUP_FILE ($BACKUP_SIZE)"
        else
            log_error "Encryption failed, keeping unencrypted backup"
        fi
    fi
else
    log_info "Encryption disabled (set BACKUP_ENCRYPTION=true to enable)"
fi

# =============================================================================
# Cleanup Old Backups
# =============================================================================
log_info "Cleaning up old backups (retention: $RETENTION_DAYS days)..."

# Find and remove backups older than retention period (both encrypted and unencrypted)
DELETED_COUNT=0
while IFS= read -r old_backup; do
    if [[ -n "$old_backup" ]]; then
        log_info "Removing old backup: $(basename "$old_backup")"
        rm -f "$old_backup"
        ((DELETED_COUNT++))
    fi
done < <(find "$BACKUP_DIR" -name "sietch_backup_*.tar.gz*" -mtime +$RETENTION_DAYS -type f)

if [[ $DELETED_COUNT -gt 0 ]]; then
    log_info "Removed $DELETED_COUNT old backup(s)"
else
    log_info "No old backups to remove"
fi

# =============================================================================
# Summary
# =============================================================================
echo ""
echo "=============================================="
echo -e "  ${GREEN}BACKUP COMPLETE${NC}"
echo "=============================================="
echo ""
echo "Backup file: $BACKUP_DIR/$FINAL_BACKUP_FILE"
echo "Backup size: $BACKUP_SIZE"
echo "Encrypted: $BACKUP_ENCRYPTION"
echo "Retention: $RETENTION_DAYS days"
echo ""

# List current backups
echo "Current backups:"
ls -lh "$BACKUP_DIR"/sietch_backup_*.tar.gz* 2>/dev/null | tail -10

echo ""

# Show restore instructions for encrypted backups
if [[ "$FINAL_BACKUP_FILE" == *.gpg ]]; then
    echo "To restore encrypted backup:"
    echo "  gpg --decrypt $BACKUP_DIR/$FINAL_BACKUP_FILE | tar -xzf -"
    echo ""
fi

log_info "Backup completed successfully!"

# =============================================================================
# Optional: Remote Backup (uncomment and configure)
# =============================================================================
# Uncomment below to sync backups to remote storage
# Requires: rclone configured with remote storage provider

# REMOTE_PATH="remote:sietch-backups"
# log_info "Syncing to remote storage..."
# rclone copy "$BACKUP_DIR/$BACKUP_NAME.tar.gz" "$REMOTE_PATH/" --progress
# log_info "Remote sync complete"
