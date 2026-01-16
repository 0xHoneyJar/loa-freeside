/**
 * ELIGIBILITY_RULES Step Handler
 *
 * Sprint S-23: WizardEngine Implementation
 *
 * Fourth step: Eligibility rule configuration.
 * Users define thresholds and rules for membership tiers.
 *
 * @see SDD §6.3 WizardEngine
 */

import type { Logger } from 'pino';
import type { StepContext, StepInput, StepResult } from '@arrakis/core/ports';
import type {
  WizardSession,
  EligibilityRuleConfig,
  EligibilityRuleType,
} from '@arrakis/core/domain';
import { WizardState } from '@arrakis/core/domain';
import { randomUUID } from 'node:crypto';
import {
  BaseStepHandler,
  createButton,
  createSelectMenu,
  createActionRow,
  createNavigationButtons,
  ButtonStyle,
} from './base.js';

// =============================================================================
// Rule Type Options
// =============================================================================

const RULE_TYPES: Array<{
  type: EligibilityRuleType;
  label: string;
  emoji: string;
  description: string;
}> = [
  {
    type: 'min_balance',
    label: 'Minimum Balance',
    emoji: '💰',
    description: 'Require minimum token balance',
  },
  {
    type: 'nft_ownership',
    label: 'NFT Ownership',
    emoji: '🖼️',
    description: 'Require NFT ownership',
  },
  {
    type: 'min_hold_duration',
    label: 'Hold Duration',
    emoji: '⏱️',
    description: 'Require minimum hold time',
  },
  {
    type: 'score_threshold',
    label: 'Score Threshold',
    emoji: '📊',
    description: 'Require minimum score',
  },
];

// =============================================================================
// Default Tier Thresholds
// =============================================================================

const DEFAULT_TIERS = [
  { name: 'Bronze', minBalance: '1', color: 0xcd7f32 },
  { name: 'Silver', minBalance: '10', color: 0xc0c0c0 },
  { name: 'Gold', minBalance: '100', color: 0xffd700 },
];

// =============================================================================
// ELIGIBILITY_RULES Step Handler
// =============================================================================

export class EligibilityRulesStepHandler extends BaseStepHandler {
  readonly step = WizardState.ELIGIBILITY_RULES;

  constructor(logger: Logger) {
    super(logger.child({ step: 'ELIGIBILITY_RULES' }));
  }

  async execute(context: StepContext, input: StepInput): Promise<StepResult> {
    const { data } = input;
    const rules = data.rules as EligibilityRuleConfig[] | undefined;

    if (!rules || rules.length === 0) {
      return this.errorResult('Please configure at least one eligibility rule');
    }

    // Validate rules
    const validation = await this.validate(input, context.session);
    if (!validation.valid) {
      return this.errorResult(validation.errors.join(', '));
    }

    // Ensure all rules have IDs
    const processedRules = rules.map((rule) => ({
      ...rule,
      id: rule.id || randomUUID(),
    }));

    this.log.info(
      { sessionId: context.sessionId, ruleCount: processedRules.length },
      'ELIGIBILITY_RULES step completed'
    );

    return this.successResult(
      undefined,
      `Configured ${processedRules.length} eligibility rule(s)`
    );
  }

  async getDisplay(session: WizardSession): Promise<{
    embeds: unknown[];
    components: unknown[];
  }> {
    const assets = session.data.assets ?? [];
    const rules = session.data.rules ?? [];

    const embed = this.createStepEmbed(
      'Eligibility Rules',
      `Configure the rules that determine membership tiers.

**Configured Assets:** ${assets.map((a) => a.symbol).join(', ') || 'None'}

Each rule defines criteria for a membership tier. You can create multiple tiers with different thresholds.`,
      session
    );

    // Show existing rules
    if (rules.length > 0) {
      (embed as { fields?: unknown[] }).fields = [
        {
          name: `Configured Rules (${rules.length})`,
          value: rules
            .map((rule) => {
              const typeInfo = RULE_TYPES.find((t) => t.type === rule.type);
              const emoji = typeInfo?.emoji ?? '📋';
              return `${emoji} **${rule.description}**\n   Asset: ${rule.assetId.slice(0, 8)}...`;
            })
            .join('\n\n'),
          inline: false,
        },
      ];
    }

    // Asset select for new rule
    const assetSelect = createSelectMenu(
      'wizard:eligibility:asset',
      'Select asset for rule...',
      assets.map((asset) => ({
        label: `${asset.name} (${asset.symbol})`,
        value: asset.id,
        description: `${asset.type} on ${asset.chainId}`,
      }))
    );

    // Rule type select
    const typeSelect = createSelectMenu(
      'wizard:eligibility:type',
      'Select rule type...',
      RULE_TYPES.map((type) => ({
        label: type.label,
        value: type.type,
        description: type.description,
        emoji: type.emoji,
      }))
    );

    const components = [
      createActionRow([assetSelect]),
      createActionRow([typeSelect]),
      createActionRow([
        createButton('wizard:eligibility:add', 'Add Rule', ButtonStyle.Primary, false, '➕'),
        createButton('wizard:eligibility:defaults', 'Use Defaults', ButtonStyle.Secondary, false, '⚡'),
        createButton('wizard:eligibility:remove', 'Remove Last', ButtonStyle.Secondary, rules.length === 0, '🗑️'),
      ]),
      createNavigationButtons('eligibility', true, rules.length === 0),
    ];

    return { embeds: [embed], components };
  }

  async validate(
    input: StepInput,
    session: WizardSession
  ): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    const rules = input.data.rules as EligibilityRuleConfig[] | undefined;

    if (!rules || rules.length === 0) {
      errors.push('At least one eligibility rule must be configured');
      return { valid: false, errors };
    }

    // Get valid asset IDs from session
    const validAssetIds = new Set(session.data.assets?.map((a) => a.id) ?? []);

    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i]!;
      const prefix = `Rule ${i + 1}`;

      // Validate asset reference
      if (!validAssetIds.has(rule.assetId)) {
        errors.push(`${prefix}: Asset "${rule.assetId}" is not configured`);
      }

      // Validate rule type
      const validTypes = new Set(RULE_TYPES.map((t) => t.type));
      if (!validTypes.has(rule.type)) {
        errors.push(`${prefix}: Invalid rule type "${rule.type}"`);
      }

      // Validate description
      if (!rule.description?.trim()) {
        errors.push(`${prefix}: Description is required`);
      }

      // Validate parameters based on type
      switch (rule.type) {
        case 'min_balance':
          if (!rule.parameters.minBalance) {
            errors.push(`${prefix}: Minimum balance is required`);
          } else {
            const balance = Number(rule.parameters.minBalance);
            if (isNaN(balance) || balance <= 0) {
              errors.push(`${prefix}: Minimum balance must be a positive number`);
            }
          }
          break;
        case 'nft_ownership':
          if (rule.parameters.minCount !== undefined) {
            const count = Number(rule.parameters.minCount);
            if (isNaN(count) || count < 1) {
              errors.push(`${prefix}: Minimum NFT count must be at least 1`);
            }
          }
          break;
        case 'min_hold_duration':
          if (!rule.parameters.durationDays) {
            errors.push(`${prefix}: Hold duration is required`);
          } else {
            const days = Number(rule.parameters.durationDays);
            if (isNaN(days) || days <= 0) {
              errors.push(`${prefix}: Hold duration must be positive`);
            }
          }
          break;
        case 'score_threshold':
          if (!rule.parameters.minScore) {
            errors.push(`${prefix}: Minimum score is required`);
          } else {
            const score = Number(rule.parameters.minScore);
            if (isNaN(score) || score < 0) {
              errors.push(`${prefix}: Score must be non-negative`);
            }
          }
          break;
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Generate default rules based on configured assets.
   */
  generateDefaultRules(assets: WizardSession['data']['assets']): EligibilityRuleConfig[] {
    if (!assets || assets.length === 0) return [];

    const firstAsset = assets[0]!;
    const isNFT = firstAsset.type === 'erc721' || firstAsset.type === 'erc1155';

    if (isNFT) {
      // For NFTs, create ownership tiers
      return [
        {
          id: randomUUID(),
          type: 'nft_ownership',
          assetId: firstAsset.id,
          parameters: { minCount: 1 },
          description: `Own at least 1 ${firstAsset.symbol}`,
        },
        {
          id: randomUUID(),
          type: 'nft_ownership',
          assetId: firstAsset.id,
          parameters: { minCount: 5 },
          description: `Own at least 5 ${firstAsset.symbol}`,
        },
        {
          id: randomUUID(),
          type: 'nft_ownership',
          assetId: firstAsset.id,
          parameters: { minCount: 10 },
          description: `Own at least 10 ${firstAsset.symbol}`,
        },
      ];
    } else {
      // For tokens, create balance tiers
      return DEFAULT_TIERS.map((tier) => ({
        id: randomUUID(),
        type: 'min_balance' as EligibilityRuleType,
        assetId: firstAsset.id,
        parameters: { minBalance: tier.minBalance },
        description: `Hold at least ${tier.minBalance} ${firstAsset.symbol} (${tier.name})`,
      }));
    }
  }
}

/**
 * Create an ELIGIBILITY_RULES step handler.
 */
export function createEligibilityRulesStepHandler(
  logger: Logger
): EligibilityRulesStepHandler {
  return new EligibilityRulesStepHandler(logger);
}
