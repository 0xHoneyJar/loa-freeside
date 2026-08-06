import React from 'react';

const ROLES = {
  guest:     { alignSelf: 'flex-end', background: 'var(--fs-accent-authority)', color: 'var(--fs-on-accent)', borderBottomRightRadius: '2px' },
  concierge: { alignSelf: 'flex-start', background: 'var(--fs-surface-raised)', color: 'var(--fs-ink-primary)', border: '1px solid var(--fs-line-hairline)', borderBottomLeftRadius: '2px' },
  system:    { alignSelf: 'center', color: 'var(--fs-ink-muted)', fontSize: 'var(--fs-size-2xs)', fontStyle: 'italic', letterSpacing: '0.04em' },
};

/** Message bubble. `guest` = sunset/sunlight, `concierge` = raised + hairline, `system` = centered italic. */
export function ChatBubble({ role = 'concierge', children, style, ...rest }) {
  const v = ROLES[role] || ROLES.concierge;
  if (role === 'system') {
    return <div style={{ ...v, fontFamily: 'var(--fs-font-body)', ...style }} {...rest}>{children}</div>;
  }
  return (
    <div style={{ maxWidth: '85%', padding: '9px 13px', borderRadius: 'var(--fs-radius-sm)', fontSize: 'var(--fs-size-sm)', lineHeight: 1.45, wordWrap: 'break-word', fontFamily: 'var(--fs-font-body)', ...v, ...style }} {...rest}>
      {children}
    </div>
  );
}
