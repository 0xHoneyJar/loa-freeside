/**
 * Wizard Step Handlers Index
 *
 * Sprint S-23: WizardEngine Implementation
 *
 * Exports all wizard step handlers.
 *
 * @see SDD §6.3 WizardEngine
 */

// Base utilities
export {
  BaseStepHandler,
  createButton,
  createSelectMenu,
  createActionRow,
  createNavigationButtons,
  ButtonStyle,
} from './base.js';

// Step handlers
export { InitStepHandler, createInitStepHandler } from './init-step.js';
export {
  ChainSelectStepHandler,
  createChainSelectStepHandler,
} from './chain-select-step.js';
export {
  AssetConfigStepHandler,
  createAssetConfigStepHandler,
} from './asset-config-step.js';
export {
  EligibilityRulesStepHandler,
  createEligibilityRulesStepHandler,
} from './eligibility-rules-step.js';
export {
  RoleMappingStepHandler,
  createRoleMappingStepHandler,
} from './role-mapping-step.js';
export {
  ChannelStructureStepHandler,
  createChannelStructureStepHandler,
} from './channel-structure-step.js';
export { ReviewStepHandler, createReviewStepHandler } from './review-step.js';
export { DeployStepHandler, createDeployStepHandler } from './deploy-step.js';

// Factory for creating all step handlers
import type { Logger } from 'pino';
import type { IWizardStepHandler } from '@arrakis/core/ports';
import type { WizardState } from '@arrakis/core/domain';
import { WizardState as WizardStateEnum } from '@arrakis/core/domain';
import { createInitStepHandler } from './init-step.js';
import { createChainSelectStepHandler } from './chain-select-step.js';
import { createAssetConfigStepHandler } from './asset-config-step.js';
import { createEligibilityRulesStepHandler } from './eligibility-rules-step.js';
import { createRoleMappingStepHandler } from './role-mapping-step.js';
import { createChannelStructureStepHandler } from './channel-structure-step.js';
import { createReviewStepHandler } from './review-step.js';
import { createDeployStepHandler } from './deploy-step.js';

/**
 * Create all step handlers.
 *
 * @param logger - Logger instance
 * @returns Map of state to handler
 */
export function createAllStepHandlers(
  logger: Logger
): Map<WizardState, IWizardStepHandler> {
  const handlers = new Map<WizardState, IWizardStepHandler>();

  handlers.set(WizardStateEnum.INIT, createInitStepHandler(logger));
  handlers.set(WizardStateEnum.CHAIN_SELECT, createChainSelectStepHandler(logger));
  handlers.set(WizardStateEnum.ASSET_CONFIG, createAssetConfigStepHandler(logger));
  handlers.set(WizardStateEnum.ELIGIBILITY_RULES, createEligibilityRulesStepHandler(logger));
  handlers.set(WizardStateEnum.ROLE_MAPPING, createRoleMappingStepHandler(logger));
  handlers.set(WizardStateEnum.CHANNEL_STRUCTURE, createChannelStructureStepHandler(logger));
  handlers.set(WizardStateEnum.REVIEW, createReviewStepHandler(logger));
  handlers.set(WizardStateEnum.DEPLOY, createDeployStepHandler(logger));

  return handlers;
}
