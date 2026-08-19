import * as React from 'react';

/** Inline message block — a left-ruled tinted strip in the state color. */
export interface CalloutProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'info' | 'positive' | 'caution' | 'critical';
  children?: React.ReactNode;
}

export function Callout(props: CalloutProps): JSX.Element;
