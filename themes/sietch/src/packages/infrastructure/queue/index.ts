/**
 * Queue Infrastructure Module
 *
 * Sprint 69: Unified Tracing & Resilience
 *
 * Provides BullMQ-based queueing infrastructure for
 * reliable async processing with retry and dead letter support.
 *
 * @module packages/infrastructure/queue
 */

export {
  WebhookQueue,
  createWebhookQueue,
} from './WebhookQueue';

export type {
  WebhookJobData,
  WebhookProcessResult,
  WebhookProcessor,
  WebhookQueueOptions,
  QueueMetrics,
} from './WebhookQueue';
