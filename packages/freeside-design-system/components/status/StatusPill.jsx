import React from 'react';

// solid state pills — each state's text color is chosen for contrast on its fill
const COLORS = {
  positive:  { bg: 'var(--fs-state-positive)', fg: 'var(--fs-lado-sunlight)' },
  info:      { bg: 'var(--fs-state-info)', fg: 'var(--fs-lado-sunlight)' },
  caution:   { bg: 'var(--fs-state-caution)', fg: 'var(--fs-deep-space-ink)' },
  critical:  { bg: 'var(--fs-state-critical)', fg: 'var(--fs-lado-sunlight)' },
  neutral:   { bg: 'var(--fs-state-neutral)', fg: 'var(--fs-deep-space-ink)' },
};

/** Solid state-colored pill. Uppercase micro-label; contrast text per state. */
export function StatusPill({ state = 'neutral', color, children, style, ...rest }) {
  const v = COLORS[state] || COLORS.neutral;
  return (
    <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 'var(--fs-radius-sm)', fontSize: 'var(--fs-size-2xs)', fontWeight: 600, letterSpacing: 'var(--fs-tracking-label)', textTransform: 'uppercase', color: v.fg, background: color || v.bg, fontFamily: 'var(--fs-font-body)', ...style }} {...rest}>
      {children ?? state.toUpperCase()}
    </span>
  );
}
