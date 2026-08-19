Soft tinted badge — a low-alpha tint of the state color with ink-variant text and an optional dot.

```jsx
<StatusBadge variant="positive" dot>Verified</StatusBadge>
<StatusBadge variant="critical" dot>Denied</StatusBadge>
```

Variants: `positive`, `info`, `caution`, `critical`, `neutral`. Text uses the register-aware `*-ink` semantics, so it stays readable in Deep Space. Quieter than `StatusPill` — use it in dense tables and lists.
