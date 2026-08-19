# One deviation in this archive

Every file here is byte-identical to the live source **except six**, which have had a single
comment line removed.

## What was removed

Each template entry file normally opens with a one-line marker that a Claude Design
design-system project reads to index it:

```html
<!-- @template name="Guest surface" description="Exposure 0 — the Terrace. Editorial resort composition with one environmental plate; every reading projected through Exposure" -->
```
→ first line of `templates/guest-surface/GuestSurface.dc.html`

```html
<!-- @template name="Permission gate" description="The seam between exposure levels — renders exposure = min(ceiling, max(depth, floor)) with copy projected from classified fragments, never written inline" -->
```
→ first line of `templates/permission-gate/PermissionGate.dc.html`

```html
<!-- @template name="Roster" description="Mixed-sensitivity table under Exposure — per-row existence, per-cell sensitivity, per-action capability, and aggregates computed over the visible set only" -->
```
→ first line of `templates/roster/Roster.dc.html`

```html
<!-- @template name="Degraded + alert states" description="One incident, six honest renderings — severity tracks state, specificity tracks exposure, agency tracks role" -->
```
→ first line of `templates/degraded-states/DegradedStates.dc.html`

```html
<!-- @template name="Docs / long-form" description="Exposure 1 — the Atrium. One reading column, 24/48 rhythm, hairline rules. Article prose is authored content; the chrome around it projects from state" -->
```
→ first line of `templates/docs/Docs.dc.html`

```html
<!-- @template name="Station Console" description="Freeside operator console — two faces, one accent pair, four layout numbers." -->
```
→ first line of `templates/station-console/StationConsole.dc.html`


## Why

The archive was staged inside the very design system it packages. That project's compiler scans
every folder for these markers and indexes **one entry per folder**, so six markers nested under
one staging directory collided and made the live templates unreachable. Removing the marker from
the staged copies was the only change that left the implementation untouched.

## Does it matter?

For the intended use — committing this package into `0xHoneyJar/loa-freeside` — **no**. Nothing in
that repository reads `@template`. The templates render, the copy packs project, and the
conformance suite passes without it.

It matters in exactly one case: re-importing this folder into a Claude Design **design-system**
project, where the marker is what puts each template in the picker. To restore, paste each line
above back as the **first line** of its file, before `<helmet>`.

Nothing else differs. `npm test` reproduces the baseline either way:

```
37 checks · 276 cases · 6 packs · PASS · 0 suppressions · 0 advisories
```
