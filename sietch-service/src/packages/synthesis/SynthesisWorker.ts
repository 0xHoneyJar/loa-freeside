/**
 * Synthesis Worker (v5.0 - Sprint 44)
 *
 * BullMQ worker that processes Discord synthesis jobs with:
 * - Job-specific handlers for each operation type
 * - Progress tracking for long-running operations
 * - Error handling with retryable/non-retryable classification
 * - Integration with GlobalTokenBucket (Sprint 45)
 *
 * Part of Phase 4: BullMQ + Global Token Bucket
 */

import { Worker, Job, WorkerOptions } from 'bullmq';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Redis = require('ioredis');

import type { Client, Guild, Role, GuildChannel, TextChannel } from 'discord.js';
import type {
  SynthesisJobData,
  SynthesisJobType,
  SynthesisJobResult,
  SynthesisJobProgress,
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

// =============================================================================
// Error Types
// =============================================================================

/**
 * Base error for synthesis operations
 */
export class SynthesisError extends Error {
  constructor(
    message: string,
    public code: string,
    public retryable: boolean
  ) {
    super(message);
    this.name = 'SynthesisError';
  }
}

/**
 * Discord API error (usually retryable)
 */
export class DiscordAPIError extends SynthesisError {
  constructor(message: string, code: string) {
    super(message, code, true);
    this.name = 'DiscordAPIError';
  }
}

/**
 * Resource not found error (not retryable)
 */
export class ResourceNotFoundError extends SynthesisError {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`, 'RESOURCE_NOT_FOUND', false);
    this.name = 'ResourceNotFoundError';
  }
}

/**
 * Permission error (not retryable)
 */
export class PermissionError extends SynthesisError {
  constructor(message: string) {
    super(message, 'PERMISSION_ERROR', false);
    this.name = 'PermissionError';
  }
}

// =============================================================================
// Synthesis Worker Class
// =============================================================================

export interface SynthesisWorkerConfig {
  queueName: string;
  redis: {
    host: string;
    port: number;
    password?: string;
    db?: number;
  };
  concurrency?: number;
  limiter?: {
    max: number;
    duration: number;
  };
  discordClient: Client;
}

/**
 * SynthesisWorker
 *
 * Processes synthesis jobs from the BullMQ queue.
 * Delegates to job-specific handlers based on job type.
 */
export class SynthesisWorker {
  private worker: Worker;
  private discordClient: Client;

  constructor(config: SynthesisWorkerConfig) {
    this.discordClient = config.discordClient;

    const connection = new Redis(config.redis.port, config.redis.host, {
      password: config.redis.password,
      db: config.redis.db || 0,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

    const workerOptions: WorkerOptions = {
      connection,
      concurrency: config.concurrency || 5,
      limiter: config.limiter || {
        max: 10,
        duration: 1000,
      },
    };

    this.worker = new Worker(
      config.queueName,
      async (job: Job) => this.processJob(job),
      workerOptions
    );

    this.setupEventHandlers();
  }

  // ---------------------------------------------------------------------------
  // Job Processing
  // ---------------------------------------------------------------------------

  /**
   * Main job processor - routes to specific handler
   * Protected to allow GlobalRateLimitedSynthesisWorker to wrap with rate limiting
   */
  protected async processJob(job: Job): Promise<SynthesisJobResult> {
    const startTime = Date.now();
    const jobData = job.data as SynthesisJobData;

    try {
      let result: SynthesisJobResult;

      switch (jobData.type) {
        case 'CREATE_ROLE':
          result = await this.handleCreateRole(
            job,
            jobData.payload as CreateRoleJobPayload
          );
          break;

        case 'UPDATE_ROLE':
          result = await this.handleUpdateRole(
            job,
            jobData.payload as UpdateRoleJobPayload
          );
          break;

        case 'DELETE_ROLE':
          result = await this.handleDeleteRole(
            job,
            jobData.payload as DeleteRoleJobPayload
          );
          break;

        case 'CREATE_CHANNEL':
          result = await this.handleCreateChannel(
            job,
            jobData.payload as CreateChannelJobPayload
          );
          break;

        case 'UPDATE_CHANNEL':
          result = await this.handleUpdateChannel(
            job,
            jobData.payload as UpdateChannelJobPayload
          );
          break;

        case 'DELETE_CHANNEL':
          result = await this.handleDeleteChannel(
            job,
            jobData.payload as DeleteChannelJobPayload
          );
          break;

        case 'CREATE_CATEGORY':
          result = await this.handleCreateCategory(
            job,
            jobData.payload as CreateCategoryJobPayload
          );
          break;

        case 'UPDATE_CATEGORY':
          result = await this.handleUpdateCategory(
            job,
            jobData.payload as UpdateCategoryJobPayload
          );
          break;

        case 'DELETE_CATEGORY':
          result = await this.handleDeleteCategory(
            job,
            jobData.payload as DeleteCategoryJobPayload
          );
          break;

        case 'ASSIGN_ROLE':
          result = await this.handleAssignRole(
            job,
            jobData.payload as AssignRoleJobPayload
          );
          break;

        case 'REMOVE_ROLE':
          result = await this.handleRemoveRole(
            job,
            jobData.payload as RemoveRoleJobPayload
          );
          break;

        case 'SEND_MESSAGE':
          result = await this.handleSendMessage(
            job,
            jobData.payload as SendMessageJobPayload
          );
          break;

        case 'SYNTHESIZE_COMMUNITY':
          result = await this.handleSynthesizeCommunity(
            job,
            jobData.payload as SynthesizeCommunityJobPayload
          );
          break;

        default:
          throw new SynthesisError(
            `Unknown job type: ${(jobData as any).type}`,
            'UNKNOWN_JOB_TYPE',
            false
          );
      }

      const duration = Date.now() - startTime;
      return {
        ...result,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      if (error instanceof SynthesisError) {
        return {
          success: false,
          error: {
            code: error.code,
            message: error.message,
            retryable: error.retryable,
          },
          duration,
        };
      }

      // Unknown error - default to retryable
      return {
        success: false,
        error: {
          code: 'UNKNOWN_ERROR',
          message: (error as Error).message,
          retryable: true,
        },
        duration,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Job Handlers
  // ---------------------------------------------------------------------------

  private async handleCreateRole(
    job: Job,
    payload: CreateRoleJobPayload
  ): Promise<SynthesisJobResult> {
    const guild = await this.getGuild(payload.guildId);

    // Security: HIGH-002 - Pre-flight permission check
    await this.validatePermissions(guild, 'ManageRoles');

    // Security: HIGH-002 - Validate requested permissions don't exceed bot's permissions
    await this.validateRequestedPermissions(guild, payload.permissions);

    await job.updateProgress({ current: 1, total: 2, stage: 'creating_role' } as SynthesisJobProgress);

    const role = await guild.roles.create({
      name: payload.name,
      color: payload.color,
      permissions: payload.permissions,
      hoist: payload.hoist,
      mentionable: payload.mentionable,
      position: payload.position,
      reason: payload.reason || 'Arrakis Synthesis',
    });

    await job.updateProgress({ current: 2, total: 2, stage: 'complete' } as SynthesisJobProgress);

    return {
      success: true,
      resourceId: role.id,
      duration: 0, // Set by caller
    };
  }

  private async handleUpdateRole(
    job: Job,
    payload: UpdateRoleJobPayload
  ): Promise<SynthesisJobResult> {
    const guild = await this.getGuild(payload.guildId);
    const role = await this.getRole(guild, payload.roleId);

    // Security: HIGH-002 - Pre-flight permission check with role hierarchy
    await this.validatePermissions(guild, 'ManageRoles', payload.roleId);

    // Security: HIGH-002 - Validate requested permissions
    await this.validateRequestedPermissions(guild, payload.permissions);

    await job.updateProgress({ current: 1, total: 2, stage: 'updating_role' } as SynthesisJobProgress);

    await role.edit({
      name: payload.name,
      color: payload.color,
      permissions: payload.permissions,
      hoist: payload.hoist,
      mentionable: payload.mentionable,
      position: payload.position,
      reason: payload.reason || 'Arrakis Synthesis',
    });

    await job.updateProgress({ current: 2, total: 2, stage: 'complete' } as SynthesisJobProgress);

    return {
      success: true,
      resourceId: role.id,
      duration: 0,
    };
  }

  private async handleDeleteRole(
    job: Job,
    payload: DeleteRoleJobPayload
  ): Promise<SynthesisJobResult> {
    const guild = await this.getGuild(payload.guildId);
    const role = await this.getRole(guild, payload.roleId);

    // Security: HIGH-002 - Pre-flight permission check with role hierarchy
    await this.validatePermissions(guild, 'ManageRoles', payload.roleId);

    await job.updateProgress({ current: 1, total: 2, stage: 'deleting_role' } as SynthesisJobProgress);

    await role.delete(payload.reason || 'Arrakis Synthesis');

    await job.updateProgress({ current: 2, total: 2, stage: 'complete' } as SynthesisJobProgress);

    return {
      success: true,
      resourceId: payload.roleId,
      duration: 0,
    };
  }

  private async handleCreateChannel(
    job: Job,
    payload: CreateChannelJobPayload
  ): Promise<SynthesisJobResult> {
    const guild = await this.getGuild(payload.guildId);

    // Security: HIGH-002 - Pre-flight permission check
    await this.validatePermissions(guild, 'ManageChannels');

    await job.updateProgress({ current: 1, total: 2, stage: 'creating_channel' } as SynthesisJobProgress);

    const channel = await guild.channels.create({
      name: payload.name,
      type: payload.type,
      topic: payload.topic,
      parent: payload.parent,
      permissionOverwrites: payload.permissionOverwrites,
      reason: payload.reason || 'Arrakis Synthesis',
    });

    await job.updateProgress({ current: 2, total: 2, stage: 'complete' } as SynthesisJobProgress);

    return {
      success: true,
      resourceId: channel.id,
      duration: 0,
    };
  }

  private async handleUpdateChannel(
    job: Job,
    payload: UpdateChannelJobPayload
  ): Promise<SynthesisJobResult> {
    const guild = await this.getGuild(payload.guildId);
    const channel = await this.getChannel(guild, payload.channelId);

    // Security: HIGH-002 - Pre-flight permission check
    await this.validatePermissions(guild, 'ManageChannels');

    await job.updateProgress({ current: 1, total: 2, stage: 'updating_channel' } as SynthesisJobProgress);

    await channel.edit({
      name: payload.name,
      topic: payload.topic,
      parent: payload.parent,
      permissionOverwrites: payload.permissionOverwrites,
      reason: payload.reason || 'Arrakis Synthesis',
    });

    await job.updateProgress({ current: 2, total: 2, stage: 'complete' } as SynthesisJobProgress);

    return {
      success: true,
      resourceId: channel.id,
      duration: 0,
    };
  }

  private async handleDeleteChannel(
    job: Job,
    payload: DeleteChannelJobPayload
  ): Promise<SynthesisJobResult> {
    const guild = await this.getGuild(payload.guildId);
    const channel = await this.getChannel(guild, payload.channelId);

    // Security: HIGH-002 - Pre-flight permission check
    await this.validatePermissions(guild, 'ManageChannels');

    await job.updateProgress({ current: 1, total: 2, stage: 'deleting_channel' } as SynthesisJobProgress);

    await channel.delete(payload.reason || 'Arrakis Synthesis');

    await job.updateProgress({ current: 2, total: 2, stage: 'complete' } as SynthesisJobProgress);

    return {
      success: true,
      resourceId: payload.channelId,
      duration: 0,
    };
  }

  private async handleCreateCategory(
    job: Job,
    payload: CreateCategoryJobPayload
  ): Promise<SynthesisJobResult> {
    const guild = await this.getGuild(payload.guildId);

    // Security: HIGH-002 - Pre-flight permission check
    await this.validatePermissions(guild, 'ManageChannels');

    await job.updateProgress({ current: 1, total: 2, stage: 'creating_category' } as SynthesisJobProgress);

    const category = await guild.channels.create({
      name: payload.name,
      type: 4, // Category type
      permissionOverwrites: payload.permissionOverwrites,
      reason: payload.reason || 'Arrakis Synthesis',
    });

    await job.updateProgress({ current: 2, total: 2, stage: 'complete' } as SynthesisJobProgress);

    return {
      success: true,
      resourceId: category.id,
      duration: 0,
    };
  }

  private async handleUpdateCategory(
    job: Job,
    payload: UpdateCategoryJobPayload
  ): Promise<SynthesisJobResult> {
    const guild = await this.getGuild(payload.guildId);
    const category = await this.getChannel(guild, payload.categoryId);

    // Security: HIGH-002 - Pre-flight permission check
    await this.validatePermissions(guild, 'ManageChannels');

    await job.updateProgress({ current: 1, total: 2, stage: 'updating_category' } as SynthesisJobProgress);

    await category.edit({
      name: payload.name,
      permissionOverwrites: payload.permissionOverwrites,
      reason: payload.reason || 'Arrakis Synthesis',
    });

    await job.updateProgress({ current: 2, total: 2, stage: 'complete' } as SynthesisJobProgress);

    return {
      success: true,
      resourceId: category.id,
      duration: 0,
    };
  }

  private async handleDeleteCategory(
    job: Job,
    payload: DeleteCategoryJobPayload
  ): Promise<SynthesisJobResult> {
    const guild = await this.getGuild(payload.guildId);
    const category = await this.getChannel(guild, payload.categoryId);

    // Security: HIGH-002 - Pre-flight permission check
    await this.validatePermissions(guild, 'ManageChannels');

    await job.updateProgress({ current: 1, total: 2, stage: 'deleting_category' } as SynthesisJobProgress);

    await category.delete(payload.reason || 'Arrakis Synthesis');

    await job.updateProgress({ current: 2, total: 2, stage: 'complete' } as SynthesisJobProgress);

    return {
      success: true,
      resourceId: payload.categoryId,
      duration: 0,
    };
  }

  private async handleAssignRole(
    job: Job,
    payload: AssignRoleJobPayload
  ): Promise<SynthesisJobResult> {
    const guild = await this.getGuild(payload.guildId);

    // Security: HIGH-002 - Pre-flight permission check with role hierarchy
    await this.validatePermissions(guild, 'ManageRoles', payload.roleId);

    const member = await guild.members.fetch(payload.userId);

    await job.updateProgress({ current: 1, total: 2, stage: 'assigning_role' } as SynthesisJobProgress);

    await member.roles.add(payload.roleId, payload.reason || 'Arrakis Synthesis');

    await job.updateProgress({ current: 2, total: 2, stage: 'complete' } as SynthesisJobProgress);

    return {
      success: true,
      resourceId: payload.roleId,
      duration: 0,
    };
  }

  private async handleRemoveRole(
    job: Job,
    payload: RemoveRoleJobPayload
  ): Promise<SynthesisJobResult> {
    const guild = await this.getGuild(payload.guildId);

    // Security: HIGH-002 - Pre-flight permission check with role hierarchy
    await this.validatePermissions(guild, 'ManageRoles', payload.roleId);

    const member = await guild.members.fetch(payload.userId);

    await job.updateProgress({ current: 1, total: 2, stage: 'removing_role' } as SynthesisJobProgress);

    await member.roles.remove(payload.roleId, payload.reason || 'Arrakis Synthesis');

    await job.updateProgress({ current: 2, total: 2, stage: 'complete' } as SynthesisJobProgress);

    return {
      success: true,
      resourceId: payload.roleId,
      duration: 0,
    };
  }

  private async handleSendMessage(
    job: Job,
    payload: SendMessageJobPayload
  ): Promise<SynthesisJobResult> {
    const channel = await this.discordClient.channels.fetch(payload.channelId);
    if (!channel || !channel.isTextBased()) {
      throw new ResourceNotFoundError('Channel', payload.channelId);
    }

    await job.updateProgress({ current: 1, total: 2, stage: 'sending_message' } as SynthesisJobProgress);

    const message = await (channel as TextChannel).send({
      content: payload.content,
      embeds: payload.embeds,
      components: payload.components,
    });

    await job.updateProgress({ current: 2, total: 2, stage: 'complete' } as SynthesisJobProgress);

    return {
      success: true,
      resourceId: message.id,
      duration: 0,
    };
  }

  private async handleSynthesizeCommunity(
    job: Job,
    payload: SynthesizeCommunityJobPayload
  ): Promise<SynthesisJobResult> {
    const guild = await this.getGuild(payload.guildId);

    // Security: HIGH-002 - Pre-flight permission checks for community synthesis
    await this.validatePermissions(guild, 'ManageRoles');
    await this.validatePermissions(guild, 'ManageChannels');

    const totalOperations =
      payload.categories.length +
      payload.roles.length +
      payload.channels.length;
    let currentOperation = 0;

    const createdResources: Record<string, string> = {};

    // Create categories first
    for (const categoryPayload of payload.categories) {
      await job.updateProgress({
        current: ++currentOperation,
        total: totalOperations,
        stage: 'creating_categories',
        message: `Creating category: ${categoryPayload.name}`,
      } as SynthesisJobProgress);

      const category = await guild.channels.create({
        name: categoryPayload.name,
        type: 4,
        permissionOverwrites: categoryPayload.permissionOverwrites,
        reason: 'Arrakis Community Synthesis',
      });

      createdResources[categoryPayload.name] = category.id;
    }

    // Create roles
    for (const rolePayload of payload.roles) {
      await job.updateProgress({
        current: ++currentOperation,
        total: totalOperations,
        stage: 'creating_roles',
        message: `Creating role: ${rolePayload.name}`,
      } as SynthesisJobProgress);

      const role = await guild.roles.create({
        name: rolePayload.name,
        color: rolePayload.color,
        permissions: rolePayload.permissions,
        hoist: rolePayload.hoist,
        mentionable: rolePayload.mentionable,
        position: rolePayload.position,
        reason: 'Arrakis Community Synthesis',
      });

      createdResources[rolePayload.name] = role.id;
    }

    // Create channels
    for (const channelPayload of payload.channels) {
      await job.updateProgress({
        current: ++currentOperation,
        total: totalOperations,
        stage: 'creating_channels',
        message: `Creating channel: ${channelPayload.name}`,
      } as SynthesisJobProgress);

      const channel = await guild.channels.create({
        name: channelPayload.name,
        type: channelPayload.type,
        topic: channelPayload.topic,
        parent: channelPayload.parent,
        permissionOverwrites: channelPayload.permissionOverwrites,
        reason: 'Arrakis Community Synthesis',
      });

      createdResources[channelPayload.name] = channel.id;
    }

    return {
      success: true,
      resourceId: payload.manifestId,
      duration: 0,
      metadata: {
        createdResources,
        totalOperations,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async getGuild(guildId: string): Promise<Guild> {
    const guild = await this.discordClient.guilds.fetch(guildId);
    if (!guild) {
      throw new ResourceNotFoundError('Guild', guildId);
    }
    return guild;
  }

  private async getRole(guild: Guild, roleId: string): Promise<Role> {
    const role = await guild.roles.fetch(roleId);
    if (!role) {
      throw new ResourceNotFoundError('Role', roleId);
    }
    return role;
  }

  private async getChannel(guild: Guild, channelId: string): Promise<GuildChannel> {
    const channel = await guild.channels.fetch(channelId);
    if (!channel) {
      throw new ResourceNotFoundError('Channel', channelId);
    }
    return channel;
  }

  /**
   * Validate bot permissions before Discord operations
   *
   * Security: HIGH-002 - Pre-flight permission checks to prevent privilege escalation
   */
  private async validatePermissions(
    guild: Guild,
    operation: 'ManageRoles' | 'ManageChannels' | 'ManageGuild',
    targetRoleId?: string
  ): Promise<void> {
    const botMember = await guild.members.fetchMe();

    // Check bot has required permission
    if (!botMember.permissions.has(operation)) {
      throw new PermissionError(
        `Bot lacks ${operation} permission in guild ${guild.id}`
      );
    }

    // For role operations, check bot role hierarchy
    if (operation === 'ManageRoles' && targetRoleId) {
      const targetRole = await guild.roles.fetch(targetRoleId);
      if (targetRole && targetRole.position >= botMember.roles.highest.position) {
        throw new PermissionError(
          `Cannot modify role ${targetRoleId}: Higher than bot's highest role`
        );
      }
    }
  }

  /**
   * Validate requested permissions don't exceed bot's permissions
   *
   * Security: HIGH-002 - Prevent requesting permissions higher than bot has
   */
  private async validateRequestedPermissions(
    guild: Guild,
    requestedPermissions?: string
  ): Promise<void> {
    if (!requestedPermissions) return;

    const botMember = await guild.members.fetchMe();
    const requestedPerms = BigInt(requestedPermissions);
    const botPerms = botMember.permissions.bitfield;

    // Check if requested permissions exceed bot's permissions
    if ((requestedPerms & ~botPerms) !== 0n) {
      throw new PermissionError(
        `Requested permissions exceed bot's permissions`
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Event Handlers
  // ---------------------------------------------------------------------------

  private setupEventHandlers(): void {
    this.worker.on('completed', (job) => {
      console.log(`[SynthesisWorker] Job ${job.id} completed`);
    });

    this.worker.on('failed', (job, error) => {
      console.error(`[SynthesisWorker] Job ${job?.id} failed:`, error.message);
    });

    this.worker.on('error', (error) => {
      console.error('[SynthesisWorker] Worker error:', error);
    });

    this.worker.on('stalled', (jobId) => {
      console.warn(`[SynthesisWorker] Job ${jobId} stalled`);
    });
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Close the worker
   */
  async close(): Promise<void> {
    await this.worker.close();
  }

  /**
   * Pause the worker
   */
  async pause(): Promise<void> {
    await this.worker.pause();
  }

  /**
   * Resume the worker
   */
  async resume(): Promise<void> {
    await this.worker.resume();
  }
}
