import * as React from 'react';

/**
 * Freeside card surface. `base` = raised mineral (default); `deep` = deep-space
 * authority card; `sky` = environmental/hospitality (soft corner, sky hairline).
 */
export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'base' | 'deep' | 'sky';
  children?: React.ReactNode;
}

export function Card(props: CardProps): JSX.Element;
