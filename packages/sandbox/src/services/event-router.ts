/**
 * EventRouter - Routes Discord Events to Sandboxes
 *
 * Sprint 86: Discord Server Sandboxes - Event Routing
 *
 * Subscribes to raw events from gateway and republishes
 * to appropriate sandbox or production subjects.
 *
 * @see SDD §7.1 Event Router Service
 * @module packages/sandbox/services/event-router
 */

import type { Logger } from 'pino';
import type { JetStreamClient, JetStreamManager, ConsumerMessages, JsMsg, Consumer } from 'nats';
import { AckPolicy, DeliverPolicy, RetentionPolicy, StorageType } from 'nats';
import { RouteProvider } from './route-provider.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for EventRouter
 */
export interface EventRouterConfig {
  /** NATS JetStream client */
  jetstream: JetStreamClient;

  /** NATS JetStream manager */
  jetstreamManager: JetStreamManager;

  /** Route provider for guild-to-sandbox lookups */
  routeProvider: RouteProvider;

  /** Logger instance */
  logger: Logger;

  /** Consumer name for this router instance */
  consumerName?: string;

  /** Max concurrent messages to process */
  maxConcurrent?: number;
}

/**
 * Discord event structure (minimal for routing)
 */
export interface DiscordEvent {
  /** Event type (e.g., MESSAGE_CREATE, GUILD_MEMBER_ADD) */
  t?: string;

  /** Event data */
  d?: {
    guild_id?: string;
    [key: string]: unknown;
  };

  /** Top-level guild_id (some events) */
  guild_id?: string;
}

/**
 * Routing statistics
 */
export interface RoutingStats {
  /** Total events processed */
  totalProcessed: number;

  /** Events routed to sandboxes */
  routedToSandbox: number;

  /** Events routed to production */
  routedToProduction: number;

  /** Events with no guild_id (direct to production) */
  noGuildId: number;

  /** Routing errors */
  errors: number;

  /** Average routing latency in ms */
  avgLatencyMs: number;
}

/**
 * Routing result for a single message
 */
export interface RoutingResult {
  /** Original guild ID */
  guildId: string | null;

  /** Target sandbox ID (null = production) */
  sandboxId: string | null;

  /** Target subject */
  targetSubject: string;

  /** Processing latency in ms */
  latencyMs: number;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_CONSUMER_NAME = 'sandbox-event-router';
const DEFAULT_MAX_CONCURRENT = 100;

// Stream and consumer configuration for sandbox routing
const SANDBOX_STREAM_NAME = 'SANDBOX';
const SANDBOX_STREAM_SUBJECTS = ['sandbox.>'];
const SANDBOX_STREAM_MAX_AGE_NS = 5 * 60 * 1_000_000_000; // 5 minutes
const SANDBOX_STREAM_MAX_MSGS = 500_000;

// =============================================================================
// EventRouter
// =============================================================================

/**
 * Routes Discord events to sandbox or production subjects
 */
export class EventRouter {
  private readonly jetstream: JetStreamClient;
  private readonly jsm: JetStreamManager;
  private readonly routeProvider: RouteProvider;
  private readonly logger: Logger;
  private readonly consumerName: string;
  private readonly maxConcurrent: number;

  private consumer: ConsumerMessages | null = null;
  private running = false;
  private stats: RoutingStats = {
    totalProcessed: 0,
    routedToSandbox: 0,
    routedToProduction: 0,
    noGuildId: 0,
    errors: 0,
    avgLatencyMs: 0,
  };

  // Rolling average window for latency (prevents unbounded memory growth)
  private static readonly LATENCY_WINDOW_SIZE = 1000;
  private latencyWindow: number[] = [];
  private latencyWindowIndex = 0;

  constructor(config: EventRouterConfig) {
    this.jetstream = config.jetstream;
    this.jsm = config.jetstreamManager;
    this.routeProvider = config.routeProvider;
    this.logger = config.logger.child({ component: 'EventRouter' });
    this.consumerName = config.consumerName ?? DEFAULT_CONSUMER_NAME;
    this.maxConcurrent = config.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
  }

  // ===========================================================================
  // Stream & Consumer Setup
  // ===========================================================================

  /**
   * Ensure the SANDBOX stream exists
   *
   * Creates the stream if it doesn't exist.
   */
  async ensureSandboxStream(): Promise<void> {
    try {
      const info = await this.jsm.streams.info(SANDBOX_STREAM_NAME);
      this.logger.debug(
        { stream: SANDBOX_STREAM_NAME, state: info.state },
        'Sandbox stream already exists'
      );
    } catch {
      // Stream doesn't exist, create it
      this.logger.info({ stream: SANDBOX_STREAM_NAME }, 'Creating sandbox stream');

      await this.jsm.streams.add({
        name: SANDBOX_STREAM_NAME,
        subjects: SANDBOX_STREAM_SUBJECTS,
        retention: RetentionPolicy.Limits,
        storage: StorageType.Memory,
        max_age: SANDBOX_STREAM_MAX_AGE_NS,
        max_msgs: SANDBOX_STREAM_MAX_MSGS,
        num_replicas: 3,
        description: 'Sandbox-specific events and commands',
      });

      this.logger.info({ stream: SANDBOX_STREAM_NAME }, 'Sandbox stream created');
    }
  }

  /**
   * Ensure the event-router consumer exists on the EVENTS stream
   */
  async ensureConsumer(): Promise<void> {
    const streamName = 'EVENTS';

    try {
      await this.jsm.consumers.info(streamName, this.consumerName);
      this.logger.debug(
        { stream: streamName, consumer: this.consumerName },
        'Router consumer already exists'
      );
    } catch {
      // Consumer doesn't exist, create it
      this.logger.info(
        { stream: streamName, consumer: this.consumerName },
        'Creating router consumer'
      );

      await this.jsm.consumers.add(streamName, {
        durable_name: this.consumerName,
        filter_subjects: ['events.>'],
        ack_policy: AckPolicy.Explicit,
        max_ack_pending: this.maxConcurrent,
        ack_wait: 15_000 * 1_000_000, // 15 seconds in nanoseconds
        max_deliver: 5,
        deliver_policy: DeliverPolicy.All,
        description: 'Routes events to sandboxes or production',
      });

      this.logger.info(
        { stream: streamName, consumer: this.consumerName },
        'Router consumer created'
      );
    }
  }

  // ===========================================================================
  // Routing Logic
  // ===========================================================================

  /**
   * Start routing events
   *
   * Subscribes to: events.>
   * Republishes to: sandbox.{id}.events.{type} or events.{type}
   */
  async start(): Promise<void> {
    if (this.running) {
      this.logger.warn('Event router already running');
      return;
    }

    this.logger.info('Starting event router');

    // Ensure stream and consumer exist
    await this.ensureSandboxStream();
    await this.ensureConsumer();

    // Get consumer
    const consumer: Consumer = await this.jetstream.consumers.get('EVENTS', this.consumerName);
    this.consumer = await consumer.consume();
    this.running = true;

    // Process messages
    this.processMessages().catch((error) => {
      this.logger.error({ error }, 'Event router processing failed');
      this.running = false;
    });

    this.logger.info('Event router started');
  }

  /**
   * Stop routing events
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.logger.info('Stopping event router');
    this.running = false;

    // Consumer will be cleaned up on next iteration
    this.consumer = null;

    this.logger.info('Event router stopped');
  }

  /**
   * Process messages from the consumer
   */
  private async processMessages(): Promise<void> {
    if (!this.consumer) {
      throw new Error('Consumer not initialized');
    }

    for await (const msg of this.consumer) {
      if (!this.running) {
        break;
      }

      try {
        await this.routeMessage(msg);
        msg.ack();
      } catch (error) {
        this.stats.errors++;
        this.logger.error({ error, subject: msg.subject }, 'Failed to route event');
        msg.nak();
      }
    }
  }

  /**
   * Route a single message
   */
  private async routeMessage(msg: JsMsg): Promise<RoutingResult> {
    const startTime = Date.now();

    // Parse the event
    let event: DiscordEvent;
    try {
      event = JSON.parse(msg.string());
    } catch (error) {
      this.logger.warn({ error, subject: msg.subject }, 'Failed to parse event JSON');
      throw error;
    }

    // Extract guild_id
    const guildId = this.extractGuildId(event);

    let sandboxId: string | null = null;
    let targetSubject: string;

    if (!guildId) {
      // Events without guild_id go directly to production
      targetSubject = msg.subject;
      this.stats.noGuildId++;
    } else {
      // Lookup sandbox for this guild
      const lookup = await this.routeProvider.getSandboxForGuild(guildId);
      sandboxId = lookup.sandboxId;

      if (sandboxId) {
        // Route to sandbox-specific subject
        targetSubject = `sandbox.${sandboxId}.${msg.subject}`;
        this.stats.routedToSandbox++;
      } else {
        // Route to production subject (unchanged)
        targetSubject = msg.subject;
        this.stats.routedToProduction++;
      }
    }

    // Publish to target subject
    await this.jetstream.publish(targetSubject, msg.data);

    const latencyMs = Date.now() - startTime;
    this.updateLatencyStats(latencyMs);

    this.logger.debug(
      { guildId, sandboxId, source: msg.subject, target: targetSubject, latencyMs },
      'Event routed'
    );

    return {
      guildId,
      sandboxId,
      targetSubject,
      latencyMs,
    };
  }

  /**
   * Route a message directly (for testing or manual routing)
   *
   * @param subject - Original subject
   * @param data - Event data (JSON string or object)
   * @returns Routing result
   */
  async routeDirect(subject: string, data: string | object): Promise<RoutingResult> {
    const startTime = Date.now();
    const jsonStr = typeof data === 'string' ? data : JSON.stringify(data);
    const event: DiscordEvent = typeof data === 'string' ? JSON.parse(data) : data;
    const dataBytes = new TextEncoder().encode(jsonStr);

    const guildId = this.extractGuildId(event);
    let sandboxId: string | null = null;
    let targetSubject: string;

    if (!guildId) {
      targetSubject = subject;
      this.stats.noGuildId++;
    } else {
      const lookup = await this.routeProvider.getSandboxForGuild(guildId);
      sandboxId = lookup.sandboxId;

      if (sandboxId) {
        targetSubject = `sandbox.${sandboxId}.${subject}`;
        this.stats.routedToSandbox++;
      } else {
        targetSubject = subject;
        this.stats.routedToProduction++;
      }
    }

    await this.jetstream.publish(targetSubject, dataBytes);

    const latencyMs = Date.now() - startTime;
    this.updateLatencyStats(latencyMs);

    return {
      guildId,
      sandboxId,
      targetSubject,
      latencyMs,
    };
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  /**
   * Extract guild_id from event
   */
  private extractGuildId(event: DiscordEvent): string | null {
    return event.guild_id ?? event.d?.guild_id ?? null;
  }

  /**
   * Update latency statistics using rolling average
   *
   * Uses a fixed-size circular buffer to prevent unbounded memory growth.
   * Maintains average over last LATENCY_WINDOW_SIZE samples.
   */
  private updateLatencyStats(latencyMs: number): void {
    this.stats.totalProcessed++;

    // Add to rolling window (circular buffer)
    if (this.latencyWindow.length < EventRouter.LATENCY_WINDOW_SIZE) {
      this.latencyWindow.push(latencyMs);
    } else {
      this.latencyWindow[this.latencyWindowIndex] = latencyMs;
      this.latencyWindowIndex =
        (this.latencyWindowIndex + 1) % EventRouter.LATENCY_WINDOW_SIZE;
    }

    // Calculate rolling average
    const sum = this.latencyWindow.reduce((a, b) => a + b, 0);
    this.stats.avgLatencyMs = sum / this.latencyWindow.length;
  }

  // ===========================================================================
  // Metrics
  // ===========================================================================

  /**
   * Get routing statistics
   */
  getStats(): RoutingStats {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalProcessed: 0,
      routedToSandbox: 0,
      routedToProduction: 0,
      noGuildId: 0,
      errors: 0,
      avgLatencyMs: 0,
    };
    this.latencyWindow = [];
    this.latencyWindowIndex = 0;
  }

  /**
   * Check if router is running
   */
  isRunning(): boolean {
    return this.running;
  }
}

// =============================================================================
// Stream Configuration Export
// =============================================================================

/**
 * SANDBOX stream configuration for integration with NatsClient
 */
export const SANDBOX_STREAM_CONFIG = {
  name: SANDBOX_STREAM_NAME,
  subjects: SANDBOX_STREAM_SUBJECTS,
  retention: RetentionPolicy.Limits,
  storage: StorageType.Memory,
  maxAge: SANDBOX_STREAM_MAX_AGE_NS,
  maxMsgs: SANDBOX_STREAM_MAX_MSGS,
  replicas: 3,
  description: 'Sandbox-specific events and commands',
};
