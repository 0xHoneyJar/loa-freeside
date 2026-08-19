# Examples

## `dashboard-palette/` — a worked retrofit

The precedent for adopting Freeside colour in a repository that already has its own token layer.
The scenario: a React + Vite + Tailwind + shadcn/ui dashboard with its own CSS custom properties.
The result: **one file changed, no component edits.**

| File | What it shows |
|---|---|
| `freeside-palette.css` | The remap. Freeside primitives assigned to the names the existing app already uses. This is the only file a real retrofit adds. |
| `vendor/tokens.css` | The app's original token layer, unmodified — what you are mapping *from*. |
| `vendor/shadcn-compat.css` | The shadcn variable contract (`--background`, `--foreground`, `--muted`, `--border`, …) satisfied from Freeside values. |
| `vendor/horai-light.css` | A second, differently-structured vendor theme, to show the mapping is not tuned to one source. |
| `dashboard-light.html` | The result on the light / Paradise register. |
| `dashboard-deep.html` | The same markup on the deep / Authority register. Nothing but `data-register` changed. |
| `palette-mapping.html` | The mapping itself, side by side — vendor name, Freeside source, resulting swatch. |

Open `palette-mapping.html` first; it explains the other two.

## The order that works

Colour first, then type, then rhythm, then — only where a surface genuinely has viewers at
different depths — Exposure.

Most of the value arrives with colour alone, and colour is the only step that can be done without
touching a component. Exposure is last because it is the only step that changes what the product
*says*, which means it needs the copy decisions made deliberately rather than mapped mechanically.

`../retrofit/retrofit.card.html` is the full recipe.

## A note on the paths inside `freeside-palette.css`

Its header comment shows `@import "../styles/sprawl/…"` — those are the **consumer's** paths in the
repository this was worked against, quoted so the recipe reads as it would in place. They do not
resolve here, and are inside a comment, so nothing loads them. The vendor files they refer to are in
`vendor/` beside it. `npm run verify` strips CSS comments before checking references for exactly
this reason.
