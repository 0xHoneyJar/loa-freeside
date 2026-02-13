//! Gateway configuration module
//!
//! Sprint S-4: Enhanced configuration for shard pools and NATS
//! Handles loading configuration from environment variables.

use crate::error::GatewayError;
use std::env;
use twilight_gateway::Intents;

/// Gateway configuration
#[derive(Debug, Clone)]
pub struct GatewayConfig {
    /// Discord bot token
    pub discord_token: String,

    /// Pool ID for this gateway instance (0-indexed)
    /// Each pool manages SHARDS_PER_POOL shards
    pub pool_id: u64,

    /// Total number of shards across all pools
    pub total_shards: u64,

    /// NATS server URL(s) - comma-separated for multiple servers
    pub nats_url: Option<String>,

    /// Health/metrics HTTP port
    pub http_port: u16,

    /// Log level (trace, debug, info, warn, error)
    pub log_level: String,
}

impl GatewayConfig {
    /// Load configuration from environment variables
    pub fn from_env() -> Result<Self, GatewayError> {
        dotenvy::dotenv().ok();

        let discord_token = env::var("DISCORD_TOKEN")
            .or_else(|_| env::var("DISCORD_BOT_TOKEN"))
            .map_err(|_| GatewayError::Config(
                "DISCORD_TOKEN or DISCORD_BOT_TOKEN must be set".to_string(),
            ))?;

        // Pool ID replaces shard_id for multi-shard pools
        let pool_id = env::var("POOL_ID")
            .or_else(|_| env::var("SHARD_ID")) // Backwards compat
            .unwrap_or_else(|_| "0".to_string())
            .parse()
            .map_err(|e| GatewayError::Config(format!("POOL_ID must be a valid number: {e}")))?;

        let total_shards = env::var("TOTAL_SHARDS")
            .unwrap_or_else(|_| "1".to_string())
            .parse()
            .map_err(|e| GatewayError::Config(format!("TOTAL_SHARDS must be a valid number: {e}")))?;

        let nats_url = env::var("NATS_URL").ok();

        let http_port = env::var("HTTP_PORT")
            .or_else(|_| env::var("METRICS_PORT")) // Backwards compat
            .unwrap_or_else(|_| "9090".to_string())
            .parse()
            .map_err(|e| GatewayError::Config(format!("HTTP_PORT must be a valid port number: {e}")))?;

        let log_level = env::var("LOG_LEVEL").unwrap_or_else(|_| "info".to_string());

        Ok(Self {
            discord_token,
            pool_id,
            total_shards,
            nats_url,
            http_port,
            log_level,
        })
    }

    /// Get configured Discord intents
    ///
    /// Per SDD §5.1.2, we use minimal intents:
    /// - GUILDS: Required for guild lifecycle events
    /// - GUILD_MEMBERS: Required for member events (privileged)
    /// - GUILD_MESSAGES: Optional, for message-based features
    pub fn intents() -> Intents {
        Intents::GUILDS | Intents::GUILD_MEMBERS
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_intents_are_minimal() {
        let intents = GatewayConfig::intents();

        // Should have GUILDS and GUILD_MEMBERS
        assert!(intents.contains(Intents::GUILDS));
        assert!(intents.contains(Intents::GUILD_MEMBERS));

        // Should NOT have message content (privileged, not needed)
        assert!(!intents.contains(Intents::MESSAGE_CONTENT));
    }

    #[test]
    fn test_default_values() {
        // Pool ID should default to 0
        assert_eq!(
            env::var("POOL_ID")
                .unwrap_or_else(|_| "0".to_string())
                .parse::<u64>()
                .unwrap(),
            0
        );
    }
}
