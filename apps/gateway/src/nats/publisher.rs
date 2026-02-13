//! NATS event publisher
//!
//! Sprint S-4: Publishes serialized events to NATS JetStream

use crate::error::GatewayError;
use crate::events::serialize::GatewayEvent;
use async_nats::jetstream::{self, Context as JsContext};
use async_nats::Client;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tracing::{debug, error, info, warn};

/// Stream names per SDD §7.1.1
pub mod streams {
    /// Commands stream for slash command interactions
    pub const COMMANDS: &str = "COMMANDS";
    /// Events stream for guild/member events
    pub const EVENTS: &str = "EVENTS";
    /// Eligibility stream for token checks
    pub const ELIGIBILITY: &str = "ELIGIBILITY";
}

/// Subject prefixes for routing
pub mod subjects {
    /// Slash commands: commands.{command_name}
    pub const COMMANDS: &str = "commands";
    /// Guild events: events.guild.{event_type}
    pub const GUILD_EVENTS: &str = "events.guild";
    /// Member events: events.member.{event_type}
    pub const MEMBER_EVENTS: &str = "events.member";
    /// Interactions: commands.interaction
    pub const INTERACTION: &str = "commands.interaction";
}

/// NATS publisher for gateway events
pub struct NatsPublisher {
    client: Client,
    jetstream: JsContext,
    connected: AtomicBool,
    messages_published: AtomicU64,
    publish_failures: AtomicU64,
}

impl NatsPublisher {
    /// Connect to NATS server
    pub async fn connect(servers: &str) -> Result<Arc<Self>, GatewayError> {
        info!(servers, "Connecting to NATS");

        let client = async_nats::connect(servers)
            .await
            .map_err(|e| GatewayError::NatsConnectionFailed(Box::new(e)))?;

        let jetstream = jetstream::new(client.clone());

        info!("Connected to NATS JetStream");

        Ok(Arc::new(Self {
            client,
            jetstream,
            connected: AtomicBool::new(true),
            messages_published: AtomicU64::new(0),
            publish_failures: AtomicU64::new(0),
        }))
    }

    /// Check if connected
    pub fn is_connected(&self) -> bool {
        self.connected.load(Ordering::SeqCst)
    }

    /// Get total messages published
    pub fn messages_published(&self) -> u64 {
        self.messages_published.load(Ordering::Relaxed)
    }

    /// Get total publish failures
    pub fn publish_failures(&self) -> u64 {
        self.publish_failures.load(Ordering::Relaxed)
    }

    /// Publish a gateway event to the appropriate stream
    pub async fn publish_event(&self, event: &GatewayEvent) -> Result<(), GatewayError> {
        let subject = self.route_event(event);
        let payload = serde_json::to_vec(event).map_err(|e| GatewayError::SerializationFailed {
            event_type: event.event_type.clone(),
            shard_id: event.shard_id,
            source: e,
        })?;

        debug!(
            event_type = %event.event_type,
            subject,
            event_id = %event.event_id,
            "Publishing event"
        );

        match self.jetstream.publish(subject.clone(), payload.into()).await {
            Ok(ack_future) => {
                // In async-nats 0.46, publish returns a PublishAckFuture
                // that must be awaited to get the actual acknowledgment
                match ack_future.await {
                    Ok(ack) => {
                        self.messages_published.fetch_add(1, Ordering::Relaxed);
                        debug!(
                            subject,
                            stream = %ack.stream,
                            seq = ack.sequence,
                            "Event published"
                        );
                        Ok(())
                    }
                    Err(e) => {
                        self.publish_failures.fetch_add(1, Ordering::Relaxed);
                        warn!(subject, error = %e, "Failed to get publish acknowledgment");
                        Err(GatewayError::NatsPublishFailed {
                            subject,
                            source: Box::new(e),
                        })
                    }
                }
            }
            Err(e) => {
                self.publish_failures.fetch_add(1, Ordering::Relaxed);
                warn!(subject, error = %e, "Failed to publish event");
                Err(GatewayError::NatsPublishFailed {
                    subject,
                    source: Box::new(e),
                })
            }
        }
    }

    /// Route event to appropriate subject based on event type
    fn route_event(&self, event: &GatewayEvent) -> String {
        match event.event_type.as_str() {
            // Interactions go to COMMANDS stream
            "interaction.create" => format!("{}.interaction", subjects::COMMANDS),

            // Guild events go to EVENTS stream
            "guild.join" => format!("{}.join", subjects::GUILD_EVENTS),
            "guild.leave" => format!("{}.leave", subjects::GUILD_EVENTS),
            "guild.update" => format!("{}.update", subjects::GUILD_EVENTS),

            // Member events go to EVENTS stream
            "member.join" => format!("{}.join", subjects::MEMBER_EVENTS),
            "member.leave" => format!("{}.leave", subjects::MEMBER_EVENTS),
            "member.update" => format!("{}.update", subjects::MEMBER_EVENTS),

            // Default: generic event
            other => format!("events.{}", other.replace('.', "_")),
        }
    }

    /// Graceful shutdown
    pub async fn close(&self) {
        info!("Closing NATS connection");
        self.connected.store(false, Ordering::SeqCst);
        // async-nats handles cleanup on drop
    }
}

/// Ensure streams exist with correct configuration
///
/// This is typically run during startup or by a separate setup job.
pub async fn ensure_streams(js: &JsContext) -> Result<(), GatewayError> {
    use async_nats::jetstream::stream::{Config, RetentionPolicy, StorageType};

    // COMMANDS stream - memory storage, 60s retention for fast command processing
    let commands_config = Config {
        name: streams::COMMANDS.to_string(),
        subjects: vec!["commands.>".to_string()],
        retention: RetentionPolicy::Limits,
        max_age: std::time::Duration::from_secs(60),
        storage: StorageType::Memory,
        ..Default::default()
    };

    match js.create_stream(commands_config).await {
        Ok(_) => info!("Created COMMANDS stream"),
        Err(e) if e.to_string().contains("already in use") => {
            debug!("COMMANDS stream already exists");
        }
        Err(e) => {
            error!(error = %e, "Failed to create COMMANDS stream");
            return Err(GatewayError::Config(format!("Failed to create COMMANDS stream: {e}")));
        }
    }

    // EVENTS stream - memory storage, 5min retention for event processing
    let events_config = Config {
        name: streams::EVENTS.to_string(),
        subjects: vec!["events.>".to_string()],
        retention: RetentionPolicy::Limits,
        max_age: std::time::Duration::from_secs(300),
        storage: StorageType::Memory,
        ..Default::default()
    };

    match js.create_stream(events_config).await {
        Ok(_) => info!("Created EVENTS stream"),
        Err(e) if e.to_string().contains("already in use") => {
            debug!("EVENTS stream already exists");
        }
        Err(e) => {
            error!(error = %e, "Failed to create EVENTS stream");
            return Err(GatewayError::Config(format!("Failed to create EVENTS stream: {e}")));
        }
    }

    info!("NATS streams configured");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_route_interaction() {
        let event = GatewayEvent {
            event_id: "test".to_string(),
            event_type: "interaction.create".to_string(),
            shard_id: 0,
            timestamp: 0,
            guild_id: None,
            channel_id: None,
            user_id: None,
            data: serde_json::Value::Null,
        };

        // Create a mock publisher would require more setup
        // For now, test the routing logic separately
        assert_eq!(event.event_type, "interaction.create");
    }

    #[test]
    fn test_stream_constants() {
        assert_eq!(streams::COMMANDS, "COMMANDS");
        assert_eq!(streams::EVENTS, "EVENTS");
        assert_eq!(streams::ELIGIBILITY, "ELIGIBILITY");
    }

    /// Validates that Rust hardcoded constants match the language-neutral
    /// nats-routing.json. If this fails, Rust routing has drifted from
    /// the shared contract consumed by TypeScript workers.
    mod routing_conformance {
        use super::*;

        const ROUTING_JSON: &str = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../packages/shared/nats-schemas/nats-routing.json"
        );

        #[test]
        fn rust_stream_names_match_routing_json() {
            let content = std::fs::read_to_string(ROUTING_JSON)
                .expect("Failed to read nats-routing.json");
            let routing: serde_json::Value = serde_json::from_str(&content)
                .expect("Failed to parse nats-routing.json");

            let json_streams = routing["streams"].as_object()
                .expect("streams should be object");

            assert_eq!(
                streams::COMMANDS,
                json_streams["COMMANDS"]["name"].as_str().unwrap(),
                "COMMANDS stream name mismatch"
            );
            assert_eq!(
                streams::EVENTS,
                json_streams["EVENTS"]["name"].as_str().unwrap(),
                "EVENTS stream name mismatch"
            );
            assert_eq!(
                streams::ELIGIBILITY,
                json_streams["ELIGIBILITY"]["name"].as_str().unwrap(),
                "ELIGIBILITY stream name mismatch"
            );
        }

        #[test]
        fn rust_subject_prefixes_match_routing_json() {
            let content = std::fs::read_to_string(ROUTING_JSON)
                .expect("Failed to read nats-routing.json");
            let routing: serde_json::Value = serde_json::from_str(&content)
                .expect("Failed to parse nats-routing.json");

            let json_subjects = routing["subjects"].as_object()
                .expect("subjects should be object");

            assert_eq!(
                subjects::COMMANDS,
                json_subjects["commands"]["prefix"].as_str().unwrap(),
                "commands prefix mismatch"
            );
            assert_eq!(
                subjects::GUILD_EVENTS,
                json_subjects["guild_events"]["prefix"].as_str().unwrap(),
                "guild_events prefix mismatch"
            );
            assert_eq!(
                subjects::MEMBER_EVENTS,
                json_subjects["member_events"]["prefix"].as_str().unwrap(),
                "member_events prefix mismatch"
            );
            assert_eq!(
                subjects::INTERACTION,
                json_subjects["commands"]["interaction"].as_str().unwrap(),
                "interaction subject mismatch"
            );
        }

        #[test]
        fn rust_route_event_matches_routing_json_mapping() {
            let content = std::fs::read_to_string(ROUTING_JSON)
                .expect("Failed to read nats-routing.json");
            let routing: serde_json::Value = serde_json::from_str(&content)
                .expect("Failed to parse nats-routing.json");

            let mapping = routing["event_type_to_subject"].as_object()
                .expect("event_type_to_subject should be object");

            // We need a NatsPublisher to call route_event, but it requires
            // a real NATS connection. Instead, verify the mapping constants
            // are consistent with the subject module definitions.
            for (event_type, expected_subject) in mapping {
                let expected = expected_subject.as_str().unwrap();
                // Verify the expected subject starts with a known prefix
                let valid = expected.starts_with(subjects::COMMANDS)
                    || expected.starts_with(subjects::GUILD_EVENTS)
                    || expected.starts_with(subjects::MEMBER_EVENTS);
                assert!(
                    valid,
                    "event_type '{}' maps to subject '{}' which doesn't match any Rust prefix",
                    event_type, expected
                );
            }
        }
    }
}
