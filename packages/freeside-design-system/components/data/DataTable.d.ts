import * as React from 'react';

export interface DataColumn {
  label: React.ReactNode;
  align?: 'left' | 'right' | 'center';
  /** Render this column's cells in the mono face (12px). */
  mono?: boolean;
}

/** A cell may be a plain node, or an object for per-cell overrides. */
export type DataCell = React.ReactNode | { value: React.ReactNode; mono?: boolean; color?: string; align?: 'left' | 'right' | 'center' };

/**
 * Operator data table — the dense, mono-friendly table used across the operator
 * dash (soju-lens, per-class rollup, recent envelopes). Uppercase micro-label
 * headers, 1px hairline row rules.
 */
export interface DataTableProps extends React.HTMLAttributes<HTMLTableElement> {
  columns?: DataColumn[];
  rows?: DataCell[][];
}

export function DataTable(props: DataTableProps): JSX.Element;
