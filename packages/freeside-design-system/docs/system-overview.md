# Freeside Design System

**Freeside** is the Tessier-Ashpool orbital-resort brand — a curated paradise wrapped around a machine built for profit. The system encodes that duality: *paradise, but engineered.*

The brand is carried by three things: the wordmark, the deep mineral ground, and one accent pair. It is not carried by prose. There is no tagline strip, no motto, no lore caption, no bilingual signage layer, no decorative rule-and-star device. Those were removed because they read as decoration rather than as brand, and because they made every screen feel written-at rather than designed.

> The deep architecture spec lives in **`architecture/`**. This file is the working brand guide for what is compiled here.

## The six rules

**1 · Two typefaces.** **Michroma** for the wordmark and the display role — hero statements, sparingly, never numerals. **Archivo** for everything else, including all numerals (`font-variant-numeric: tabular-nums`). There is no monospace brand face — a system mono appears only inside literal code. A third face is never introduced to signal a mood.

**2 · Six text roles, one size each.**

| Role | Face | Size | Weight | Tracking | Case |
|---|---|---|---|---|---|
| wordmark | Michroma | 20 | — | .16em | UPPER |
| display | Michroma | 44 | — | .04em | UPPER |
| title | Archivo | 26 | 600 | −.01em | Sentence |
| section | Archivo | 15 | 600 | 0 | Sentence |
| body | Archivo | 14 | 400 | 0 | Sentence |
| label | Archivo | 11 | 600 | .14em | UPPER |

One title per screen. If a piece of text is not one of these six roles, it does not belong on the page.

**3 · Casing is fixed.** wordmark / display / label are UPPERCASE, always. title / section / body are Sentence case, always. Title Case appears nowhere in Freeside.

**4 · Two accents on screen.** A surface sets `data-accent` to exactly one pair. Components read only `--fs-accent-1` and `--fs-accent-2` and never reach past them into the palette. Twelve colours exist; two are visible at a time — that is what makes an accent an accent.

| Pair | accent-1 | accent-2 | Ink on accent-1 | Use |
|---|---|---|---|---|
| `resort` *(default)* | Bermuda Sunset `#C8705B` | Cannes Sky `#66ADC6` | Deep Space Ink · 4.79 | guest, console, everyday |
| `garden` | Babylon Deep `#5C6647` | Organic Sand `#CEBA99` | Lado Sunlight · 5.42 | environmental, spa, hospitality |
| `vice` | Casino Magenta `#E1588E` | Hazard `#F7D481` | Deep Space Ink · 4.84 | nightlife, SimStim |
| `systems` | Clinic Teal `#58988B` | Cannes Sky `#66ADC6` | Deep Space Ink · 5.08 | customs, ops, clinical |
| `dynasty` | Rose Brick `#936064` | Organic Sand `#CEBA99` | Lado Sunlight · 4.56 | Tessier-Ashpool formal |

`--fs-on-accent` belongs to the **pair, not the register** — the readable ink on a solid fill is a property of the colour. Deep Space Ink is correct on six of the eight palette colours; `garden` and `dynasty` are the exceptions and carry Lado Sunlight. Garden's accent-1 is Babylon Foliage darkened to `#5C6647`: the raw foliage `#6E7A56` clears AA against *neither* ink, so it stays a status colour and a fill, never a button ground.

Status is **not** an accent. Positive `#6E7A56` · caution `#F7D481` · critical `#B23A2E` appear as a 6px dot or a 3–8px bar, at most one per row.

**5 · Text is one ink.** Deep Space Ink `#081F28` on light, Lado Sunlight `#F7F1E5` on deep — the only two colours that hold contrast as letterforms. Colour is never a letterform: it is a bar, a dot, a rule, or a fill sitting behind the one ink. On a solid accent fill, use `--fs-on-accent` — never pick the ink by eye. Support neutrals: Ink 2 `#2C3E47`, muted `#6B6862` (light) / `#8B979D` (deep).

*Implementation note:* a custom-property alias resolves **where it is declared**, so every `*-ink` alias must be repeated verbatim inside each register block or it inherits the other register's frozen literal.

**6 · Four layout numbers.**

| | |
|---|---|
| **8** | inside a control; a dot and its label |
| **16** | inside a box; between stacked rows |
| **24** | between boxes — the gutter, both axes, always |
| **48** | page margin; gap between major sections |

Boxes never touch. If two boxes share an edge, the gutter is missing. Header and footer take the same page margin as the body — they are inset, not full-bleed bars, and they carry content across their full width rather than parking it at the two ends.

## Registers

**Deep Space is the default.** Deep Space Ink base, Lado Sunlight text. The colours read at their strongest against it and the accent pair does the most work there.

**Light (Paradise)** is opted into with `data-register="light"`. Lado Sunlight base, Deep Space Ink text.

On deep space, elevation is a **lighter surface**, not a shadow. Shadows exist only in the light register.

## Form & motion

Square by default (`--fs-radius-none`). 2px on controls — just enough to read as pressable. 4px and pill are hospitality-context privileges. Motion is engineered, never bouncy: `--fs-ease-standard`, 160 / 240 / 420ms. The one gradient in the system is the Lado-Acheson sky (`--fs-lado-sky`), hero use only.

## Imagery

Engineered paradise — Mediterranean skies, hanging gardens, water, lunar-concrete terraces, drone microlights, maintenance robots. Images feather into the base at their inner seam. There are no windows to space: the light-band *is* the sky, so the Lado-Acheson gradient is the only one. Gravity tapers from full-g at the centre to zero-g at the tips, so **wayfinding runs along one axis** — order levels by that gradient, not alphabetically. Use real or placeholder imagery; never synthesize scene imagery in SVG.

## Voice

Plain and short. Name the thing, give the number, stop. A label says what a field is; it does not editorialize about what the field means. No sublabels under headings, no reassurance copy under buttons, no atmospheric one-liners under titles. When a screen feels empty, that is a layout problem — solve it with space and scale, not with sentences.

## Index

- `styles.css` — global entry; imports `tokens/{fonts,colors,typography,spacing}.css`
- `tokens/` — `colors.css` (primitives · registers · accent pairs), `typography.css` (2 faces · 6 roles), `spacing.css` (4 layout numbers · form · motion), `fonts.css` (the single font swap point)
- `guidelines/` — foundation specimen cards (Design System tab)
- `assets/` — `station-interior.png`, `horse-mark.svg` (The Honey Jar parent mark)
- `components/` — 15 React primitives: `actions/` (Button, Input), `surfaces/` (Card, Panel, Tile), `status/` (StatusPill, StatusBadge, Callout, Spinner, TierBadge), `data/` (DataTable, InfoRow, MessageBox, Step), `chat/` (ChatBubble)
- `templates/station-console/` — the reference application of all six rules
- `architecture/` — the full spec + token starter scaffold
- `SKILL.md` — agent-skill entry point

## Caveats

- Retired type roles (`--fs-font-heading`, `-wayfind`, `-ops`, `-mono`, `-elite`, `-jp`, `-vice`) are **aliased to the two real faces** so existing components collapse to the 2-font system without edits. New work should reference `--fs-font-display` / `--fs-font-body` only.
- Retired odd spacing steps (`--fs-space-5/10/20/32`) are aliased to their nearest surviving step for the same reason.
- Guideline cards and component `.prompt.md` files still describe the pre-reduction system — refresh pending.
- `--fs-critical` is a derived deep red (the palette has no true red); Rose Brick is the in-palette alternative.
