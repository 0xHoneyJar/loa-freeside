# Sprint S-3: Engineer Review Feedback

**Sprint**: S-3 (ScyllaDB & Observability Foundation)
**Reviewer**: Senior Technical Lead
**Date**: 2026-01-15
**Status**: APPROVED

## Verdict

**All good**

## Review Summary

Sprint S-3 completes Phase 1 (Foundation Hardening) with a solid implementation of ScyllaDB integration and comprehensive observability infrastructure. The code quality is production-ready.

## Detailed Review

### ScyllaDB Schema (schema.cql)

| Aspect | Assessment |
|--------|------------|
| Partition key design | Correct - optimized for access patterns |
| Clustering keys | Proper ordering for leaderboard queries |
| Compaction strategies | LeveledCompaction for scores, TimeWindowCompaction for history |
| TTLs | Appropriate (90 days history, 5 min eligibility cache) |
| Indexes | Single index on wallet_address - acceptable for eligibility lookups |

The dual-table pattern (`scores` + `scores_by_profile`) is the right call. Trading write amplification for single-partition reads on both access patterns is correct for this workload.

### ScyllaClient Implementation (scylla-client.ts)

| Aspect | Assessment |
|--------|------------|
| Connection handling | Proper lifecycle with connect/close |
| Consistency level | LOCAL_QUORUM - correct choice |
| Batch operations | 50-item batches avoid ScyllaDB limits |
| Error handling | Metrics tracked, errors propagated |
| Type safety | Strong typing throughout |

The batch size of 50 is conservative but safe. ScyllaDB's batch size warnings trigger around 5KB, and 50 scores with all fields should stay well under that.

### Observability Stack

**Prometheus Configuration (prometheus.yml)**
- Kubernetes service discovery properly configured
- All required scrape targets present (gateway, worker, NATS, Redis, PostgreSQL, ScyllaDB)
- Appropriate relabel configs for pod metadata
- 15s scrape interval is reasonable for this workload

**Grafana Dashboards**
- Gateway dashboard covers key metrics: events/sec, routing latency p99, shard status, NATS failures
- Proper threshold configuration (yellow at 20ms, red at 50ms for latency)
- 30s refresh rate appropriate for operational use

**Alert Rules (alerts.yml)**
- Comprehensive coverage across all components (7 alert groups)
- Sensible thresholds:
  - Gateway: 50ms p99 latency warning, shard down critical
  - Worker: 1% error rate critical, 2s p95 processing latency
  - RPC: Circuit breaker monitoring, all-providers-down critical
  - ScyllaDB: Connection failures, 100ms query latency
- Appropriate `for` durations to prevent alert flapping
- Runbook URLs included (internal wiki references)

### Test Coverage (scylla-client.test.ts)

- Connection lifecycle tested
- CRUD operations covered
- Batch operations validated (100 scores → 4 batches)
- Cache hit/miss tracking verified
- Prometheus format export tested

Mock approach using `vi.mock('cassandra-driver')` is appropriate for unit tests.

### Metrics Infrastructure (metrics.ts)

- Standard prom-client patterns
- Appropriate histogram buckets for different latency profiles
- Helper functions for common operations
- Registry isolation prevents metric conflicts

## Architecture Decisions Validated

| Decision | Rationale | Verdict |
|----------|-----------|---------|
| AD-S3.1: ScyllaDB Serverless | Pay-per-operation, no ops overhead | Correct |
| AD-S3.2: Dual-table scores | Optimizes both access patterns | Correct |
| AD-S3.3: Time-bucketed history | Prevents partition hot spots | Correct |
| AD-S3.4: Prometheus metrics | Industry standard, Grafana native | Correct |

## Minor Notes (Not Blocking)

1. **Migration script dry-run**: Recommend running `--dry-run` first in production to validate data shape
2. **Alert thresholds**: May need tuning after production baseline established
3. **ScyllaDB Cloud VPC peering**: Manual setup required per README - not automated

## Dependencies Verified

- `cassandra-driver@^4.7.2` - Standard Cassandra/ScyllaDB driver
- `prom-client@^15.1.0` - Official Prometheus client for Node.js

Both are well-maintained, widely-used packages.

## Phase 1 Completion

With this sprint approved, Phase 1 (Foundation Hardening) is complete:
- [x] S-1: Rust Toolchain & PostgreSQL Enhancement
- [x] S-2: RPC Pool & Circuit Breakers
- [x] S-3: ScyllaDB & Observability Foundation

Ready for Phase 2: Rust Gateway & NATS.
