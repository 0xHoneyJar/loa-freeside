import React from 'react';

// soft tinted badges — bg is a low-alpha tint of the state color, text is the ink variant
const VARIANTS = {
  positive: { color: 'var(--fs-state-positive-ink)', dot: 'var(--fs-state-positive)', tint: 'var(--fs-state-positive)' },
  info:     { color: 'var(--fs-state-info-ink)', dot: 'var(--fs-state-info)', tint: 'var(--fs-state-info)' },
  caution:  { color: 'var(--fs-state-caution-ink)', dot: 'var(--fs-state-caution)', tint: 'var(--fs-state-caution)' },
  critical: { color: 'var(--fs-state-critical)', dot: 'var(--fs-state-critical)', tint: 'var(--fs-state-critical)' },
  neutral:  { color: 'var(--fs-ink-muted)', dot: 'var(--fs-state-neutral)', tint: 'var(--fs-state-neutral)' },
};

/** Soft tinted badge. Low-alpha state tint + ink-variant text, optional dot. */
export function StatusBadge({ variant = 'neutral', dot = false, children, style, ...rest }) {
  const v = VARIANTS[variant] || VARIANTS.neutral;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '5px 12px', borderRadius: 'var(--fs-radius-sm)', fontSize: 'var(--fs-size-xs)', fontWeight: 600, letterSpacing: '0.04em', background: `color-mix(in srgb, ${v.tint} 16%, transparent)`, color: v.color, fontFamily: 'var(--fs-font-body)', ...style }} {...rest}>
      {dot && <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: v.dot }} />}
      {children ?? variant.charAt(0).toUpperCase() + variant.slice(1)}
    </span>
  );
}
