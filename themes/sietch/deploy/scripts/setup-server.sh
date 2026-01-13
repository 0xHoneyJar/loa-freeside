#!/bin/bash
#
# Server Setup Script for Sietch Service
# Run this on a fresh Ubuntu 22.04+ VPS
#
# Usage: curl -sSL https://raw.githubusercontent.com/.../setup-server.sh | sudo bash
# Or: sudo ./setup-server.sh
#

set -euo pipefail

# Configuration
NODE_VERSION="20"
APP_USER="sietch"
APP_DIR="/opt/sietch-service"
LOG_DIR="/var/log/sietch-service"
DATA_DIR="/opt/sietch-service/data"
BACKUP_DIR="/opt/sietch-backups"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${GREEN}[$(date '+%H:%M:%S')]${NC} $1"; }
warn() { echo -e "${YELLOW}[$(date '+%H:%M:%S')] WARN:${NC} $1"; }
error() { echo -e "${RED}[$(date '+%H:%M:%S')] ERROR:${NC} $1" >&2; }
header() { echo -e "\n${BLUE}=== $1 ===${NC}\n"; }

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    error "Please run as root (sudo)"
    exit 1
fi

header "System Update"
apt-get update
apt-get upgrade -y
apt-get install -y curl wget git build-essential sqlite3 fail2ban ufw

header "Create Application User"
if ! id "$APP_USER" &>/dev/null; then
    useradd -r -m -s /bin/bash "$APP_USER"
    log "Created user: $APP_USER"
else
    log "User $APP_USER already exists"
fi

header "Install Node.js $NODE_VERSION"
if ! command -v node &> /dev/null || ! node -v | grep -q "v$NODE_VERSION"; then
    curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
    apt-get install -y nodejs
    log "Node.js $(node -v) installed"
else
    log "Node.js $(node -v) already installed"
fi

header "Install PM2"
if ! command -v pm2 &> /dev/null; then
    npm install -g pm2
    pm2 startup systemd -u $APP_USER --hp /home/$APP_USER
    log "PM2 installed and startup configured"
else
    log "PM2 already installed"
fi

header "Install Caddy"
if ! command -v caddy &> /dev/null; then
    apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
    apt-get update
    apt-get install -y caddy
    log "Caddy installed"
else
    log "Caddy already installed"
fi

header "Create Directories"
mkdir -p "$APP_DIR" "$LOG_DIR" "$DATA_DIR" "$BACKUP_DIR"
mkdir -p /var/log/caddy
chown -R $APP_USER:$APP_USER "$APP_DIR" "$LOG_DIR" "$DATA_DIR" "$BACKUP_DIR"
chmod 750 "$DATA_DIR"
log "Directories created"

header "Configure Firewall"
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow http
ufw allow https
ufw --force enable
log "Firewall configured (SSH, HTTP, HTTPS allowed)"

header "Configure Fail2ban"
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

[caddy]
enabled = true
port = http,https
filter = caddy
logpath = /var/log/caddy/*.log
maxretry = 10
EOF

cat > /etc/fail2ban/filter.d/caddy.conf << 'EOF'
[Definition]
failregex = ^.*"remote_ip":"<HOST>".*"status":4[0-9][0-9].*$
ignoreregex =
EOF

systemctl restart fail2ban
log "Fail2ban configured"

header "Install Monitoring Stack"
# Prometheus Node Exporter
if ! command -v node_exporter &> /dev/null; then
    NODE_EXPORTER_VERSION="1.7.0"
    cd /tmp
    wget -q https://github.com/prometheus/node_exporter/releases/download/v${NODE_EXPORTER_VERSION}/node_exporter-${NODE_EXPORTER_VERSION}.linux-amd64.tar.gz
    tar xzf node_exporter-${NODE_EXPORTER_VERSION}.linux-amd64.tar.gz
    cp node_exporter-${NODE_EXPORTER_VERSION}.linux-amd64/node_exporter /usr/local/bin/
    rm -rf node_exporter-*

    cat > /etc/systemd/system/node_exporter.service << 'EOF'
[Unit]
Description=Node Exporter
After=network.target

[Service]
User=nobody
ExecStart=/usr/local/bin/node_exporter
Restart=always

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable node_exporter
    systemctl start node_exporter
    log "Node Exporter installed"
else
    log "Node Exporter already installed"
fi

# Prometheus
if ! command -v prometheus &> /dev/null; then
    PROMETHEUS_VERSION="2.48.0"
    cd /tmp
    wget -q https://github.com/prometheus/prometheus/releases/download/v${PROMETHEUS_VERSION}/prometheus-${PROMETHEUS_VERSION}.linux-amd64.tar.gz
    tar xzf prometheus-${PROMETHEUS_VERSION}.linux-amd64.tar.gz
    cp prometheus-${PROMETHEUS_VERSION}.linux-amd64/{prometheus,promtool} /usr/local/bin/
    mkdir -p /etc/prometheus /var/lib/prometheus
    cp -r prometheus-${PROMETHEUS_VERSION}.linux-amd64/{consoles,console_libraries} /etc/prometheus/
    rm -rf prometheus-*

    cat > /etc/prometheus/prometheus.yml << 'EOF'
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']

  - job_name: 'node'
    static_configs:
      - targets: ['localhost:9100']

  - job_name: 'sietch'
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: /metrics
EOF

    cat > /etc/systemd/system/prometheus.service << 'EOF'
[Unit]
Description=Prometheus
After=network.target

[Service]
User=nobody
ExecStart=/usr/local/bin/prometheus \
  --config.file=/etc/prometheus/prometheus.yml \
  --storage.tsdb.path=/var/lib/prometheus \
  --storage.tsdb.retention.time=30d \
  --web.listen-address=127.0.0.1:9090
Restart=always

[Install]
WantedBy=multi-user.target
EOF

    chown -R nobody:nogroup /var/lib/prometheus
    systemctl daemon-reload
    systemctl enable prometheus
    systemctl start prometheus
    log "Prometheus installed"
else
    log "Prometheus already installed"
fi

# Grafana
if ! command -v grafana-server &> /dev/null; then
    apt-get install -y apt-transport-https software-properties-common
    wget -q -O /usr/share/keyrings/grafana.key https://apt.grafana.com/gpg.key
    echo "deb [signed-by=/usr/share/keyrings/grafana.key] https://apt.grafana.com stable main" | tee /etc/apt/sources.list.d/grafana.list
    apt-get update
    apt-get install -y grafana

    # Configure Grafana to listen on localhost only
    sed -i 's/;http_port = 3000/http_port = 3001/' /etc/grafana/grafana.ini
    sed -i 's/;http_addr =/http_addr = 127.0.0.1/' /etc/grafana/grafana.ini

    systemctl daemon-reload
    systemctl enable grafana-server
    systemctl start grafana-server
    log "Grafana installed (port 3001)"
else
    log "Grafana already installed"
fi

header "Configure Log Rotation"
cat > /etc/logrotate.d/sietch-service << 'EOF'
/var/log/sietch-service/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 sietch sietch
    sharedscripts
    postrotate
        pm2 reloadLogs 2>/dev/null || true
    endscript
}
EOF
log "Log rotation configured"

header "Setup Complete!"
echo ""
log "Next steps:"
echo "  1. Clone your application to $APP_DIR"
echo "  2. Copy .env file to $APP_DIR/.env"
echo "  3. Configure Caddy: sudo cp deploy/configs/Caddyfile /etc/caddy/Caddyfile"
echo "  4. Update domain in Caddyfile: sudo nano /etc/caddy/Caddyfile"
echo "  5. Start Caddy: sudo systemctl reload caddy"
echo "  6. Deploy with GitHub Actions"
echo ""
log "Monitoring URLs (after Caddy config):"
echo "  - Grafana: https://grafana.yourdomain.com (default: admin/admin)"
echo "  - Prometheus: localhost:9090 (internal only)"
echo ""
