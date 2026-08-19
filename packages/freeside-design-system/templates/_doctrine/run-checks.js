/* Freeside — DOCTRINE TEST RUNNER
   CI entry point. Runs the same audit the Conformance card runs, over the same
   fixtures and the same assertions, with no browser and no dependencies:

     node templates/_doctrine/run-checks.js

   Exits 0 when every check passes and nothing was suppressed, 1 otherwise.

   PRESENTATION SCOPE. A green verdict means the screens state the right amount.
   It asserts nothing about server-side filtering or authorization.

   The card and this runner MUST load the same files in the same order. Adding a
   template means one require here and one <script> in
   guidelines/doctrine-conformance.card.html. */

global.window = global.window || global;

require('./doctrine.js');
require('./fixtures.js');
require('./tests.js');
require('../permission-gate/copy.js');
require('../roster/copy.js');
require('../roster/checks.js');
require('../guest-surface/copy.js');
require('../degraded-states/copy.js');
require('../docs/copy.js');

var D = global.window.FreesideDoctrine;
if (!D) { console.error('doctrine.js did not load'); process.exit(1); }

var a;
try { a = D.audit(); }
catch (err) {
  console.error(err);
  console.error('\n  ERROR — audit() threw before it could report. Every verdict is meaningless until this is fixed.\n');
  process.exit(1);
}

var pad = function (s, n) { s = String(s); return s + Array(Math.max(1, n - s.length + 1)).join(' '); };

console.log('');
console.log('Freeside doctrine — ' + a.results.length + ' checks · ' + a.cases + ' cases · ' +
            a.fragments + ' fragments · ' + a.packs.length + ' packs');
console.log('PRESENTATION doctrine only — server-side filtering is not asserted here.');
console.log(Array(78).join('-'));

a.results.forEach(function (r) {
  console.log((r.pass ? '  PASS  ' : '  FAIL  ') + pad(r.id, 46) + (r.pass ? '' : r.failures.length + ' failing'));
  if (!r.pass) r.failures.slice(0, 10).forEach(function (f) { console.log('        · ' + f); });
  if (!r.pass && r.failures.length > 10) console.log('        · … ' + (r.failures.length - 10) + ' more');
});

if (a.recorded.length) {
  console.log('');
  console.log('  Guard suppressions (each one fails the verdict):');
  a.recorded.forEach(function (v) {
    console.log('        · ' + v.pack + ' · ' + v.field + ' — ' + v.why + (v.detail ? ' — "' + v.detail + '"' : ''));
  });
}

if (a.advisories.length) {
  console.log('');
  console.log('  Lint advisories (not part of the verdict):');
  a.advisories.forEach(function (x) { console.log('        · ' + x); });
}

console.log(Array(78).join('-'));
console.log(a.pass ? '  PASS' : '  FAIL');
console.log('');
process.exit(a.pass ? 0 : 1);
