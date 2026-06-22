#!/usr/bin/env node
/*
 * Hivemind auto-labeler — derives canonical taxonomy labels from issue/PR context.
 * VENDORED from ~/.claude/laboratory/proposed-actions/autolabel.mjs (canon:
 * construct-laboratory-substrate @2bd219ad) so the fresh-clone Cloud Routine can run it.
 * Self-contained: enums are inline, no schema-file dependency.
 *
 * Reads ISSUE_TITLE + ISSUE_BODY (env), classifies workstream × artifact_type ×
 * priority against the canon enums, emits labels to apply.
 *   node autolabel.mjs            → "workstream:delivery artifact-type:product-spec priority:medium"
 *   node autolabel.mjs --json     → {"workstream":"delivery",...}
 *
 * Emits the COLON form with the schema dimension names (the canonical GH-label form,
 * ratified 2026-06-01). Bracket [W]/[CANVAS] is the orthogonal Linear title-prefix axis.
 */
const title = process.env.ISSUE_TITLE || process.argv[2] || '';
const body  = process.env.ISSUE_BODY  || process.argv[3] || '';
// strip markdown heading lines (e.g. "## Scope") — section labels, not work-type signal
const hay = `${title}\n${body}`.replace(/^[ \t]*#{1,6}[ \t].*$/gm, '').toLowerCase();
const RX = (s) => new RegExp(s, 'i');

// workstream enum: discovery · delivery · experimentation · tech-debt · sorry-for-ur-loss
const WS = [
  ['sorry-for-ur-loss', RX('\\b(outage|hotfix|on.?fire|sev[012]|p0|active incident|(is|went|going|service|site|prod|production) down|down for|broke (the )?(build|prod|production))\\b')], // drop bare incident/rollback (fired on background mentions, eval 3/3 false); LLM layer catches real incidents
  ['experimentation',   RX('\\b(experiment|spike|prototype|hypothesis|canary|rlhf|poc|playtest)\\b')],
  ['tech-debt',         RX('\\b(refactor|upgrade|migrat|deprecat|clean.?up|tech.?debt|chore|lint|rename|bump)\\b')],
  ['discovery',         RX('\\b(research|discover|explore|investigat|scope|understand|unknown)\\b')],
  ['delivery',          RX('.')], // default — building production features
];
// artifact_type enum (11) — first match wins, specific → general
const ART = [
  ['incident-postmortem',        RX('\\b(postmortem|post.?mortem)\\b')],
  ['bug-report',                 RX('(stack ?trace|traceback|\\bexception\\b|\\bthrows?\\b|crashes? (on|when|at|after)|fails? to |does(n.?t| not) work|not working|\\b[45]\\d\\d\\b|reproduc)')], // require a failure SYMPTOM not a bare bug/error mention (eval: 8/8 false on design docs); LLM layer catches the rest
  ['technical-rfc',              RX('\\b(rfc|design doc|architecture|sdd|adr)\\b')],
  ['experiment-design',          RX('\\b(experiment design|hypothesis|a/b test)\\b')],
  ['launch-plan',                RX('\\b(launch|release plan|go.?to.?market|gtm|rollout)\\b')],
  ['competitor-analysis',        RX('\\b(competitor|competitive|vs\\.? )\\b')],
  ['user-interview-synthesis',   RX('\\b(user interview|interview synthesis)\\b')],
  ['user-truth-canvas',          RX('\\b(user truth|canvas|persona|user research)\\b')],
  ['atomic-learning',            RX('\\b(learning|insight|finding|takeaway)\\b')],
  ['meeting-notes',              RX('\\b(meeting|sync notes|standup)\\b')],
  ['product-spec',               RX('.')], // default — spec/PRD/feature
];
// priority enum: urgent · high · medium · low
const PRI = [
  ['urgent', RX('\\b(urgent|p0|critical|asap|blocker|on.?fire|sev0)\\b')],
  ['high',   RX('\\b(\\bp1\\b|important|high.?priority|soon|sev1)\\b')],
  ['low',    RX('\\b(low.?priority|minor|cosmetic|nice.?to.?have|p3|someday|backlog)\\b')],
  ['medium', RX('.')], // default
];
// M4: structural default (last entry) — RX('.') does NOT match a newline, so a
// whitespace/newline-only hay would otherwise crash on undefined[0].
const pick = (table) => (table.find(([, rx]) => rx.test(hay)) || table[table.length - 1])[0];
const dims = { workstream: pick(WS), artifact_type: pick(ART), priority: pick(PRI) };
if (process.argv.includes('--json')) console.log(JSON.stringify(dims));
else console.log(`workstream:${dims.workstream} artifact-type:${dims.artifact_type} priority:${dims.priority}`);
