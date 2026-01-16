/**
 * DEPLOY Step Handler
 *
 * Sprint S-23: WizardEngine Implementation
 *
 * Eighth and final step: Deployment.
 * Triggers the SynthesisEngine to create roles and channels.
 *
 * @see SDD §6.3 WizardEngine
 */

import type { Logger } from 'pino';
import type { StepContext, StepInput, StepResult } from '@arrakis/core/ports';
import type { WizardSession, DeploymentStatus } from '@arrakis/core/domain';
import { WizardState } from '@arrakis/core/domain';
import {
  BaseStepHandler,
  createButton,
  createActionRow,
  ButtonStyle,
} from './base.js';

// =============================================================================
// Deployment Status Display
// =============================================================================

const STATUS_DISPLAY: Record<
  DeploymentStatus,
  { emoji: string; label: string; color: number }
> = {
  pending: { emoji: '⏳', label: 'Pending', color: 0x95a5a6 },
  roles_creating: { emoji: '🎭', label: 'Creating Roles', color: 0x3498db },
  roles_created: { emoji: '✅', label: 'Roles Created', color: 0x2ecc71 },
  channels_creating: { emoji: '📺', label: 'Creating Channels', color: 0x3498db },
  channels_created: { emoji: '✅', label: 'Channels Created', color: 0x2ecc71 },
  permissions_setting: { emoji: '🔒', label: 'Setting Permissions', color: 0x3498db },
  completed: { emoji: '🎉', label: 'Completed', color: 0x2ecc71 },
  failed: { emoji: '❌', label: 'Failed', color: 0xe74c3c },
};

// =============================================================================
// DEPLOY Step Handler
// =============================================================================

export class DeployStepHandler extends BaseStepHandler {
  readonly step = WizardState.DEPLOY;

  constructor(logger: Logger) {
    super(logger.child({ step: 'DEPLOY' }));
  }

  async execute(context: StepContext, input: StepInput): Promise<StepResult> {
    const { data } = input;
    const confirmed = data.confirmed as boolean | undefined;

    if (!confirmed) {
      return this.errorResult('Please confirm deployment');
    }

    // Validate session is ready for deployment
    const validation = await this.validate(input, context.session);
    if (!validation.valid) {
      return this.errorResult(validation.errors.join(', '));
    }

    this.log.info(
      { sessionId: context.sessionId },
      'DEPLOY step - deployment confirmed'
    );

    // Note: Actual deployment is triggered by WizardEngine.deploy()
    // This handler just validates and confirms the request

    return this.successResult(
      undefined,
      'Deployment initiated! Your roles and channels are being created...'
    );
  }

  async getDisplay(session: WizardSession): Promise<{
    embeds: unknown[];
    components: unknown[];
  }> {
    const { data } = session;
    const status = data.deploymentStatus ?? 'pending';
    const statusInfo = STATUS_DISPLAY[status];

    const embed = this.createStepEmbed(
      'Deploy Configuration',
      status === 'pending'
        ? `You're about to deploy your community configuration!

**Community:** ${data.communityName ?? 'Not set'}

This will create:
• ${data.tierRoles?.length ?? 0} role(s)
• ${data.customChannels?.length ?? 0} channel(s) ${data.channelTemplate !== 'custom' ? `(${data.channelTemplate} template)` : ''}

⚠️ **Warning:** This action will modify your Discord server. Make sure you have reviewed all settings.`
        : `Deployment in progress...

**Status:** ${statusInfo.emoji} ${statusInfo.label}`,
      session
    );

    // Update embed color based on status
    (embed as { color?: number }).color = statusInfo.color;

    const fields: unknown[] = [];

    // Show deployment progress
    if (status !== 'pending') {
      const progress = this.calculateProgress(status);
      fields.push({
        name: 'Progress',
        value: this.createProgressBar(progress),
        inline: false,
      });
    }

    // Show job ID if available
    if (data.synthesisJobId) {
      fields.push({
        name: 'Job ID',
        value: `\`${data.synthesisJobId}\``,
        inline: true,
      });
    }

    // Show error if failed
    if (status === 'failed' && data.deploymentError) {
      fields.push({
        name: '❌ Error',
        value: data.deploymentError,
        inline: false,
      });
    }

    // Show completion message
    if (status === 'completed') {
      fields.push({
        name: '🎉 Success',
        value: 'Your community has been set up successfully! Your members can now connect their wallets to verify eligibility.',
        inline: false,
      });
    }

    if (fields.length > 0) {
      (embed as { fields?: unknown[] }).fields = fields;
    }

    // Components based on status
    const components: Record<string, unknown>[] = [];

    if (status === 'pending') {
      components.push(
        createActionRow([
          createButton('wizard:deploy:confirm', 'Deploy Now', ButtonStyle.Success, false, '🚀'),
          createButton('wizard:deploy:back', 'Back to Review', ButtonStyle.Secondary, false, '◀️'),
          createButton('wizard:deploy:cancel', 'Cancel', ButtonStyle.Danger, false, '✖️'),
        ])
      );
    } else if (status === 'failed') {
      components.push(
        createActionRow([
          createButton('wizard:deploy:retry', 'Retry Deployment', ButtonStyle.Primary, false, '🔄'),
          createButton('wizard:deploy:back', 'Back to Review', ButtonStyle.Secondary, false, '◀️'),
          createButton('wizard:deploy:cancel', 'Cancel', ButtonStyle.Danger, false, '✖️'),
        ])
      );
    } else if (status === 'completed') {
      components.push(
        createActionRow([
          createButton('wizard:deploy:done', 'Finish Setup', ButtonStyle.Success, false, '✅'),
          createButton('wizard:deploy:view', 'View Configuration', ButtonStyle.Secondary, false, '📄'),
        ])
      );
    } else {
      // In progress - show refresh button
      components.push(
        createActionRow([
          createButton('wizard:deploy:refresh', 'Refresh Status', ButtonStyle.Secondary, false, '🔄'),
          createButton('wizard:deploy:cancel', 'Cancel Deployment', ButtonStyle.Danger, false, '✖️'),
        ])
      );
    }

    return { embeds: [embed], components };
  }

  async validate(
    input: StepInput,
    session: WizardSession
  ): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    const { data } = session;

    // Must have validated manifest
    if (!data.manifest) {
      errors.push('Manifest must be generated');
    }

    if (!data.validated) {
      errors.push('Configuration must be validated before deployment');
    }

    // Check not already deploying
    if (data.deploymentStatus && !['pending', 'failed'].includes(data.deploymentStatus)) {
      errors.push('Deployment already in progress');
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Calculate deployment progress percentage.
   */
  private calculateProgress(status: DeploymentStatus): number {
    const progressMap: Record<DeploymentStatus, number> = {
      pending: 0,
      roles_creating: 20,
      roles_created: 40,
      channels_creating: 60,
      channels_created: 80,
      permissions_setting: 90,
      completed: 100,
      failed: 0,
    };
    return progressMap[status];
  }

  /**
   * Create a visual progress bar.
   */
  private createProgressBar(percent: number): string {
    const filled = Math.round(percent / 10);
    const empty = 10 - filled;
    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    return `${bar} ${percent}%`;
  }
}

/**
 * Create a DEPLOY step handler.
 */
export function createDeployStepHandler(logger: Logger): DeployStepHandler {
  return new DeployStepHandler(logger);
}
