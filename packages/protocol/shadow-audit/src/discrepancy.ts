/**
 * Shadow Mode — the Discrepancy engine.
 *
 * The audit produces per-member `AccessDecisionRecord`s carrying BOTH sides: `holds_role` (the
 * incumbent — the current Discord role, Collab.Land's state) and `qualifies` (the recommendation — the
 * new conviction/holdings system). Shadow Mode runs read-only ALONGSIDE the incumbent and surfaces the
 * **Comparison View + Discrepancy Report** (the product spec: docs.arrakis.community/features/shadow-mode):
 * who would be PROMOTED, DEMOTED, or unchanged — without touching a single Discord role.
 *
 * This is a pure derivation over the band already on each record (common.ts):
 *   - `missing` (holdings WITHOUT access)  → **promotion** (newly eligible — should be granted)
 *   - `stale`   (access WITHOUT holdings)  → **demotion**  (the confront set — should be removed)
 *   - `ok`      (access matches holdings)  → **no_change**
 *
 * BANDS ONLY (the protocol's standing invariant): no numeric score leaks; the band distribution IS the
 * conviction distribution the dashboard renders.
 */
import { z } from 'zod';
import { AccessDecisionRecordSchema, type AccessDecisionRecord } from './schemas/access-decision-record.js';
import { BandSchema, EthAddressSchema, type Band } from './schemas/common.js';

/** The shadow-mode change a member would see at cutover. */
export const ChangeSchema = z.enum(['promotion', 'demotion', 'no_change']);
export type Change = z.infer<typeof ChangeSchema>;

/** The band → change mapping. The band already IS the holds×qualifies quadrant (common.ts), so the
 *  classification is canonical — not a second, drift-prone computation. Exhaustive switch with a
 *  `never` guard: if BandSchema ever grows a 4th band, this fails to COMPILE rather than silently
 *  bucketing the new band as `no_change` (which would hide a real discrepancy). */
export const changeFromBand = (band: Band): Change => {
  switch (band) {
    case 'missing':
      return 'promotion';
    case 'stale':
      return 'demotion';
    case 'ok':
      return 'no_change';
    default: {
      const _exhaustive: never = band;
      throw new Error(`changeFromBand: unhandled band ${String(_exhaustive)}`);
    }
  }
};

/** One row of the Comparison View — incumbent vs recommended, and the resulting change. */
export const MemberDiscrepancySchema = z
  .object({
    wallet: EthAddressSchema,
    community: z.string().min(1),
    /** incumbent: the wallet currently holds the Discord role. */
    holds_role: z.boolean(),
    /** recommendation: the wallet qualifies under the new system. */
    qualifies: z.boolean(),
    band: BandSchema,
    change: ChangeSchema,
  })
  .strict();
export type MemberDiscrepancy = z.infer<typeof MemberDiscrepancySchema>;

/** The Discrepancy Report — the per-member rows + the aggregate the dashboard renders. */
export const DiscrepancyReportSchema = z
  .object({
    members: z.array(MemberDiscrepancySchema),
    aggregate: z
      .object({
        total: z.number().int().nonnegative(),
        promotions: z.number().int().nonnegative(),
        demotions: z.number().int().nonnegative(),
        no_change: z.number().int().nonnegative(),
        /** the Conviction Distribution — bands, never a raw score. */
        band_distribution: z
          .object({
            stale: z.number().int().nonnegative(),
            missing: z.number().int().nonnegative(),
            ok: z.number().int().nonnegative(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();
export type DiscrepancyReport = z.infer<typeof DiscrepancyReportSchema>;

/**
 * diffShadow — the comparison. Map each access decision through its band into a member row, then
 * aggregate. Pure + deterministic; the input order is preserved so the Comparison View is stable.
 *
 * Read-only by construction: it consumes decisions and emits a report. It NEVER mutates a role — that is
 * the whole point of Shadow Mode (operate alongside the incumbent, show potential actions, change
 * nothing until the operator reviews the report and chooses to go live).
 *
 * Precondition: `records` are schema-valid (validate upstream via AccessDecisionRecordSchema — the wired
 * path does). diffShadow is a public export; an unvalidated caller risks double-counted duplicate rows.
 */
export function diffShadow(records: readonly AccessDecisionRecord[]): DiscrepancyReport {
  const members: MemberDiscrepancy[] = records.map((r) => ({
    wallet: r.wallet,
    community: r.community,
    holds_role: r.holds_role,
    qualifies: r.qualifies,
    band: r.band,
    change: changeFromBand(r.band),
  }));
  const countChange = (c: Change): number => members.filter((m) => m.change === c).length;
  const countBand = (b: Band): number => members.filter((m) => m.band === b).length;
  return {
    members,
    aggregate: {
      total: members.length,
      promotions: countChange('promotion'),
      demotions: countChange('demotion'),
      no_change: countChange('no_change'),
      band_distribution: { stale: countBand('stale'), missing: countBand('missing'), ok: countBand('ok') },
    },
  };
}

// re-export the record schema so consumers can validate inputs from one entry point
export { AccessDecisionRecordSchema };
