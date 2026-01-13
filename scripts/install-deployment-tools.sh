#!/bin/bash
# Arrakis Deployment Tools Installer
# Installs: AWS CLI v2, Terraform, Docker

set -e

echo "=========================================="
echo "  Arrakis Deployment Tools Installer"
echo "=========================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

check_installed() {
    if command -v "$1" &> /dev/null; then
        echo -e "${GREEN}✓${NC} $1 already installed: $($1 --version 2>&1 | head -1)"
        return 0
    fi
    return 1
}

# ==========================================
# AWS CLI v2
# ==========================================
echo ""
echo "1/3: AWS CLI v2"
echo "----------------------------------------"

if check_installed aws; then
    echo "  Skipping AWS CLI installation"
else
    echo "  Installing AWS CLI v2..."
    cd /tmp
    curl -sL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
    unzip -q -o awscliv2.zip
    sudo ./aws/install --update
    rm -rf aws awscliv2.zip
    echo -e "${GREEN}✓${NC} AWS CLI installed: $(aws --version)"
fi

# ==========================================
# Terraform
# ==========================================
echo ""
echo "2/3: Terraform"
echo "----------------------------------------"

if check_installed terraform; then
    echo "  Skipping Terraform installation"
else
    echo "  Adding HashiCorp repository..."
    sudo apt-get update -qq
    sudo apt-get install -y -qq gnupg software-properties-common curl

    # Add HashiCorp GPG key
    curl -fsSL https://apt.releases.hashicorp.com/gpg | sudo gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg 2>/dev/null || true

    # Add repository
    echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/hashicorp.list > /dev/null

    # Install
    sudo apt-get update -qq
    sudo apt-get install -y -qq terraform
    echo -e "${GREEN}✓${NC} Terraform installed: $(terraform --version | head -1)"
fi

# ==========================================
# Docker
# ==========================================
echo ""
echo "3/3: Docker"
echo "----------------------------------------"

if check_installed docker; then
    echo "  Skipping Docker installation"
else
    echo "  Installing Docker..."
    sudo apt-get update -qq
    sudo apt-get install -y -qq docker.io

    # Add user to docker group
    sudo usermod -aG docker "$USER"

    echo -e "${GREEN}✓${NC} Docker installed: $(docker --version)"
    echo -e "${YELLOW}!${NC} Log out and back in for Docker group permissions to take effect"
fi

# ==========================================
# Summary
# ==========================================
echo ""
echo "=========================================="
echo "  Installation Complete"
echo "=========================================="
echo ""
echo "Installed versions:"
aws --version 2>/dev/null || echo "  AWS CLI: (restart shell to use)"
terraform --version 2>/dev/null | head -1 || echo "  Terraform: (restart shell to use)"
docker --version 2>/dev/null || echo "  Docker: (restart shell to use)"

echo ""
echo "=========================================="
echo "  Next Steps"
echo "=========================================="
echo ""
echo "1. Configure AWS credentials:"
echo "   ${YELLOW}aws configure${NC}"
echo ""
echo "   You'll need:"
echo "   - AWS Access Key ID"
echo "   - AWS Secret Access Key"
echo "   - Default region: us-east-1"
echo "   - Default output: json"
echo ""
echo "2. Verify AWS access:"
echo "   ${YELLOW}aws sts get-caller-identity${NC}"
echo ""
echo "3. If Docker was just installed, log out and back in,"
echo "   then verify:"
echo "   ${YELLOW}docker run hello-world${NC}"
echo ""
echo "4. Create Terraform state backend (one-time):"
echo "   ${YELLOW}aws s3 mb s3://arrakis-terraform-state --region us-east-1${NC}"
echo "   ${YELLOW}aws dynamodb create-table \\
     --table-name arrakis-terraform-locks \\
     --attribute-definitions AttributeName=LockID,AttributeType=S \\
     --key-schema AttributeName=LockID,KeyType=HASH \\
     --billing-mode PAY_PER_REQUEST \\
     --region us-east-1${NC}"
echo ""
