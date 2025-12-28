/**
 * Synthesis Package (v5.0 - Sprint 44-45)
 *
 * BullMQ-based async Discord operations queue with global rate limiting.
 * Provides queue management, worker processing, job monitoring, and
 * platform-wide Discord API rate limiting.
 *
 * @module synthesis
 */

export { SynthesisQueue, DEFAULT_QUEUE_NAME } from './SynthesisQueue.js';
export { SynthesisWorker, SynthesisError, DiscordAPIError, ResourceNotFoundError, PermissionError } from './SynthesisWorker.js';
export { GlobalDiscordTokenBucket, RateLimitExceededError, TokenBucketError } from './GlobalDiscordTokenBucket.js';
export { GlobalRateLimitedSynthesisWorker } from './GlobalRateLimitedSynthesisWorker.js';
export { ReconciliationController } from './ReconciliationController.js';
export type {
  SynthesisJobType,
  SynthesisJobData,
  SynthesisJobPayload,
  SynthesisJobResult,
  SynthesisJobProgress,
  SynthesisQueueConfig,
  QueueMetrics,
  DeadLetterQueueEntry,
  CreateRoleJobPayload,
  UpdateRoleJobPayload,
  DeleteRoleJobPayload,
  CreateChannelJobPayload,
  UpdateChannelJobPayload,
  DeleteChannelJobPayload,
  CreateCategoryJobPayload,
  UpdateCategoryJobPayload,
  DeleteCategoryJobPayload,
  AssignRoleJobPayload,
  RemoveRoleJobPayload,
  SendMessageJobPayload,
  SynthesizeCommunityJobPayload,
} from './types.js';
export type { TokenBucketConfig, TokenBucketStats } from './GlobalDiscordTokenBucket.js';
export type { GlobalRateLimitedWorkerConfig } from './GlobalRateLimitedSynthesisWorker.js';
export type {
  DriftDetectionResult,
  ReconciliationPlan,
  ReconciliationResult,
  ReconciliationOptions,
  DesiredStateManifest,
  ShadowState,
  ManifestResource,
} from './ReconciliationController.js';
