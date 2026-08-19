import * as React from 'react';

/** Solid state-colored pill (uppercase micro-label). Text color is chosen per state for contrast. */
export interface StatusPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  state?: 'positive' | 'info' | 'caution' | 'critical' | 'neutral';
  /** Override the fill with a raw color. */
  color?: string;
  children?: React.ReactNode;
}

export function StatusPill(props: StatusPillProps): JSX.Element;
