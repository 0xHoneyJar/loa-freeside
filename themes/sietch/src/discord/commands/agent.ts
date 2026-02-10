/**
 * Discord /agent Command
 * Sprint S5-T1: Agent interaction via Discord with streaming message edits
 *
 * Streams AI agent responses via throttled message edits (~500ms).
 * Truncates to Discord 2000 char limit. Shows budget warnings and rate limit info.
 *
 * @see SDD §6.3 Bot Integration
 */

import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { logger } from '../../utils/logger.js';
import type { IAgentGateway, AgentRequestContext } from '@arrakis/core/ports';
import { formatErrorMessage } from '@arrakis/adapters/agent';
import type { AgentErrorCode } from '@arrakis/adapters/agent';
import { deriveIdempotencyKey } from '@arrakis/adapters/agent/idempotency';

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

/** Discord message character limit */
const DISCORD_MAX_LENGTH = 2000;

/** Truncation indicator */
const TRUNCATION_SUFFIX = '\n\n... (response truncated)';

/** Minimum interval between message edits (ms) */
const EDIT_THROTTLE_MS = 500;

/** Model alias choices for Discord slash command */
const MODEL_CHOICES = [
  { name: 'Default (cheap)', value: 'cheap' },
  { name: 'Fast Code', value: 'fast-code' },
  { name: 'Reviewer', value: 'reviewer' },
  { name: 'Reasoning', value: 'reasoning' },
  { name: 'Native', value: 'native' },
] as const;

// --------------------------------------------------------------------------
// Command Definition
// --------------------------------------------------------------------------

export const agentCommand = new SlashCommandBuilder()
  .setName('agent')
  .setDescription('Ask an AI agent a question')
  .addStringOption((option) =>
    option
      .setName('message')
      .setDescription('Your message to the agent')
      .setRequired(true)
      .setMaxLength(4000),
  )
  .addStringOption((option) =>
    option
      .setName('model')
      .setDescription('Model to use (default: cheap)')
      .setRequired(false)
      .addChoices(...MODEL_CHOICES),
  );

// --------------------------------------------------------------------------
// Handler
// --------------------------------------------------------------------------

/** Gateway instance — set during bot initialization */
let gateway: IAgentGateway | null = null;

/** Context builder — injected during initialization */
let buildContext: ((interaction: ChatInputCommandInteraction) => Promise<AgentRequestContext>) | null = null;

/**
 * Initialize the agent command with dependencies.
 * Called during bot setup, not at import time.
 */
export function initAgentCommand(deps: {
  gateway: IAgentGateway;
  buildContext: (interaction: ChatInputCommandInteraction) => Promise<AgentRequestContext>;
}): void {
  gateway = deps.gateway;
  buildContext = deps.buildContext;
}

/**
 * Handle /agent slash command interaction.
 */
export async function handleAgentCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!gateway || !buildContext) {
    await interaction.reply({
      content: 'AI agents are not configured for this server.',
      ephemeral: true,
    });
    return;
  }

  const message = interaction.options.getString('message', true);
  const modelAlias = interaction.options.getString('model') ?? undefined;

  // Defer reply immediately (we'll edit it as we stream)
  await interaction.deferReply();

  try {
    const context = await buildContext(interaction);

    // Per-platform deterministic idempotency key (S11-T2, SDD §9.4)
    context.idempotencyKey = deriveIdempotencyKey({
      platform: 'discord',
      eventId: `interaction:${interaction.id}`,
    });

    let fullContent = '';
    let lastEditTime = 0;
    let budgetWarning = false;

    for await (const event of gateway.stream({
      context,
      agent: 'default',
      messages: [{ role: 'user', content: message }],
      modelAlias: modelAlias as AgentRequestContext['accessLevel'] | undefined,
    })) {
      if (event.type === 'content') {
        fullContent += event.data.text;

        // Throttle edits to avoid rate limits
        const now = Date.now();
        if (now - lastEditTime >= EDIT_THROTTLE_MS) {
          lastEditTime = now;
          await interaction.editReply({
            content: truncate(fullContent + ' ...'),
          });
        }
      } else if (event.type === 'usage') {
        // Check for budget warning (data has costUsd, we check via gateway)
        try {
          const status = await gateway.getBudgetStatus(context.tenantId);
          if (status.warningThresholdReached) {
            budgetWarning = true;
          }
        } catch {
          // Non-critical — skip budget check
        }
      } else if (event.type === 'error') {
        const errorCode = event.data.code as AgentErrorCode;
        const userMessage = formatErrorMessage(errorCode);
        await interaction.editReply({ content: userMessage });
        return;
      }
    }

    // Final edit with complete response
    let finalContent = truncate(fullContent || 'No response generated.');
    if (budgetWarning) {
      finalContent += '\n\n⚠️ Community AI budget is running low.';
    }

    await interaction.editReply({ content: finalContent });
  } catch (err: unknown) {
    const error = err as { code?: string; statusCode?: number; details?: Record<string, unknown>; name?: string };

    // STREAM_RESUME_LOST: generate new key and notify user (S11-T1)
    if (error.name === 'StreamResumeLostError') {
      await interaction.editReply({
        content: 'Stream context expired. Please try again. (restarted)',
      });
      return;
    }

    if (error.code) {
      const errorCode = error.code as AgentErrorCode;
      const params: Record<string, string | number> = {};

      // Add retry-after for rate limits
      if (error.statusCode === 429 && error.details?.retryAfterMs) {
        params.retry_after = Math.ceil(Number(error.details.retryAfterMs) / 1000);
      }

      const userMessage = formatErrorMessage(errorCode, params);
      await interaction.editReply({ content: userMessage });
      return;
    }

    logger.error({ err, userId: interaction.user.id }, 'agent command error');
    await interaction.editReply({
      content: formatErrorMessage('INTERNAL_ERROR'),
    });
  }
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/** Truncate text to Discord's character limit */
function truncate(text: string): string {
  if (text.length <= DISCORD_MAX_LENGTH) return text;
  return text.slice(0, DISCORD_MAX_LENGTH - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX;
}
