# Gateway Proxy Chaos Testing

Chaos tests verify the system's resilience under failure conditions.

## Prerequisites

- Docker and Docker Compose
- AWS CLI (for ECS chaos on staging)
- Services running (Ingestor, Worker, RabbitMQ)

## Test Scenarios

### Scenario 1: Kill Worker Container
**Impact**: Events buffer in queue, new worker picks up
**Recovery Time Target**: < 30 seconds

```bash
# Local (Docker)
./tests/chaos/scenarios/kill-worker.sh

# Staging (ECS)
./tests/chaos/scenarios/kill-worker.sh --env staging
```

### Scenario 2: Kill Ingestor Container
**Impact**: Gateway reconnects, no event loss
**Recovery Time Target**: < 60 seconds (Discord reconnect)

```bash
./tests/chaos/scenarios/kill-ingestor.sh
```

### Scenario 3: RabbitMQ Connection Drop
**Impact**: Both services reconnect automatically
**Recovery Time Target**: < 10 seconds

```bash
./tests/chaos/scenarios/rabbitmq-disconnect.sh
```

### Scenario 4: Redis Unavailable
**Impact**: Graceful degradation, sessions unavailable
**Recovery Time Target**: Immediate (degraded mode)

```bash
./tests/chaos/scenarios/redis-unavailable.sh
```

### Scenario 5: Database Connection Pool Exhaustion
**Impact**: Circuit breaker triggers, queue backs up
**Recovery Time Target**: < 60 seconds (pool refresh)

```bash
./tests/chaos/scenarios/db-pool-exhaustion.sh
```

## Running All Chaos Tests

```bash
# Run all scenarios sequentially
./tests/chaos/run-all.sh

# Run specific scenario
./tests/chaos/run-all.sh --scenario kill-worker
```

## Expected Results

| Scenario | Data Loss | Recovery Time | Alerts |
|----------|-----------|---------------|--------|
| Kill Worker | NONE | < 30s | gp-worker-no-tasks |
| Kill Ingestor | NONE | < 60s | ingestor-no-tasks |
| RabbitMQ Disconnect | NONE | < 10s | None expected |
| Redis Unavailable | Sessions only | Immediate | redis-connection |
| DB Pool Exhaustion | NONE | < 60s | db-connection |

## Verification Checklist

After each test:
1. [ ] Verify no messages in DLQ
2. [ ] Verify queue depth returns to baseline
3. [ ] Verify all alarms resolved
4. [ ] Verify logs show recovery
5. [ ] Verify metrics show recovery time
