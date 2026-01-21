/**
 * Theme Services
 *
 * Services for the WYSIWYG theme builder.
 * Sprint 3: Web3 Layer - Chain Service
 *
 * @module services/theme
 */

// Chain service
export {
  ThemeChainService,
  themeChainService,
  type RpcEndpointHealth,
  type ChainClientConfig,
} from './ThemeChainService.js';

// Contract read service
export {
  ContractReadService,
  contractReadService,
  type CacheProvider,
  type ContractReadOptions,
} from './ContractReadService.js';

// Contract validation service
export {
  ContractValidationService,
  contractValidationService,
  addToBlocklist,
  isBlocklisted,
  type ValidateContractInput,
  type AbiValidationResult,
} from './ContractValidationService.js';

// Re-export chain configuration utilities
export {
  SUPPORTED_CHAIN_IDS,
  isSupportedChainId,
  getChainConfig,
  getChainConfigSafe,
  getChainName,
  getAllChainConfigs,
  validateChainId,
} from './ThemeChainService.js';

// Component registry
export {
  ComponentRegistry,
  componentRegistry,
  type ComponentRegistration,
} from './ComponentRegistry.js';

// Component definitions
export {
  registerMVPComponents,
  getMVPComponentDefinitions,
  TokenGateComponent,
  NFTGalleryComponent,
  LeaderboardComponent,
  ProfileCardComponent,
  RichTextComponent,
  LayoutContainerComponent,
} from './components/index.js';
