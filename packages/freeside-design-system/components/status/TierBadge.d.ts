import * as React from 'react';

/**
 * Access-tier chip — surfaces a Freeside guest/access tier ("credit is the key")
 * as a soft tier-tinted chip: the tier ink over a 15% tint with a 35%-tint border
 * and a solid dot (or a glyph via `glyph`).
 *
 * Tiers: `port` (free-port arrival) · `promenade` (gardens & resort) ·
 * `villa` (dynastic) · `straylight` (authority/elite) · `concierge` (staff) ·
 * `vip` (nightlife).
 */
export interface TierBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tier?: 'port' | 'promenade' | 'villa' | 'straylight' | 'concierge' | 'vip';
  /** Optional leading glyph instead of the color dot. */
  glyph?: React.ReactNode;
}

export function TierBadge(props: TierBadgeProps): JSX.Element;
