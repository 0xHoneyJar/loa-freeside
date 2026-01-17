//! Shard pool implementation
//!
//! Sprint S-4: Twilight Gateway Core
//! Manages multiple Discord shards per process per SDD §5.1.3

use crate::events::serialize::serialize_event;
use crate::metrics::GatewayMetrics;
use crate::nats::NatsPublisher;
use crate::shard::state::{ShardHealth, ShardState};

use anyhow::Result;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::broadcast;
use tracing::{debug, error, info, warn};
use twilight_gateway::{Config, Intents, Shard, ShardId};
use twilight_model::gateway::event::Event;

/// Number of shards per gateway process (pool)
pub const SHARDS_PER_POOL: u64 = 25;

/// Shard pool managing multiple Discord shards
pub struct ShardPool {
    pool_id: u64,
    shards: Vec<Shard>,
    nats: Option<Arc<NatsPublisher>>,
    state: ShardState,
    metrics: Arc<GatewayMetrics>,
    shutdown_tx: broadcast::Sender<()>,
}

impl ShardPool {
    /// Create a new shard pool
    ///
    /// # Arguments
    /// * `pool_id` - Pool identifier (0, 1, 2, ...)
    /// * `total_shards` - Total shards across all pools
    /// * `token` - Discord bot token
    /// * `intents` - Discord gateway intents
    /// * `nats` - Optional NATS publisher (None for local testing)
    /// * `metrics` - Prometheus metrics
    pub async fn new(
        pool_id: u64,
        total_shards: u64,
        token: String,
        intents: Intents,
        nats: Option<Arc<NatsPublisher>>,
        metrics: Arc<GatewayMetrics>,
    ) -> Result<Self> {
        let start_shard = pool_id * SHARDS_PER_POOL;
        let end_shard = ((pool_id + 1) * SHARDS_PER_POOL).min(total_shards);

        let shard_ids: Vec<u64> = (start_shard..end_shard).collect();

        info!(
            pool_id,
            start_shard,
            end_shard,
            shard_count = shard_ids.len(),
            "Creating shard pool"
        );

        let state = ShardState::new(pool_id, shard_ids.iter().copied(), total_shards);

        let mut shards = Vec::with_capacity(shard_ids.len());

        for shard_id in shard_ids {
            let config = Config::builder(token.clone(), intents).build();

            let shard = Shard::with_config(ShardId::new(shard_id, total_shards), config);

            shards.push(shard);
        }

        let (shutdown_tx, _) = broadcast::channel(1);

        Ok(Self {
            pool_id,
            shards,
            nats,
            state,
            metrics,
            shutdown_tx,
        })
    }

    /// Get the pool ID
    pub fn pool_id(&self) -> u64 {
        self.pool_id
    }

    /// Get shared state (for health checks)
    pub fn state(&self) -> ShardState {
        self.state.clone()
    }

    /// Run all shards in the pool
    ///
    /// This spawns a task for each shard and waits for all to complete.
    pub async fn run(self) -> Result<()> {
        let mut handles = Vec::with_capacity(self.shards.len());

        for shard in self.shards {
            let shard_id = shard.id().number();
            let nats = self.nats.clone();
            let state = self.state.clone();
            let metrics = Arc::clone(&self.metrics);
            let mut shutdown_rx = self.shutdown_tx.subscribe();

            let handle = tokio::spawn(async move {
                tokio::select! {
                    result = run_shard(shard, nats, state, metrics) => {
                        if let Err(e) = result {
                            error!(shard_id, error = %e, "Shard task failed");
                        }
                    }
                    _ = shutdown_rx.recv() => {
                        info!(shard_id, "Shard received shutdown signal");
                    }
                }
            });

            handles.push(handle);
        }

        // Wait for all shards
        for handle in handles {
            let _ = handle.await;
        }

        info!(pool_id = self.pool_id, "Shard pool shut down");
        Ok(())
    }

    /// Signal shutdown to all shards
    pub fn shutdown(&self) {
        let _ = self.shutdown_tx.send(());
    }
}

/// Run a single shard's event loop
async fn run_shard(
    mut shard: Shard,
    nats: Option<Arc<NatsPublisher>>,
    state: ShardState,
    metrics: Arc<GatewayMetrics>,
) -> Result<()> {
    let shard_id = shard.id().number();
    let pool_id = state.pool_id();

    state.set_health(shard_id, ShardHealth::Connecting);

    info!(shard_id, pool_id, "Shard starting");

    loop {
        let event = match shard.next_event().await {
            Ok(event) => event,
            Err(source) => {
                warn!(shard_id, error = %source, "Error receiving event");
                metrics.record_error(shard_id);

                if source.is_fatal() {
                    state.set_health(shard_id, ShardHealth::Dead);
                    error!(shard_id, "Fatal gateway error");
                    return Err(source.into());
                }

                state.set_health(shard_id, ShardHealth::Disconnected);
                continue;
            }
        };

        // Record event received
        state.record_event(shard_id);
        metrics.record_event(shard_id, &event);

        // Handle special events
        match &event {
            Event::Ready(ready) => {
                state.set_health(shard_id, ShardHealth::Ready);
                state.set_guilds(shard_id, ready.guilds.len() as u64);
                metrics.set_guilds(shard_id, ready.guilds.len() as u64);
                info!(
                    shard_id,
                    guilds = ready.guilds.len(),
                    session_id = %ready.session_id,
                    "Shard ready"
                );
            }
            Event::Resumed => {
                state.set_health(shard_id, ShardHealth::Ready);
                info!(shard_id, "Shard resumed");
            }
            Event::GatewayHeartbeatAck => {
                state.record_heartbeat(shard_id);
                metrics.record_heartbeat(shard_id);
            }
            Event::GuildCreate(guild) => {
                // Increment guild count on join
                let current = state.total_guilds();
                state.set_guilds(shard_id, current + 1);
                debug!(shard_id, guild_id = %guild.id, "Guild joined");
            }
            Event::GuildDelete(guild) => {
                // Decrement guild count on leave
                if !guild.unavailable {
                    let current = state.total_guilds();
                    if current > 0 {
                        state.set_guilds(shard_id, current - 1);
                    }
                }
                debug!(shard_id, guild_id = %guild.id, "Guild left");
            }
            _ => {}
        }

        // Route event to NATS if available
        if let Some(ref nats) = nats {
            let start = Instant::now();

            if let Some(payload) = serialize_event(&event, shard_id) {
                match nats.publish_event(&payload).await {
                    Ok(()) => {
                        state.record_route(shard_id);
                        metrics.record_route_success(shard_id, start.elapsed());
                    }
                    Err(e) => {
                        state.record_route_failure(shard_id);
                        metrics.record_route_failure(shard_id);
                        warn!(shard_id, error = %e, "Failed to publish event to NATS");
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_shards_per_pool_constant() {
        assert_eq!(SHARDS_PER_POOL, 25);
    }

    #[test]
    fn test_shard_range_calculation() {
        // Pool 0: shards 0-24
        let pool_id = 0u64;
        let total_shards = 100u64;
        let start = pool_id * SHARDS_PER_POOL;
        let end = ((pool_id + 1) * SHARDS_PER_POOL).min(total_shards);
        assert_eq!(start, 0);
        assert_eq!(end, 25);

        // Pool 3: shards 75-99
        let pool_id = 3u64;
        let start = pool_id * SHARDS_PER_POOL;
        let end = ((pool_id + 1) * SHARDS_PER_POOL).min(total_shards);
        assert_eq!(start, 75);
        assert_eq!(end, 100);
    }
}
