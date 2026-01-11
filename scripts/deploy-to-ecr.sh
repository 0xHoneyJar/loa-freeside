#!/bin/bash
# =============================================================================
# Arrakis ECR Deployment Script
# =============================================================================
# Builds and pushes the sietch-service Docker image to AWS ECR
# Then forces ECS service to pick up the new image
#
# Usage: ./scripts/deploy-to-ecr.sh [tag]
#   tag: Optional image tag (default: latest)
#
# Prerequisites:
#   - AWS CLI configured with appropriate permissions
#   - Docker daemon running
#   - User in docker group (or run with sudo)
# =============================================================================

set -e

# Configuration
AWS_REGION="us-east-1"
AWS_ACCOUNT_ID="891376933289"
ECR_REPO="arrakis-production-api"
ECS_CLUSTER="arrakis-production-cluster"
ECS_SERVICE_API="arrakis-production-api"
ECS_SERVICE_WORKER="arrakis-production-worker"
IMAGE_TAG="${1:-latest}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# =============================================================================
# Pre-flight Checks
# =============================================================================
echo ""
echo "=========================================="
echo "  Arrakis ECR Deployment"
echo "=========================================="
echo ""

log_info "Running pre-flight checks..."

# Check Docker
if ! command -v docker &> /dev/null; then
    log_error "Docker is not installed. Please install Docker first."
    exit 1
fi

if ! docker info &> /dev/null; then
    log_error "Docker daemon is not running or you don't have permission."
    log_warn "Try: sudo usermod -aG docker \$USER && newgrp docker"
    exit 1
fi
log_success "Docker is available"

# Check AWS CLI
if ! command -v aws &> /dev/null; then
    log_error "AWS CLI is not installed. Run: ./scripts/install-deployment-tools.sh"
    exit 1
fi

# Verify AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
    log_error "AWS credentials not configured. Run: aws configure"
    exit 1
fi
log_success "AWS CLI configured"

# Verify we're in the right directory
if [ ! -f "sietch-service/Dockerfile" ]; then
    log_error "Must run from arrakis root directory (where sietch-service/ exists)"
    exit 1
fi
log_success "In correct directory"

echo ""

# =============================================================================
# Build Docker Image
# =============================================================================
log_info "Building Docker image..."
cd sietch-service

# Build with build args for cache busting
BUILD_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
GIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

docker build \
    --build-arg BUILD_DATE="$BUILD_DATE" \
    --build-arg GIT_SHA="$GIT_SHA" \
    -t "${ECR_REPO}:${IMAGE_TAG}" \
    -t "${ECR_REPO}:${GIT_SHA}" \
    .

log_success "Docker image built: ${ECR_REPO}:${IMAGE_TAG}"
cd ..

# =============================================================================
# Push to ECR
# =============================================================================
log_info "Authenticating with ECR..."
aws ecr get-login-password --region ${AWS_REGION} | \
    docker login --username AWS --password-stdin ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com

log_success "Authenticated with ECR"

log_info "Tagging images for ECR..."
ECR_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO}"

docker tag "${ECR_REPO}:${IMAGE_TAG}" "${ECR_URI}:${IMAGE_TAG}"
docker tag "${ECR_REPO}:${GIT_SHA}" "${ECR_URI}:${GIT_SHA}"

log_info "Pushing images to ECR..."
docker push "${ECR_URI}:${IMAGE_TAG}"
docker push "${ECR_URI}:${GIT_SHA}"

log_success "Images pushed to ECR"

# =============================================================================
# Update ECS Services
# =============================================================================
log_info "Forcing ECS service update (API)..."
aws ecs update-service \
    --cluster ${ECS_CLUSTER} \
    --service ${ECS_SERVICE_API} \
    --force-new-deployment \
    --region ${AWS_REGION} \
    --query 'service.deployments[0].{status:status,running:runningCount,desired:desiredCount}' \
    --output table

log_info "Forcing ECS service update (Worker)..."
aws ecs update-service \
    --cluster ${ECS_CLUSTER} \
    --service ${ECS_SERVICE_WORKER} \
    --force-new-deployment \
    --region ${AWS_REGION} \
    --query 'service.deployments[0].{status:status,running:runningCount,desired:desiredCount}' \
    --output table

log_success "ECS services updated"

# =============================================================================
# Wait for Deployment
# =============================================================================
echo ""
log_info "Waiting for API service to stabilize (this may take 2-5 minutes)..."

if aws ecs wait services-stable \
    --cluster ${ECS_CLUSTER} \
    --services ${ECS_SERVICE_API} \
    --region ${AWS_REGION} 2>/dev/null; then
    log_success "API service is stable!"
else
    log_warn "Timeout waiting for service. Check AWS Console for status."
fi

# =============================================================================
# Deployment Summary
# =============================================================================
echo ""
echo "=========================================="
echo "  Deployment Complete"
echo "=========================================="
echo ""

# Get service status
log_info "Current service status:"
aws ecs describe-services \
    --cluster ${ECS_CLUSTER} \
    --services ${ECS_SERVICE_API} ${ECS_SERVICE_WORKER} \
    --region ${AWS_REGION} \
    --query 'services[*].{Service:serviceName,Status:status,Running:runningCount,Desired:desiredCount}' \
    --output table

# Get ALB DNS
ALB_DNS=$(aws elbv2 describe-load-balancers \
    --names arrakis-production-alb \
    --region ${AWS_REGION} \
    --query 'LoadBalancers[0].DNSName' \
    --output text 2>/dev/null || echo "Unknown")

echo ""
log_info "Load Balancer DNS: ${ALB_DNS}"
log_info "Health check endpoint: https://${ALB_DNS}/health"
echo ""

# Test health endpoint
log_info "Testing health endpoint..."
if curl -sf "https://${ALB_DNS}/health" -o /dev/null 2>/dev/null; then
    log_success "Health check passed!"
else
    log_warn "Health check not responding yet. Service may still be starting."
    log_info "Check logs: aws logs tail /ecs/arrakis-production/api --follow"
fi

echo ""
echo "=========================================="
echo "  Useful Commands"
echo "=========================================="
echo ""
echo "  View API logs:"
echo "    aws logs tail /ecs/arrakis-production/api --follow"
echo ""
echo "  View Worker logs:"
echo "    aws logs tail /ecs/arrakis-production/worker --follow"
echo ""
echo "  Check service status:"
echo "    aws ecs describe-services --cluster ${ECS_CLUSTER} --services ${ECS_SERVICE_API}"
echo ""
echo "  Force redeploy:"
echo "    aws ecs update-service --cluster ${ECS_CLUSTER} --service ${ECS_SERVICE_API} --force-new-deployment"
echo ""
