# Permission gate

`templates/permission-gate/` — entry point `PermissionGate.dc.html`

A refusal that stands on the surface it is refusing. Three disclosure modes: silent (existence not acknowledged), abstract (handling admitted, structure withheld), explicit (the layer named and the attempt recorded).

## What exposure it demonstrates

**the seam — whatever min(ceiling, max(depth, floor)) resolves to**

## How to run it

From the package root:

```bash
npm run dev
# then open http://localhost:4173/templates/permission-gate/PermissionGate.dc.html
```

It must be served over `http://`, not opened as a `file://` URL — the template fetches its own scripts and the compiled bundle by relative path.

## Controls

Every knob is a prop on the `data-props` block of the DC and is editable in the Tweaks panel when the file is opened in Claude Design:

`role · destination (arrival·account·console·settlement) · systemState`

Outside that host, edit the defaults in the `renderVals()` fallback at the bottom of the `.dc.html`, or drive the component directly.

## Files

| File | Role |
|---|---|
| `PermissionGate.dc.html` | Template entry. **Copy this.** |
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

- The environment band renders at the ASKER\u2019s own level, never the destination\u2019s. Offering the console from the terrace neither carries Terrace into the console nor lifts the ceiling on arrival.
- The held panel is a threshold, not a redaction block: a recess in the deep register with one Lado Sunlight seam. It appears only where the disclosure mode already admits handling exists, and carries no rows, counts or shape.
- Set role=guest, destination=settlement to see silent mode: no door at all, because a door is itself an acknowledgment.
