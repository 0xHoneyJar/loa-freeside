/**
 * Component Definitions Index
 *
 * Registers all MVP components with the ComponentRegistry.
 * Sprint 5: Component System - Registry & Validators
 *
 * @see grimoires/loa/sdd.md §7.2 MVP Component Definitions
 */

import { componentRegistry } from '../ComponentRegistry.js';
import { TokenGateComponent } from './TokenGateComponent.js';
import { NFTGalleryComponent } from './NFTGalleryComponent.js';
import { LeaderboardComponent } from './LeaderboardComponent.js';
import { ProfileCardComponent } from './ProfileCardComponent.js';
import { RichTextComponent } from './RichTextComponent.js';
import { LayoutContainerComponent } from './LayoutContainerComponent.js';

// =============================================================================
// Register MVP Components
// =============================================================================

/**
 * Register all MVP component definitions
 */
export function registerMVPComponents(): void {
  // Web3 Components
  componentRegistry.registerComponent(TokenGateComponent);
  componentRegistry.registerComponent(NFTGalleryComponent);
  componentRegistry.registerComponent(LeaderboardComponent);
  componentRegistry.registerComponent(ProfileCardComponent);

  // Content Components
  componentRegistry.registerComponent(RichTextComponent);

  // Layout Components
  componentRegistry.registerComponent(LayoutContainerComponent);
}

/**
 * Get all registered component definitions
 */
export function getMVPComponentDefinitions() {
  return [
    TokenGateComponent,
    NFTGalleryComponent,
    LeaderboardComponent,
    ProfileCardComponent,
    RichTextComponent,
    LayoutContainerComponent,
  ];
}

// Re-export individual components for direct access
export { TokenGateComponent } from './TokenGateComponent.js';
export { NFTGalleryComponent } from './NFTGalleryComponent.js';
export { LeaderboardComponent } from './LeaderboardComponent.js';
export { ProfileCardComponent } from './ProfileCardComponent.js';
export { RichTextComponent } from './RichTextComponent.js';
export { LayoutContainerComponent } from './LayoutContainerComponent.js';
