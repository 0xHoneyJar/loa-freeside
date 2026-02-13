//! Arrakis Gateway - Rust Discord Gateway using Twilight
//!
//! Sprint S-4: Twilight Gateway Core
//!
//! This is a scalable Discord gateway that:
//! - Manages multiple shards per process (shard pool)
//! - Serializes events and publishes to NATS JetStream
//! - Exposes health/ready endpoints for Kubernetes
//! - Exports Prometheus metrics for observability

use anyhow::Result;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::signal;
use tracing::{error, info};

mod config;
pub mod error;
mod events;
mod health;
mod metrics;
mod nats;
mod shard;

use config::GatewayConfig;
use health::AppState;
use metrics::GatewayMetrics;
use nats::NatsPublisher;
use shard::ShardPool;

#[tokio::main]
async fn main() -> Result<()> {
    // Load configuration first to get log level
    let gateway_config = GatewayConfig::from_env()?;

    // Initialize tracing with configured log level
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive(format!("arrakis_gateway={}", gateway_config.log_level).parse()?)
                .add_directive("twilight_gateway=info".parse()?)
                .add_directive("async_nats=warn".parse()?),
        )
        .json()
        .init();

    info!(
        version = env!("CARGO_PKG_VERSION"),
        pool_id = gateway_config.pool_id,
        total_shards = gateway_config.total_shards,
        "Starting Arrakis Gateway"
    );

    // Initialize metrics
    let metrics = Arc::new(GatewayMetrics::new());
    info!("Prometheus metrics initialized");

    // Connect to NATS if configured
    let nats = if let Some(ref url) = gateway_config.nats_url {
        match NatsPublisher::connect(url).await {
            Ok(publisher) => {
                info!(url, "Connected to NATS");
                metrics.set_nats_connected(true);
                Some(publisher)
            }
            Err(e) => {
                error!(error = %e, "Failed to connect to NATS - running in local mode");
                metrics.set_nats_connected(false);
                None
            }
        }
    } else {
        info!("No NATS_URL configured - running in local mode");
        None
    };

    // Get Discord intents
    let intents = GatewayConfig::intents();
    info!(?intents, "Using Discord intents");

    // Create shard pool
    let pool = ShardPool::new(
        gateway_config.pool_id,
        gateway_config.total_shards,
        gateway_config.discord_token.clone(),
        intents,
        nats.clone(),
        Arc::clone(&metrics),
    )
    .await?;

    let pool_state = pool.state();
    info!(
        pool_id = gateway_config.pool_id,
        shard_count = pool_state.shard_count(),
        "Shard pool created"
    );

    // Start health server
    let app_state = AppState {
        shard_state: pool_state.clone(),
        nats: nats.clone(),
        metrics: Arc::clone(&metrics),
    };

    let health_router = health::router(app_state);
    let addr: SocketAddr = ([0, 0, 0, 0], gateway_config.http_port).into();

    info!(port = gateway_config.http_port, "Starting HTTP server");

    let http_server = axum::serve(
        tokio::net::TcpListener::bind(addr).await?,
        health_router,
    );

    // Run everything concurrently
    tokio::select! {
        result = pool.run() => {
            if let Err(e) = result {
                error!(error = %e, "Shard pool error");
            }
        }
        result = http_server => {
            if let Err(e) = result {
                error!(error = %e, "HTTP server error");
            }
        }
        _ = shutdown_signal() => {
            info!("Shutdown signal received");
        }
    }

    // Graceful shutdown
    info!("Shutting down gateway...");

    if let Some(ref nats) = nats {
        nats.close().await;
    }

    info!("Gateway shutdown complete");
    Ok(())
}

/// Wait for shutdown signal (SIGTERM or SIGINT)
async fn shutdown_signal() {
    let ctrl_c = async {
        signal::ctrl_c()
            .await
            .expect("Failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("Failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
}
