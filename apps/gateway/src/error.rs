//! Domain error types for the Arrakis Gateway
//!
//! Sprint S-6: Replaces opaque error types with structured thiserror types
//! for navigable diagnostics and compile-time exhaustive handling.
//!
//! Design reference: Bridgebuilder Meditation §V.1 (Rust Error Taxonomy Gap)
//!
//! main.rs is the ONLY module allowed to use anyhow::Result (process boundary).
//! All application code returns Result<T, GatewayError>.

use thiserror::Error;

/// Gateway domain errors
///
/// Every variant carries structured context fields for diagnostics.
/// On-call engineers can pattern-match on the variant to understand
/// the failure mode without parsing error message strings.
///
/// Example log output:
/// ```text
/// GatewayError::ShardCircuitBroken { shard_id: 3, count: 10, max: 10 }
/// → "shard 3 exceeded consecutive error threshold (10/10)"
/// ```
#[derive(Error, Debug)]
pub enum GatewayError {
    /// Shard exceeded consecutive error threshold (circuit breaker tripped)
    #[error("shard {shard_id} exceeded consecutive error threshold ({count}/{max})")]
    ShardCircuitBroken {
        shard_id: u64,
        count: u32,
        max: u32,
    },

    /// Shard reconnection failed (fatal — shard marked dead)
    #[error("shard {shard_id} reconnection failed")]
    ShardReconnectFailed {
        shard_id: u64,
        #[source]
        source: Box<dyn std::error::Error + Send + Sync>,
    },

    /// NATS publish failed for a specific subject
    #[error("NATS publish failed for subject '{subject}'")]
    NatsPublishFailed {
        subject: String,
        #[source]
        source: Box<dyn std::error::Error + Send + Sync>,
    },

    /// NATS connection failed
    #[error("NATS connection failed")]
    NatsConnectionFailed(#[source] Box<dyn std::error::Error + Send + Sync>),

    /// Event serialization failed
    #[error("event serialization failed for {event_type} on shard {shard_id}")]
    SerializationFailed {
        event_type: String,
        shard_id: u64,
        #[source]
        source: serde_json::Error,
    },

    /// Configuration error (environment variable missing or invalid)
    #[error("configuration error: {0}")]
    Config(String),

    /// Shard ID overflow: u64 value exceeds u32::MAX (Twilight API boundary)
    #[error("shard ID overflow: {value} exceeds u32::MAX")]
    ShardIdOverflow { value: u64 },
}

impl GatewayError {
    /// Returns a static label string suitable for Prometheus metrics.
    ///
    /// Used as the `error_type` label on `gateway_errors_total` counter,
    /// enabling per-error-type monitoring and alerting.
    pub fn error_type_label(&self) -> &'static str {
        match self {
            Self::ShardCircuitBroken { .. } => "circuit_broken",
            Self::ShardReconnectFailed { .. } => "reconnect_failed",
            Self::NatsPublishFailed { .. } => "nats_publish",
            Self::NatsConnectionFailed(_) => "nats_connection",
            Self::SerializationFailed { .. } => "serialization",
            Self::Config(_) => "config",
            Self::ShardIdOverflow { .. } => "shard_overflow",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_error() -> Box<dyn std::error::Error + Send + Sync> {
        Box::new(std::io::Error::new(std::io::ErrorKind::Other, "test"))
    }

    #[test]
    fn every_variant_has_distinct_error_type_label() {
        let labels = [
            GatewayError::ShardCircuitBroken { shard_id: 0, count: 10, max: 10 }
                .error_type_label(),
            GatewayError::ShardReconnectFailed {
                shard_id: 0,
                source: test_error(),
            }
            .error_type_label(),
            GatewayError::NatsPublishFailed {
                subject: "test".to_string(),
                source: test_error(),
            }
            .error_type_label(),
            GatewayError::NatsConnectionFailed(test_error()).error_type_label(),
            GatewayError::SerializationFailed {
                event_type: "test".to_string(),
                shard_id: 0,
                source: serde_json::from_str::<()>("invalid").unwrap_err(),
            }
            .error_type_label(),
            GatewayError::Config("test".to_string()).error_type_label(),
            GatewayError::ShardIdOverflow { value: u64::MAX }.error_type_label(),
        ];

        // All labels are unique
        let mut unique = labels.to_vec();
        unique.sort();
        unique.dedup();
        assert_eq!(labels.len(), unique.len(), "Duplicate error_type_label found");
    }

    #[test]
    fn error_messages_contain_context() {
        let err = GatewayError::ShardCircuitBroken {
            shard_id: 3,
            count: 10,
            max: 10,
        };
        let msg = err.to_string();
        assert!(msg.contains("shard 3"), "message should contain shard_id");
        assert!(msg.contains("10/10"), "message should contain count/max");

        let err = GatewayError::NatsPublishFailed {
            subject: "commands.interaction".to_string(),
            source: test_error(),
        };
        assert!(err.to_string().contains("commands.interaction"));

        let err = GatewayError::ShardIdOverflow { value: u64::MAX };
        assert!(err.to_string().contains(&u64::MAX.to_string()));
    }

    #[test]
    fn config_error_preserves_message() {
        let err = GatewayError::Config("DISCORD_TOKEN must be set".to_string());
        assert_eq!(
            err.to_string(),
            "configuration error: DISCORD_TOKEN must be set"
        );
    }

    #[test]
    fn shard_id_overflow_at_boundary() {
        // u32::MAX should NOT overflow
        let val = u32::MAX as u64;
        assert!(u32::try_from(val).is_ok());

        // u32::MAX + 1 SHOULD overflow
        let val = u32::MAX as u64 + 1;
        assert!(u32::try_from(val).is_err());
    }
}
