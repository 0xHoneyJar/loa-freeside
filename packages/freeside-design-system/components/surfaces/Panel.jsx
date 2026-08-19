import React from 'react';

/** Panel — a raised mineral surface with an optional uppercase label heading + sunset section index/badge. */
export function Panel({ title, badge, children, style, ...rest }) {
  return (
    <div style={{ background: 'var(--fs-surface-raised)', border: '1px solid var(--fs-line-hairline)', borderRadius: 'var(--fs-radius-none)', padding: 'var(--fs-panel-pad)', fontFamily: 'var(--fs-font-body)', ...style }} {...rest}>
      {(title || badge) && (
        <h2 style={{ margin: '0 0 16px 0', fontSize: 'var(--fs-size-xs)', fontWeight: 600, letterSpacing: 'var(--fs-tracking-label)', textTransform: 'uppercase', color: 'var(--fs-ink-muted)', fontFamily: 'var(--fs-font-body)', display: 'flex', alignItems: 'baseline', gap: '8px' }}>
          {badge && <span style={{ color: 'var(--fs-accent-authority-ink)', fontWeight: 700, fontFamily: 'var(--fs-font-display)', letterSpacing: '0.04em' }}>{badge}</span>}
          {title}
        </h2>
      )}
      {children}
    </div>
  );
}
