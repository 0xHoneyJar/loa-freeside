/**
 * Telegram /agent Command
 * Sprint S5-T2: Agent interaction via Telegram with streaming message edits
 *
 * Streams AI agent responses via throttled editMessageText (~500ms).
 * Truncates to Telegram 4096 char limit.
 *
 * @see SDD §6.3 Bot Integration
 */

import type { BotContext } from '../bot.js';
import type { Bot } from 'grammy';
import { logger } from '../../utils/logger.js';
import type { IAgentGateway, AgentRequestContext } from '@arrakis/core/ports';
import { formatErrorMessage } from '@arrakis/adapters/agent';
import type { AgentErrorCode } from '@arrakis/adapters/agent';
import { deriveIdempotencyKey } from '@arrakis/adapters/agent/idempotency';

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

/** Telegram message character limit */
const TELEGRAM_MAX_LENGTH = 4096;

/** Truncation indicator */
const TRUNCATION_SUFFIX = '\n\n... (response truncated)';

/** Minimum interval between message edits (ms) */
const EDIT_THROTTLE_MS = 500;

// --------------------------------------------------------------------------
// State
// --------------------------------------------------------------------------

/** Gateway instance — set during bot initialization */
let gateway: IAgentGateway | null = null;

/** Context builder — injected during initialization */
let contextBuilder: ((ctx: BotContext) => Promise<AgentRequestContext>) | null = null;

/**
 * Initialize the agent command with dependencies.
 * Called during bot setup, not at import time.
 */
export function initTelegramAgent(deps: {
  gateway: IAgentGateway;
  buildContext: (ctx: BotContext) => Promise<AgentRequestContext>;
}): void {
  gateway = deps.gateway;
  contextBuilder = deps.buildContext;
}

// --------------------------------------------------------------------------
// Handler
// --------------------------------------------------------------------------

/**
 * Handle /agent command in Telegram.
 */
async function handleAgentCommand(ctx: BotContext): Promise<void> {
  if (!gateway || !contextBuilder) {
    await ctx.reply('AI agents are not configured for this bot.');
    return;
  }

  // Extract message text after /agent
  const text = ctx.message?.text ?? '';
  const message = text.replace(/^\/agent\s*/, '').trim();

  if (!message) {
    await ctx.reply(
      'Usage: `/agent <your message>`\n\nExample: `/agent What is the current BGT staking APY?`',
      { parse_mode: 'Markdown' },
    );
    return;
  }

  // Send initial "thinking" message
  const sentMessage = await ctx.reply('Thinking...');

  try {
    const agentContext = await contextBuilder(ctx);

    // Per-platform deterministic idempotency key (S11-T2, SDD §9.4)
    agentContext.idempotencyKey = deriveIdempotencyKey({
      platform: 'telegram',
      eventId: `update:${ctx.update.update_id}`,
    });

    let fullContent = '';
    let lastEditTime = 0;
    let budgetWarning = false;

    for await (const event of gateway.stream({
      context: agentContext,
      agent: 'default',
      messages: [{ role: 'user', content: message }],
    })) {
      if (event.type === 'content') {
        fullContent += event.data.text;

        // Throttle edits to avoid Telegram API rate limits
        const now = Date.now();
        if (now - lastEditTime >= EDIT_THROTTLE_MS) {
          lastEditTime = now;
          try {
            await ctx.api.editMessageText(
              sentMessage.chat.id,
              sentMessage.message_id,
              truncate(fullContent + ' ...'),
            );
          } catch (editErr: unknown) {
            // Telegram returns 400 if content unchanged — ignore
            const msg = (editErr as { message?: string }).message ?? '';
            if (!msg.includes('message is not modified')) {
              logger.debug({ err: editErr }, 'telegram agent: edit failed');
            }
          }
        }
      } else if (event.type === 'usage') {
        try {
          const status = await gateway.getBudgetStatus(agentContext.tenantId);
          if (status.warningThresholdReached) {
            budgetWarning = true;
          }
        } catch {
          // Non-critical
        }
      } else if (event.type === 'error') {
        const errorCode = event.data.code as AgentErrorCode;
        const userMessage = formatErrorMessage(errorCode);
        await ctx.api.editMessageText(
          sentMessage.chat.id,
          sentMessage.message_id,
          userMessage,
        );
        return;
      }
    }

    // Final edit with complete response
    let finalContent = truncate(fullContent || 'No response generated.');
    if (budgetWarning) {
      finalContent += '\n\n⚠️ Community AI budget is running low.';
    }

    await ctx.api.editMessageText(
      sentMessage.chat.id,
      sentMessage.message_id,
      finalContent,
    );
  } catch (err: unknown) {
    const error = err as { code?: string; statusCode?: number; details?: Record<string, unknown>; name?: string };

    // STREAM_RESUME_LOST: notify user (S11-T1)
    if (error.name === 'StreamResumeLostError') {
      await ctx.api.editMessageText(
        sentMessage.chat.id,
        sentMessage.message_id,
        'Stream context expired. Please try again. (restarted)',
      );
      return;
    }

    if (error.code) {
      const errorCode = error.code as AgentErrorCode;
      const params: Record<string, string | number> = {};

      if (error.statusCode === 429 && error.details?.retryAfterMs) {
        params.retry_after = Math.ceil(Number(error.details.retryAfterMs) / 1000);
      }

      const userMessage = formatErrorMessage(errorCode, params);
      await ctx.api.editMessageText(
        sentMessage.chat.id,
        sentMessage.message_id,
        userMessage,
      );
      return;
    }

    logger.error({ err, userId: ctx.from?.id }, 'telegram agent command error');
    await ctx.api.editMessageText(
      sentMessage.chat.id,
      sentMessage.message_id,
      formatErrorMessage('INTERNAL_ERROR'),
    );
  }
}

// --------------------------------------------------------------------------
// Registration
// --------------------------------------------------------------------------

/**
 * Register /agent command with the Telegram bot.
 */
export function registerAgentCommand(bot: Bot<BotContext>): void {
  bot.command('agent', handleAgentCommand);
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/** Truncate text to Telegram's character limit */
function truncate(text: string): string {
  if (text.length <= TELEGRAM_MAX_LENGTH) return text;
  return text.slice(0, TELEGRAM_MAX_LENGTH - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX;
}
