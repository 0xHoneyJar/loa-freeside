import type { EcosystemPattern } from "./types.js";
import type { ValidatedFinding } from "./schemas.js";
import type { ILogger } from "../ports/logger.js";
/**
 * Extract the first sentence from a description string.
 * Splits on period (.) and takes the first segment, bounded at MAX_CONNECTION_LENGTH characters.
 * If no period is found, takes the entire string up to the max length.
 */
export declare function firstSentence(text: string): string;
/**
 * Extract ecosystem patterns from bridge findings (AC-1, AC-2).
 *
 * Qualifying findings:
 * - PRAISE with confidence > 0.8
 * - All SPECULATION findings (any confidence)
 *
 * Each extracted pattern includes repo, pr, pattern (title), connection (first sentence
 * of description), extractedFrom (finding id), and confidence.
 */
export declare function extractEcosystemPatterns(findings: ValidatedFinding[], repo: string, prNumber: number): EcosystemPattern[];
/**
 * Update the ecosystem context file with new patterns (AC-3, AC-4).
 *
 * - Reads existing file (or creates empty context if missing)
 * - Deduplicates: skips patterns where repo + pattern already exists
 * - Per-repo cap: if a repo exceeds PER_REPO_CAP patterns after merge, evicts oldest (by insertion order)
 * - Writes atomically: writes to temp file then renames
 * - Updates lastUpdated to ISO timestamp
 * - All I/O errors are handled gracefully (log warning, don't throw)
 */
export declare function updateEcosystemContext(contextPath: string, newPatterns: EcosystemPattern[], logger?: ILogger): Promise<void>;
//# sourceMappingURL=ecosystem.d.ts.map