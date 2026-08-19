# Known gaps

State at v1.0.0-rc.1. Nothing here is a blocking defect; the distinction is kept explicit below.

## Blocking defects

**None.** The suite is green with zero suppressions and the tree passes `npm run verify`.
Interactive templates render from a clean checkout served over HTTP when their pinned browser
runtime assets are reachable or remapped to approved local copies through `window.__resources`.
Only the committed conformance and full-system documents under `dist/` are claimed to work
offline without additional browser assets.

---

## Post-RC work

### 1 · Station Console reorganization — largest remaining item

The console's zone IA is settled and correct (**Overview · Members · Operations · Settlement**,
replacing the earlier Promenade / Desiderata St. / The Spindle / Villa Straylight place names).
The chrome was brought in line with the rest of Service — hairline instrumentation instead of
filled cards, a hairline nav rail, 2–3px meters.

What has **not** happened is the reorganization of each zone's internal content around
**systems, flows, capacity and dependencies**. Today the Overview zone presents credit figures
and service pools as a flat readout. It should express:

- which systems exist and which are upstream of which
- where allocation is committed versus available, and against what ceiling
- what depends on what, so an operator can see what a change will disturb
- provenance and recency per figure
- thresholds, and distance to them

Deliberately deferred from the RC because it is content work, not chrome. The console is the
one template that is **not** doctrine-projected — its strings are template-owned, which is why
it ships no `copy.js` and is exempt from the pack checks. Reorganizing it therefore means
writing product copy, and that is a decision to make with the operator persona in the room
rather than during an export.

**Not blocking:** the console renders correctly, demonstrates register and accent discipline,
and its IA no longer contradicts the naming rule.

### 2 · First bounded consumer retrofit

No consumer has adopted the system yet. The intended first trial is **one workflow** in
`0xHoneyJar/freeside-dashboard` — deliberately one, so the retrofit recipe is tested against
real constraints before it is offered to the rest of the estate.

Scope it as: colour layer first, one screen, no component rewrites, no Exposure. Only add
Exposure to that screen if it genuinely has viewers at different depths. Record what the
recipe got wrong.

`examples/dashboard-palette/` is the worked precedent — a repo with its own Tailwind/shadcn
token layer remapped in one file with no component edits.

### 3 · Wordmark and display face

**Michroma is a production placeholder, not the final mark.** It is a real, licensed Google
font and is safe to ship, but it was chosen as a stand-in for a custom Freeside wordmark that
has not been commissioned.

Consequences to keep in mind:
- The wordmark rule is documented as *Michroma sets the wordmark and display; Archivo sets
  everything else*. If a custom face arrives, that rule likely becomes *custom face for the
  wordmark, Michroma or the custom face for display* — the split will need restating in one place.
- Candidate explorations are in `docs/reference/wordmark-candidates-1.png` and `-2.png`.
- No font binaries are shipped. See `docs/FONTS.md`.

### 4 · Richer environmental plates

The system ships **one** canonical render, `assets/terrace-plate.png`, graded from
`assets/station-interior.png` toward Cannes blue by a luminance-keyed duotone. It carries
fabricated sky, the tiled far side reading as curved terraces, haze, and the axial specular.

It does **not** carry vegetation, water, or people. That is a genuine gap and it cannot be
closed by grading — it needs new renders or photography. The brief for them is the Yes/No panel
on `cards/brand-environment.card.html`:

> **Yes** — fabricated blue sky · linear axial light · ground and terraces curving up at the
> frame edges · cultivated planting against poured concrete · water or mist · guests, staff, a
> tender · machinery as elegant seams and service traces.
>
> **No** — wilderness · a flat Earth horizon · rust, damp, ruin · empty spa minimalism with one
> plant · neon, rain-slick streets, holograms · windows onto space, or the station seen from
> outside.

The plate is an `<image-slot>` in every template that uses it, so replacing it is a drop, not
a code change.

### 5 · Smaller items

- **Guest surface bottom whitespace.** The actions row uses `margin-top:auto`, so on a very tall
  viewport it sits far below the content. Correct for a full-page design; looks loose in a short
  frame. Cosmetic.
- **Roster grouping.** Rows are ordered as the pack returns them. Operational grouping by tier
  would help at scale, but reordering is a disclosure channel and wants a deliberate decision
  about what ordering itself reveals — not a template change made in passing.
- **No settlement or access templates.** Exposure 3 (Ledger) is demonstrated through the
  existing templates at high exposure rather than by a dedicated settlement surface.
- **Cards are 1280px-authored.** They are specimens, not responsive product surfaces. The
  templates are the responsive artifacts.
- **Review cards need a live browser.** `cards/doctrine-review-*.card.html` mount real template
  DCs in iframes. Iframe content does not survive DOM-recapture screenshots or PDF export —
  review them live, and verify their contents by reading the frames' DOM rather than from a
  capture.
- **The two standalone `dist/` artifacts are synchronized by hand.** Neither is generated by
  `npm run build`, which produces `dist/index.html` and `dist/manifest.json` only — the
  publisher that builds them is not part of this repo. Both are nevertheless kept current,
  because each embeds code that can execute: `dist/conformance.html` carries the Conformance
  renderer inline, and `dist/full-system.html` carries `templates/_print/support.js`
  gzip-compressed in its asset manifest, whose helmet path mounts nine ordered external
  scripts. The procedures — and the reason a replacement gzip stream need not reproduce the
  publisher's original bytes — are in `MANIFEST.md`.

---

## Recorded constraints that are not gaps

These read like omissions and are deliberate:

- **Exposure is presentation only.** It is not, and must never be described as, the
  authorization boundary. Server-side filtering is the boundary.
- **Ordinals are not identifiers.** Roster row ordinals (01, 02, …) are positions in the visible
  set. They change under sorting, filtering, pagination and access changes. `rows[].id` is the
  durable key. Never persist an ordinal, never put one in a URL, never use one as a foreign key.
- **The lexical lint is advisory and has no digit rule.** Classification is by provenance, not
  spelling. "2 reservations" is legitimate data.
- **`templates/docs/` authors its prose.** Article body copy carries no state, so it lives in the
  template. Everything around it projects. The boundary is documented at the top of its `copy.js`.
