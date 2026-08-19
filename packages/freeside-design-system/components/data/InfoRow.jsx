import React from 'react';

/** Label/value row with a hairline rule. */
export function InfoRow({ label, value, last = false, style, ...rest }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', padding: '12px 0', borderBottom: last ? 'none' : '1px solid var(--fs-line-hairline)', fontFamily: 'var(--fs-font-body)', ...style }} {...rest}>
      <span style={{ color: 'var(--fs-ink-muted)', fontSize: 'var(--fs-size-sm)' }}>{label}</span>
      <span style={{ fontSize: 'var(--fs-size-sm)', fontWeight: 600, color: 'var(--fs-ink-primary)', textAlign: 'right' }}>{value}</span>
    </div>
  );
}
