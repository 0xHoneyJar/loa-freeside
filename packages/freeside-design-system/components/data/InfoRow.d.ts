import * as React from 'react';

/**
 * Label / value row for member detail lists (verify session info). Dimmed label
 * left, medium value right, hairline rule below. Set `last` on the final row to
 * drop its border.
 */
export interface InfoRowProps extends React.HTMLAttributes<HTMLDivElement> {
  label: React.ReactNode;
  value: React.ReactNode;
  last?: boolean;
}

export function InfoRow(props: InfoRowProps): JSX.Element;
