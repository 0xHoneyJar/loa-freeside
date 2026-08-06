# Type System

**Two faces. That is the whole system.**

| Token | Face | Used for |
|---|---|---|
| `--fs-font-display` | **Michroma** | The wordmark and the display role — hero statements, used sparingly. Never body, never labels, and never numerals: a hero figure is Archivo. |
| `--fs-font-body` | **Archivo** | Everything else, including every numeral. Tabular figures by default. |

Archivo Narrow is loaded for the rare condensed label. Nothing else is a brand face.

---

## Six roles, one size each

If a piece of text is not one of these six roles, it does not belong on the screen. Sizes and tracking live in `tokens/typography.css`; components reference the role tokens, never raw px.

| Role | Token prefix | Face | Notes |
|---|---|---|---|
| Wordmark | `--fs-wordmark-*` | display | Uppercase, wide tracking |
| Display | `--fs-display-*` | display | Uppercase. One per screen, at exposure 0–1 |
| Title | `--fs-title-*` | body | Screen and section titles |
| Section | `--fs-section-*` | body | Sub-headings inside a column |
| Body | `--fs-body-*` | body | All prose. `text-wrap: pretty`, 62–74ch measure |
| Label | `--fs-label-*` | body | Uppercase, tracked, muted ink. Eyebrows, table headers, stamps |

Data figures use `--fs-data-lg` / `--fs-data-sm` with `font-variant-numeric: var(--fs-numeric)`.

---

## There is no mono face

Machine-read text — identifiers, coordinates, payloads, ledger figures — is **Archivo with tabular
figures, added tracking, and a sunk surface**. The quality comes from the numerals and the surface,
not from a second typeface. `--fs-font-mono` still resolves (it aliases `--fs-font-body`) so older
code keeps working, but new code should not reference it: it names a face that no longer exists.

The same applies to `--fs-font-jp`, `--fs-font-elite`, `--fs-font-heading`, `--fs-font-ops`,
`--fs-font-wayfind` and `--fs-font-vice`. All alias one of the two real faces. They are compatibility
shims, not choices.

---

## Case and tracking

Wordmark, display, labels and stamps are **uppercase with wide tracking**. Titles, sections and body
are sentence case at normal tracking. Nothing else is uppercased for emphasis — emphasis is weight
or ink, never case.

---

## Type does not carry exposure

A screen's exposure level changes rhythm (`--fs-pad-page`, `--fs-gap-stack`), how figures are
stated, and whether structural lines are drawn. It does **not** change the typeface or the scale.
Terrace and Ledger are the same two faces at the same six sizes; what differs is how much is said
and how tightly it is packed. See `guidelines/doctrine-exposure.card.html`.

---

## Superseded

An earlier direction specified **nine** faces on a role-per-tier model (Handel Gothic, Microgramma,
ITC Avant Garde, Avenir Next World, Neue Frutiger, DIN 2014, OCR-B, Optima Nova, Tazugane Gothic),
plus a Chakra Petch nightlife context. It was replaced because nine faces produced screens that read
as texture rather than as a system, and because eight of the nine were licensed families standing
behind free substitutes — a swap layer nobody was ever going to exercise.

Also retired with it: the axial-line-and-star wordmark device, the T·A monogram coin, the Japanese
companion setting, and the Lado-Acheson sky gradient. Do not reintroduce any of them.
