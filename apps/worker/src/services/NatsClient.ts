/**
 * NATS JetStream Client for Arrakis Workers
 * Sprint S-5: NATS JetStream Deployment
 *
 * Provides connection management and stream configuration per SDD §7.1
 */

import {
  connect,
  NatsConnection,
  JetStreamClient,
  JetStreamManager,
  StringCodec,
  RetentionPolicy,
  StorageType,
  AckPolicy,
  DeliverPolicy,
} from 'nats';
import type { Logger } from 'pino';

// --------------------------------------------------------------------------
// Stream Configurations (per SDD §7.1.1)
// --------------------------------------------------------------------------

export interface StreamConfig {
  name: string;
  subjects: string[];
  retention: RetentionPolicy;
  storage: StorageType;
  maxAge: number; // nanoseconds
  maxMsgs?: number;
  maxBytes?: number;
  replicas: number;
  description?: string;
}

/**
 * Stream configurations per SDD §7.1.1
 * - COMMANDS: Slash commands, 60s retention, memory storage
 * - EVENTS: Guild/member events, 5min retention, memory storage
 * - ELIGIBILITY: Token checks, 7 days retention, file storage
 * - INTERNAL: Health/metrics, 1min retention, memory storage
 */
export const STREAM_CONFIGS: StreamConfig[] = [
  {
    name: 'COMMANDS',
    subjects: ['commands.>'],
    retention: RetentionPolicy.Workqueue, // Messages removed after ACK
    storage: StorageType.Memory,
    maxAge: 60 * 1_000_000_000, // 60 seconds in nanoseconds
    maxMsgs: 100_000,
    replicas: 3,
    description: 'Slash command interactions from Discord',
  },
  {
    name: 'EVENTS',
    subjects: ['events.>'],
    retention: RetentionPolicy.Limits,
    storage: StorageType.Memory,
    maxAge: 5 * 60 * 1_000_000_000, // 5 minutes
    maxMsgs: 500_000,
    replicas: 3,
    description: 'Guild and member lifecycle events',
  },
  {
    name: 'ELIGIBILITY',
    subjects: ['eligibility.>'],
    retention: RetentionPolicy.Limits,
    storage: StorageType.File, // Persistent for auditing
    maxAge: 7 * 24 * 60 * 60 * 1_000_000_000, // 7 days
    maxBytes: 1_000_000_000, // 1GB
    replicas: 3,
    description: 'Token eligibility checks and results',
  },
  {
    name: 'INTERNAL',
    subjects: ['internal.>'],
    retention: RetentionPolicy.Limits,
    storage: StorageType.Memory,
    maxAge: 60 * 1_000_000_000, // 1 minute
    maxMsgs: 10_000,
    replicas: 1, // Single replica for internal comms
    description: 'Internal health and metrics messages',
  },
];

// --------------------------------------------------------------------------
// Consumer Configurations (per SDD §7.3)
// --------------------------------------------------------------------------

export interface ConsumerConfig {
  streamName: string;
  consumerName: string;
  filterSubjects: string[];
  ackPolicy: AckPolicy;
  maxAckPending: number;
  ackWait: number; // milliseconds
  maxDeliver: number;
  description?: string;
}

export const CONSUMER_CONFIGS: ConsumerConfig[] = [
  {
    streamName: 'COMMANDS',
    consumerName: 'command-worker',
    filterSubjects: ['commands.>'],
    ackPolicy: AckPolicy.Explicit,
    maxAckPending: 50,
    ackWait: 30_000, // 30 seconds
    maxDeliver: 3,
    description: 'Processes slash commands',
  },
  {
    streamName: 'EVENTS',
    consumerName: 'event-worker',
    filterSubjects: ['events.>'],
    ackPolicy: AckPolicy.Explicit,
    maxAckPending: 100,
    ackWait: 15_000, // 15 seconds
    maxDeliver: 5,
    description: 'Processes guild/member events',
  },
  {
    streamName: 'ELIGIBILITY',
    consumerName: 'eligibility-worker',
    filterSubjects: ['eligibility.check.*'],
    ackPolicy: AckPolicy.Explicit,
    maxAckPending: 200,
    ackWait: 60_000, // 60 seconds (RPC calls can be slow)
    maxDeliver: 3,
    description: 'Processes eligibility checks',
  },
  {
    streamName: 'ELIGIBILITY',
    consumerName: 'sync-worker',
    filterSubjects: ['eligibility.sync.*'],
    ackPolicy: AckPolicy.Explicit,
    maxAckPending: 10,
    ackWait: 300_000, // 5 minutes (community syncs are long)
    maxDeliver: 2,
    description: 'Processes community-wide eligibility syncs',
  },
];

// --------------------------------------------------------------------------
// NATS Client
// --------------------------------------------------------------------------

export interface NatsClientConfig {
  servers: string[];
  name?: string;
  maxReconnectAttempts?: number;
  reconnectTimeWait?: number;
  /** If true, require TLS for all connections (enforced in production) */
  requireTLS?: boolean;
}

export class NatsClient {
  private connection: NatsConnection | null = null;
  private jetstream: JetStreamClient | null = null;
  private jsm: JetStreamManager | null = null;
  private readonly codec = StringCodec();
  private readonly log: Logger;
  private readonly config: NatsClientConfig;

  constructor(config: NatsClientConfig, logger: Logger) {
    this.config = config;
    this.log = logger.child({ component: 'NatsClient' });
  }

  /**
   * Check if any server URL uses TLS
   * SEC-4.4: Used to enforce TLS in production
   */
  private hasTLSServers(): boolean {
    return this.config.servers.some(
      (s) => s.startsWith('tls://') || s.startsWith('nats+tls://') || s.startsWith('wss://')
    );
  }

  /**
   * Connect to NATS and initialize JetStream
   * SEC-4.4: Enforces TLS in production to prevent MITM attacks (L-3)
   */
  async connect(): Promise<void> {
    const podName = process.env['POD_NAME'] || process.env['HOSTNAME'] || 'local';
    const isProduction = process.env['NODE_ENV'] === 'production';

    // SEC-4.4: Enforce TLS in production
    if ((isProduction || this.config.requireTLS) && !this.hasTLSServers()) {
      throw new Error(
        'NATS TLS required in production. Use tls:// or nats+tls:// URL scheme. ' +
        'Current servers: ' + this.config.servers.join(', ')
      );
    }

    this.log.info(
      { servers: this.config.servers, tls: this.hasTLSServers() },
      'Connecting to NATS'
    );

    this.connection = await connect({
      servers: this.config.servers,
      name: this.config.name || `arrakis-worker-${podName}`,
      reconnect: true,
      maxReconnectAttempts: this.config.maxReconnectAttempts ?? -1,
      reconnectTimeWait: this.config.reconnectTimeWait ?? 1000,
    });

    // Handle connection events
    this.connection.closed().then((err) => {
      if (err) {
        this.log.error({ error: err }, 'NATS connection closed with error');
      } else {
        this.log.info('NATS connection closed');
      }
    });

    (async () => {
      for await (const s of this.connection!.status()) {
        this.log.info({ type: s.type, data: s.data }, 'NATS status');
      }
    })().catch(() => {});

    this.jetstream = this.connection.jetstream();
    this.jsm = await this.connection.jetstreamManager();

    this.log.info('Connected to NATS JetStream');
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connection !== null && !this.connection.isClosed();
  }

  /**
   * Get JetStream client
   */
  getJetStream(): JetStreamClient {
    if (!this.jetstream) {
      throw new Error('NATS not connected - call connect() first');
    }
    return this.jetstream;
  }

  /**
   * Get JetStream Manager
   */
  getJetStreamManager(): JetStreamManager {
    if (!this.jsm) {
      throw new Error('NATS not connected - call connect() first');
    }
    return this.jsm;
  }

  /**
   * Initialize all streams (run once at startup or by setup job)
   */
  async ensureStreams(): Promise<void> {
    if (!this.jsm) {
      throw new Error('NATS not connected - call connect() first');
    }

    for (const streamConfig of STREAM_CONFIGS) {
      try {
        const info = await this.jsm.streams.info(streamConfig.name);
        this.log.debug(
          { stream: streamConfig.name, state: info.state },
          'Stream already exists'
        );
      } catch {
        // Stream doesn't exist, create it
        this.log.info({ stream: streamConfig.name }, 'Creating stream');

        await this.jsm.streams.add({
          name: streamConfig.name,
          subjects: streamConfig.subjects,
          retention: streamConfig.retention,
          storage: streamConfig.storage,
          max_age: streamConfig.maxAge,
          max_msgs: streamConfig.maxMsgs,
          max_bytes: streamConfig.maxBytes,
          num_replicas: streamConfig.replicas,
          description: streamConfig.description,
        });

        this.log.info({ stream: streamConfig.name }, 'Stream created');
      }
    }

    this.log.info('All streams initialized');
  }

  /**
   * Initialize consumers (run once at startup)
   */
  async ensureConsumers(): Promise<void> {
    if (!this.jsm) {
      throw new Error('NATS not connected - call connect() first');
    }

    for (const consumerConfig of CONSUMER_CONFIGS) {
      try {
        await this.jsm.consumers.info(
          consumerConfig.streamName,
          consumerConfig.consumerName
        );
        this.log.debug(
          { stream: consumerConfig.streamName, consumer: consumerConfig.consumerName },
          'Consumer already exists'
        );
      } catch {
        // Consumer doesn't exist, create it
        this.log.info(
          { stream: consumerConfig.streamName, consumer: consumerConfig.consumerName },
          'Creating consumer'
        );

        await this.jsm.consumers.add(consumerConfig.streamName, {
          durable_name: consumerConfig.consumerName,
          filter_subjects: consumerConfig.filterSubjects,
          ack_policy: consumerConfig.ackPolicy,
          max_ack_pending: consumerConfig.maxAckPending,
          ack_wait: consumerConfig.ackWait * 1_000_000, // Convert to nanoseconds
          max_deliver: consumerConfig.maxDeliver,
          deliver_policy: DeliverPolicy.All,
          description: consumerConfig.description,
        });

        this.log.info(
          { stream: consumerConfig.streamName, consumer: consumerConfig.consumerName },
          'Consumer created'
        );
      }
    }

    this.log.info('All consumers initialized');
  }

  /**
   * Publish a message to a subject
   */
  async publish(subject: string, data: unknown): Promise<void> {
    if (!this.jetstream) {
      throw new Error('NATS not connected - call connect() first');
    }

    const payload = this.codec.encode(JSON.stringify(data));
    const ack = await this.jetstream.publish(subject, payload);

    this.log.debug(
      { subject, stream: ack.stream, seq: ack.seq },
      'Message published'
    );
  }

  /**
   * Get stream statistics
   */
  async getStreamStats(): Promise<Record<string, { messages: number; bytes: number }>> {
    if (!this.jsm) {
      throw new Error('NATS not connected - call connect() first');
    }

    const stats: Record<string, { messages: number; bytes: number }> = {};

    for (const streamConfig of STREAM_CONFIGS) {
      try {
        const info = await this.jsm.streams.info(streamConfig.name);
        stats[streamConfig.name] = {
          messages: info.state.messages,
          bytes: info.state.bytes,
        };
      } catch {
        stats[streamConfig.name] = { messages: 0, bytes: 0 };
      }
    }

    return stats;
  }

  /**
   * Get consumer lag statistics
   */
  async getConsumerLag(): Promise<Record<string, { pending: number; waiting: number }>> {
    if (!this.jsm) {
      throw new Error('NATS not connected - call connect() first');
    }

    const lag: Record<string, { pending: number; waiting: number }> = {};

    for (const consumerConfig of CONSUMER_CONFIGS) {
      try {
        const info = await this.jsm.consumers.info(
          consumerConfig.streamName,
          consumerConfig.consumerName
        );
        lag[consumerConfig.consumerName] = {
          pending: info.num_pending,
          waiting: info.num_waiting,
        };
      } catch {
        lag[consumerConfig.consumerName] = { pending: 0, waiting: 0 };
      }
    }

    return lag;
  }

  /**
   * Graceful shutdown
   */
  async close(): Promise<void> {
    if (this.connection) {
      this.log.info('Draining NATS connection');
      await this.connection.drain();
      this.log.info('NATS connection drained');
    }
  }
}

// --------------------------------------------------------------------------
// Factory function
// --------------------------------------------------------------------------

/**
 * Create NATS client from environment
 */
export function createNatsClient(logger: Logger): NatsClient {
  const natsUrl = process.env['NATS_URL'];

  if (!natsUrl) {
    throw new Error('NATS_URL environment variable is required');
  }

  return new NatsClient(
    {
      servers: natsUrl.split(','),
      name: `arrakis-worker-${process.env['POD_NAME'] || 'local'}`,
    },
    logger
  );
}
