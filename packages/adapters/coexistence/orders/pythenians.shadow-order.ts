/**
 * Pythenians — the first real shadow order (run #1). The foundation's first consumer.
 *
 * CHAIN-FIRST, NO ADMIN REQUIRED (operator frame 2026-06-28): the order is placed in `shadow`
 * mode; eligibility is judged by NFT ownership via score-api, which indexes the Solana collection
 * through svm_gateway. This provides value — the Conviction Distribution + holder analytics — WITHOUT
 * touching the Discord server or needing admin access. Teams see the value, then adopt; no-risk swap.
 *
 * `admin_principals` is empty BY DESIGN: it gates GO-LIVE (the role write), which is deferred until a
 * team adopts (FR-10 deny-all until then). The full Comparison View (chain vs incumbent Discord roles)
 * lights up once the bot is invited to the guild — until then the chain side alone is the value.
 *
 * This config lives here as the first placed order; it moves to the worlds registry / a durable order
 * store as the counter (freeside-cli) matures. @see docs-site/06-shadow-mode.md (the doctrine).
 */
import type { CommunityOrder } from '../order-registry.js';
import type { EligibilityRule } from '../shadow-sync-job.js';
import {
  DEFAULT_MIN_ACCURACY_FOR_PARALLEL,
  DEFAULT_MIN_SHADOW_DAYS_FOR_PARALLEL,
  DEFAULT_SHADOW_SYNC_INTERVAL_HOURS,
} from '@freeside/core/domain';

export const PYTHENIANS_COMMUNITY = 'pythenians';
/** The Pythenians Discord guild (shadow target). */
export const PYTHENIANS_GUILD_ID = '826115122799837205';
/** The Pythenians Solana collection mint (Metaplex), served by score-api via svm_gateway. */
export const PYTHENIANS_COLLECTION = 'pyTh2UtBKfuDW6KCdT3swospYeoLmmKaGujWA91Moru';

const pytheniansNftRule: EligibilityRule = {
  ruleType: 'nft_ownership',
  chainId: '101', // Solana mainnet-beta
  contractAddress: PYTHENIANS_COLLECTION,
};

export const PYTHENIANS_SHADOW_ORDER: CommunityOrder = {
  config: {
    communityId: PYTHENIANS_COMMUNITY,
    guildId: PYTHENIANS_GUILD_ID,
    mode: 'shadow', // read-only; no Discord mutation, no admin needed
    incumbentInfo: null, // detected when the bot joins the guild
    syncIntervalHours: DEFAULT_SHADOW_SYNC_INTERVAL_HOURS,
    lastSyncAt: null,
    shadowAccuracy: null,
    shadowDays: 0,
    minAccuracyForParallel: DEFAULT_MIN_ACCURACY_FOR_PARALLEL,
    minShadowDaysForParallel: DEFAULT_MIN_SHADOW_DAYS_FOR_PARALLEL,
  },
  eligibilityRules: [pytheniansNftRule],
};
