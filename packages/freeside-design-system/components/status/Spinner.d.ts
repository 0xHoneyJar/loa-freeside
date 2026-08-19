import * as React from 'react';

/**
 * Ring spinner — the loading indicator across verify and admin. A solid track
 * ring with one accent-colored arc, rotating 1s linear. Default 40px / 3px.
 */
export interface SpinnerProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Diameter in px. Default 40. */
  size?: number;
  /** Ring thickness in px. Default 3. */
  thickness?: number;
  /** Arc color. Default blurple. */
  color?: string;
  /** Track color. Default member border. */
  track?: string;
}

export function Spinner(props: SpinnerProps): JSX.Element;
