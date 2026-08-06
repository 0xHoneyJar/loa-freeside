import React from 'react';

/** Machine-read payload block (signable/copyable). Tabular Archivo with added tracking
    on a sunk surface — the system has no mono face; "mono" here names the treatment. */
export function MessageBox({ children, style, ...rest }) {
  return (
    <div style={{ background: 'var(--fs-surface-sunk)', borderRadius: 'var(--fs-radius-none)', padding: '16px', fontFamily: 'var(--fs-font-body)', fontSize: 'var(--fs-size-sm)', letterSpacing: '0.02em', whiteSpace: 'pre-wrap', wordBreak: 'break-word', border: '1px solid var(--fs-line-hairline)', color: 'var(--fs-ink-primary)', lineHeight: 1.5, ...style }} {...rest}>
      {children}
    </div>
  );
}
