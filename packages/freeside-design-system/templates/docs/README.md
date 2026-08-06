# Docs / long-form

`templates/docs/` — entry point `Docs.dc.html`

A reading surface. One column, 24/48 rhythm, hairline rules.

## What exposure it demonstrates

**1 · Atrium**

## How to run it

From the package root:

```bash
npm run dev
# then open http://localhost:4173/templates/docs/Docs.dc.html
```

It must be served over `http://`, not opened as a `file://` URL — the template fetches its own scripts and the compiled bundle by relative path.

## Controls

Every knob is a prop on the `data-props` block of the DC and is editable in the Tweaks panel when the file is opened in Claude Design:

`role · destination · systemState`

Outside that host, edit the defaults in the `renderVals()` fallback at the bottom of the `.dc.html`, or drive the component directly.

## Files

| File | Role |
|---|---|
| `Docs.dc.html` | Template entry. **Copy this.** |
| `copy.js` | Copy pack — the fragment catalogue, selector and view model. **Copy this and edit the strings.** |
| `ds-base.js` | Loads the design system. **Copy, then edit its one `base` line** to point at wherever the design system lives relative to the page. |
| `support.js` | Design Component runtime. Generated, do not edit. Keep it beside the template. |

## Dependencies that must stay imported

- `../_doctrine/doctrine.js` — the engine. Shared. Never fork it.
- `../_doctrine/fixtures.js` — the case matrix. Shared by CI and the Conformance card.
- `../../styles.css` (via `ds-base.js`) — tokens and registers.

## What must not be hardcoded

- **Any user-facing string.** Copy is declared in `copy.js` and projected through `D.dispose()`. A template that writes a literal is outside the guard, and the conformance suite cannot see it.
- **A dark panel's colour.** Use `data-register="deep"` and read `var(--fs-surface-base)`. Registers nest in both directions.
- **Page padding or stack rhythm.** Set `data-exposure="0..3"` and let `--fs-pad-page` / `--fs-gap-stack` follow.
- **A denial reason.** Packs call `dispose()` and receive `render` / `fallback` / `omit`. The exact reason stays in the audit.

## Notes

- This is the one template where prose is AUTHORED rather than projected: article body copy lives in the template because it carries no state. Everything around it — the chrome, the contents rail, the applicability note, the actions — projects.
- The boundary is documented at the top of copy.js. If a string varies by who is reading or what the system is doing, it is chrome and must project.
