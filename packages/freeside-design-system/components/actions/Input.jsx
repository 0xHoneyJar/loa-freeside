import React, { useState } from 'react';

const BASE = {
  fontFamily: 'var(--fs-font-body)', outline: 'none', color: 'var(--fs-ink-primary)',
  transition: 'border-color var(--fs-dur-fast) var(--fs-ease-standard)', boxSizing: 'border-box', width: '100%',
};

const VARIANTS = (focus) => ({
  // default hospitality/UI field — square, sunset focus
  field: { ...BASE, fontSize: 'var(--fs-size-sm)', background: 'var(--fs-surface-base)', border: `1px solid ${focus ? 'var(--fs-accent-authority)' : 'var(--fs-line-structural)'}`, borderRadius: 'var(--fs-radius-sm)', padding: '10px 12px' },
  // credit / access — tracked tabular figures, sunk surface, systems-pair focus
  mono:  { ...BASE, fontFamily: 'var(--fs-font-body)', fontSize: 'var(--fs-size-xs)', letterSpacing: '0.02em', background: 'var(--fs-surface-sunk)', border: `1px solid ${focus ? 'var(--fs-teal)' : 'var(--fs-line-hairline)'}`, borderRadius: 'var(--fs-radius-sm)', padding: '9px 12px' },
  // organic context (spa/garden) — pill, sky focus
  pill:  { ...BASE, fontSize: 'var(--fs-size-sm)', background: 'var(--fs-surface-raised)', border: `1px solid ${focus ? 'var(--fs-accent-sky)' : 'var(--fs-line-hairline)'}`, borderRadius: 'var(--fs-radius-pill)', padding: '9px 16px' },
});

/** Freeside text input — `field` (default), `mono` (credit/access treatment), `pill` (garden context). */
export function Input({ variant = 'field', value, placeholder, type = 'text', disabled = false, style, ...rest }) {
  const [focus, setFocus] = useState(false);
  const v = VARIANTS(focus)[variant] || VARIANTS(focus).field;
  return (
    <input
      type={type}
      defaultValue={value}
      placeholder={placeholder}
      disabled={disabled}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={{ ...v, opacity: disabled ? 0.5 : 1, ...style }}
      {...rest}
    />
  );
}
