# Station Console

`templates/station-console/` — entry point `StationConsole.dc.html`

An operator console across four zones — Overview, Members, Operations, Settlement. Hairline instrumentation rather than filled cards.

## What exposure it demonstrates

**operator-facing; deep register throughout**

## How to run it

From the package root:

```bash
npm run dev
# then open http://localhost:4173/templates/station-console/StationConsole.dc.html
```

It must be served over `http://`, not opened as a `file://` URL — the template fetches its own scripts and the compiled bundle by relative path.

## Controls

Every knob is a prop on the `data-props` block of the DC and is editable in the Tweaks panel when the file is opened in Claude Design:

`initialZone · register · accent (see the data-props block in the DC)`

Outside that host, edit the defaults in the `renderVals()` fallback at the bottom of the `.dc.html`, or drive the component directly.

## Files

| File | Role |
|---|---|
| `StationConsole.dc.html` | Template entry. **Copy this.** |
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

- This template is NOT doctrine-projected. Its strings are template-owned, which is why it has no copy.js and is exempt from the pack checks. It demonstrates layout, register and accent discipline, not Exposure.
- A reorganization around systems, flows, capacity and dependencies is a known post-RC task \u2014 see KNOWN-GAPS.md. The current zone IA (Overview · Members · Operations · Settlement) is settled and correct; the internal structure of each zone is not.
