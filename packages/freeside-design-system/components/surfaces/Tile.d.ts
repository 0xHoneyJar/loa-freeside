import * as React from 'react';

/**
 * Federation-cell tile — the operator dash's status card. A panel-hi surface
 * (`#1c1c20`, 6px radius, 12px pad) with a 3px left accent bar colored by state.
 * `slug` is the bold title; `latency` sits mono-right; `children` is the mono body.
 */
export interface TileProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Left-bar color — pass a state color token (e.g. `var(--state-up)`). */
  accentColor?: string;
  slug?: React.ReactNode;
  /** Right-aligned mono latency label (e.g. `42ms`). */
  latency?: React.ReactNode;
  children?: React.ReactNode;
}

export function Tile(props: TileProps): JSX.Element;
