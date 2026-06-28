/**
 * makeScoreEligibilityChecker — the live IEligibilityChecker for the Shadow Mode
 * order-counter (the coexistence layer's keystone seam).
 *
 * Routes Arrakis-eligibility through score-api's per-community wallet profile, so the
 * foundation is community- AND chain-agnostic: score-api hides the chain (svm_gateway
 * for Solana, evm_bronze for EVM), so a Solana community (Pythenians) and an EVM one
 * resolve through the exact same path. The chain never leaks into the coexistence layer.
 *
 * FAIL-CLOSED (this is an access boundary): any error — non-2xx, a 403 out-of-scope key,
 * a timeout, a transport failure, or a response that doesn't match the contract — yields
 * { eligible: false } with source 'native_degraded'. Eligibility is NEVER granted on a
 * degraded read. The community-scoped api key is held server-side only and never logged.
 * A 404 is treated as a real negative (the wallet is not a scored holder), not a degrade.
 *
 * @see grimoires/loa/context/arch-brief-shadow-order-counter-convergence.md
 */
import { z } from 'zod';
import type { ArrakisEligibilityResult } from '@freeside/core/domain';
import type { EligibilityRule, IEligibilityChecker } from './shadow-sync-job.js';

export interface ScoreEligibilityConfig {
  /** score-api base URL. */
  endpoint: string;
  /** community slug (e.g. 'pythenians'); the api key MUST be scoped to it. */
  community: string;
  /** community-scoped x-api-key — server-side only, never logged or returned. */
  apiKey: string;
  /** per-request timeout (default 5s). */
  timeoutMs?: number;
}

/**
 * Injectable fetch of ONE community wallet profile — so the checker is testable without
 * network and the key-handling path is isolated. Returns the HTTP status + parsed body;
 * throws only on a transport failure (which the checker maps to fail-closed).
 */
export type CommunityProfileFetcher = (args: {
  endpoint: string;
  community: string;
  address: string;
  apiKey: string;
  timeoutMs: number;
}) => Promise<{ status: number; body: unknown }>;

const DEGRADED: ArrakisEligibilityResult = {
  eligible: false,
  tier: null,
  score: null,
  source: 'native_degraded',
};

const DEFAULT_TIMEOUT_MS = 5000;

/** The subset of score-api's CommunityWalletProfile this checker reads. A field of the
 *  wrong type fails the parse → fail-closed (contract drift never silently grants). */
const ProfileSchema = z.object({
  tier: z.string().nullable().optional(),
  tier_class: z.string().nullable().optional(),
  combined_score: z.number().nullable().optional(),
  nft_score: z.number().nullable().optional(),
});

export function makeScoreEligibilityChecker(
  config: ScoreEligibilityConfig,
  fetcher: CommunityProfileFetcher = defaultProfileFetcher,
): IEligibilityChecker {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    async checkEligibility(
      rules: EligibilityRule[],
      walletAddress: string,
    ): Promise<ArrakisEligibilityResult> {
      // This checker is score-backed; it cannot soundly evaluate a raw on-chain token_balance.
      // Refuse the whole check (degrade) rather than bank a confident negative for a rule it
      // structurally can't judge — a chain-backed checker owns token_balance. (FAGAN M-1)
      if (rules.some((rule) => rule.ruleType === 'token_balance')) {
        return DEGRADED;
      }
      let res: { status: number; body: unknown };
      try {
        res = await fetcher({
          endpoint: config.endpoint,
          community: config.community,
          address: walletAddress,
          apiKey: config.apiKey,
          timeoutMs,
        });
      } catch {
        return DEGRADED; // transport failure / timeout → never grant
      }

      // 404 = a real negative: the wallet is not a scored holder in this community.
      if (res.status === 404) {
        return { eligible: false, tier: null, score: null, source: 'score_service' };
      }
      // any other non-2xx (403 out-of-scope key, 429, 5xx, …) → couldn't determine → fail-closed.
      if (res.status < 200 || res.status >= 300) {
        return DEGRADED;
      }

      const parsed = ProfileSchema.safeParse(res.body);
      if (!parsed.success) {
        return DEGRADED; // contract drift → fail-closed, never silently grant
      }

      const tier = parsed.data.tier ?? null;
      const score = parsed.data.combined_score ?? null;
      const nftScore = parsed.data.nft_score ?? null;
      const eligible = rules.some((rule) => satisfies(rule, { tier, score, nftScore }));
      return { eligible, tier, score, source: 'score_service' };
    },
  };
}

// Assumes one community = one gating contract = one score-api profile: rule.contractAddress /
// rule.chainId are NOT used to scope the lookup (score-api returns a single community-scoped
// profile). A multi-contract community needs per-contract scoping — tracked follow-up (FAGAN M-3).
function satisfies(
  rule: EligibilityRule,
  p: { tier: string | null; score: number | null; nftScore: number | null },
): boolean {
  switch (rule.ruleType) {
    case 'score_threshold':
      return rule.minScore != null && p.score != null && p.score >= rule.minScore;
    case 'nft_ownership':
      // The wallet HOLDS the gating NFT iff nft_score > 0 — NOT `tier !== null`. tier and
      // combined_score aggregate non-NFT signals too, so a wallet can carry a tier with
      // nft_score 0 and hold nothing; tier-presence would fail OPEN. (FAGAN H-1)
      return p.nftScore !== null && p.nftScore > 0;
    default:
      // token_balance is refused upstream (degrade); any unknown rule denies.
      return false;
  }
}

/**
 * Default network fetcher. Never throws on a non-2xx (it returns the status so the
 * checker maps it); throws only on a transport failure → fail-closed upstream.
 */
export const defaultProfileFetcher: CommunityProfileFetcher = async ({
  endpoint,
  community,
  address,
  apiKey,
  timeoutMs,
}) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const base = endpoint.replace(/\/$/, '');
    const url = `${base}/v1/wallets/${encodeURIComponent(address)}?community=${encodeURIComponent(community)}`;
    const r = await fetch(url, { headers: { 'x-api-key': apiKey }, signal: ctrl.signal });
    const body = await r.json().catch(() => null);
    return { status: r.status, body };
  } finally {
    clearTimeout(timer);
  }
};
