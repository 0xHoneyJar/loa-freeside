/**
 * Synthesis Types (v5.0 - Sprint 44)
 *
 * Type definitions for BullMQ-based Discord synthesis queue.
 * Defines job types, payloads, and results for async Discord operations.
 */

import { z } from 'zod';

/**
 * Synthesis Job Types
 *
 * Each job type represents a discrete Discord API operation.
 */
export enum SynthesisJobType {
  /** Create a Discord role */
  CREATE_ROLE = 'CREATE_ROLE',

  /** Update an existing Discord role */
  UPDATE_ROLE = 'UPDATE_ROLE',

  /** Delete a Discord role */
  DELETE_ROLE = 'DELETE_ROLE',

  /** Create a Discord channel */
  CREATE_CHANNEL = 'CREATE_CHANNEL',

  /** Update an existing Discord channel */
  UPDATE_CHANNEL = 'UPDATE_CHANNEL',

  /** Delete a Discord channel */
  DELETE_CHANNEL = 'DELETE_CHANNEL',

  /** Create a Discord category */
  CREATE_CATEGORY = 'CREATE_CATEGORY',

  /** Update an existing Discord category */
  UPDATE_CATEGORY = 'UPDATE_CATEGORY',

  /** Delete a Discord category */
  DELETE_CATEGORY = 'DELETE_CATEGORY',

  /** Assign a role to a member */
  ASSIGN_ROLE = 'ASSIGN_ROLE',

  /** Remove a role from a member */
  REMOVE_ROLE = 'REMOVE_ROLE',

  /** Send a message to a channel */
  SEND_MESSAGE = 'SEND_MESSAGE',

  /** Full community synthesis (orchestrates multiple operations) */
  SYNTHESIZE_COMMUNITY = 'SYNTHESIZE_COMMUNITY',
}

/**
 * Role Creation Job Payload
 */
export interface CreateRoleJobPayload {
  guildId: string;
  name: string;
  color?: number;
  permissions?: string;
  hoist?: boolean;
  mentionable?: boolean;
  position?: number;
  reason?: string;
}

/**
 * Role Update Job Payload
 */
export interface UpdateRoleJobPayload {
  guildId: string;
  roleId: string;
  name?: string;
  color?: number;
  permissions?: string;
  hoist?: boolean;
  mentionable?: boolean;
  position?: number;
  reason?: string;
}

/**
 * Role Deletion Job Payload
 */
export interface DeleteRoleJobPayload {
  guildId: string;
  roleId: string;
  reason?: string;
}

/**
 * Channel Creation Job Payload
 */
export interface CreateChannelJobPayload {
  guildId: string;
  name: string;
  type?: number; // Discord channel type enum
  topic?: string;
  parent?: string; // Category ID
  permissionOverwrites?: Array<{
    id: string;
    type: 'role' | 'member';
    allow?: string;
    deny?: string;
  }>;
  reason?: string;
}

/**
 * Channel Update Job Payload
 */
export interface UpdateChannelJobPayload {
  guildId: string;
  channelId: string;
  name?: string;
  topic?: string;
  parent?: string;
  permissionOverwrites?: Array<{
    id: string;
    type: 'role' | 'member';
    allow?: string;
    deny?: string;
  }>;
  reason?: string;
}

/**
 * Channel Deletion Job Payload
 */
export interface DeleteChannelJobPayload {
  guildId: string;
  channelId: string;
  reason?: string;
}

/**
 * Category Creation Job Payload
 */
export interface CreateCategoryJobPayload {
  guildId: string;
  name: string;
  permissionOverwrites?: Array<{
    id: string;
    type: 'role' | 'member';
    allow?: string;
    deny?: string;
  }>;
  reason?: string;
}

/**
 * Category Update Job Payload
 */
export interface UpdateCategoryJobPayload {
  guildId: string;
  categoryId: string;
  name?: string;
  permissionOverwrites?: Array<{
    id: string;
    type: 'role' | 'member';
    allow?: string;
    deny?: string;
  }>;
  reason?: string;
}

/**
 * Category Deletion Job Payload
 */
export interface DeleteCategoryJobPayload {
  guildId: string;
  categoryId: string;
  reason?: string;
}

/**
 * Assign Role Job Payload
 */
export interface AssignRoleJobPayload {
  guildId: string;
  userId: string;
  roleId: string;
  reason?: string;
}

/**
 * Remove Role Job Payload
 */
export interface RemoveRoleJobPayload {
  guildId: string;
  userId: string;
  roleId: string;
  reason?: string;
}

/**
 * Send Message Job Payload
 */
export interface SendMessageJobPayload {
  channelId: string;
  content: string;
  embeds?: unknown[];
  components?: unknown[];
}

/**
 * Community Synthesis Job Payload
 *
 * Orchestrates full community synthesis from manifest.
 */
export interface SynthesizeCommunityJobPayload {
  communityId: string;
  guildId: string;
  manifestId: string;
  roles: CreateRoleJobPayload[];
  channels: CreateChannelJobPayload[];
  categories: CreateCategoryJobPayload[];
}

/**
 * Union type for all job payloads
 */
export type SynthesisJobPayload =
  | CreateRoleJobPayload
  | UpdateRoleJobPayload
  | DeleteRoleJobPayload
  | CreateChannelJobPayload
  | UpdateChannelJobPayload
  | DeleteChannelJobPayload
  | CreateCategoryJobPayload
  | UpdateCategoryJobPayload
  | DeleteCategoryJobPayload
  | AssignRoleJobPayload
  | RemoveRoleJobPayload
  | SendMessageJobPayload
  | SynthesizeCommunityJobPayload;

/**
 * Synthesis Job Data
 *
 * Generic job structure for BullMQ.
 */
export interface SynthesisJobData<T = SynthesisJobPayload> {
  type: SynthesisJobType;
  payload: T;
  idempotencyKey: string;
  communityId?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Synthesis Job Result
 *
 * Returned by workers after job completion.
 */
export interface SynthesisJobResult {
  success: boolean;
  resourceId?: string; // Discord resource ID (role/channel ID)
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
  duration: number; // Execution time in milliseconds
  metadata?: Record<string, unknown>;
}

/**
 * Synthesis Job Progress
 *
 * Progress updates for long-running jobs.
 */
export interface SynthesisJobProgress {
  current: number;
  total: number;
  stage: string;
  message?: string;
}

/**
 * Queue Configuration
 */
export interface SynthesisQueueConfig {
  queueName: string;
  redis: {
    host: string;
    port: number;
    password?: string;
    db?: number;
  };
  defaultJobOptions: {
    attempts: number;
    backoff: {
      type: 'exponential';
      delay: number; // Initial delay in ms
    };
    removeOnComplete: boolean | number;
    removeOnFail: boolean | number;
  };
  workerOptions: {
    concurrency: number;
    limiter: {
      max: number; // Max jobs per duration
      duration: number; // Duration in ms
    };
  };
}

/**
 * Queue Metrics
 *
 * For monitoring queue health.
 */
export interface QueueMetrics {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
}

/**
 * Dead Letter Queue Entry
 *
 * Failed jobs moved to dead letter queue.
 */
export interface DeadLetterQueueEntry {
  jobId: string;
  jobType: SynthesisJobType;
  payload: SynthesisJobPayload;
  error: {
    code: string;
    message: string;
    stack?: string;
  };
  attemptsMade: number;
  failedAt: Date;
  communityId?: string;
}

// =============================================================================
// Zod Validation Schemas (Security: HIGH-001)
// =============================================================================

/**
 * Discord Snowflake ID validation (17-19 characters, numeric string)
 */
const DiscordIdSchema = z.string().min(17).max(19).regex(/^\d+$/, 'Must be a numeric string');

/**
 * Discord permissions validation (numeric string, BigInt compatible)
 */
const DiscordPermissionsSchema = z.string().regex(/^\d+$/, 'Must be a numeric string').optional();

/**
 * Audit log reason validation (max 512 chars per Discord API limit)
 */
const ReasonSchema = z.string().max(512, 'Reason exceeds Discord audit log limit (512 chars)').optional();

/**
 * Permission overwrites validation
 */
const PermissionOverwriteSchema = z.object({
  id: DiscordIdSchema,
  type: z.enum(['role', 'member']),
  allow: DiscordPermissionsSchema,
  deny: DiscordPermissionsSchema,
});

/**
 * Create Role Job Payload Schema
 */
export const CreateRoleJobPayloadSchema = z.object({
  guildId: DiscordIdSchema,
  name: z.string().min(1).max(100, 'Role name exceeds Discord limit (100 chars)'),
  color: z.number().int().min(0).max(0xFFFFFF, 'Color must be valid hex (0-0xFFFFFF)').optional(),
  permissions: DiscordPermissionsSchema,
  hoist: z.boolean().optional(),
  mentionable: z.boolean().optional(),
  position: z.number().int().min(0).max(250, 'Position exceeds Discord limit (250)').optional(),
  reason: ReasonSchema,
});

/**
 * Update Role Job Payload Schema
 */
export const UpdateRoleJobPayloadSchema = z.object({
  guildId: DiscordIdSchema,
  roleId: DiscordIdSchema,
  name: z.string().min(1).max(100).optional(),
  color: z.number().int().min(0).max(0xFFFFFF).optional(),
  permissions: DiscordPermissionsSchema,
  hoist: z.boolean().optional(),
  mentionable: z.boolean().optional(),
  position: z.number().int().min(0).max(250).optional(),
  reason: ReasonSchema,
});

/**
 * Delete Role Job Payload Schema
 */
export const DeleteRoleJobPayloadSchema = z.object({
  guildId: DiscordIdSchema,
  roleId: DiscordIdSchema,
  reason: ReasonSchema,
});

/**
 * Create Channel Job Payload Schema
 */
export const CreateChannelJobPayloadSchema = z.object({
  guildId: DiscordIdSchema,
  name: z.string().min(1).max(100, 'Channel name exceeds Discord limit (100 chars)'),
  type: z.number().int().min(0).max(15, 'Invalid Discord channel type').optional(),
  topic: z.string().max(1024, 'Topic exceeds Discord limit (1024 chars)').optional(),
  parent: DiscordIdSchema.optional(),
  permissionOverwrites: z.array(PermissionOverwriteSchema).optional(),
  reason: ReasonSchema,
});

/**
 * Update Channel Job Payload Schema
 */
export const UpdateChannelJobPayloadSchema = z.object({
  guildId: DiscordIdSchema,
  channelId: DiscordIdSchema,
  name: z.string().min(1).max(100).optional(),
  topic: z.string().max(1024).optional(),
  parent: DiscordIdSchema.optional(),
  permissionOverwrites: z.array(PermissionOverwriteSchema).optional(),
  reason: ReasonSchema,
});

/**
 * Delete Channel Job Payload Schema
 */
export const DeleteChannelJobPayloadSchema = z.object({
  guildId: DiscordIdSchema,
  channelId: DiscordIdSchema,
  reason: ReasonSchema,
});

/**
 * Create Category Job Payload Schema
 */
export const CreateCategoryJobPayloadSchema = z.object({
  guildId: DiscordIdSchema,
  name: z.string().min(1).max(100),
  permissionOverwrites: z.array(PermissionOverwriteSchema).optional(),
  reason: ReasonSchema,
});

/**
 * Update Category Job Payload Schema
 */
export const UpdateCategoryJobPayloadSchema = z.object({
  guildId: DiscordIdSchema,
  categoryId: DiscordIdSchema,
  name: z.string().min(1).max(100).optional(),
  permissionOverwrites: z.array(PermissionOverwriteSchema).optional(),
  reason: ReasonSchema,
});

/**
 * Delete Category Job Payload Schema
 */
export const DeleteCategoryJobPayloadSchema = z.object({
  guildId: DiscordIdSchema,
  categoryId: DiscordIdSchema,
  reason: ReasonSchema,
});

/**
 * Assign Role Job Payload Schema
 */
export const AssignRoleJobPayloadSchema = z.object({
  guildId: DiscordIdSchema,
  userId: DiscordIdSchema,
  roleId: DiscordIdSchema,
  reason: ReasonSchema,
});

/**
 * Remove Role Job Payload Schema
 */
export const RemoveRoleJobPayloadSchema = z.object({
  guildId: DiscordIdSchema,
  userId: DiscordIdSchema,
  roleId: DiscordIdSchema,
  reason: ReasonSchema,
});

/**
 * Send Message Job Payload Schema
 */
export const SendMessageJobPayloadSchema = z.object({
  channelId: DiscordIdSchema,
  content: z.string().min(1).max(2000, 'Message content exceeds Discord limit (2000 chars)'),
  embeds: z.array(z.unknown()).max(10, 'Embeds exceed Discord limit (10)').optional(),
  components: z.array(z.unknown()).max(5, 'Components exceed Discord limit (5)').optional(),
});

/**
 * Synthesize Community Job Payload Schema
 */
export const SynthesizeCommunityJobPayloadSchema = z.object({
  communityId: z.string(),
  guildId: DiscordIdSchema,
  manifestId: z.string(),
  roles: z.array(CreateRoleJobPayloadSchema),
  channels: z.array(CreateChannelJobPayloadSchema),
  categories: z.array(CreateCategoryJobPayloadSchema),
});

/**
 * Get validation schema for a specific job type
 */
export function getSchemaForJobType(jobType: SynthesisJobType): z.ZodSchema {
  switch (jobType) {
    case SynthesisJobType.CREATE_ROLE:
      return CreateRoleJobPayloadSchema;
    case SynthesisJobType.UPDATE_ROLE:
      return UpdateRoleJobPayloadSchema;
    case SynthesisJobType.DELETE_ROLE:
      return DeleteRoleJobPayloadSchema;
    case SynthesisJobType.CREATE_CHANNEL:
      return CreateChannelJobPayloadSchema;
    case SynthesisJobType.UPDATE_CHANNEL:
      return UpdateChannelJobPayloadSchema;
    case SynthesisJobType.DELETE_CHANNEL:
      return DeleteChannelJobPayloadSchema;
    case SynthesisJobType.CREATE_CATEGORY:
      return CreateCategoryJobPayloadSchema;
    case SynthesisJobType.UPDATE_CATEGORY:
      return UpdateCategoryJobPayloadSchema;
    case SynthesisJobType.DELETE_CATEGORY:
      return DeleteCategoryJobPayloadSchema;
    case SynthesisJobType.ASSIGN_ROLE:
      return AssignRoleJobPayloadSchema;
    case SynthesisJobType.REMOVE_ROLE:
      return RemoveRoleJobPayloadSchema;
    case SynthesisJobType.SEND_MESSAGE:
      return SendMessageJobPayloadSchema;
    case SynthesisJobType.SYNTHESIZE_COMMUNITY:
      return SynthesizeCommunityJobPayloadSchema;
    default:
      throw new Error(`Unknown job type: ${jobType}`);
  }
}
