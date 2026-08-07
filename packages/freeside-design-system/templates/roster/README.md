# Roster

`templates/roster/` — entry point `Roster.dc.html`

A mixed-sensitivity table under Exposure. Per-row existence, per-cell sensitivity, per-action capability, and aggregates computed over the visible set only.

## What exposure it demonstrates

**2 · Service (1 · Atrium for a member, denied for a guest)**

## How to run it

From the package root:

```bash
npm run dev
# then open http://localhost:4173/templates/roster/Roster.dc.html
```

It must be served over `http://`, not opened as a `file://` URL — the template fetches its own scripts and the compiled bundle by relative path.

## Controls

Every knob is a prop on the `data-props` block of the DC and is editable in the Tweaks panel when the file is opened in Claude Design:

`role · destination · systemState · exportGranted (boolean)`

Outside that host, edit the defaults in the `renderVals()` fallback at the bottom of the `.dc.html`, or drive the component directly.

## Files

| File | Role |
|---|---|
| `Roster.dc.html` | Template entry. **Copy this.** |
| `checks.js` | Pack-specific conformance assertions. **Copy this.** |
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

- Compare operator with and without exportGranted. A CAPABILITY grant changes what may be done and must not add a row, a column or a digit. A CEILING grant travels on ceilingGrant instead and legitimately may.
- Row ordinals (01, 02, \u2026) are positions in the VISIBLE SET ONLY. They are not identifiers, they are not stable, and they change under sorting, filtering, pagination or any access change. The durable key is rows[].id. Never persist an ordinal, never put one in a URL, never use one as a foreign key.
- The count, the skeleton row and the row identifiers are all built from the visible set, so none of them can be differenced against the page to recover a hidden total.
- checks.js holds this template\u2019s own conformance assertions and is registered via D.registerChecks().

## Browser runtime

This interactive template uses pinned browser copies of React, ReactDOM and Babel from unpkg.
Restricted or offline deployments must remap those URLs to approved local copies through
`window.__resources` before `support.js` loads. See
[`../../README.md`](../../README.md#browser-runtime).
