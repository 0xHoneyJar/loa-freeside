/**
 * The Shadow Mode order book — sprint item ② of the order-counter foundation.
 *
 * "Ordering a community" (Freeside-as-Subway) = placing a CommunityOrder: a
 * CoexistenceConfig (which community, which guild, what mode) + its eligibility rules.
 * The counter (today: seeded by hand; later: freeside-cli / code mode) WRITES orders
 * here; the shadow sweep READS them (getShadowModeCommunities → getEligibilityRules →
 * the IEligibilityChecker). Graduation (shadow → parallel → primary) is an updateConfig.
 *
 * In-memory + seedable for run #1 (operator: "run Pythenians manually first, automate
 * later"). A durable store (Postgres) swaps in behind the same shape when the counter
 * grows order/apply verbs. Method names mirror ICommunityRepository / IShadowSync so the
 * sweep wire (item ③) adapts this with no impedance.
 *
 * @see grimoires/loa/context/arch-brief-shadow-order-counter-convergence.md
 */
import type { CoexistenceConfig } from '@freeside/core/domain';
import type { EligibilityRule } from './shadow-sync-job.js';

/** One placed order: a community's coexistence config + the rules its eligibility is judged by. */
export interface CommunityOrder {
  readonly config: CoexistenceConfig;
  readonly eligibilityRules: readonly EligibilityRule[];
}

/** The order book. Reads never throw on an unknown community (fail-safe: absent = not ordered). */
export interface OrderRegistry {
  /** Place (or replace) an order. The counter's write verb. */
  place(order: CommunityOrder): void;
  /** The full order for a community, or undefined if not ordered. */
  get(communityId: string): CommunityOrder | undefined;
  /** The coexistence config (IShadowSync.getConfig shape). */
  getConfig(communityId: string): CoexistenceConfig | undefined;
  /** The eligibility rules (ICommunityRepository.getEligibilityRules shape); [] if not ordered. */
  getEligibilityRules(communityId: string): readonly EligibilityRule[];
  /** Communities currently in `shadow` mode — what the 6h sweep iterates. */
  getShadowModeCommunities(): string[];
  /** Patch a config in place (graduation: mode flip, accuracy/shadowDays accrual). No-op if absent. */
  updateConfig(communityId: string, patch: Partial<CoexistenceConfig>): void;
}

export function makeInMemoryOrderRegistry(seed: readonly CommunityOrder[] = []): OrderRegistry {
  const book = new Map<string, CommunityOrder>();
  for (const order of seed) book.set(order.config.communityId, order);

  // Store + return DEEP COPIES. The `readonly` types are compile-time only; this is the runtime
  // enforcement that a caller cannot reach into stored state through a getter (or by mutating an
  // order it placed) — e.g. flip a graduated community's mode back to `shadow` and resurrect it
  // into the sweep, which reads `o.config.mode` live. (FAGAN M-2)
  const clone = <T>(v: T): T => structuredClone(v);
  return {
    place(order) {
      book.set(order.config.communityId, clone(order));
    },
    get(communityId) {
      const o = book.get(communityId);
      return o ? clone(o) : undefined;
    },
    getConfig(communityId) {
      const o = book.get(communityId);
      return o ? clone(o.config) : undefined;
    },
    getEligibilityRules(communityId) {
      const o = book.get(communityId);
      return o ? clone(o.eligibilityRules) : [];
    },
    getShadowModeCommunities() {
      return [...book.values()].filter((o) => o.config.mode === 'shadow').map((o) => o.config.communityId);
    },
    updateConfig(communityId, patch) {
      const order = book.get(communityId);
      if (!order) return; // fail-safe: never resurrect an un-ordered community
      book.set(communityId, { ...order, config: { ...order.config, ...patch } });
    },
  };
}
