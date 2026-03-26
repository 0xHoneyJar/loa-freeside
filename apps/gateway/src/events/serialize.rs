//! Event serialization for message broker
//!
//! Converts Twilight events to JSON payloads for NATS publishing.
#![allow(dead_code)] // Scaffolded for future event routing

use serde::{Deserialize, Serialize};
use tracing::warn;
use twilight_model::gateway::event::Event;
use uuid::Uuid;

/// Generic gateway event payload
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayEvent {
    pub event_id: String,
    pub event_type: String,
    pub shard_id: u64,
    pub timestamp: u64,
    pub guild_id: Option<String>,
    pub channel_id: Option<String>,
    pub user_id: Option<String>,
    pub data: serde_json::Value,
}

/// Interaction-specific event payload
#[derive(Debug, Clone, Serialize)]
pub struct InteractionEvent {
    pub event_id: String,
    pub shard_id: u64,
    pub timestamp: u64,
    pub interaction_id: String,
    pub interaction_token: String,
    pub guild_id: Option<String>,
    pub channel_id: String,
    pub user_id: String,
    pub command_name: Option<String>,
    pub subcommand: Option<String>,
    pub data: serde_json::Value,
}

/// Serialize a Twilight event to a GatewayEvent payload
///
/// Returns None for events we don't need to forward (e.g., heartbeats)
pub fn serialize_event(event: &Event, shard_id: u64) -> Option<GatewayEvent> {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;

    match event {
        Event::GuildCreate(guild) => {
            // GuildCreate is an enum in twilight-model 0.17; extract data via serde
            let guild_data = serde_json::to_value(guild.as_ref())
                .unwrap_or_else(|e| {
                    warn!(shard_id, error = %e, "Failed to serialize GuildCreate data");
                    serde_json::Value::Null
                });
            Some(GatewayEvent {
                event_id: Uuid::new_v4().to_string(),
                event_type: "guild.join".to_string(),
                shard_id,
                timestamp,
                guild_id: Some(guild.id().to_string()),
                channel_id: None,
                user_id: None,
                data: guild_data,
            })
        }

        Event::GuildDelete(guild) => Some(GatewayEvent {
            event_id: Uuid::new_v4().to_string(),
            event_type: "guild.leave".to_string(),
            shard_id,
            timestamp,
            guild_id: Some(guild.id.to_string()),
            channel_id: None,
            user_id: None,
            data: serde_json::json!({
                "unavailable": guild.unavailable,
            }),
        }),

        Event::MemberAdd(member) => Some(GatewayEvent {
            event_id: Uuid::new_v4().to_string(),
            event_type: "member.join".to_string(),
            shard_id,
            timestamp,
            guild_id: Some(member.guild_id.to_string()),
            channel_id: None,
            user_id: Some(member.user.id.to_string()),
            data: serde_json::json!({
                "username": member.user.name,
                "discriminator": member.user.discriminator,
            }),
        }),

        Event::MemberRemove(member) => Some(GatewayEvent {
            event_id: Uuid::new_v4().to_string(),
            event_type: "member.leave".to_string(),
            shard_id,
            timestamp,
            guild_id: Some(member.guild_id.to_string()),
            channel_id: None,
            user_id: Some(member.user.id.to_string()),
            data: serde_json::Value::Null,
        }),

        Event::MemberUpdate(member) => Some(GatewayEvent {
            event_id: Uuid::new_v4().to_string(),
            event_type: "member.update".to_string(),
            shard_id,
            timestamp,
            guild_id: Some(member.guild_id.to_string()),
            channel_id: None,
            user_id: Some(member.user.id.to_string()),
            data: serde_json::json!({
                "roles": member.roles.iter().map(|r| r.to_string()).collect::<Vec<_>>(),
                "nick": member.nick,
            }),
        }),

        Event::InteractionCreate(interaction) => {
            // Interactions are serialized as generic events.
            // The interaction_token is Discord's response token (15-min TTL),
            // needed by the command handler to reply. NATS is internal-only,
            // but explicit naming prevents accidental external logging.
            Some(GatewayEvent {
                event_id: Uuid::new_v4().to_string(),
                event_type: "interaction.create".to_string(),
                shard_id,
                timestamp,
                guild_id: interaction.guild_id.map(|id| id.to_string()),
                channel_id: interaction.channel.as_ref().map(|c| c.id.to_string()),
                user_id: interaction.author_id().map(|id| id.to_string()),
                data: serde_json::json!({
                    "interaction_id": interaction.id.to_string(),
                    "interaction_type": format!("{:?}", interaction.kind),
                    "interaction_token": interaction.token,
                }),
            })
        }

        // Events we don't forward
        Event::GatewayHeartbeat
        | Event::GatewayHeartbeatAck
        | Event::GatewayHello(_)
        | Event::GatewayInvalidateSession(_)
        | Event::GatewayReconnect => None,

        // Ready event - useful for debugging but not forwarded to workers
        Event::Ready(_) => None,

        // Default: log but don't forward
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_serialize_returns_none_for_heartbeat() {
        let event = Event::GatewayHeartbeatAck;
        assert!(serialize_event(&event, 0).is_none());
    }

    /// Fixture conformance: Rust must be able to round-trip deserialize
    /// every committed JSON fixture. If this fails, the Rust GatewayEvent
    /// struct has drifted from the wire format contract.
    ///
    /// The same fixtures are validated by the TypeScript Zod schemas in
    /// packages/shared/nats-schemas/src/__tests__/fixture-conformance.test.ts
    mod fixture_conformance {
        use super::*;

        const FIXTURES_DIR: &str = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../packages/shared/nats-schemas/fixtures"
        );

        fn load_fixture(name: &str) -> serde_json::Value {
            let path = format!("{}/{}.json", FIXTURES_DIR, name);
            let content = std::fs::read_to_string(&path)
                .unwrap_or_else(|e| panic!("Failed to read fixture {}: {}", path, e));
            serde_json::from_str(&content)
                .unwrap_or_else(|e| panic!("Failed to parse fixture {}: {}", path, e))
        }

        fn deserialize_fixture(name: &str) -> GatewayEvent {
            let value = load_fixture(name);
            serde_json::from_value::<GatewayEvent>(value)
                .unwrap_or_else(|e| panic!("Fixture {} failed GatewayEvent deserialization: {}", name, e))
        }

        #[test]
        fn guild_join_fixture_deserializes() {
            let event = deserialize_fixture("guild-join");
            assert_eq!(event.event_type, "guild.join");
            assert!(event.guild_id.is_some());
        }

        #[test]
        fn guild_leave_fixture_deserializes() {
            let event = deserialize_fixture("guild-leave");
            assert_eq!(event.event_type, "guild.leave");
        }

        #[test]
        fn member_join_fixture_deserializes() {
            let event = deserialize_fixture("member-join");
            assert_eq!(event.event_type, "member.join");
            assert!(event.user_id.is_some());
        }

        #[test]
        fn member_leave_fixture_deserializes() {
            let event = deserialize_fixture("member-leave");
            assert_eq!(event.event_type, "member.leave");
        }

        #[test]
        fn member_update_fixture_deserializes() {
            let event = deserialize_fixture("member-update");
            assert_eq!(event.event_type, "member.update");
        }

        #[test]
        fn interaction_create_fixture_deserializes() {
            let event = deserialize_fixture("interaction-create");
            assert_eq!(event.event_type, "interaction.create");
            // BB60-20 regression guard: field must be interaction_token, not token
            let data = event.data.as_object().expect("data should be object");
            assert!(data.contains_key("interaction_token"), "BB60-20: must use interaction_token");
            assert!(!data.contains_key("token"), "BB60-20: must NOT have bare 'token' field");
        }

        #[test]
        fn all_fixtures_round_trip_through_serde() {
            let fixtures = [
                "guild-join", "guild-leave",
                "member-join", "member-leave", "member-update",
                "interaction-create",
            ];
            for name in fixtures {
                let event = deserialize_fixture(name);
                // Re-serialize and verify it produces valid JSON
                let json = serde_json::to_string(&event)
                    .unwrap_or_else(|e| panic!("Re-serialization of {} failed: {}", name, e));
                // Deserialize again to prove round-trip
                let _: GatewayEvent = serde_json::from_str(&json)
                    .unwrap_or_else(|e| panic!("Round-trip of {} failed: {}", name, e));
            }
        }
    }
}
