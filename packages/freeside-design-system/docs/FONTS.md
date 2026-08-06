# Fonts

Two faces. **No font binaries are shipped** — nothing here is licensed for redistribution, so the
stylesheet declares families and expects the consumer to load them.

## The two faces

| Role | Family | Weights | Where it is used |
|---|---|---|---|
| Display / wordmark | **Michroma** | 400 only | The FREESIDE wordmark, and display-scale statements. Nothing else. |
| Everything else | **Archivo** | 400, 500, 600, 700 | Titles, sections, body, labels, and **every numeral** — tabular. |

### The rule, stated once

> **Michroma sets the wordmark and the display role. Archivo sets everything else, including
> every numeral.**

Michroma is a single-weight geometric face with wide default tracking. It is legible at wordmark
and display scale and illegible as body copy — that constraint is why the split exists, not a
stylistic preference. Do not set Michroma below ~26px, do not set it in a paragraph, and do not
reach for a third face to get a "machine-read" look. Archivo's tabular numerals *are* that look.

An earlier direction carried a T·A monogram coin, an axial-line device and a Japanese companion
face. All three are retired.

## Source and loading

Both are Google Fonts under the SIL Open Font License 1.1.

- Michroma — <https://fonts.google.com/specimen/Michroma>
- Archivo — <https://fonts.google.com/specimen/Archivo>

`tokens/fonts.css` declares the families and fallback stacks. It does **not** fetch them. Add one
of the following in the consuming app.

### a · Google Fonts CDN — simplest

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Michroma&family=Archivo:wght@400;500;600;700&display=swap">
```

### b · Self-hosted — preferred for production

```css
@font-face {
  font-family: 'Archivo';
  src: url('/fonts/archivo-variable.woff2') format('woff2-variations');
  font-weight: 400 700;
  font-display: swap;
}
@font-face {
  font-family: 'Michroma';
  src: url('/fonts/michroma-400.woff2') format('woff2');
  font-weight: 400;
  font-display: swap;
}
```

Archivo ships a variable version — one file covers 400–700 and is the better choice. Keep
`font-display: swap` so the fallback renders immediately.

## Fallback stacks

Declared in `tokens/fonts.css`. Both end in a generic family, so nothing lands in a browser
default serif.

- **Display** — Michroma → geometric/neo-grotesque chain → `sans-serif`. A fallback is narrower
  and less tracked, so a wordmark set in it reads tighter. Acceptable; never invisible.
- **Body** — Archivo → system UI chain → `sans-serif`. Tabular alignment comes from
  `font-variant-numeric: tabular-nums` set on containers rather than from the family, so figures
  stay in column even in the fallback.

## Casing and tracking

Fixed per role, not chosen per instance. `cards/type-labels.card.html` is the specimen.

| Role | Casing | Tracking |
|---|---|---|
| Wordmark | UPPERCASE | `0.14em` |
| Display | UPPERCASE | `0.04em` |
| Title | Sentence case | `-0.01em` |
| Section | Sentence case | normal |
| Body | Sentence case | normal |
| Label | UPPERCASE | `0.18em` |

## Status

**Michroma is a production placeholder.** Properly licensed and safe to ship, but standing in for
a custom Freeside wordmark that has not been commissioned. Candidates are in
`docs/reference/wordmark-candidates-1.png` and `-2.png`. See `KNOWN-GAPS.md §3` — if a custom face
arrives, the one rule above is the single place that needs restating.
