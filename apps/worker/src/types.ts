/**
 * Discord Event Payload from RabbitMQ messages
 * Schema must match Ingestor's DiscordEventPayload
 */
export interface DiscordEventPayload {
  // Metadata
  eventId: string;
  eventType: string;
  timestamp: number;
  shardId?: number;

  // Routing
  guildId?: string;
  channelId?: string;
  userId?: string;

  // Discord-specific (for interactions)
  interactionId?: string;
  interactionToken?: string;

  // Parsed command data (for convenience, extracted from data)
  commandName?: string;
  subcommand?: string;

  // Component interaction data (buttons/selects)
  customId?: string;
  componentType?: number;
  selectedValues?: string[];

  // Raw payload data
  data?: Record<string, unknown>;
}

/**
 * Consumer message handler result
 */
export type ConsumeResult = 'ack' | 'nack' | 'nack-requeue';

/**
 * Handler function signature for processing events
 */
export type EventHandler<T = Record<string, unknown>> = (
  payload: DiscordEventPayload,
  data: T
) => Promise<ConsumeResult>;

/**
 * Consumer configuration
 */
export interface ConsumerConfig {
  queue: string;
  prefetch: number;
  tag?: string;
}

/**
 * Worker health status response
 */
export interface WorkerHealthStatus {
  status: 'healthy' | 'unhealthy';
  timestamp: number;
  checks: {
    rabbitmq: {
      connected: boolean;
      channelOpen: boolean;
      consumersActive: number;
    };
    redis: {
      connected: boolean;
      latencyMs: number | null;
    };
    memory: {
      heapUsed: number;
      heapTotal: number;
      rss: number;
      belowThreshold: boolean;
    };
  };
  stats: {
    messagesProcessed: number;
    messagesErrored: number;
    uptime: number;
  };
}

/**
 * Discord REST service response types
 */
export interface DeferResult {
  success: boolean;
  error?: string;
}

export interface FollowupResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface RoleResult {
  success: boolean;
  error?: string;
}

/**
 * Redis session data structure
 */
export interface SessionData {
  type: string;
  userId: string;
  data: Record<string, unknown>;
  createdAt: number;
  expiresAt: number;
}

/**
 * Cooldown check result
 */
export interface CooldownResult {
  isOnCooldown: boolean;
  remainingMs: number;
}

/**
 * Event types for routing (must match Ingestor)
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
 * Extract command name from event type
 * e.g., "interaction.command.check-eligibility" -> "check-eligibility"
 */
export function extractCommandName(eventType: string): string | null {
  const match = /^interaction\.command\.(.+)$/.exec(eventType);
  return match ? match[1] ?? null : null;
}

/**
 * Check if event is an interaction type
 */
export function isInteractionEvent(eventType: string): boolean {
  return eventType.startsWith('interaction.');
}

/**
 * Check if event is a member event type
 */
export function isMemberEvent(eventType: string): boolean {
  return eventType.startsWith('member.');
}

/**
 * Check if event is a guild event type
 */
export function isGuildEvent(eventType: string): boolean {
  return eventType.startsWith('guild.');
}
