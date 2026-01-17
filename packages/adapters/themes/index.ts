/**
 * Theme Adapters
 * Sprint S-17: Theme Interface & BasicTheme
 * Sprint S-18: SietchTheme & Theme Registry
 *
 * Exports theme implementations, registry, and utilities:
 * - BasicTheme: Free 3-tier, 5-badge theme
 * - SietchTheme: Pro 9-tier, 10-badge Dune theme (v4.1 parity)
 * - ThemeRegistry: Centralized theme management
 * - Badge evaluators: Evaluation logic for all badge types
 *
 * @see SDD §6.2 Theme System
 */

// Badge Evaluators
export * from './badge-evaluators.js';

// Theme Implementations
export { BasicTheme, basicTheme } from './basic-theme.js';
export { SietchTheme, sietchTheme } from './sietch-theme.js';

// Theme Registry
export {
  ThemeRegistry,
  themeRegistry,
  type ThemeMetadata,
  type CustomThemeConfig,
  type ThemeRegistryOptions,
} from './theme-registry.js';
