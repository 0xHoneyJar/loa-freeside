#!/bin/bash
# VPS Environment Setup Script for Sietch Service
# Run this script on a fresh Ubuntu 22.04+ VPS
#
# Usage: sudo bash setup-vps.sh
#
# Prerequisites:
#   - Root or sudo access
#   - Ubuntu 22.04 LTS or later
#   - SSH access configured

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Check if running as root or with sudo
if [[ $EUID -ne 0 ]]; then
   log_error "This script must be run as root or with sudo"
   exit 1
fi

# Configuration
SIETCH_USER="${SIETCH_USER:-sietch}"
SIETCH_DIR="/opt/sietch"
NODE_VERSION="20"
DOMAIN="${DOMAIN:-sietch-api.honeyjar.xyz}"

log_info "Starting Sietch VPS setup..."
log_info "User: $SIETCH_USER"
log_info "Directory: $SIETCH_DIR"
log_info "Node.js Version: $NODE_VERSION"
log_info "Domain: $DOMAIN"

# =============================================================================
# Step 1: System Updates
# =============================================================================
log_info "Updating system packages..."
apt-get update && apt-get upgrade -y

# =============================================================================
# Step 2: Install Dependencies
# =============================================================================
log_info "Installing system dependencies..."
apt-get install -y \
    curl \
    wget \
    git \
    build-essential \
    nginx \
    certbot \
    python3-certbot-nginx \
    sqlite3 \
    ufw \
    fail2ban \
    gnupg \
    jq

# =============================================================================
# Step 3: Install Node.js 20 LTS
# =============================================================================
log_info "Installing Node.js ${NODE_VERSION} LTS..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
    apt-get install -y nodejs
else
    log_warn "Node.js already installed: $(node --version)"
fi

# Verify installation
log_info "Node.js version: $(node --version)"
log_info "npm version: $(npm --version)"

# =============================================================================
# Step 4: Install PM2 Globally
# =============================================================================
log_info "Installing PM2..."
npm install -g pm2

# Configure PM2 log rotation
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true

log_info "PM2 version: $(pm2 --version)"

# =============================================================================
# Step 5: Create Sietch User (if not exists)
# =============================================================================
if ! id "$SIETCH_USER" &>/dev/null; then
    log_info "Creating sietch user..."
    useradd -m -s /bin/bash "$SIETCH_USER"
else
    log_warn "User $SIETCH_USER already exists"
fi

# =============================================================================
# Step 6: Create Directory Structure
# =============================================================================
log_info "Creating directory structure..."
mkdir -p "$SIETCH_DIR"/{current,releases,data,logs,backups,scripts}

# Set ownership
chown -R "$SIETCH_USER:$SIETCH_USER" "$SIETCH_DIR"

# Set permissions
chmod 755 "$SIETCH_DIR"
chmod 700 "$SIETCH_DIR/backups"
chmod 700 "$SIETCH_DIR/data"

log_info "Directory structure created:"
ls -la "$SIETCH_DIR"

# =============================================================================
# Step 7: Create Environment File Template
# =============================================================================
log_info "Creating environment file template..."
if [[ ! -f "$SIETCH_DIR/.env" ]]; then
    cat > "$SIETCH_DIR/.env" << 'EOF'
# Sietch Service Environment Configuration
# IMPORTANT: Replace all placeholder values before starting the service

# =============================================================================
# Berachain RPC Configuration
# =============================================================================
# Primary RPC URL (use dedicated RPC provider for production)
BERACHAIN_RPC_URLS=https://rpc.berachain.com,https://bera-rpc.publicnode.com

# BGT Token contract address on Berachain
BGT_ADDRESS=0x0000000000000000000000000000000000000000

# Reward vault addresses (comma-separated)
REWARD_VAULT_ADDRESSES=0x0000000000000000000000000000000000000001,0x0000000000000000000000000000000000000002

# =============================================================================
# trigger.dev Configuration
# =============================================================================
TRIGGER_PROJECT_ID=sietch-service
TRIGGER_SECRET_KEY=tr_dev_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# =============================================================================
# Discord Configuration
# =============================================================================
DISCORD_BOT_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
DISCORD_GUILD_ID=000000000000000000
DISCORD_CHANNEL_THE_DOOR=000000000000000000
DISCORD_CHANNEL_CENSUS=000000000000000000
DISCORD_ROLE_NAIB=000000000000000000
DISCORD_ROLE_FEDAYKIN=000000000000000000

# =============================================================================
# API Configuration
# =============================================================================
API_PORT=3000
API_HOST=127.0.0.1

# Admin API keys (format: key1:name1,key2:name2)
ADMIN_API_KEYS=sietch_admin_key_1:admin1,sietch_admin_key_2:admin2

# =============================================================================
# Database Configuration
# =============================================================================
DATABASE_PATH=/opt/sietch/data/sietch.db

# =============================================================================
# Logging Configuration
# =============================================================================
LOG_LEVEL=info

# =============================================================================
# Grace Period Configuration
# =============================================================================
GRACE_PERIOD_HOURS=24
EOF
    chown "$SIETCH_USER:$SIETCH_USER" "$SIETCH_DIR/.env"
    chmod 600 "$SIETCH_DIR/.env"
    log_warn "Environment file created at $SIETCH_DIR/.env - EDIT THIS FILE with actual values!"
else
    log_warn "Environment file already exists at $SIETCH_DIR/.env"
fi

# =============================================================================
# Step 8: Configure Firewall (UFW)
# =============================================================================
log_info "Configuring firewall..."
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp

# Enable firewall (non-interactive)
echo "y" | ufw enable
ufw status

# =============================================================================
# Step 9: Configure Fail2ban
# =============================================================================
log_info "Configuring fail2ban..."
cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5

[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3

[nginx-http-auth]
enabled = true
port = http,https
filter = nginx-http-auth
logpath = /var/log/nginx/error.log
maxretry = 3

[nginx-limit-req]
enabled = true
port = http,https
filter = nginx-limit-req
logpath = /var/log/nginx/error.log
maxretry = 10
EOF

systemctl restart fail2ban
systemctl enable fail2ban

# =============================================================================
# Step 10: SSH Hardening (Key-Only Authentication)
# =============================================================================
log_info "Hardening SSH configuration..."

# Backup original sshd_config
cp /etc/ssh/sshd_config /etc/ssh/sshd_config.backup

# Configure SSH for key-only authentication
cat > /etc/ssh/sshd_config.d/99-sietch-hardening.conf << 'EOF'
# Sietch SSH Hardening Configuration
# Disable password authentication - use SSH keys only
PasswordAuthentication no
ChallengeResponseAuthentication no

# Disable root login
PermitRootLogin prohibit-password

# Use only SSH protocol 2
Protocol 2

# Limit authentication attempts
MaxAuthTries 3
MaxSessions 5

# Set idle timeout (5 minutes)
ClientAliveInterval 300
ClientAliveCountMax 2

# Disable X11 forwarding
X11Forwarding no

# Disable TCP forwarding (unless needed)
AllowTcpForwarding no

# Log level
LogLevel VERBOSE
EOF

# Test SSH config before restarting
if sshd -t; then
    systemctl restart sshd
    log_info "SSH hardened: password auth disabled, key-only authentication enabled"
else
    log_error "SSH config test failed, reverting..."
    rm /etc/ssh/sshd_config.d/99-sietch-hardening.conf
fi

log_warn "IMPORTANT: Ensure you have SSH key access before disconnecting!"

# =============================================================================
# Step 11: Automatic Security Updates
# =============================================================================
log_info "Configuring automatic security updates..."

apt-get install -y unattended-upgrades apt-listchanges

# Configure unattended-upgrades
cat > /etc/apt/apt.conf.d/50unattended-upgrades << 'EOF'
// Automatically upgrade packages from these origins
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}";
    "${distro_id}:${distro_codename}-security";
    "${distro_id}ESMApps:${distro_codename}-apps-security";
    "${distro_id}ESM:${distro_codename}-infra-security";
};

// Remove unused kernel packages
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";

// Remove unused dependencies
Unattended-Upgrade::Remove-Unused-Dependencies "true";

// Automatically reboot if required (at 3 AM)
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "03:00";

// Email notifications (optional - configure if needed)
// Unattended-Upgrade::Mail "admin@example.com";

// Don't automatically reboot with users logged in
Unattended-Upgrade::Automatic-Reboot-WithUsers "false";
EOF

# Enable automatic updates
cat > /etc/apt/apt.conf.d/20auto-upgrades << 'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Download-Upgradeable-Packages "1";
APT::Periodic::AutocleanInterval "7";
APT::Periodic::Unattended-Upgrade "1";
EOF

systemctl enable unattended-upgrades
systemctl start unattended-upgrades

log_info "Automatic security updates enabled"

# =============================================================================
# Step 12: nginx Log Rotation
# =============================================================================
log_info "Configuring nginx log rotation..."

cat > /etc/logrotate.d/nginx-sietch << 'EOF'
/var/log/nginx/sietch-*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 www-data adm
    sharedscripts
    postrotate
        [ -f /var/run/nginx.pid ] && kill -USR1 `cat /var/run/nginx.pid`
    endscript
}
EOF

log_info "nginx log rotation configured (14 days retention)"

# =============================================================================
# Step 13: Setup PM2 Startup Script
# =============================================================================
log_info "Configuring PM2 startup..."
pm2 startup systemd -u "$SIETCH_USER" --hp "/home/$SIETCH_USER"

# =============================================================================
# Step 14: Create Useful Scripts
# =============================================================================
log_info "Creating utility scripts..."

# Status check script
cat > "$SIETCH_DIR/scripts/status.sh" << 'EOF'
#!/bin/bash
echo "=== Sietch Service Status ==="
echo ""
echo "PM2 Status:"
pm2 list
echo ""
echo "Disk Usage:"
df -h /opt/sietch
echo ""
echo "Memory Usage:"
free -h
echo ""
echo "API Health Check:"
curl -s http://127.0.0.1:3000/health | jq . || echo "API not responding"
echo ""
echo "Recent Logs (last 20 lines):"
tail -20 /opt/sietch/logs/out.log 2>/dev/null || echo "No logs yet"
EOF
chmod +x "$SIETCH_DIR/scripts/status.sh"

# Restart script
cat > "$SIETCH_DIR/scripts/restart.sh" << 'EOF'
#!/bin/bash
echo "Restarting Sietch service..."
pm2 restart sietch
pm2 save
echo "Done. Status:"
pm2 list
EOF
chmod +x "$SIETCH_DIR/scripts/restart.sh"

# Log viewer script
cat > "$SIETCH_DIR/scripts/logs.sh" << 'EOF'
#!/bin/bash
# Usage: ./logs.sh [lines]
LINES=${1:-100}
echo "=== Sietch Logs (last $LINES lines) ==="
tail -n "$LINES" /opt/sietch/logs/out.log
EOF
chmod +x "$SIETCH_DIR/scripts/logs.sh"

chown -R "$SIETCH_USER:$SIETCH_USER" "$SIETCH_DIR/scripts"

# =============================================================================
# Step 15: Summary
# =============================================================================
log_info "VPS setup complete!"
echo ""
echo "=============================================="
echo "  NEXT STEPS:"
echo "=============================================="
echo ""
echo "1. Edit the environment file:"
echo "   sudo nano $SIETCH_DIR/.env"
echo ""
echo "2. Configure nginx (run as root):"
echo "   Copy nginx config from docs/deployment/configs/nginx-sietch.conf"
echo "   to /etc/nginx/sites-available/sietch"
echo ""
echo "3. Obtain SSL certificate:"
echo "   sudo certbot --nginx -d $DOMAIN"
echo ""
echo "4. Deploy the application:"
echo "   Run the deploy.sh script"
echo ""
echo "5. Start the service:"
echo "   sudo -u $SIETCH_USER pm2 start ecosystem.config.js"
echo "   sudo -u $SIETCH_USER pm2 save"
echo ""
echo "=============================================="
echo ""
log_info "Utility scripts available at $SIETCH_DIR/scripts/"
