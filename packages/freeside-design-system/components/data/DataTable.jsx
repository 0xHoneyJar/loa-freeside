import React from 'react';

/**
 * Data table. Uppercase label headers, sunset hairline row rules, mono cells
 * for credit/access ids and figures.
 *
 * columns: [{ label, align?, mono? }]
 * rows:    array of rows; each cell is a node, or { value, mono?, color?, align? }
 */
export function DataTable({ columns = [], rows = [], style, ...rest }) {
  const cellOf = (cell) => (cell && typeof cell === 'object' && !React.isValidElement(cell)) ? cell : { value: cell };
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-size-sm)', fontFamily: 'var(--fs-font-body)', color: 'var(--fs-ink-primary)', ...style }} {...rest}>
      <thead>
        <tr>
          {columns.map((c, i) => (
            <th key={i} style={{ textAlign: c.align || 'left', padding: '10px 8px', borderBottom: '1px solid var(--fs-line-structural)', color: 'var(--fs-ink-muted)', fontWeight: 600, fontSize: 'var(--fs-size-2xs)', letterSpacing: 'var(--fs-tracking-label)', textTransform: 'uppercase' }}>{c.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, ri) => (
          <tr key={ri}>
            {row.map((raw, ci) => {
              const col = columns[ci] || {};
              const cell = cellOf(raw);
              const mono = cell.mono != null ? cell.mono : col.mono;
              return (
                <td key={ci} style={{ textAlign: cell.align || col.align || 'left', padding: '10px 8px', borderBottom: '1px solid var(--fs-line-hairline)', verticalAlign: 'top', fontFamily: mono ? 'var(--fs-font-body)' : 'inherit', fontSize: mono ? 'var(--fs-size-xs)' : 'var(--fs-size-sm)', color: cell.color || 'var(--fs-ink-primary)' }}>{cell.value}</td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
