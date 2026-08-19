# Degraded + alert states

`templates/degraded-states/` — entry point `DegradedStates.dc.html`

One incident, six honest renderings. Severity tracks state, specificity tracks exposure, agency tracks role — and the three move independently.

## What exposure it demonstrates

**2 · Service, and every level below by role**

## How to run it

From the package root:

```bash
npm run dev
# then open http://localhost:4173/templates/degraded-states/DegradedStates.dc.html
```

It must be served over `http://`, not opened as a `file://` URL — the template fetches its own scripts and the compiled bundle by relative path.

## Controls

Every knob is a prop on the `data-props` block of the DC and is editable in the Tweaks panel when the file is opened in Claude Design:

`systemState (nominal·degraded·alert) · role · destination`

Outside that host, edit the defaults in the `renderVals()` fallback at the bottom of the `.dc.html`, or drive the component directly.

## Files

| File | Role |
|---|---|
| `DegradedStates.dc.html` | Template entry. **Copy this.** |
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

- The layout IS the causal claim: cause (headline, body) \u2192 impact \u2192 measured effect (the metric row) \u2192 recovery, threaded on one spine that begins as a 3px severity bar and tapers to a hairline.
- Recovery steps are numbered because they are ordered work. The pack returns them in dependency order; the numbering only makes that legible.
- A state floor RAISES exposure but never breaches the access ceiling. Try role=member, systemState=alert: the floor wants Service, the ceiling holds Atrium, and the result is a clamp notice rather than a leak.

## Browser runtime

This interactive template uses pinned browser copies of React, ReactDOM and Babel from unpkg.
Restricted or offline deployments must remap those URLs to approved local copies through
`window.__resources` before `support.js` loads. See
[`../../README.md`](../../README.md#browser-runtime).
