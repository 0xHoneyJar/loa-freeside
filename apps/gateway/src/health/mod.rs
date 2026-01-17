//! Health check endpoints
//!
//! Sprint S-4: Health Endpoints per SDD §8.2

use crate::metrics::GatewayMetrics;
use crate::nats::NatsPublisher;
use crate::shard::ShardState;
use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use serde::Serialize;
use std::sync::Arc;

/// Health check response
#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub status: &'static str,
    pub version: &'static str,
    pub pool_id: u64,
}

/// Readiness check response
#[derive(Debug, Serialize)]
pub struct ReadyResponse {
    pub ready: bool,
    pub pool_id: u64,
    pub shards_total: usize,
    pub shards_ready: usize,
    pub nats_connected: bool,
    pub guilds_total: u64,
}

/// Application state for health endpoints
#[derive(Clone)]
pub struct AppState {
    pub shard_state: ShardState,
    pub nats: Option<Arc<NatsPublisher>>,
    pub metrics: Arc<GatewayMetrics>,
}

/// Create the health check router
pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health_handler))
        .route("/ready", get(ready_handler))
        .route("/metrics", get(metrics_handler))
        .with_state(state)
}

/// Health endpoint - always returns 200 if process is running
async fn health_handler(State(state): State<AppState>) -> impl IntoResponse {
    Json(HealthResponse {
        status: "healthy",
        version: env!("CARGO_PKG_VERSION"),
        pool_id: state.shard_state.pool_id(),
    })
}

/// Readiness endpoint - returns 200 if at least one shard is ready
async fn ready_handler(State(state): State<AppState>) -> impl IntoResponse {
    let shards_ready = state.shard_state.ready_shards();
    let shards_total = state.shard_state.shard_count();
    let nats_connected = state.nats.as_ref().map_or(true, |n| n.is_connected());

    let is_ready = shards_ready > 0 && nats_connected;

    let response = ReadyResponse {
        ready: is_ready,
        pool_id: state.shard_state.pool_id(),
        shards_total,
        shards_ready,
        nats_connected,
        guilds_total: state.shard_state.total_guilds(),
    };

    if is_ready {
        (StatusCode::OK, Json(response))
    } else {
        (StatusCode::SERVICE_UNAVAILABLE, Json(response))
    }
}

/// Metrics endpoint - returns Prometheus format metrics
async fn metrics_handler(State(state): State<AppState>) -> impl IntoResponse {
    // Update current metrics
    state.metrics.set_shards_ready(
        state.shard_state.pool_id(),
        state.shard_state.ready_shards(),
    );

    if let Some(ref nats) = state.nats {
        state.metrics.set_nats_connected(nats.is_connected());
    }

    (
        StatusCode::OK,
        [(axum::http::header::CONTENT_TYPE, "text/plain; charset=utf-8")],
        state.metrics.render(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_health_response_serialization() {
        let response = HealthResponse {
            status: "healthy",
            version: "0.2.0",
            pool_id: 0,
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("healthy"));
    }

    #[test]
    fn test_ready_response_serialization() {
        let response = ReadyResponse {
            ready: true,
            pool_id: 0,
            shards_total: 25,
            shards_ready: 25,
            nats_connected: true,
            guilds_total: 1000,
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("\"ready\":true"));
    }
}
