---
name: freeside-design
description: Use this skill to generate well-branded interfaces and assets for Freeside — the Tessier-Ashpool orbital-resort brand. Two typefaces, two accents on screen, four layout numbers, dark by default. Contains the guidelines, palette, type roles, brand marks, and React component primitives.
user-invocable: true
---

Read `readme.md` first, then explore. The deep architecture spec is in `architecture/`.

If creating visual artifacts (slides, mocks, throwaway prototypes), copy assets out and create static HTML for the user to view. For production code, read the rules here and design with the tokens/components as an expert in the brand.

## The six rules

These are the whole system. If a decision is not covered here, it is not a decision — take the plainest option.

**1 · TWO TYPEFACES.** Michroma for the wordmark and the display role — hero statements, sparingly, never numerals. Archivo for literally everything else, including all numerals (`font-variant-numeric: tabular-nums`). There is no mono brand face; a monospace appears only inside literal code blocks. Never introduce a third face to signal a mood.

**2 · SIX TEXT ROLES, ONE SIZE EACH.** wordmark · display · title · section · body · label. One title per screen. If text is not one of the six roles, delete it.

**3 · CASING IS FIXED.** wordmark / display / label are UPPERCASE always. title / section / body are Sentence case always. Title Case appears nowhere in Freeside.

**4 · TWO ACCENTS ON SCREEN.** A surface sets `data-accent` to one pair — `resort` (default), `garden`, `vice`, `systems`, `dynasty` — and components read only `--fs-accent-1` / `--fs-accent-2`. Never reach past them into the palette. Status (positive / caution / critical) is not an accent: it is a dot or a 3px bar, one per row at most.

**5 · TEXT IS ONE INK.** Deep Space Ink on light, Lado Sunlight on deep. Colour is never a letterform — it is a bar, a dot, a rule, or a fill sitting behind the one ink.

**6 · FOUR LAYOUT NUMBERS.** 8 inside a control · 16 inside a box · 24 between boxes · 48 page margin and section gap. Boxes never touch: a shared edge means the gutter is missing. Header and footer obey the same margins as the body — they are not full-bleed bars.

## Defaults

- **Deep Space is the default register.** Light is opted into with `data-register="light"`. Elevation on deep is a lighter surface, not a shadow.
- **Square by default.** 2px radius on controls only. Roundness is earned by hospitality context.
- **No flavour text.** No lore captions, no technical sublabels under headings, no tagline strips, no decorative glyph rules. The palette and the wordmark carry the brand; sentences that only set a mood are deleted.
- **One gradient exists** — the Lado-Acheson sky, hero only.
- Render the brand as the FREESIDE wordmark alone. Do not synthesize scene imagery in SVG — use placeholders.

## Files

- **readme.md** — the brand guide. Read first.
- **architecture/** — full spec: decision record, token layering, component inventory, build plan.
- **styles.css** — the single stylesheet consumers link; `@import`s every file under `tokens/`.
- **tokens/** — `colors.css` (primitives + register + accent pairs), `typography.css` (2 faces, 6 roles), `spacing.css` (4 layout numbers), `fonts.css` (the single font swap point).
- **components/** — 15 React primitives across `actions/`, `surfaces/`, `status/`, `data/`, `chat/`.
- **guidelines/** — foundation specimen cards (Design System tab).
- **templates/station-console/** — the reference application of all six rules.
