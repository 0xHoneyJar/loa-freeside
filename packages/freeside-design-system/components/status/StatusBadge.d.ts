import * as React from 'react';

/** Soft tinted badge — a low-alpha tint of the state color with ink-variant text and an optional dot. */
export interface StatusBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'positive' | 'info' | 'caution' | 'critical' | 'neutral';
  /** Show a leading state-colored dot. */
  dot?: boolean;
  children?: React.ReactNode;
}

export function StatusBadge(props: StatusBadgeProps): JSX.Element;
