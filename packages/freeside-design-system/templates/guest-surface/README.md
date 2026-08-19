# Guest surface

`templates/guest-surface/` — entry point `GuestSurface.dc.html`

The resort as it is sold. Editorial composition on the Paradise register: one environmental plate, seven living-environment readings, and a capacity gauge that publishes the same number at four precisions.

## What exposure it demonstrates

**0 · Terrace (rises to 3 · Ledger)**

## How to run it

From the package root:

```bash
npm run dev
# then open http://localhost:4173/templates/guest-surface/GuestSurface.dc.html
```

It must be served over `http://`, not opened as a `file://` URL — the template fetches its own scripts and the compiled bundle by relative path.

## Controls

Every knob is a prop on the `data-props` block of the DC and is editable in the Tweaks panel when the file is opened in Claude Design:

`role (guest·member·operator·principal) · destination (arrival·account) · systemState (nominal·degraded·alert)`

Outside that host, edit the defaults in the `renderVals()` fallback at the bottom of the `.dc.html`, or drive the component directly.

## Files

| File | Role |
|---|---|
| `GuestSurface.dc.html` | Template entry. **Copy this.** |
| `copy.js` | Copy pack — the fragment catalogue, selector and view model. **Copy this and edit the strings.** |
| `ds-base.js` | Loads the design system. **Copy, then edit its one `base` line** to point at wherever the design system lives relative to the page. |
| `support.js` | Design Component runtime. Generated, do not edit. Keep it beside the template. |

## Dependencies that must stay imported

- `../_doctrine/doctrine.js` — the engine. Shared. Never fork it.
- `../_doctrine/fixtures.js` — the case matrix. Shared by CI and the Conformance card.
- `../../styles.css` (via `ds-base.js`) — tokens and registers.
- `../../image-slot.js` — the drag-and-drop plate.
- `../../assets/terrace-plate.png` — the default environmental render.

## What must not be hardcoded

- **Any user-facing string.** Copy is declared in `copy.js` and projected through `D.dispose()`. A template that writes a literal is outside the guard, and the conformance suite cannot see it.
- **A dark panel's colour.** Use `data-register="deep"` and read `var(--fs-surface-base)`. Registers nest in both directions.
- **Page padding or stack rhythm.** Set `data-exposure="0..3"` and let `--fs-pad-page` / `--fs-gap-stack` follow.
- **A denial reason.** Packs call `dispose()` and receive `render` / `fallback` / `omit`. The exact reason stays in the audit.

## Notes

- The gauge is the reference implementation of geometry-as-disclosure. At Terrace it renders three segments and the exact figure exists nowhere on the client — not in the fill width, the ARIA label, the title, a data attribute or a form value. At Service and above it becomes role="meter" with the real reading.
- The plate is an <image-slot>. Drop a render on it in a browser and the choice persists; the shipped default is assets/terrace-plate.png.
- act.console demonstrates action projection on four axes: it carries min: 2 AND plain: "Open the console", so an operator standing on the terrace is still offered operations — in Terrace-safe words.

## Browser runtime

This interactive template uses pinned browser copies of React, ReactDOM and Babel from unpkg.
Restricted or offline deployments must remap those URLs to approved local copies through
`window.__resources` before `support.js` loads. See
[`../../README.md`](../../README.md#browser-runtime).
