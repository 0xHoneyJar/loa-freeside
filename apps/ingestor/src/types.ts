/**
 * Discord Event Payload for RabbitMQ messages
 * Schema defined in SDD Section 3.2.2
 */
export interface DiscordEventPayload {
  // Metadata
  eventId: string;
  eventType: string;
  timestamp: number;
  shardId: number;

  // Routing
  guildId: string;
  channelId?: string;
  userId?: string;

  // Discord-specific (for interactions)
  interactionId?: string;
  interactionToken?: string;

  // Raw payload data
  data: Record<string, unknown>;
}

/**
 * Event types for routing keys
 */
export type EventType =
  | 'interaction.command'
  | 'interaction.button'
  | 'interaction.modal'
  | 'interaction.autocomplete'
  | 'member.join'
  | 'member.leave'
  | 'member.update'
  | 'guild.join'
  | 'guild.leave'
  | 'message.create';

/**
 * Priority levels for interaction events
 */
export const PRIORITY = {
  COMMAND: 10,
  BUTTON: 8,
  MODAL: 8,
  AUTOCOMPLETE: 6,
  MEMBER_EVENT: 5,
  GUILD_EVENT: 4,
  MESSAGE: 1,
} as const;

/**
 * Health check response
 */
export interface HealthStatus {
  status: 'healthy' | 'unhealthy';
  timestamp: number;
  checks: {
    discord: {
      connected: boolean;
      latency: number;
      shardId: number;
    };
    rabbitmq: {
      connected: boolean;
      channelOpen: boolean;
    };
    memory: {
      heapUsed: number;
      heapTotal: number;
      rss: number;
      belowThreshold: boolean;
    };
  };
}

/**
 * Publisher connection status
 */
export interface PublisherStatus {
  connected: boolean;
  channelOpen: boolean;
  lastPublishTime?: number;
  publishCount: number;
  errorCount: number;
}
