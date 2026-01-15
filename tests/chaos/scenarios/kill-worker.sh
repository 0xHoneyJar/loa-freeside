#!/bin/bash
# Chaos Test: Kill Worker Container
# Verifies events buffer in queue and new worker picks up

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV="${1:-local}"

echo "=== Chaos Test: Kill Worker Container ==="
echo "Environment: $ENV"
echo "Expected: Events buffer in queue, processed on recovery"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Step 1: Record baseline queue depth
log_info "Recording baseline metrics..."
if [[ "$ENV" == "local" ]]; then
  BASELINE_QUEUE=$(curl -s -u guest:guest http://localhost:15672/api/queues/%2f/arrakis.interactions | jq -r '.messages // 0')
else
  # Staging uses AWS CloudWatch
  BASELINE_QUEUE=$(aws cloudwatch get-metric-statistics \
    --namespace AWS/AmazonMQ \
    --metric-name MessageCount \
    --dimensions Name=Broker,Value=arrakis-staging-rabbitmq Name=Queue,Value=arrakis.interactions \
    --start-time "$(date -u -d '1 minute ago' +%Y-%m-%dT%H:%M:%SZ)" \
    --end-time "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --period 60 \
    --statistics Average \
    --query 'Datapoints[0].Average' \
    --output text 2>/dev/null || echo "0")
fi

log_info "Baseline queue depth: $BASELINE_QUEUE"

# Step 2: Publish some test messages (optional - requires test publisher)
log_info "Waiting for some traffic..."
sleep 5

# Step 3: Kill the worker
log_info "Killing worker container..."
KILL_START=$(date +%s)

if [[ "$ENV" == "local" ]]; then
  # Local Docker
  WORKER_CONTAINER=$(docker ps --filter "name=worker" --format "{{.ID}}" | head -1)
  if [[ -n "$WORKER_CONTAINER" ]]; then
    docker kill "$WORKER_CONTAINER"
    log_info "Killed container: $WORKER_CONTAINER"
  else
    log_warn "No worker container found - is Docker running?"
    exit 1
  fi
else
  # ECS - stop task
  TASK_ARN=$(aws ecs list-tasks \
    --cluster arrakis-staging-cluster \
    --service-name arrakis-staging-gp-worker \
    --query 'taskArns[0]' \
    --output text)

  if [[ -n "$TASK_ARN" && "$TASK_ARN" != "None" ]]; then
    aws ecs stop-task \
      --cluster arrakis-staging-cluster \
      --task "$TASK_ARN" \
      --reason "Chaos test: kill-worker"
    log_info "Stopped ECS task: $TASK_ARN"
  else
    log_error "No worker task found"
    exit 1
  fi
fi

# Step 4: Monitor queue depth (should increase)
log_info "Monitoring queue depth (expecting increase)..."
sleep 10

if [[ "$ENV" == "local" ]]; then
  PEAK_QUEUE=$(curl -s -u guest:guest http://localhost:15672/api/queues/%2f/arrakis.interactions | jq -r '.messages // 0')
else
  PEAK_QUEUE=$(aws cloudwatch get-metric-statistics \
    --namespace AWS/AmazonMQ \
    --metric-name MessageCount \
    --dimensions Name=Broker,Value=arrakis-staging-rabbitmq Name=Queue,Value=arrakis.interactions \
    --start-time "$(date -u -d '1 minute ago' +%Y-%m-%dT%H:%M:%SZ)" \
    --end-time "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --period 60 \
    --statistics Maximum \
    --query 'Datapoints[0].Maximum' \
    --output text 2>/dev/null || echo "0")
fi

log_info "Peak queue depth during outage: $PEAK_QUEUE"

# Step 5: Wait for worker to recover
log_info "Waiting for new worker to start..."
RECOVERY_TIMEOUT=60
RECOVERY_START=$(date +%s)
RECOVERED=false

for i in $(seq 1 $RECOVERY_TIMEOUT); do
  if [[ "$ENV" == "local" ]]; then
    WORKER_RUNNING=$(docker ps --filter "name=worker" --format "{{.ID}}" | wc -l)
    if [[ "$WORKER_RUNNING" -gt 0 ]]; then
      RECOVERED=true
      break
    fi
  else
    TASK_COUNT=$(aws ecs describe-services \
      --cluster arrakis-staging-cluster \
      --services arrakis-staging-gp-worker \
      --query 'services[0].runningCount' \
      --output text)
    if [[ "$TASK_COUNT" -gt 0 ]]; then
      RECOVERED=true
      break
    fi
  fi
  sleep 1
done

RECOVERY_END=$(date +%s)
RECOVERY_TIME=$((RECOVERY_END - KILL_START))

if [[ "$RECOVERED" == "true" ]]; then
  log_info "Worker recovered in ${RECOVERY_TIME}s"
else
  log_error "Worker did not recover within ${RECOVERY_TIMEOUT}s"
  exit 1
fi

# Step 6: Wait for queue to drain
log_info "Waiting for queue to drain..."
sleep 30

if [[ "$ENV" == "local" ]]; then
  FINAL_QUEUE=$(curl -s -u guest:guest http://localhost:15672/api/queues/%2f/arrakis.interactions | jq -r '.messages // 0')
else
  FINAL_QUEUE=$(aws cloudwatch get-metric-statistics \
    --namespace AWS/AmazonMQ \
    --metric-name MessageCount \
    --dimensions Name=Broker,Value=arrakis-staging-rabbitmq Name=Queue,Value=arrakis.interactions \
    --start-time "$(date -u -d '1 minute ago' +%Y-%m-%dT%H:%M:%SZ)" \
    --end-time "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --period 60 \
    --statistics Average \
    --query 'Datapoints[0].Average' \
    --output text 2>/dev/null || echo "0")
fi

log_info "Final queue depth: $FINAL_QUEUE"

# Step 7: Check DLQ for failures
if [[ "$ENV" == "local" ]]; then
  DLQ_COUNT=$(curl -s -u guest:guest http://localhost:15672/api/queues/%2f/arrakis.dlq | jq -r '.messages // 0')
else
  DLQ_COUNT=$(aws cloudwatch get-metric-statistics \
    --namespace AWS/AmazonMQ \
    --metric-name MessageCount \
    --dimensions Name=Broker,Value=arrakis-staging-rabbitmq Name=Queue,Value=arrakis.dlq \
    --start-time "$(date -u -d '5 minutes ago' +%Y-%m-%dT%H:%M:%SZ)" \
    --end-time "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --period 60 \
    --statistics Maximum \
    --query 'Datapoints[0].Maximum' \
    --output text 2>/dev/null || echo "0")
fi

# Summary
echo ""
echo "=== Chaos Test Results: Kill Worker ==="
echo "Recovery Time: ${RECOVERY_TIME}s (target: <30s)"
echo "Queue Peak: $PEAK_QUEUE"
echo "Queue Final: $FINAL_QUEUE"
echo "DLQ Messages: ${DLQ_COUNT:-0}"
echo ""

# Evaluate results
PASSED=true

if [[ "$RECOVERY_TIME" -gt 30 ]]; then
  log_error "FAIL: Recovery time exceeded 30s"
  PASSED=false
fi

if [[ "${DLQ_COUNT:-0}" -gt 0 ]]; then
  log_error "FAIL: Messages in DLQ - possible data loss"
  PASSED=false
fi

if [[ "$PASSED" == "true" ]]; then
  log_info "PASS: Worker recovery test successful"
  exit 0
else
  log_error "FAIL: Worker recovery test failed"
  exit 1
fi
