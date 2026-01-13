/**
 * Theme Adapters - Theme Implementations
 *
 * Sprint 36: Theme Interface & BasicTheme
 * Sprint 37: SietchTheme Implementation
 *
 * Provides theme implementations for different subscription tiers:
 * - BasicTheme: Free tier (3 tiers, 5 badges)
 * - SietchTheme: Premium tier (9 tiers, 12 badges)
 *
 * @module packages/adapters/themes
 */

export { BasicTheme, createBasicTheme, basicTheme } from './BasicTheme.js';
export { SietchTheme, createSietchTheme, sietchTheme, BGT_THRESHOLDS, RANK_BOUNDARIES } from './SietchTheme.js';
