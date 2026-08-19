Tile — a raised surface with a 3px state-colored left accent bar. For grids of places, cells, or services.

```jsx
<Tile slug="Desiderata St." latency="Lv 3" accentColor="var(--fs-accent-foliage)">
  Promenade gardens, retail, dining terraces.
</Tile>
```

`accentColor` takes a semantic token — never a raw hex or a Layer-1 primitive, or it will not adapt when the register flips. `latency` renders in mono as right-aligned meta.
