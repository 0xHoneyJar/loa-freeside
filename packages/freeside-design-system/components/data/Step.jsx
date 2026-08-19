import React from 'react';

/** Numbered step row. Bermuda Sunset-authority index circle + title/description. */
export function Step({ number, title, description, accent = 'var(--fs-accent-authority)', style, ...rest }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '12px 0', fontFamily: 'var(--fs-font-body)', ...style }} {...rest}>
      <span style={{ width: '26px', height: '26px', borderRadius: 'var(--fs-radius-sm)', background: accent, color: 'var(--fs-on-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--fs-size-xs)', fontWeight: 700, fontFamily: 'var(--fs-font-display)', flexShrink: 0 }}>{number}</span>
      <div style={{ fontSize: 'var(--fs-size-sm)' }}>
        <strong style={{ display: 'block', marginBottom: '3px', color: 'var(--fs-ink-primary)' }}>{title}</strong>
        <span style={{ color: 'var(--fs-ink-muted)' }}>{description}</span>
      </div>
    </div>
  );
}
