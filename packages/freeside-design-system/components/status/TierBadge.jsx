import React from 'react';

// Freeside guest access tiers — "credit is the key".
// The tier colour is the DOT and the tint; the label is always the one ink.
const TIERS = {
  port:       'var(--fs-cannes-sky)',      // free-port arrival
  promenade:  'var(--fs-babylon-foliage)', // gardens & resort
  villa:      'var(--fs-bermuda-sunset)',  // dynastic
  straylight: 'var(--fs-ink-primary)',     // authority / elite
  concierge:  'var(--fs-teal)',            // staff / systems
  vip:        'var(--fs-casino-magenta)',  // nightlife / vice
};

/** Access-tier chip — a Freeside guest/access tier as a tier-tinted chip with a colored dot. */
export function TierBadge({ tier = 'villa', glyph, style, ...rest }) {
  const c = TIERS[tier] || TIERS.villa;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '3px 10px', borderRadius: 'var(--fs-radius-sm)', fontSize: 'var(--fs-size-xs)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--fs-ink-primary)', background: 'color-mix(in srgb, ' + c + ' 15%, transparent)', border: '1px solid color-mix(in srgb, ' + c + ' 35%, transparent)', fontFamily: 'var(--fs-font-body)', ...style }} {...rest}>
      {glyph ? <span>{glyph}</span> : <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: c, flexShrink: 0 }} />}
      {tier}
    </span>
  );
}
