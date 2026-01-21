/**
 * Theme Builder Validation Schemas
 *
 * Zod schemas for validating theme configurations, components, and Web3 inputs.
 * Sprint 1: Foundation - Database Schema & Types
 *
 * @see grimoires/loa/sdd.md §4. Data Models
 * @see grimoires/loa/sdd.md §8.1 Contract Validation (Security)
 */

import { z } from 'zod';
import { isAddress, getAddress } from 'viem';

// =============================================================================
// Constants
// =============================================================================

/**
 * Theme name constraints
 */
const THEME_NAME_MIN = 1;
const THEME_NAME_MAX = 100;

/**
 * Theme description constraints
 */
const THEME_DESCRIPTION_MAX = 500;

/**
 * Hex color pattern (with #)
 */
const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

/**
 * Semver pattern
 */
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

/**
 * URL slug pattern (lowercase, alphanumeric, hyphens)
 */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Minimum cache TTL in seconds
 */
const MIN_CACHE_TTL = 60;

/**
 * Maximum cache TTL in seconds (1 day)
 */
const MAX_CACHE_TTL = 86400;

/**
 * Supported chain IDs
 */
const SUPPORTED_CHAIN_IDS = [1, 42161, 10, 8453, 137, 80094] as const;

// =============================================================================
// Base Schemas
// =============================================================================

/**
 * UUID v4 schema for theme IDs
 */
export const themeUuidSchema = z.string().uuid();

/**
 * Hex color schema
 */
export const hexColorSchema = z.string().regex(HEX_COLOR_PATTERN, 'Invalid hex color format');

/**
 * Semver schema
 */
export const semverSchema = z.string().regex(SEMVER_PATTERN, 'Invalid semver format');

/**
 * URL slug schema
 */
export const slugSchema = z.string()
  .min(1)
  .max(50)
  .regex(SLUG_PATTERN, 'Slug must be lowercase alphanumeric with hyphens');

/**
 * Ethereum address schema (validates and checksums)
 */
export const addressSchema = z.string()
  .refine(
    (val) => isAddress(val),
    { message: 'Invalid Ethereum address' }
  )
  .transform((val) => getAddress(val)); // Normalize to checksummed

/**
 * Chain ID schema
 */
export const chainIdSchema = z.number()
  .int()
  .positive()
  .refine(
    (val) => SUPPORTED_CHAIN_IDS.includes(val as typeof SUPPORTED_CHAIN_IDS[number]),
    { message: `Chain ID must be one of: ${SUPPORTED_CHAIN_IDS.join(', ')}` }
  );

/**
 * BigInt as string schema (for serialization)
 */
export const bigintStringSchema = z.string()
  .regex(/^\d+$/, 'Must be a non-negative integer string')
  .refine(
    (val) => {
      try {
        BigInt(val);
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Invalid bigint string' }
  );

/**
 * ISO 8601 timestamp schema
 */
export const timestampSchema = z.string().datetime();

// =============================================================================
// Theme Status & Enums
// =============================================================================

export const themeStatusSchema = z.enum(['draft', 'published']);

export const borderRadiusPresetSchema = z.enum(['none', 'sm', 'md', 'lg', 'full']);

export const spacingPresetSchema = z.enum(['compact', 'comfortable', 'spacious']);

export const fontSourceSchema = z.enum(['system', 'google', 'custom']);

export const pageLayoutSchema = z.enum(['full', 'sidebar', 'dashboard']);

export const pageVisibilitySchema = z.enum(['public', 'members', 'gated']);

export const contractTypeSchema = z.enum(['erc20', 'erc721', 'erc1155', 'custom']);

export const gateTypeSchema = z.enum(['token', 'nft', 'multi']);

export const gateConditionTypeSchema = z.enum(['balance', 'ownership', 'trait']);

export const visibilityConditionTypeSchema = z.enum(['gate', 'role', 'custom']);

export const auditActionSchema = z.enum(['create', 'update', 'publish', 'unpublish', 'delete']);

export const auditActorTypeSchema = z.enum(['user', 'system', 'api']);

export const assetTypeSchema = z.enum(['logo', 'image', 'font', 'favicon']);

export const storageTypeSchema = z.enum(['local', 's3']);

// =============================================================================
// Branding Schemas
// =============================================================================

/**
 * Theme colors schema
 */
export const themeColorsSchema = z.object({
  primary: hexColorSchema,
  secondary: hexColorSchema,
  background: hexColorSchema,
  surface: hexColorSchema,
  text: hexColorSchema,
  textMuted: hexColorSchema,
  accent: hexColorSchema,
  error: hexColorSchema,
  success: hexColorSchema,
  warning: hexColorSchema,
});

/**
 * Font config schema
 */
export const fontConfigSchema = z.object({
  family: z.string().min(1).max(100),
  source: fontSourceSchema,
  url: z.string().url().optional(),
  weights: z.array(z.number().int().min(100).max(900)).min(1),
}).refine(
  (data) => data.source !== 'custom' || data.url !== undefined,
  { message: 'Custom fonts require a URL', path: ['url'] }
);

/**
 * Theme fonts schema
 */
export const themeFontsSchema = z.object({
  heading: fontConfigSchema,
  body: fontConfigSchema,
  mono: fontConfigSchema,
});

/**
 * Theme logo schema
 */
export const themeLogoSchema = z.object({
  url: z.string().url(),
  width: z.number().int().positive().max(2000).optional(),
  height: z.number().int().positive().max(2000).optional(),
  alt: z.string().min(1).max(200),
});

/**
 * Theme branding schema
 */
export const themeBrandingSchema = z.object({
  colors: themeColorsSchema,
  fonts: themeFontsSchema,
  logo: themeLogoSchema.optional(),
  favicon: z.string().url().optional(),
  borderRadius: borderRadiusPresetSchema,
  spacing: spacingPresetSchema,
});

// =============================================================================
// Web3 Schemas
// =============================================================================

/**
 * Base ABI param schema (for tuple components - non-recursive for simplicity)
 * Full recursive support not needed for read-only contract functions.
 */
const baseAbiParamSchema = z.object({
  name: z.string(),
  type: z.string(),
});

/**
 * ABI input schema
 */
export const abiInputSchema = z.object({
  name: z.string(),
  type: z.string(),
  components: z.array(baseAbiParamSchema).optional(),
});

/**
 * ABI output schema
 */
export const abiOutputSchema = z.object({
  name: z.string(),
  type: z.string(),
  components: z.array(baseAbiParamSchema).optional(),
});

/**
 * Contract ABI fragment schema (read-only functions only)
 */
export const contractAbiFragmentSchema = z.object({
  type: z.literal('function'),
  name: z.string().min(1).max(100),
  inputs: z.array(abiInputSchema),
  outputs: z.array(abiOutputSchema),
  stateMutability: z.enum(['view', 'pure']),
});

/**
 * Contract rate limit schema
 */
export const contractRateLimitSchema = z.object({
  maxCalls: z.number().int().positive().max(1000),
  windowSeconds: z.number().int().positive().max(3600),
});

/**
 * Contract binding schema
 */
export const contractBindingSchema = z.object({
  id: themeUuidSchema,
  name: z.string().min(1).max(100),
  chainId: chainIdSchema,
  address: addressSchema,
  abi: z.array(contractAbiFragmentSchema).min(1),
  type: contractTypeSchema,
  verified: z.boolean().optional(),
  cacheTtl: z.number().int().min(MIN_CACHE_TTL).max(MAX_CACHE_TTL),
  rateLimit: contractRateLimitSchema.optional(),
});

/**
 * Native currency schema
 */
export const nativeCurrencySchema = z.object({
  name: z.string().min(1).max(50),
  symbol: z.string().min(1).max(10),
  decimals: z.number().int().min(0).max(18),
});

/**
 * Chain config schema
 */
export const chainConfigSchema = z.object({
  chainId: chainIdSchema,
  name: z.string().min(1).max(50),
  rpcUrl: z.string().url(),
  rpcUrls: z.array(z.string().url()).optional(),
  blockExplorer: z.string().url().optional(),
  nativeCurrency: nativeCurrencySchema,
});

// =============================================================================
// Gate Schemas
// =============================================================================

/**
 * Gate trait filter schema
 */
export const gateTraitFilterSchema = z.object({
  traitType: z.string().min(1).max(100),
  values: z.array(z.string().min(1).max(200)).min(1),
});

/**
 * Gate fallback schema
 */
export const gateFallbackSchema = z.object({
  redirect: z.string().url().optional(),
  message: z.string().max(500).optional(),
});

/**
 * Gate condition schema
 */
export const gateConditionSchema = z.object({
  contractId: themeUuidSchema,
  type: gateConditionTypeSchema,
  minBalance: bigintStringSchema.optional(),
  tokenId: z.string().optional(),
  traits: z.array(gateTraitFilterSchema).optional(),
});

/**
 * Gate config schema
 */
export const gateConfigSchema = z.object({
  type: gateTypeSchema,
  contractId: themeUuidSchema.optional(),
  minBalance: bigintStringSchema.optional(),
  traits: z.array(gateTraitFilterSchema).optional(),
  conditions: z.array(gateConditionSchema).optional(),
  operator: z.enum(['and', 'or']).optional(),
  fallback: gateFallbackSchema.optional(),
}).refine(
  (data) => {
    if (data.type === 'multi') {
      return data.conditions && data.conditions.length > 0 && data.operator;
    }
    return data.contractId !== undefined;
  },
  { message: 'Multi gates require conditions and operator; single gates require contractId' }
);

/**
 * Visibility condition schema
 */
export const visibilityConditionSchema = z.object({
  type: visibilityConditionTypeSchema,
  gateId: themeUuidSchema.optional(),
  roleIds: z.array(z.string()).optional(),
  expression: z.string().max(500).optional(),
}).refine(
  (data) => {
    if (data.type === 'gate') return data.gateId !== undefined;
    if (data.type === 'role') return data.roleIds && data.roleIds.length > 0;
    if (data.type === 'custom') return data.expression !== undefined;
    return true;
  },
  { message: 'Visibility condition requires matching field for its type' }
);

// =============================================================================
// Component Schemas
// =============================================================================

export const componentTypeSchema = z.enum([
  'token-gate',
  'nft-gallery',
  'leaderboard',
  'profile-card',
  'rich-text',
  'layout-container',
  'image',
  'button',
  'divider',
  'spacer',
]);

export const componentCategorySchema = z.enum([
  'web3',
  'content',
  'layout',
  'interactive',
]);

/**
 * Component position schema
 */
export const componentPositionSchema = z.object({
  x: z.number().int().min(0).max(11),
  y: z.number().int().min(0),
  width: z.number().int().min(1).max(12),
  height: z.union([z.number().int().min(1), z.literal('auto')]),
});

/**
 * Component visibility schema
 */
export const componentVisibilitySchema = z.object({
  condition: visibilityConditionSchema.optional(),
});

/**
 * Base component instance schema (props validated separately by type)
 */
export const componentInstanceSchema = z.object({
  id: themeUuidSchema,
  type: componentTypeSchema,
  props: z.record(z.unknown()),
  position: componentPositionSchema,
  visibility: componentVisibilitySchema.optional(),
  label: z.string().max(50).optional(),
});

// =============================================================================
// Page Schemas
// =============================================================================

/**
 * Page meta schema
 */
export const pageMetaSchema = z.object({
  title: z.string().max(100).optional(),
  description: z.string().max(300).optional(),
});

/**
 * Theme page schema
 */
export const themePageSchema = z.object({
  id: themeUuidSchema,
  slug: slugSchema,
  name: z.string().min(1).max(50),
  layout: pageLayoutSchema,
  components: z.array(componentInstanceSchema),
  meta: pageMetaSchema.optional(),
  visibility: pageVisibilitySchema,
  gateConfig: gateConfigSchema.optional(),
}).refine(
  (data) => data.visibility !== 'gated' || data.gateConfig !== undefined,
  { message: 'Gated pages require a gateConfig', path: ['gateConfig'] }
);

// =============================================================================
// Discord Theme Schemas
// =============================================================================

export const discordPermissionModeSchema = z.enum(['greenfield', 'restricted']);

/**
 * Discord embed footer schema
 */
export const discordEmbedFooterSchema = z.object({
  text: z.string().min(1).max(2048),
  iconUrl: z.string().url().optional(),
});

/**
 * Discord embed field schema
 */
export const discordEmbedFieldSchema = z.object({
  name: z.string().min(1).max(256),
  value: z.string().min(1).max(1024),
  inline: z.boolean().optional(),
});

/**
 * Discord embed template schema
 */
export const discordEmbedTemplateSchema = z.object({
  title: z.string().max(256).optional(),
  description: z.string().max(4096).optional(),
  color: z.number().int().min(0).max(16777215).optional(),
  thumbnail: z.boolean().optional(),
  footer: discordEmbedFooterSchema.optional(),
  fields: z.array(discordEmbedFieldSchema).max(25).optional(),
});

/**
 * Discord embed templates schema
 */
export const discordEmbedTemplatesSchema = z.object({
  welcome: discordEmbedTemplateSchema.optional(),
  leaderboard: discordEmbedTemplateSchema.optional(),
  alert: discordEmbedTemplateSchema.optional(),
  custom: z.record(discordEmbedTemplateSchema).optional(),
});

/**
 * Discord colors schema
 */
export const discordColorsSchema = z.object({
  primary: z.number().int().min(0).max(16777215),
  success: z.number().int().min(0).max(16777215),
  warning: z.number().int().min(0).max(16777215),
  error: z.number().int().min(0).max(16777215),
});

/**
 * Discord theme config schema
 */
export const discordThemeConfigSchema = z.object({
  mode: discordPermissionModeSchema,
  embedTemplates: discordEmbedTemplatesSchema,
  colors: discordColorsSchema,
});

// =============================================================================
// Theme Root Schemas
// =============================================================================

/**
 * Theme config schema (JSON stored in database)
 */
export const themeConfigSchema = z.object({
  branding: themeBrandingSchema,
  pages: z.array(themePageSchema),
  contracts: z.array(contractBindingSchema),
  chains: z.array(chainConfigSchema),
  discord: discordThemeConfigSchema.optional(),
});

/**
 * Full theme schema
 */
export const themeSchema = z.object({
  id: themeUuidSchema,
  communityId: z.string().min(1),
  name: z.string().min(THEME_NAME_MIN).max(THEME_NAME_MAX),
  description: z.string().max(THEME_DESCRIPTION_MAX),
  branding: themeBrandingSchema,
  pages: z.array(themePageSchema),
  contracts: z.array(contractBindingSchema),
  chains: z.array(chainConfigSchema),
  discord: discordThemeConfigSchema.optional(),
  status: themeStatusSchema,
  version: semverSchema,
  publishedAt: timestampSchema.optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

// =============================================================================
// API Input Schemas
// =============================================================================

/**
 * Create theme input schema
 */
export const createThemeInputSchema = z.object({
  communityId: z.string().min(1),
  name: z.string().min(THEME_NAME_MIN).max(THEME_NAME_MAX),
  description: z.string().max(THEME_DESCRIPTION_MAX).optional(),
  branding: themeBrandingSchema.partial().optional(),
});

/**
 * Update theme input schema
 */
export const updateThemeInputSchema = z.object({
  name: z.string().min(THEME_NAME_MIN).max(THEME_NAME_MAX).optional(),
  description: z.string().max(THEME_DESCRIPTION_MAX).optional(),
});

/**
 * Partial branding schema for updates (deep partial for colors)
 */
export const partialThemeBrandingSchema = z.object({
  colors: themeColorsSchema.partial().optional(),
  fonts: themeFontsSchema.partial().optional(),
  logo: themeLogoSchema.optional(),
  favicon: z.string().url().optional(),
  borderRadius: borderRadiusPresetSchema.optional(),
  spacing: spacingPresetSchema.optional(),
}).partial();

/**
 * Update theme config input schema
 */
export const updateThemeConfigInputSchema = z.object({
  branding: partialThemeBrandingSchema.optional(),
  pages: z.array(themePageSchema).optional(),
  contracts: z.array(contractBindingSchema).optional(),
  chains: z.array(chainConfigSchema).optional(),
  discord: discordThemeConfigSchema.optional(),
  changeSummary: z.string().max(500).optional(),
});

/**
 * Theme list options schema
 * Note: Query params come as strings, so we coerce to numbers
 */
export const themeListOptionsSchema = z.object({
  communityId: z.string().optional(),
  status: themeStatusSchema.optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  orderBy: z.enum(['created_at', 'updated_at', 'name']).optional(),
  orderDir: z.enum(['asc', 'desc']).optional(),
});

/**
 * Create contract binding input schema
 */
export const createContractBindingInputSchema = z.object({
  name: z.string().min(1).max(100),
  chainId: chainIdSchema,
  address: addressSchema,
  abi: z.array(contractAbiFragmentSchema).optional(),
  type: contractTypeSchema.optional(),
  verified: z.boolean().optional(),
  cacheTtl: z.number().int().min(MIN_CACHE_TTL).max(MAX_CACHE_TTL).optional(),
});

/**
 * Update contract binding input schema
 */
export const updateContractBindingInputSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  abi: z.array(contractAbiFragmentSchema).optional(),
  type: contractTypeSchema.optional(),
  verified: z.boolean().optional(),
  cacheTtl: z.number().int().min(MIN_CACHE_TTL).max(MAX_CACHE_TTL).optional(),
});

/**
 * Validate contract input schema
 */
export const validateContractInputSchema = z.object({
  chainId: chainIdSchema,
  address: addressSchema,
});

// =============================================================================
// Type Exports (inferred from schemas)
// =============================================================================

export type ThemeColorsInput = z.infer<typeof themeColorsSchema>;
export type FontConfigInput = z.infer<typeof fontConfigSchema>;
export type ThemeBrandingInput = z.infer<typeof themeBrandingSchema>;
export type ContractBindingInput = z.infer<typeof contractBindingSchema>;
export type ChainConfigInput = z.infer<typeof chainConfigSchema>;
export type GateConfigInput = z.infer<typeof gateConfigSchema>;
export type ThemePageInput = z.infer<typeof themePageSchema>;
export type ThemeConfigInput = z.infer<typeof themeConfigSchema>;
export type ThemeInput = z.infer<typeof themeSchema>;
export type CreateThemeInput = z.infer<typeof createThemeInputSchema>;
export type UpdateThemeInput = z.infer<typeof updateThemeInputSchema>;
export type UpdateThemeConfigInput = z.infer<typeof updateThemeConfigInputSchema>;
export type ThemeListOptionsInput = z.infer<typeof themeListOptionsSchema>;
export type CreateContractBindingInput = z.infer<typeof createContractBindingInputSchema>;
export type UpdateContractBindingInput = z.infer<typeof updateContractBindingInputSchema>;

// =============================================================================
// Schema Aliases (for route handlers)
// =============================================================================

/** Alias for createContractBindingInputSchema */
export const contractBindingCreateSchema = createContractBindingInputSchema;

/** Alias for updateContractBindingInputSchema */
export const contractBindingUpdateSchema = updateContractBindingInputSchema;
