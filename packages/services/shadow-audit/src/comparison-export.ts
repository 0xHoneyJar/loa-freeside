/**
 * comparison-export.ts — the shareable, provenance-bearing migration-delta artifact (the viral loop).
 *
 * The wedge's distribution is "share the audit with the person who owns the server." A screenshot is not
 * verifiable; this serializes the Comparison View (the migration delta) into a SELF-DESCRIBING artifact that
 * carries its own provenance — `run_id`, `inputs_hash`, and the `methodology` (rule + snapshot) — so the
 * recipient can re-run the audit and confirm the number, and can verify the rule matches the incumbent's
 * enforced policy (NOT a Freeside-vs-Freeside artifact). Pure; no I/O.
 *
 * FAIL-CLOSED: the per-member delta exists only for an authed, community-bound audit. Exporting an anon audit
 * (no `comparison`) throws — there is nothing per-member to export, and we never fabricate one.
 */
import type { AuditOutput, Methodology, MemberDiscrepancy, DiscrepancyReport } from '@freeside/shadow-audit-protocol';

export class ComparisonUnavailableError extends Error {
  constructor() {
    super('comparison export requires an authed, community-bound audit (output.comparison is absent)');
    this.name = 'ComparisonUnavailableError';
  }
}

/** The self-describing artifact: the delta + the provenance needed to verify it. */
export interface ComparisonArtifact {
  run_id: string;
  inputs_hash: string;
  methodology: Methodology;
  delta: DiscrepancyReport['aggregate'];
  members: MemberDiscrepancy[];
}

export function comparisonArtifact(output: AuditOutput): ComparisonArtifact {
  if (!output.comparison) throw new ComparisonUnavailableError();
  return {
    run_id: output.run_id,
    inputs_hash: output.inputs_hash,
    methodology: output.methodology,
    delta: output.comparison.aggregate,
    members: output.comparison.members,
  };
}

/** JSON artifact — the canonical, round-trippable form (parse(serialize(x)) deep-equals the artifact). */
export function exportComparisonJson(output: AuditOutput): string {
  return JSON.stringify(comparisonArtifact(output), null, 2);
}

/** RFC-4180-ish field escape: quote + double-up quotes when the field carries a comma, quote, or newline. */
const esc = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/**
 * CSV artifact — a provenance preamble (`#`-prefixed, skippable by parsers) + the per-member table. The preamble
 * makes the shared file self-describing; the table is the human-readable delta the server owner reviews.
 */
export function exportComparisonCsv(output: AuditOutput): string {
  const a = comparisonArtifact(output);
  const preamble = [
    '# shadow-access migration delta',
    `# run_id=${a.run_id}`,
    `# rule=${a.methodology.rule_id} snapshot_block=${a.methodology.snapshot_block} sources=${a.methodology.sources.join('|')}`,
    `# inputs_hash=${a.inputs_hash}`,
    `# promotions=${a.delta.promotions} demotions=${a.delta.demotions} no_change=${a.delta.no_change} total=${a.delta.total}`,
  ];
  const header = 'wallet,community,holds_role,qualifies,band,change';
  const rows = a.members.map((m) =>
    [m.wallet, esc(m.community), String(m.holds_role), String(m.qualifies), m.band, m.change].join(','),
  );
  return [...preamble, header, ...rows].join('\n') + '\n';
}
