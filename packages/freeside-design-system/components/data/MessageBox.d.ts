import * as React from 'react';

/**
 * Mono message box — displays the raw, signable verification message (or any
 * copyable payload). Raised surface, hairline border, `pre-wrap` mono text.
 */
export interface MessageBoxProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
}

export function MessageBox(props: MessageBoxProps): JSX.Element;
