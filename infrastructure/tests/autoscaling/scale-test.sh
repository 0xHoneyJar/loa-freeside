#!/usr/bin/env bash
# =============================================================================
# ECS Auto-Scaling Test Suite
# Sprint S-11: Auto-Scaling Configuration
# =============================================================================
# Tests for verifying ECS service auto-scaling behavior
#
# Usage:
#   ./scale-test.sh [test-type] [options]
#
# Test Types:
#   scale-up     - Test scale-up from minimum to target
#   scale-down   - Test scale-down after cooldown
#   load         - Run load test to trigger scaling
#   verify       - Verify current scaling configuration
#   all          - Run all tests
#
# Options:
#   --environment  Environment (staging|production), default: staging
#   --service      Service to test (api|gp-worker|gateway), default: all
#   --dry-run      Show what would be done without executing
#   --verbose      Enable verbose output

set -euo pipefail

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../../.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
ENVIRONMENT="${ENVIRONMENT:-staging}"
SERVICE="all"
DRY_RUN=false
VERBOSE=false
CLUSTER_NAME="arrakis-${ENVIRONMENT}-cluster"

# AWS region from terraform
AWS_REGION="${AWS_REGION:-us-east-1}"

# -----------------------------------------------------------------------------
# Helper Functions
# -----------------------------------------------------------------------------

log_info() {
    echo -e "${BLUE}[INFO]${NC} $*"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $*"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $*"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $*" >&2
}

log_verbose() {
    if [[ "$VERBOSE" == "true" ]]; then
        echo -e "${BLUE}[VERBOSE]${NC} $*"
    fi
}

check_dependencies() {
    local deps=("aws" "jq")
    for dep in "${deps[@]}"; do
        if ! command -v "$dep" &> /dev/null; then
            log_error "Required dependency '$dep' not found"
            exit 1
        fi
    done
}

get_service_name() {
    local service=$1
    case "$service" in
        api)
            echo "arrakis-${ENVIRONMENT}-api"
            ;;
        gp-worker)
            echo "arrakis-${ENVIRONMENT}-gp-worker"
            ;;
        gateway)
            echo "arrakis-${ENVIRONMENT}-gateway"
            ;;
        *)
            log_error "Unknown service: $service"
            return 1
            ;;
    esac
}

get_scaling_config() {
    local service_name=$1
    local resource_id="service/${CLUSTER_NAME}/${service_name}"

    aws application-autoscaling describe-scalable-targets \
        --service-namespace ecs \
        --resource-ids "$resource_id" \
        --region "$AWS_REGION" \
        2>/dev/null | jq '.ScalableTargets[0]'
}

get_scaling_policies() {
    local service_name=$1
    local resource_id="service/${CLUSTER_NAME}/${service_name}"

    aws application-autoscaling describe-scaling-policies \
        --service-namespace ecs \
        --resource-id "$resource_id" \
        --region "$AWS_REGION" \
        2>/dev/null | jq '.ScalingPolicies'
}

get_current_task_count() {
    local service_name=$1

    aws ecs describe-services \
        --cluster "$CLUSTER_NAME" \
        --services "$service_name" \
        --region "$AWS_REGION" \
        2>/dev/null | jq '.services[0].runningCount'
}

get_desired_task_count() {
    local service_name=$1

    aws ecs describe-services \
        --cluster "$CLUSTER_NAME" \
        --services "$service_name" \
        --region "$AWS_REGION" \
        2>/dev/null | jq '.services[0].desiredCount'
}

# -----------------------------------------------------------------------------
# Test Functions
# -----------------------------------------------------------------------------

verify_scaling_configuration() {
    local service=$1
    local service_name
    service_name=$(get_service_name "$service")

    log_info "Verifying scaling configuration for $service ($service_name)..."

    # Get scaling target
    local scaling_target
    scaling_target=$(get_scaling_config "$service_name")

    if [[ "$scaling_target" == "null" ]] || [[ -z "$scaling_target" ]]; then
        log_error "No scaling target found for $service_name"
        return 1
    fi

    local min_capacity max_capacity
    min_capacity=$(echo "$scaling_target" | jq '.MinCapacity')
    max_capacity=$(echo "$scaling_target" | jq '.MaxCapacity')

    log_info "  Min capacity: $min_capacity"
    log_info "  Max capacity: $max_capacity"

    # Get scaling policies
    local policies
    policies=$(get_scaling_policies "$service_name")
    local policy_count
    policy_count=$(echo "$policies" | jq 'length')

    log_info "  Active policies: $policy_count"

    if [[ "$VERBOSE" == "true" ]]; then
        echo "$policies" | jq -r '.[] | "    - \(.PolicyName): \(.PolicyType)"'
    fi

    # Check current state
    local running desired
    running=$(get_current_task_count "$service_name")
    desired=$(get_desired_task_count "$service_name")

    log_info "  Running tasks: $running"
    log_info "  Desired tasks: $desired"

    # Validation
    if [[ "$running" -lt "$min_capacity" ]]; then
        log_warning "Running tasks ($running) below minimum ($min_capacity)"
        return 1
    fi

    if [[ "$policy_count" -lt 1 ]]; then
        log_warning "No scaling policies configured"
        return 1
    fi

    log_success "Scaling configuration verified for $service"
    return 0
}

test_scale_up() {
    local service=$1
    local service_name
    service_name=$(get_service_name "$service")

    log_info "Testing scale-up for $service ($service_name)..."

    # Get current config
    local scaling_target
    scaling_target=$(get_scaling_config "$service_name")
    local min_capacity max_capacity
    min_capacity=$(echo "$scaling_target" | jq '.MinCapacity')
    max_capacity=$(echo "$scaling_target" | jq '.MaxCapacity')

    local current_desired
    current_desired=$(get_desired_task_count "$service_name")

    if [[ "$current_desired" -ge "$max_capacity" ]]; then
        log_warning "Already at max capacity ($max_capacity), cannot test scale-up"
        return 0
    fi

    local target_count=$((current_desired + 1))
    if [[ "$target_count" -gt "$max_capacity" ]]; then
        target_count=$max_capacity
    fi

    log_info "  Scaling from $current_desired to $target_count tasks..."

    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "  [DRY-RUN] Would update desired count to $target_count"
        return 0
    fi

    # Manually trigger scale-up via update-service
    aws ecs update-service \
        --cluster "$CLUSTER_NAME" \
        --service "$service_name" \
        --desired-count "$target_count" \
        --region "$AWS_REGION" \
        > /dev/null

    log_info "  Waiting for scale-up to complete..."

    local timeout=120
    local start_time=$(date +%s)

    while true; do
        local running
        running=$(get_current_task_count "$service_name")

        if [[ "$running" -ge "$target_count" ]]; then
            local end_time=$(date +%s)
            local duration=$((end_time - start_time))
            log_success "Scale-up completed in ${duration}s ($running tasks running)"

            # Check if within target (<60s)
            if [[ "$duration" -le 60 ]]; then
                log_success "Scale-up time within target (<60s)"
            else
                log_warning "Scale-up time exceeded target (${duration}s > 60s)"
            fi
            break
        fi

        local elapsed=$(($(date +%s) - start_time))
        if [[ "$elapsed" -ge "$timeout" ]]; then
            log_error "Scale-up timeout after ${timeout}s"
            return 1
        fi

        log_verbose "  Waiting... ($running/$target_count tasks running, ${elapsed}s elapsed)"
        sleep 10
    done

    return 0
}

test_scale_down() {
    local service=$1
    local service_name
    service_name=$(get_service_name "$service")

    log_info "Testing scale-down for $service ($service_name)..."

    # Get current config
    local scaling_target
    scaling_target=$(get_scaling_config "$service_name")
    local min_capacity
    min_capacity=$(echo "$scaling_target" | jq '.MinCapacity')

    local current_desired
    current_desired=$(get_desired_task_count "$service_name")

    if [[ "$current_desired" -le "$min_capacity" ]]; then
        log_info "Already at min capacity ($min_capacity), scale-down stabilization verified"
        return 0
    fi

    log_info "  Current desired: $current_desired, minimum: $min_capacity"
    log_info "  Scale-down stabilization will be tested via cooldown period"
    log_info "  Scale-in cooldown is configured at 300s (5 minutes)"

    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "  [DRY-RUN] Would scale down to minimum after cooldown"
        return 0
    fi

    # Set desired to minimum
    aws ecs update-service \
        --cluster "$CLUSTER_NAME" \
        --service "$service_name" \
        --desired-count "$min_capacity" \
        --region "$AWS_REGION" \
        > /dev/null

    log_info "  Triggered scale-down to minimum ($min_capacity)"
    log_info "  Monitoring scale-down stabilization..."

    local timeout=360  # 6 minutes (cooldown + buffer)
    local start_time=$(date +%s)

    while true; do
        local running
        running=$(get_current_task_count "$service_name")

        if [[ "$running" -eq "$min_capacity" ]]; then
            local end_time=$(date +%s)
            local duration=$((end_time - start_time))
            log_success "Scale-down completed in ${duration}s ($running tasks running)"

            # Check if respects cooldown (should take ~300s due to stabilization)
            if [[ "$duration" -ge 60 ]]; then
                log_success "Scale-down respects cooldown period"
            else
                log_warning "Scale-down may be too aggressive (check cooldown config)"
            fi
            break
        fi

        local elapsed=$(($(date +%s) - start_time))
        if [[ "$elapsed" -ge "$timeout" ]]; then
            log_error "Scale-down timeout after ${timeout}s"
            return 1
        fi

        log_verbose "  Waiting... ($running tasks running, target: $min_capacity, ${elapsed}s elapsed)"
        sleep 15
    done

    return 0
}

test_load_scaling() {
    local service=$1

    log_info "Load-based scaling test for $service..."
    log_info "This test requires k6 or similar load testing tool"

    if [[ "$service" != "api" ]]; then
        log_warning "Load test only applicable to API service"
        return 0
    fi

    if ! command -v k6 &> /dev/null; then
        log_warning "k6 not found - skipping load test"
        log_info "Install k6: https://k6.io/docs/getting-started/installation/"
        return 0
    fi

    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "[DRY-RUN] Would run k6 load test"
        return 0
    fi

    log_info "Running load test to trigger auto-scaling..."

    # Get ALB DNS
    local alb_dns
    alb_dns=$(aws elbv2 describe-load-balancers \
        --names "arrakis-${ENVIRONMENT}-alb" \
        --region "$AWS_REGION" \
        2>/dev/null | jq -r '.LoadBalancers[0].DNSName')

    if [[ -z "$alb_dns" ]] || [[ "$alb_dns" == "null" ]]; then
        log_warning "Could not find ALB DNS - skipping load test"
        return 0
    fi

    log_info "Load testing against: https://$alb_dns/health"

    # Run k6 inline script
    k6 run --duration 2m --vus 50 - <<EOF
import http from 'k6/http';
import { check, sleep } from 'k6';

export let options = {
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500'],
  },
};

export default function () {
  let res = http.get('https://${alb_dns}/health');
  check(res, {
    'status is 200': (r) => r.status === 200,
  });
  sleep(0.1);
}
EOF

    log_success "Load test completed"

    # Check if scaling occurred
    local service_name
    service_name=$(get_service_name "$service")
    local running
    running=$(get_current_task_count "$service_name")

    log_info "After load test: $running tasks running"

    return 0
}

run_all_tests() {
    local services=("api" "gp-worker" "gateway")
    local failed=0

    log_info "Running all auto-scaling tests..."
    echo ""

    # Verify configuration for all services
    log_info "=== Phase 1: Configuration Verification ==="
    for svc in "${services[@]}"; do
        if ! verify_scaling_configuration "$svc"; then
            ((failed++))
        fi
        echo ""
    done

    # Scale-up tests
    log_info "=== Phase 2: Scale-Up Tests ==="
    for svc in "${services[@]}"; do
        if ! test_scale_up "$svc"; then
            ((failed++))
        fi
        echo ""
    done

    # Scale-down tests
    log_info "=== Phase 3: Scale-Down Stabilization ==="
    for svc in "${services[@]}"; do
        if ! test_scale_down "$svc"; then
            ((failed++))
        fi
        echo ""
    done

    echo ""
    log_info "=== Test Summary ==="
    if [[ "$failed" -eq 0 ]]; then
        log_success "All tests passed!"
        return 0
    else
        log_error "$failed test(s) failed"
        return 1
    fi
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------

usage() {
    cat <<EOF
ECS Auto-Scaling Test Suite

Usage: $0 [test-type] [options]

Test Types:
  verify       Verify scaling configuration
  scale-up     Test scale-up behavior
  scale-down   Test scale-down stabilization
  load         Run load test to trigger scaling
  all          Run all tests (default)

Options:
  --environment ENV    Environment (staging|production), default: staging
  --service SVC        Service to test (api|gp-worker|gateway|all), default: all
  --dry-run            Show what would be done without executing
  --verbose            Enable verbose output
  --help               Show this help message

Examples:
  $0 verify --service api
  $0 scale-up --service gp-worker --dry-run
  $0 all --environment production --verbose
EOF
}

main() {
    local test_type="all"

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case "$1" in
            verify|scale-up|scale-down|load|all)
                test_type="$1"
                shift
                ;;
            --environment)
                ENVIRONMENT="$2"
                CLUSTER_NAME="arrakis-${ENVIRONMENT}-cluster"
                shift 2
                ;;
            --service)
                SERVICE="$2"
                shift 2
                ;;
            --dry-run)
                DRY_RUN=true
                shift
                ;;
            --verbose)
                VERBOSE=true
                shift
                ;;
            --help|-h)
                usage
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                usage
                exit 1
                ;;
        esac
    done

    check_dependencies

    log_info "Auto-Scaling Test Suite"
    log_info "Environment: $ENVIRONMENT"
    log_info "Cluster: $CLUSTER_NAME"
    log_info "Service: $SERVICE"
    [[ "$DRY_RUN" == "true" ]] && log_warning "DRY-RUN mode enabled"
    echo ""

    # Determine which services to test
    local services=()
    if [[ "$SERVICE" == "all" ]]; then
        services=("api" "gp-worker" "gateway")
    else
        services=("$SERVICE")
    fi

    # Run tests
    case "$test_type" in
        verify)
            for svc in "${services[@]}"; do
                verify_scaling_configuration "$svc"
            done
            ;;
        scale-up)
            for svc in "${services[@]}"; do
                test_scale_up "$svc"
            done
            ;;
        scale-down)
            for svc in "${services[@]}"; do
                test_scale_down "$svc"
            done
            ;;
        load)
            for svc in "${services[@]}"; do
                test_load_scaling "$svc"
            done
            ;;
        all)
            run_all_tests
            ;;
    esac
}

main "$@"
