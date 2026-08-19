import * as React from 'react';

/**
 * Freeside button. Square-cornered, engineered. `primary` is sunset authority
 * (the one everyday action); `sky` is the environmental accent; `secondary`,
 * `quiet`, and `ghost` are progressively lighter-weight.
 */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual treatment. Default `primary`. */
  variant?: 'primary' | 'secondary' | 'sky' | 'quiet' | 'ghost';
  /** `sm` (7/14) · `md` default (11/20) · `lg` CTA (15/28). Default `md`. */
  size?: 'sm' | 'md' | 'lg';
  /** Stretch to the container width. */
  fullWidth?: boolean;
  disabled?: boolean;
  children?: React.ReactNode;
}

export function Button(props: ButtonProps): JSX.Element;
