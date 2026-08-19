import React from 'react';

const VARIANTS = {
  // raised mineral surface — the default card
  base: { background: 'var(--fs-surface-raised)', border: '1px solid var(--fs-line-hairline)', borderRadius: 'var(--fs-radius-none)', padding: 'var(--fs-card-pad)', boxShadow: 'var(--fs-shadow-1)', color: 'var(--fs-ink-primary)' },
  // deep-space authority card (set data-register="deep-space" on/above it)
  deep: { background: 'var(--fs-deep-space-ink)', border: '1px solid rgba(200,112,91,.42)', borderRadius: 'var(--fs-radius-none)', padding: 'var(--fs-card-pad)', color: 'var(--fs-lado-sunlight)' },
  // environmental / hospitality — soft corner allowed, sky-tinted hairline
  sky:  { background: 'var(--fs-surface-base)', border: '1px solid color-mix(in srgb, var(--fs-cannes-sky) 40%, transparent)', borderRadius: 'var(--fs-radius-md)', padding: 'var(--fs-card-pad)', boxShadow: 'var(--fs-shadow-1)', color: 'var(--fs-ink-primary)' },
};

/** Freeside card surface. `base` (raised mineral), `deep` (authority), `sky` (environmental/hospitality). */
export function Card({ variant = 'base', children, style, ...rest }) {
  return (
    <div style={{ fontFamily: 'var(--fs-font-body)', ...(VARIANTS[variant] || VARIANTS.base), ...style }} {...rest}>
      {children}
    </div>
  );
}
