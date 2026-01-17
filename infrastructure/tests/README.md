# Infrastructure Load Tests

Sprint S-1: Foundation Hardening

## Overview

Load tests for validating infrastructure components at scale. These tests ensure the system meets performance targets before production deployment.

## Tests

### PgBouncer Connection Pool Test

Validates PostgreSQL connection pooling performance.

**Targets:**
- p99 latency < 10ms
- Success rate > 99.9%
- Handle 1000+ concurrent connections
- Zero connection errors under normal load

**Files:**
- `pgbouncer-load.js` - k6 load test script
- `run-db-tests.sh` - Convenience runner script

## Prerequisites

### Install k6

```bash
# macOS
brew install k6

# Linux (Debian/Ubuntu)
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
  --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
  | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6

# Docker
docker pull grafana/k6
```

### Install PostgreSQL Extension

The PgBouncer test requires the `xk6-sql` extension:

```bash
# Install xk6 builder
go install go.k6.io/xk6/cmd/xk6@latest

# Build k6 with PostgreSQL support
xk6 build --with github.com/grafana/xk6-sql

# Move to PATH
mv k6 /usr/local/bin/k6
```

## Usage

### Quick Start

```bash
# Test local PgBouncer
./run-db-tests.sh --local

# Test staging environment
./run-db-tests.sh --staging

# Test production (requires confirmation)
./run-db-tests.sh --production
```

### Direct k6 Execution

```bash
# Basic run
k6 run pgbouncer-load.js

# Custom VUs and duration
k6 run --vus 200 --duration 2m pgbouncer-load.js

# With environment overrides
PGBOUNCER_HOST=custom-host k6 run pgbouncer-load.js
```

### Docker Execution

```bash
docker run --rm -v $(pwd):/scripts \
  -e PGBOUNCER_HOST=host.docker.internal \
  -e PGBOUNCER_PORT=6432 \
  -e DB_USER=arrakis_admin \
  -e DB_PASSWORD=secret \
  grafana/k6 run /scripts/pgbouncer-load.js
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PGBOUNCER_HOST` | localhost | PgBouncer hostname |
| `PGBOUNCER_PORT` | 6432 | PgBouncer port |
| `DB_NAME` | arrakis | Database name |
| `DB_USER` | arrakis_admin | Database user |
| `DB_PASSWORD` | (required) | Database password |

## Test Scenarios

### Steady Load
- Ramp from 0 to 50 VUs over 30s
- Hold at 50 VUs for 1 minute
- Ramp to 100 VUs over 30s
- Hold at 100 VUs for 1 minute
- Ramp down over 30s

### Spike Test
- Starts after steady load completes
- Spike to 200 VUs in 10s
- Hold spike for 30s
- Drop to 0 in 10s

## Output Files

After running, you'll find:

- `pgbouncer-load-results.json` - Summary metrics
- `pgbouncer-load-output.json` - Detailed per-request data

## Interpreting Results

### Success Criteria

```
p99 Latency: < 10ms      Connection pool is responsive
Success Rate: > 99.9%    Minimal query failures
Connection Errors: < 10  Pool handles demand
Query Errors: < 10       Database is stable
```

### Common Issues

**High p99 latency:**
- Increase `DEFAULT_POOL_SIZE` in PgBouncer
- Check PostgreSQL slow query log
- Verify network latency

**Connection errors:**
- Increase `MAX_CLIENT_CONN` in PgBouncer
- Check if RDS is throttling connections
- Verify security groups allow traffic

**Query errors:**
- Check PostgreSQL logs for deadlocks
- Verify RLS policies aren't blocking
- Check for schema migration issues

## CI Integration

```yaml
# .github/workflows/load-test.yml
- name: Run PgBouncer Load Test
  run: |
    cd infrastructure/tests
    ./run-db-tests.sh --staging
  env:
    PGBOUNCER_HOST: ${{ secrets.STAGING_PGBOUNCER_HOST }}
    DB_PASSWORD: ${{ secrets.STAGING_DB_PASSWORD }}
```
