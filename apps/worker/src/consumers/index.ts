/**
 * Consumer exports
 *
 * Sprint S-5: Added NATS consumers alongside RabbitMQ (legacy)
 * Sprint S-6: Full NATS migration with handler integration
 * Sprint S-7: RabbitMQ deprecated, NATS is primary
 */

// RabbitMQ consumers - DEPRECATED as of Sprint S-7
// These exports are kept for backwards compatibility only
// Do not use for new code - use NATS consumers instead
/** @deprecated Use CommandNatsConsumer instead */
export { InteractionConsumer } from './InteractionConsumer.js';
/** @deprecated Use EventNatsConsumer instead */
export { EventConsumer } from './EventConsumer.js';

// NATS consumers (Sprint S-5, S-6)
export { BaseNatsConsumer, type BaseConsumerConfig, type ProcessResult } from './BaseNatsConsumer.js';
export { CommandNatsConsumer, createCommandNatsConsumer, type InteractionPayload } from './CommandNatsConsumer.js';
export {
  EventNatsConsumer,
  createEventNatsConsumer,
  createDefaultNatsEventHandlers,
  type GatewayEventPayload,
  type NatsEventHandler,
  type EventHandler, // Alias for backwards compatibility
} from './EventNatsConsumer.js';
export {
  EligibilityNatsConsumer,
  createEligibilityNatsConsumer,
  createSyncNatsConsumer,
  createDefaultEligibilityHandlers,
  type EligibilityCheckPayload,
  type EligibilityResult,
  type EligibilityHandler,
} from './EligibilityNatsConsumer.js';
