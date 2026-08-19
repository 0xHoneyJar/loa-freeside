import React from 'react';

/** Tile — a raised surface with a 3px state-colored left accent bar. Title + optional mono meta. */
export function Tile({ accentColor = 'var(--fs-accent-authority)', slug, latency, children, style, ...rest }) {
  return (
    <div style={{ position: 'relative', overflow: 'hidden', background: 'var(--fs-surface-raised)', border: '1px solid var(--fs-line-hairline)', borderRadius: 'var(--fs-radius-none)', padding: 'var(--fs-tile-pad)', fontFamily: 'var(--fs-font-body)', ...style }} {...rest}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 'var(--fs-accent-bar-w)', background: accentColor }} />
      <div style={{ marginLeft: '10px' }}>
        {(slug || latency != null) && (
          <div style={{ fontWeight: 600, marginBottom: '4px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px', color: 'var(--fs-ink-primary)' }}>
            <span>{slug}</span>
            {latency != null && <span style={{ color: 'var(--fs-ink-muted)', fontFamily: 'var(--fs-font-body)', fontSize: 'var(--fs-size-2xs)', fontWeight: 400 }}>{latency}</span>}
          </div>
        )}
        <div style={{ color: 'var(--fs-ink-secondary)', fontSize: 'var(--fs-size-sm)', lineHeight: 1.5 }}>{children}</div>
      </div>
    </div>
  );
}
