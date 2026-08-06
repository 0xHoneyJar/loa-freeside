Data table. Uppercase label headers, hairline row rules, mono cells for ids and figures.

```jsx
<DataTable
  columns={[{label:'Property'},{label:'Rate',align:'right',mono:true}]}
  rows={[['Villa Straylight',{value:'₮ 44,000',align:'right',mono:true}]]}
/>
```

Each cell is a node, or `{ value, mono, color, align }`. Set `mono` on a column for tabular figures — required for credit, access, and any column that must align numerically.
