# Gateway Prometheus Metrics

The Arrakis gateway exports Prometheus metrics via the HTTP health server on the configured port (default: 9090).

## Scrape Configuration

```yaml
scrape_configs:
  - job_name: arrakis-gateway
    scrape_interval: 15s
    static_configs:
      - targets: ['gateway:9090']
    metrics_path: /metrics
```

## Exported Metrics

### Counters

| Metric | Labels | Description |
|--------|--------|-------------|
| `gateway_events_received_total` | `shard_id`, `event_type` | Total events received from Discord |
| `gateway_events_routed_total` | `shard_id` | Total events successfully published to NATS |
| `gateway_route_failures_total` | `shard_id` | Failed event publishes to NATS |
| `gateway_errors_total` | `shard_id`, `error_type` | Total gateway errors by type |

### Histograms

| Metric | Labels | Description |
|--------|--------|-------------|
| `gateway_event_route_duration_seconds` | `shard_id` | Time to publish an event to NATS (seconds) |

### Gauges

| Metric | Labels | Description |
|--------|--------|-------------|
| `gateway_shards_ready` | `pool_id` | Number of shards in ready state |
| `gateway_guilds_total` | `shard_id` | Total guilds served by each shard |
| `gateway_nats_connected` | — | NATS connection status (1=connected, 0=disconnected) |
| `gateway_last_heartbeat_timestamp` | `shard_id` | Unix timestamp of last Discord heartbeat ack |

## Error Type Labels

The `gateway_errors_total` counter includes an `error_type` label derived from `GatewayError::error_type_label()` (Sprint 6):

| Label | Variant | Meaning |
|-------|---------|---------|
| `circuit_broken` | `ShardCircuitBroken` | Shard exceeded consecutive error threshold |
| `reconnect_failed` | `ShardReconnectFailed` | Fatal gateway reconnection failure |
| `nats_publish` | `NatsPublishFailed` | Failed to publish event to NATS |
| `nats_connection` | `NatsConnectionFailed` | NATS connection lost |
| `serialization` | `SerializationFailed` | Event serialization error |
| `config` | `Config` | Configuration error |
| `shard_overflow` | `ShardIdOverflow` | Shard ID exceeds u32::MAX |
| `receive_error` | (non-fatal) | Transient event receive error |

## Event Type Labels

The `gateway_events_received_total` counter includes an `event_type` label:

| Label | Discord Event |
|-------|--------------|
| `guild_create` | Guild joined |
| `guild_delete` | Guild left |
| `guild_update` | Guild settings changed |
| `member_add` | Member joined |
| `member_remove` | Member left |
| `member_update` | Member roles/nick changed |
| `interaction_create` | Slash command received |
| `ready` | Shard ready |
| `resumed` | Shard resumed |
| `heartbeat_ack` | Discord heartbeat acknowledged |
| `other` | Any other event type |

## Dependencies

- `metrics` crate for metric macros
- `metrics-exporter-prometheus = "0.18"` for Prometheus exposition format
