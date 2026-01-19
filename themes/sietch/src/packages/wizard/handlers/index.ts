/**
 * Wizard Step Handlers
 *
 * Sprint 42: WizardEngine & Session Store
 *
 * Each handler corresponds to a wizard state and:
 * - Generates the UI for that step (embed + components)
 * - Processes user input
 * - Returns the next state and updated data
 *
 * @module packages/wizard/handlers
 */

export { initHandler } from './initHandler.js';
export { chainSelectHandler } from './chainSelectHandler.js';
export { assetConfigHandler } from './assetConfigHandler.js';
export { eligibilityRulesHandler } from './eligibilityRulesHandler.js';
export { roleMappingHandler } from './roleMappingHandler.js';
export { channelStructureHandler } from './channelStructureHandler.js';
export { reviewHandler } from './reviewHandler.js';
export { deployHandler } from './deployHandler.js';

import { WizardState } from '../WizardState.js';
import type { StepHandler } from '../WizardEngine.js';
import { initHandler } from './initHandler.js';
import { chainSelectHandler } from './chainSelectHandler.js';
import { assetConfigHandler } from './assetConfigHandler.js';
import { eligibilityRulesHandler } from './eligibilityRulesHandler.js';
import { roleMappingHandler } from './roleMappingHandler.js';
import { channelStructureHandler } from './channelStructureHandler.js';
import { reviewHandler } from './reviewHandler.js';
import { deployHandler } from './deployHandler.js';

/**
 * All step handlers mapped by state.
 */
export const stepHandlers: Partial<Record<WizardState, StepHandler>> = {
  [WizardState.INIT]: initHandler,
  [WizardState.CHAIN_SELECT]: chainSelectHandler,
  [WizardState.ASSET_CONFIG]: assetConfigHandler,
  [WizardState.ELIGIBILITY_RULES]: eligibilityRulesHandler,
  [WizardState.ROLE_MAPPING]: roleMappingHandler,
  [WizardState.CHANNEL_STRUCTURE]: channelStructureHandler,
  [WizardState.REVIEW]: reviewHandler,
  [WizardState.DEPLOY]: deployHandler,
};
