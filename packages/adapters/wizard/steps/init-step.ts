/**
 * INIT Step Handler
 *
 * Sprint S-23: WizardEngine Implementation
 *
 * First step: Welcome and community name entry.
 * Presents a modal to collect the community name.
 *
 * @see SDD §6.3 WizardEngine
 */

import type { Logger } from 'pino';
import type { StepContext, StepInput, StepResult } from '@arrakis/core/ports';
import type { WizardSession } from '@arrakis/core/domain';
import { WizardState } from '@arrakis/core/domain';
import {
  BaseStepHandler,
  createButton,
  createActionRow,
  ButtonStyle,
} from './base.js';

// =============================================================================
// INIT Step Handler
// =============================================================================

export class InitStepHandler extends BaseStepHandler {
  readonly step = WizardState.INIT;

  constructor(logger: Logger) {
    super(logger.child({ step: 'INIT' }));
  }

  async execute(context: StepContext, input: StepInput): Promise<StepResult> {
    const { data } = input;
    const communityName = data.communityName as string | undefined;

    if (!communityName?.trim()) {
      return this.errorResult('Community name is required');
    }

    // Validate community name
    const validation = await this.validate(input, context.session);
    if (!validation.valid) {
      return this.errorResult(validation.errors.join(', '));
    }

    this.log.info(
      { sessionId: context.sessionId, communityName },
      'INIT step completed'
    );

    return this.successResult(undefined, `Community name set to: ${communityName}`);
  }

  async getDisplay(session: WizardSession): Promise<{
    embeds: unknown[];
    components: unknown[];
  }> {
    const embed = this.createStepEmbed(
      'Welcome',
      `Welcome to the community setup wizard! Let's configure your Discord server for token-gated access.

**What we'll set up:**
• Blockchain selection for eligibility checking
• Token/NFT contract configuration
• Membership tier thresholds
• Role mappings for each tier
• Channel structure and permissions

Click **Start Setup** to begin, or **Resume** if you have an existing session.`,
      session
    );

    // Add current value if set
    if (session.data.communityName) {
      (embed as { fields?: unknown[] }).fields = [
        {
          name: 'Community Name',
          value: session.data.communityName,
          inline: true,
        },
      ];
    }

    const components = [
      createActionRow([
        createButton('wizard:init:start', 'Start Setup', ButtonStyle.Primary, false, '🚀'),
        createButton('wizard:init:cancel', 'Cancel', ButtonStyle.Secondary, false, '✖️'),
      ]),
    ];

    return { embeds: [embed], components };
  }

  async validate(
    input: StepInput,
    _session: WizardSession
  ): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    const communityName = input.data.communityName as string | undefined;

    if (!communityName?.trim()) {
      errors.push('Community name is required');
    } else if (communityName.length < 3) {
      errors.push('Community name must be at least 3 characters');
    } else if (communityName.length > 100) {
      errors.push('Community name must be 100 characters or less');
    } else if (!/^[\w\s-]+$/.test(communityName)) {
      errors.push('Community name can only contain letters, numbers, spaces, and hyphens');
    }

    return { valid: errors.length === 0, errors };
  }
}

/**
 * Create an INIT step handler.
 */
export function createInitStepHandler(logger: Logger): InitStepHandler {
  return new InitStepHandler(logger);
}
