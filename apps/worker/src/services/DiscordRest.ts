import { REST } from '@discordjs/rest';
import {
  Routes,
  type RESTPostAPIInteractionCallbackJSONBody,
  type RESTPostAPIWebhookWithTokenJSONBody,
  type RESTPatchAPIWebhookWithTokenMessageJSONBody,
  InteractionResponseType,
  MessageFlags,
} from 'discord-api-types/v10';
import type { Logger } from 'pino';
import type { DeferResult, FollowupResult, RoleResult } from '../types.js';

/**
 * Followup message options
 */
export interface FollowupOptions {
  content?: string;
  embeds?: object[];
  components?: object[];
  flags?: number;
  files?: object[];
}

/**
 * DiscordRestService handles all Discord API interactions via REST.
 * It does NOT use the bot token - it uses interaction tokens for responses.
 *
 * Key methods:
 * - deferReply: Acknowledge interaction (within 3s)
 * - sendFollowup: Send response after deferral
 * - editOriginal: Edit the deferred response
 * - assignRole/removeRole: Manage member roles
 * - sendDM: Send direct message to user
 */
export class DiscordRestService {
  private readonly rest: REST;
  private readonly log: Logger;

  constructor(
    private readonly applicationId: string,
    logger: Logger
  ) {
    this.rest = new REST({ version: '10' });
    this.log = logger.child({ component: 'DiscordRest' });
  }

  /**
   * Defer an interaction response (acknowledge within 3s Discord timeout)
   * Uses the interaction token, NOT bot token
   */
  async deferReply(
    interactionId: string,
    interactionToken: string,
    ephemeral = false
  ): Promise<DeferResult> {
    try {
      const body: RESTPostAPIInteractionCallbackJSONBody = {
        type: InteractionResponseType.DeferredChannelMessageWithSource,
        data: ephemeral ? { flags: MessageFlags.Ephemeral } : undefined,
      };

      await this.rest.post(
        Routes.interactionCallback(interactionId, interactionToken),
        { body, auth: false } // No auth needed for interaction callbacks
      );

      this.log.debug({ interactionId }, 'Deferred interaction response');
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.log.error({ error, interactionId }, 'Failed to defer interaction');
      return { success: false, error: message };
    }
  }

  /**
   * Send a followup message after deferring
   */
  async sendFollowup(
    interactionToken: string,
    options: FollowupOptions
  ): Promise<FollowupResult> {
    try {
      const body: RESTPostAPIWebhookWithTokenJSONBody = {
        content: options.content,
        embeds: options.embeds as any,
        components: options.components as any,
        flags: options.flags,
      };

      const response = await this.rest.post(
        Routes.webhook(this.applicationId, interactionToken),
        { body, auth: false }
      ) as { id: string };

      this.log.debug({ messageId: response.id }, 'Sent followup message');
      return { success: true, messageId: response.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.log.error({ error }, 'Failed to send followup');
      return { success: false, error: message };
    }
  }

  /**
   * Edit the original deferred response
   */
  async editOriginal(
    interactionToken: string,
    options: FollowupOptions
  ): Promise<FollowupResult> {
    try {
      const body: RESTPatchAPIWebhookWithTokenMessageJSONBody = {
        content: options.content,
        embeds: options.embeds as any,
        components: options.components as any,
      };

      const response = await this.rest.patch(
        Routes.webhookMessage(this.applicationId, interactionToken, '@original'),
        { body, auth: false }
      ) as { id: string };

      this.log.debug({ messageId: response.id }, 'Edited original message');
      return { success: true, messageId: response.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.log.error({ error }, 'Failed to edit original');
      return { success: false, error: message };
    }
  }

  /**
   * Defer a component interaction (button/select) by acknowledging
   * Use this when processing will take time
   */
  async deferUpdate(
    interactionId: string,
    interactionToken: string
  ): Promise<DeferResult> {
    try {
      const body: RESTPostAPIInteractionCallbackJSONBody = {
        type: InteractionResponseType.DeferredMessageUpdate,
      };

      await this.rest.post(
        Routes.interactionCallback(interactionId, interactionToken),
        { body, auth: false }
      );

      this.log.debug({ interactionId }, 'Deferred component update');
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.log.error({ error, interactionId }, 'Failed to defer component update');
      return { success: false, error: message };
    }
  }

  /**
   * Update the message that contains the component (for buttons/selects)
   * This is an immediate response, not deferred
   */
  async updateMessage(
    interactionId: string,
    interactionToken: string,
    options: FollowupOptions
  ): Promise<DeferResult> {
    try {
      const body: RESTPostAPIInteractionCallbackJSONBody = {
        type: InteractionResponseType.UpdateMessage,
        data: {
          content: options.content,
          embeds: options.embeds as any,
          components: options.components as any,
        },
      };

      await this.rest.post(
        Routes.interactionCallback(interactionId, interactionToken),
        { body, auth: false }
      );

      this.log.debug({ interactionId }, 'Updated message with component');
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.log.error({ error, interactionId }, 'Failed to update message');
      return { success: false, error: message };
    }
  }

  /**
   * Set the bot token for role management operations
   * This must be called before assignRole/removeRole/sendDM
   */
  setToken(botToken: string): void {
    this.rest.setToken(botToken);
    this.log.debug('Bot token set for role operations');
  }

  /**
   * Assign a role to a guild member
   * Requires bot token to be set
   */
  async assignRole(
    guildId: string,
    userId: string,
    roleId: string
  ): Promise<RoleResult> {
    try {
      await this.rest.put(
        Routes.guildMemberRole(guildId, userId, roleId),
        { auth: true } // Requires bot token
      );

      this.log.debug({ guildId, userId, roleId }, 'Assigned role');
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.log.error({ error, guildId, userId, roleId }, 'Failed to assign role');
      return { success: false, error: message };
    }
  }

  /**
   * Remove a role from a guild member
   * Requires bot token to be set
   */
  async removeRole(
    guildId: string,
    userId: string,
    roleId: string
  ): Promise<RoleResult> {
    try {
      await this.rest.delete(
        Routes.guildMemberRole(guildId, userId, roleId),
        { auth: true }
      );

      this.log.debug({ guildId, userId, roleId }, 'Removed role');
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.log.error({ error, guildId, userId, roleId }, 'Failed to remove role');
      return { success: false, error: message };
    }
  }

  /**
   * Send a direct message to a user
   * Requires bot token to be set
   */
  async sendDM(
    userId: string,
    options: FollowupOptions
  ): Promise<FollowupResult> {
    try {
      // First create DM channel
      const channel = await this.rest.post(
        Routes.userChannels(),
        {
          body: { recipient_id: userId },
          auth: true,
        }
      ) as { id: string };

      // Then send message
      const body = {
        content: options.content,
        embeds: options.embeds,
        components: options.components,
      };

      const response = await this.rest.post(
        Routes.channelMessages(channel.id),
        { body, auth: true }
      ) as { id: string };

      this.log.debug({ userId, messageId: response.id }, 'Sent DM');
      return { success: true, messageId: response.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.log.error({ error, userId }, 'Failed to send DM');
      return { success: false, error: message };
    }
  }

  /**
   * Get guild member information
   * Requires bot token to be set
   */
  async getGuildMember(
    guildId: string,
    userId: string
  ): Promise<{ nickname?: string; roles: string[] } | null> {
    try {
      const member = await this.rest.get(
        Routes.guildMember(guildId, userId),
        { auth: true }
      ) as { nick?: string; roles: string[] };

      return {
        nickname: member.nick,
        roles: member.roles,
      };
    } catch (error) {
      this.log.error({ error, guildId, userId }, 'Failed to get guild member');
      return null;
    }
  }

  /**
   * Respond to an autocomplete interaction
   * Uses the interaction token, NOT bot token
   */
  async respondAutocomplete(
    interactionId: string,
    interactionToken: string,
    choices: Array<{ name: string; value: string }>
  ): Promise<DeferResult> {
    try {
      const body: RESTPostAPIInteractionCallbackJSONBody = {
        type: InteractionResponseType.ApplicationCommandAutocompleteResult,
        data: {
          choices: choices.slice(0, 25), // Discord max 25 choices
        },
      };

      await this.rest.post(
        Routes.interactionCallback(interactionId, interactionToken),
        { body, auth: false }
      );

      this.log.debug({ interactionId, choiceCount: choices.length }, 'Responded to autocomplete');
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.log.error({ error, interactionId }, 'Failed to respond to autocomplete');
      return { success: false, error: message };
    }
  }
}
