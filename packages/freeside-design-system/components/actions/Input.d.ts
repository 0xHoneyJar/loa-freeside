import * as React from 'react';

/**
 * Freeside text input. `field` is the default square hospitality/UI field;
 * `mono` is the credit/access variant — tracked tabular figures on a sunk
 * surface, not a mono typeface; `pill` is the garden-context treatment.
 */
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Surface treatment. Default `field`. */
  variant?: 'field' | 'mono' | 'pill';
  disabled?: boolean;
}

export function Input(props: InputProps): JSX.Element;
