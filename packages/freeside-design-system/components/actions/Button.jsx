import React, { useState } from 'react';

const VARIANTS = {
  // sunset authority — the everyday primary
  primary:   { bg: 'var(--fs-accent-authority)', color: 'var(--fs-on-accent)', border: 'none', hover: 'color-mix(in oklab, var(--fs-accent-authority), #000 12%)' },
  // hairline outline on the mineral base
  secondary: { bg: 'transparent', color: 'var(--fs-ink-primary)', border: '1px solid var(--fs-line-structural)', hover: 'var(--fs-surface-raised)' },
  // environmental — recorded Mediterranean sky
  sky:       { bg: 'var(--fs-accent-sky)', color: 'var(--fs-deep-space-ink)', border: 'none', hover: 'color-mix(in oklab, var(--fs-accent-sky), #000 12%)' },
  // quiet raised fill
  quiet:     { bg: 'var(--fs-surface-raised)', color: 'var(--fs-ink-primary)', border: '1px solid var(--fs-line-hairline)', hover: 'var(--fs-surface-sunk)' },
  ghost:     { bg: 'transparent', color: 'var(--fs-ink-secondary)', border: 'none', hover: 'var(--fs-surface-raised)' },
};

const SIZES = {
  sm: { padding: '7px 14px', fontSize: 'var(--fs-size-xs)' },
  md: { padding: '11px 20px', fontSize: 'var(--fs-size-sm)' },
  lg: { padding: '15px 28px', fontSize: 'var(--fs-size-base)' },
};

/** Freeside button. Square-cornered, engineered; sunset `primary` is the everyday authority action. */
export function Button({ variant = 'primary', size = 'md', fullWidth = false, disabled = false, children, style, onMouseEnter, onMouseLeave, ...rest }) {
  const [hover, setHover] = useState(false);
  const v = VARIANTS[variant] || VARIANTS.primary;
  const s = SIZES[size] || SIZES.md;
  const bg = hover && !disabled && v.hover ? v.hover : v.bg;
  return (
    <button
      disabled={disabled}
      onMouseEnter={(event) => {
        setHover(true);
        onMouseEnter?.(event);
      }}
      onMouseLeave={(event) => {
        setHover(false);
        onMouseLeave?.(event);
      }}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
        fontFamily: 'var(--fs-font-body)', fontWeight: 600, lineHeight: 1, whiteSpace: 'nowrap',
        letterSpacing: '0.02em', padding: s.padding, fontSize: s.fontSize,
        borderRadius: 'var(--fs-radius-sm)', background: bg, color: v.color, border: v.border,
        width: fullWidth ? '100%' : 'auto',
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
        transition: 'background var(--fs-dur-fast) var(--fs-ease-standard)',
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
