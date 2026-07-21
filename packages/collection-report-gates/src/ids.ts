/**
 * @freeside/collection-report-gates · ID discipline
 *
 * CR-019 (sprint.md §6): "Suffixed task IDs are explicit; ranges are
 * forbidden in the manifest." Every task reference must be one canonical,
 * fully-suffixed ID. This module owns the ID grammar and the range /
 * implicit-suffix rejection helpers so schema and validator share one truth.
 */

/** Canonical task IDs: CR-NNN with optional explicit suffix, or ACCEPT-<REPO>. */
export const TASK_ID_PATTERN = /^(CR-\d{3}[A-Z]?|ACCEPT-[A-Z][A-Z-]*)$/;

/** Gate IDs as ratified in sprint.md §4 (G-1, G0, G1, G1A, G1B-1..5, G2A, G2B, G3, G3-PUBLIC, G4, G4A, G4B, G5, G6). */
export const GATE_ID_PATTERN = /^G(-1|[0-9][A-Z]?(-[A-Z0-9]+)*)$/;

/** Owner roles are kebab-case role names, never person names. */
export const ROLE_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * Range-shaped strings that MUST be rejected with a specific error rather
 * than a generic pattern mismatch. Covers the prose forms found in the
 * sprint plan ("CR-101 through CR-107", "CR-003 through CR-006",
 * "CR-205 through CR-208") plus common encodings ("CR-101..CR-107",
 * "CR-101–CR-107", "CR-101-CR-107").
 */
const RANGE_SHAPES: RegExp[] = [
  /through/i,
  /\.\./,
  /–|—/, // en/em dash between IDs
  /^CR-\d{3}[A-Z]?\s*-\s*CR-\d{3}[A-Z]?$/i, // "CR-101 - CR-107"
];

export function isRangeShaped(ref: string): boolean {
  return RANGE_SHAPES.some((re) => re.test(ref));
}

/**
 * An implicit suffixed reference: a bare base ID (e.g. "CR-007") for which
 * the inventory only contains suffixed variants (CR-007A, CR-007B). The
 * sprint plan's prose used these implicitly; the manifest forbids them.
 * Returns the suffixed variants if the reference is implicit, else null.
 */
export function implicitSuffixVariants(
  ref: string,
  knownIds: ReadonlySet<string>,
): string[] | null {
  if (!/^CR-\d{3}$/.test(ref) || knownIds.has(ref)) return null;
  const variants = [...knownIds]
    .filter((id) => id.startsWith(ref) && id.length === ref.length + 1)
    .sort();
  return variants.length > 0 ? variants : null;
}
