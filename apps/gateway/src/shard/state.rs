//! Shard state tracking
//!
//! Sprint S-4: Tracks health and status of individual shards

use dashmap::DashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;

/// Health status for a shard
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShardHealth {
    /// Shard is connecting
    Connecting,
    /// Shard is ready and receiving events
    Ready,
    /// Shard is resuming after disconnect
    Resuming,
    /// Shard is disconnected
    Disconnected,
    /// Shard encountered a fatal error
    Dead,
}

impl ShardHealth {
    /// Returns true if the shard is healthy
    pub fn is_healthy(&self) -> bool {
        matches!(self, ShardHealth::Ready | ShardHealth::Resuming)
    }

    /// Returns true if the shard is ready to receive events
    pub fn is_ready(&self) -> bool {
        matches!(self, ShardHealth::Ready)
    }
}

/// State for a single shard
#[derive(Debug)]
pub struct ShardStateEntry {
    pub health: ShardHealth,
    pub guilds: u64,
    pub events_received: AtomicU64,
    pub events_routed: AtomicU64,
    pub route_failures: AtomicU64,
    pub last_heartbeat: Option<Instant>,
    pub connected_at: Option<Instant>,
}

impl Default for ShardStateEntry {
    fn default() -> Self {
        Self {
            health: ShardHealth::Connecting,
            guilds: 0,
            events_received: AtomicU64::new(0),
            events_routed: AtomicU64::new(0),
            route_failures: AtomicU64::new(0),
            last_heartbeat: None,
            connected_at: None,
        }
    }
}

/// Shared state across all shards in a pool
#[derive(Debug, Clone)]
pub struct ShardState {
    inner: Arc<ShardStateInner>,
}

#[derive(Debug)]
struct ShardStateInner {
    pool_id: u64,
    shards: DashMap<u64, ShardStateEntry>,
    total_shards: u64,
}

impl ShardState {
    /// Create a new shard state tracker
    pub fn new(pool_id: u64, shard_ids: impl Iterator<Item = u64>, total_shards: u64) -> Self {
        let shards = DashMap::new();
        for shard_id in shard_ids {
            shards.insert(shard_id, ShardStateEntry::default());
        }

        Self {
            inner: Arc::new(ShardStateInner {
                pool_id,
                shards,
                total_shards,
            }),
        }
    }

    /// Get the pool ID
    pub fn pool_id(&self) -> u64 {
        self.inner.pool_id
    }

    /// Get total shards across the cluster
    pub fn total_shards(&self) -> u64 {
        self.inner.total_shards
    }

    /// Update shard health
    pub fn set_health(&self, shard_id: u64, health: ShardHealth) {
        if let Some(mut entry) = self.inner.shards.get_mut(&shard_id) {
            entry.health = health;
            if health == ShardHealth::Ready && entry.connected_at.is_none() {
                entry.connected_at = Some(Instant::now());
            }
        }
    }

    /// Update shard guild count
    pub fn set_guilds(&self, shard_id: u64, count: u64) {
        if let Some(mut entry) = self.inner.shards.get_mut(&shard_id) {
            entry.guilds = count;
        }
    }

    /// Increment event received counter
    pub fn record_event(&self, shard_id: u64) {
        if let Some(entry) = self.inner.shards.get(&shard_id) {
            entry.events_received.fetch_add(1, Ordering::Relaxed);
        }
    }

    /// Increment event routed counter
    pub fn record_route(&self, shard_id: u64) {
        if let Some(entry) = self.inner.shards.get(&shard_id) {
            entry.events_routed.fetch_add(1, Ordering::Relaxed);
        }
    }

    /// Increment route failure counter
    pub fn record_route_failure(&self, shard_id: u64) {
        if let Some(entry) = self.inner.shards.get(&shard_id) {
            entry.route_failures.fetch_add(1, Ordering::Relaxed);
        }
    }

    /// Record heartbeat
    pub fn record_heartbeat(&self, shard_id: u64) {
        if let Some(mut entry) = self.inner.shards.get_mut(&shard_id) {
            entry.last_heartbeat = Some(Instant::now());
        }
    }

    /// Get health for a specific shard
    pub fn get_health(&self, shard_id: u64) -> Option<ShardHealth> {
        self.inner.shards.get(&shard_id).map(|e| e.health)
    }

    /// Get total events received across all shards
    pub fn total_events_received(&self) -> u64 {
        self.inner
            .shards
            .iter()
            .map(|e| e.events_received.load(Ordering::Relaxed))
            .sum()
    }

    /// Get total events routed across all shards
    pub fn total_events_routed(&self) -> u64 {
        self.inner
            .shards
            .iter()
            .map(|e| e.events_routed.load(Ordering::Relaxed))
            .sum()
    }

    /// Get total guilds across all shards
    pub fn total_guilds(&self) -> u64 {
        self.inner.shards.iter().map(|e| e.guilds).sum()
    }

    /// Get count of ready shards
    pub fn ready_shards(&self) -> usize {
        self.inner
            .shards
            .iter()
            .filter(|e| e.health.is_ready())
            .count()
    }

    /// Get count of healthy shards (ready or resuming)
    pub fn healthy_shards(&self) -> usize {
        self.inner
            .shards
            .iter()
            .filter(|e| e.health.is_healthy())
            .count()
    }

    /// Get total shard count in this pool
    pub fn shard_count(&self) -> usize {
        self.inner.shards.len()
    }

    /// Check if pool is ready (at least one shard ready)
    pub fn is_ready(&self) -> bool {
        self.ready_shards() > 0
    }

    /// Check if pool is fully healthy
    pub fn is_healthy(&self) -> bool {
        self.healthy_shards() == self.shard_count()
    }
}
