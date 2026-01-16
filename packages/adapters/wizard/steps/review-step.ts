/**
 * REVIEW Step Handler
 *
 * Sprint S-23: WizardEngine Implementation
 *
 * Seventh step: Configuration review.
 * Users preview the generated manifest before deployment.
 *
 * @see SDD §6.3 WizardEngine
 */

import type { Logger } from 'pino';
import type { StepContext, StepInput, StepResult } from '@arrakis/core/ports';
import type { WizardSession, CommunityManifest } from '@arrakis/core/domain';
import { WizardState } from '@arrakis/core/domain';
import {
  BaseStepHandler,
  createButton,
  createActionRow,
  createNavigationButtons,
  ButtonStyle,
} from './base.js';

// =============================================================================
// REVIEW Step Handler
// =============================================================================

export class ReviewStepHandler extends BaseStepHandler {
  readonly step = WizardState.REVIEW;

  constructor(logger: Logger) {
    super(logger.child({ step: 'REVIEW' }));
  }

  async execute(context: StepContext, input: StepInput): Promise<StepResult> {
    const { data } = input;
    const validated = data.validated as boolean | undefined;

    if (!validated) {
      return this.errorResult('Please review and validate the configuration');
    }

    // Validate session has all required data
    const validation = await this.validate(input, context.session);
    if (!validation.valid) {
      return this.errorResult(validation.errors.join(', '));
    }

    this.log.info(
      { sessionId: context.sessionId },
      'REVIEW step completed - configuration validated'
    );

    return this.successResult(undefined, 'Configuration validated! Ready to deploy.');
  }

  async getDisplay(session: WizardSession): Promise<{
    embeds: unknown[];
    components: unknown[];
  }> {
    const { data } = session;
    const manifest = data.manifest;

    const embed = this.createStepEmbed(
      'Review Configuration',
      `Review your community configuration before deployment.

**Community:** ${data.communityName ?? 'Not set'}

Please verify all settings below are correct. Once you deploy, roles and channels will be created in your Discord server.`,
      session
    );

    const fields: unknown[] = [];

    // Chains summary
    if (data.chains && data.chains.length > 0) {
      fields.push({
        name: '🔗 Blockchains',
        value: data.chains.map((c) => `• ${c.name}`).join('\n'),
        inline: true,
      });
    }

    // Assets summary
    if (data.assets && data.assets.length > 0) {
      fields.push({
        name: '📦 Assets',
        value: data.assets.map((a) => `• ${a.name} (${a.symbol})`).join('\n'),
        inline: true,
      });
    }

    // Rules summary
    if (data.rules && data.rules.length > 0) {
      fields.push({
        name: '📋 Rules',
        value: data.rules.map((r) => `• ${r.description}`).join('\n').slice(0, 1024),
        inline: false,
      });
    }

    // Roles summary
    if (data.tierRoles && data.tierRoles.length > 0) {
      fields.push({
        name: '🎭 Roles',
        value: data.tierRoles.map((r) => {
          const colorHex = r.roleColor.toString(16).padStart(6, '0');
          return `• ${r.roleName} (#${colorHex})`;
        }).join('\n'),
        inline: true,
      });
    }

    // Channels summary
    if (data.channelTemplate) {
      const channelCount = data.customChannels?.length ?? 0;
      fields.push({
        name: '📺 Channels',
        value: `Template: ${data.channelTemplate}\n${channelCount > 0 ? `Custom channels: ${channelCount}` : ''}`,
        inline: true,
      });
    }

    // Validation status
    if (data.validated) {
      fields.push({
        name: '✅ Status',
        value: 'Configuration validated',
        inline: false,
      });
    } else {
      fields.push({
        name: '⚠️ Status',
        value: 'Click **Validate** to verify configuration',
        inline: false,
      });
    }

    (embed as { fields?: unknown[] }).fields = fields;

    const components = [
      createActionRow([
        createButton(
          'wizard:review:validate',
          data.validated ? 'Re-Validate' : 'Validate',
          data.validated ? ButtonStyle.Secondary : ButtonStyle.Primary,
          false,
          '✓'
        ),
        createButton('wizard:review:download', 'Download Manifest', ButtonStyle.Secondary, !manifest, '📥'),
      ]),
      createNavigationButtons('review', true, !data.validated),
    ];

    return { embeds: [embed], components };
  }

  async validate(
    input: StepInput,
    session: WizardSession
  ): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    const { data } = session;

    // Validate all previous steps have data
    if (!data.communityName?.trim()) {
      errors.push('Community name is required');
    }

    if (!data.chains || data.chains.length === 0) {
      errors.push('At least one blockchain must be selected');
    }

    if (!data.assets || data.assets.length === 0) {
      errors.push('At least one asset must be configured');
    }

    if (!data.rules || data.rules.length === 0) {
      errors.push('At least one eligibility rule must be configured');
    }

    if (!data.tierRoles || data.tierRoles.length === 0) {
      errors.push('At least one tier role mapping is required');
    }

    if (!data.channelTemplate) {
      errors.push('Channel template must be selected');
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Format manifest as JSON for download.
   */
  formatManifestForDownload(manifest: CommunityManifest): string {
    return JSON.stringify(manifest, null, 2);
  }

  /**
   * Generate a summary string for the manifest.
   */
  generateSummary(manifest: CommunityManifest): string {
    const lines = [
      `**${manifest.name}** Configuration Summary`,
      '',
      `**Version:** ${manifest.version}`,
      `**Theme:** ${manifest.themeId}`,
      '',
      `**Chains:** ${manifest.chains.length}`,
      manifest.chains.map((c) => `  • ${c.name} (${c.chainId})`).join('\n'),
      '',
      `**Assets:** ${manifest.assets.length}`,
      manifest.assets.map((a) => `  • ${a.name} (${a.symbol})`).join('\n'),
      '',
      `**Rules:** ${manifest.rules.length}`,
      manifest.rules.map((r) => `  • ${r.description}`).join('\n'),
      '',
      `**Roles:** ${manifest.tierRoles.length}`,
      manifest.tierRoles.map((r) => `  • ${r.roleName}`).join('\n'),
      '',
      `**Channel Template:** ${manifest.channelTemplate}`,
    ];

    if (manifest.channels && manifest.channels.length > 0) {
      lines.push(
        '',
        `**Custom Channels:** ${manifest.channels.length}`,
        ...manifest.channels.map((c) => `  • ${c.name} (${c.type})`)
      );
    }

    return lines.join('\n');
  }
}

/**
 * Create a REVIEW step handler.
 */
export function createReviewStepHandler(logger: Logger): ReviewStepHandler {
  return new ReviewStepHandler(logger);
}
