//! Event serialization for message broker
//!
//! Converts Twilight events to JSON payloads for NATS publishing.

use serde::Serialize;
use twilight_model::gateway::event::Event;
use uuid::Uuid;

/// Generic gateway event payload
#[derive(Debug, Clone, Serialize)]
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
        Event::GuildCreate(guild) => Some(GatewayEvent {
            event_id: Uuid::new_v4().to_string(),
            event_type: "guild.join".to_string(),
            shard_id,
            timestamp,
            guild_id: Some(guild.id.to_string()),
            channel_id: None,
            user_id: None,
            data: serde_json::json!({
                "name": guild.name,
                "member_count": guild.member_count,
                "owner_id": guild.owner_id.to_string(),
            }),
        }),

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
            // Interactions have their own dedicated serialization
            // For now, serialize as generic event
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
                    "token": interaction.token,
                }),
            })
        }

        // Events we don't forward
        Event::GatewayHeartbeat(_)
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
}
