import * as React from 'react';

/**
 * Operator-dash panel — the primary dark grouping surface (`#131316`, 1px
 * hairline, 8px radius, 16px pad). The optional `title` renders as an uppercase
 * `.04em` micro-label; `badge` appends a gold sub-label after it.
 */
export interface PanelProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Uppercase micro-label heading. */
  title?: React.ReactNode;
  /** Gold sub-label appended to the heading (e.g. an ADR reference). */
  badge?: React.ReactNode;
  children?: React.ReactNode;
}

export function Panel(props: PanelProps): JSX.Element;
