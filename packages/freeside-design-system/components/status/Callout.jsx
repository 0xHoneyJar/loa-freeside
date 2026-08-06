import React from 'react';

const VARIANTS = {
  info:     { tint: 'var(--fs-state-info)', color: 'var(--fs-state-info-ink)' },
  positive: { tint: 'var(--fs-state-positive)', color: 'var(--fs-state-positive-ink)' },
  caution:  { tint: 'var(--fs-state-caution)', color: 'var(--fs-state-caution-ink)' },
  critical: { tint: 'var(--fs-state-critical)', color: 'var(--fs-state-critical)' },
};

/** Inline message block — a left-ruled tinted strip in the state color. */
export function Callout({ variant = 'info', children, style, ...rest }) {
  const v = VARIANTS[variant] || VARIANTS.info;
  return (
    <div style={{ background: `color-mix(in srgb, ${v.tint} 10%, transparent)`, borderLeft: `var(--fs-accent-bar-w) solid ${v.tint}`, color: v.color, padding: '12px 16px', borderRadius: 'var(--fs-radius-none)', fontSize: 'var(--fs-size-sm)', lineHeight: 1.5, fontFamily: 'var(--fs-font-body)', ...style }} {...rest}>
      {children}
    </div>
  );
}
