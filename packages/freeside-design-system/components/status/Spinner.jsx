import React from 'react';

/** Ring spinner. 40px, 3px track with a sunset-authority top arc, 1s linear spin. */
export function Spinner({ size = 40, thickness = 3, color = 'var(--fs-accent-authority)', track = 'var(--fs-line-structural)', style, ...rest }) {
  return (
    <span {...rest}>
      <style>{'@keyframes freeside-spin{to{transform:rotate(360deg)}}'}</style>
      <span style={{ display: 'inline-block', width: size, height: size, border: thickness + 'px solid ' + track, borderTopColor: color, borderRadius: '50%', animation: 'freeside-spin 1s linear infinite', ...style }} />
    </span>
  );
}
