# Cards

Specimen and documentation pages. Each is a standalone HTML file that links `../styles.css` and
renders at a declared viewport — authored at 1280px wide. They are **specimens, not responsive
product surfaces**; the templates are the responsive artifacts.

Serve them over http (`npm run dev`), not `file://`. `dist/index.html` indexes them all.

The first line of each file is a marker carrying its group, viewport, name and subtitle:

```html
<!-- @dsCard group="Doctrine" viewport="1280x6300" name="Exposure" subtitle="…" -->
```

## Groups

| Group | Cards |
|---|---|
| **Doctrine** | `doctrine-exposure` — the one mechanism, the three copy laws, the four levels · `doctrine-conformance` — renders `audit()` live · `doctrine-review-guest-surface` / `-permission-gate` / `-roster` — the real template DCs in iframes, one context per tile |
| **Brand** | `brand-environment` — the media system and four precisions · `brand-marks` — lockups · `brand-wordmark` — the axial device and its one correct use · `brand-glyphs` — iconography |
| **Colors** | `colors-core` · `colors-registers` · `colors-accents` · `colors-inks` · `colors-materials` |
| **Type** | `type-system` — two faces, six roles · `type-scale` · `type-labels` — casing and tracking |
| **Spacing** | `spacing-scale` · `spacing-radii` · `spacing-shadows` |
| **Components** | `actions` · `chat` · `data` · `status` · `surfaces` — these live in `../components/<group>/` beside the implementations |

`retrofit.card.html` is also duplicated at `../retrofit/retrofit.card.html`, which is the copy
the documentation links.

## Two cards that need a live browser

`doctrine-review-*.card.html` mount real template DCs in iframes through `review-frames.js`.
Badges and axis figures come from `D.resolve()` — never typed.

- Frames load progressively over roughly 20 seconds. The loader holds three at a time and keeps
  pushing props until each frame reports content, because a DC that mounts before its own doctrine
  scripts arrive renders the static template with every hole empty and has no reason to re-render.
- **Iframe content does not survive DOM-recapture screenshots or PDF export.** Review these live,
  and verify their contents by reading the frames' DOM rather than from a capture.

## Viewport heights

The `viewport` attribute must be at least the page's rendered height. A card that declares less
silently clips. When editing a card's content, re-measure and set the height **last** — the number
is easy to get right and then invalidate with a later edit in the same pass.
