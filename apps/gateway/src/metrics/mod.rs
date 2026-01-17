//! Prometheus metrics module
//!
//! Sprint S-4: Gateway Metrics per SDD §10.1.1

use metrics::{counter, gauge, histogram, describe_counter, describe_gauge, describe_histogram, Unit};
use metrics_exporter_prometheus::{PrometheusBuilder, PrometheusHandle};
use std::sync::Arc;
use std::time::Duration;
use twilight_model::gateway::event::Event;

/// Gateway metrics collector
#[derive(Clone)]
pub struct GatewayMetrics {
    handle: Arc<PrometheusHandle>,
}

impl GatewayMetrics {
    /// Initialize metrics and return handle
    pub fn new() -> Self {
        let handle = PrometheusBuilder::new()
            .install_recorder()
            .expect("Failed to install Prometheus recorder");

        // Register metric descriptions
        Self::register_metrics();

        Self {
            handle: Arc::new(handle),
        }
    }

    /// Register metric descriptions
    fn register_metrics() {
        // Event counters
        describe_counter!(
            "gateway_events_received_total",
            Unit::Count,
            "Total events received from Discord"
        );
        describe_counter!(
            "gateway_events_routed_total",
            Unit::Count,
            "Total events routed to NATS"
        );
        describe_counter!(
            "gateway_route_failures_total",
            Unit::Count,
            "Failed event routes to NATS"
        );
        describe_counter!(
            "gateway_errors_total",
            Unit::Count,
            "Total gateway errors"
        );

        // Latency histogram
        describe_histogram!(
            "gateway_event_route_duration_seconds",
            Unit::Seconds,
            "Time to route event to NATS"
        );

        // Gauges
        describe_gauge!(
            "gateway_shards_ready",
            Unit::Count,
            "Number of shards in ready state"
        );
        describe_gauge!(
            "gateway_guilds_total",
            Unit::Count,
            "Total guilds across all shards"
        );
        describe_gauge!(
            "gateway_nats_connected",
            Unit::Count,
            "NATS connection status (1=connected, 0=disconnected)"
        );
    }

    /// Record an event received
    pub fn record_event(&self, shard_id: u64, event: &Event) {
        let event_type = match event {
            Event::GuildCreate(_) => "guild_create",
            Event::GuildDelete(_) => "guild_delete",
            Event::GuildUpdate(_) => "guild_update",
            Event::MemberAdd(_) => "member_add",
            Event::MemberRemove(_) => "member_remove",
            Event::MemberUpdate(_) => "member_update",
            Event::InteractionCreate(_) => "interaction_create",
            Event::Ready(_) => "ready",
            Event::Resumed => "resumed",
            Event::GatewayHeartbeatAck => "heartbeat_ack",
            _ => "other",
        };

        counter!(
            "gateway_events_received_total",
            "shard_id" => shard_id.to_string(),
            "event_type" => event_type
        )
        .increment(1);
    }

    /// Record successful route to NATS
    pub fn record_route_success(&self, shard_id: u64, duration: Duration) {
        counter!(
            "gateway_events_routed_total",
            "shard_id" => shard_id.to_string()
        )
        .increment(1);

        histogram!(
            "gateway_event_route_duration_seconds",
            "shard_id" => shard_id.to_string()
        )
        .record(duration.as_secs_f64());
    }

    /// Record failed route
    pub fn record_route_failure(&self, shard_id: u64) {
        counter!(
            "gateway_route_failures_total",
            "shard_id" => shard_id.to_string()
        )
        .increment(1);
    }

    /// Record gateway error
    pub fn record_error(&self, shard_id: u64) {
        counter!(
            "gateway_errors_total",
            "shard_id" => shard_id.to_string()
        )
        .increment(1);
    }

    /// Record heartbeat
    pub fn record_heartbeat(&self, shard_id: u64) {
        // Heartbeats are frequent, just update a gauge
        gauge!(
            "gateway_last_heartbeat_timestamp",
            "shard_id" => shard_id.to_string()
        )
        .set(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs() as f64,
        );
    }

    /// Set guild count for a shard
    pub fn set_guilds(&self, shard_id: u64, count: u64) {
        gauge!(
            "gateway_guilds_total",
            "shard_id" => shard_id.to_string()
        )
        .set(count as f64);
    }

    /// Set shards ready count
    pub fn set_shards_ready(&self, pool_id: u64, count: usize) {
        gauge!(
            "gateway_shards_ready",
            "pool_id" => pool_id.to_string()
        )
        .set(count as f64);
    }

    /// Set NATS connection status
    pub fn set_nats_connected(&self, connected: bool) {
        gauge!("gateway_nats_connected").set(if connected { 1.0 } else { 0.0 });
    }

    /// Render metrics in Prometheus format
    pub fn render(&self) -> String {
        self.handle.render()
    }
}

impl Default for GatewayMetrics {
    fn default() -> Self {
        Self::new()
    }
}
