/* Roster — PER-PACK DISCLOSURE CHECKS
   Table-shaped leaks the general suite cannot see: row existence, cell
   sensitivity, per-action authorization and the capability/ceiling distinction.
   Registered as doctrine checks so one verdict covers mechanism and data alike.

   Adversary model: a viewer who can read the DOM, diff two sessions, and do
   arithmetic.

   PRESENTATION SCOPE. These assert what the table STATES. They cannot assert the
   client was never sent the hidden rows — the server owns that. */
(function () {
  var D = window.FreesideDoctrine;
  var F = window.FreesideFixtures;
  if (!D || !F || !D.rosterFixture) return;
  var FX = D.rosterFixture;
  var RECORDS = FX.RECORDS;
  var lbl = F.label;

  function ctxOf(c) { return D.resolve(c); }
  function proj(c) { return D.project('roster', ctxOf(c)); }
  var CASES = function () { return D.casesFor(D.packs.roster); };

  D.registerChecks([
    {
      id: 'R1-row-existence',
      title: 'R · Hidden rows are absent, never redacted in place',
      why: 'A greyed or masked row confirms the record exists.',
      run: function () {
        var bad = [];
        CASES().forEach(function (c) {
          var ctx = ctxOf(c), p = proj(c);
          var allowed = FX.visibleRecords(ctx).map(function (r) { return r.id; });
          if (p.rows.length !== allowed.length)
            bad.push(p.rows.length + ' rows vs ' + allowed.length + ' permitted — ' + lbl(c));
          p.rows.forEach(function (row) {
            if (allowed.indexOf(row.id) === -1) bad.push('saw record ' + row.id + ' — ' + lbl(c));
            if (row.cells.some(function (x) { return x.shown && !String(x.v).trim(); }))
              bad.push('record ' + row.id + ' has a shown-but-empty cell — ' + lbl(c));
          });
        });
        return bad;
      }
    },
    {
      id: 'R2-cell-sensitivity',
      title: 'R · Cells above exposure omit, and their column omits with them',
      why: 'A present column of empty cells is a redaction mark.',
      run: function () {
        var bad = [];
        CASES().forEach(function (c) {
          var ctx = ctxOf(c), p = proj(c);
          var keys = p.columns.map(function (x) { return x.key; });
          FX.COLUMNS.forEach(function (col) {
            var shouldShow = D.dispose(FX.cellFragment(RECORDS[0], col, ctx), ctx).disposition === 'render';
            var present = keys.indexOf(col.key) !== -1;
            if (present !== shouldShow)
              bad.push('column "' + col.key + '" ' + (present ? 'shown' : 'hidden') + ' against policy — ' + lbl(c));
          });
          p.rows.forEach(function (row) {
            if (row.cells.length !== p.columns.length)
              bad.push('record ' + row.id + ' has ' + row.cells.length + ' cells for ' + p.columns.length + ' columns — ' + lbl(c));
          });
        });
        return bad;
      }
    },
    {
      id: 'R3-action-authorization',
      title: 'R · Row actions are capability-gated, not exposure-gated',
      why: 'Seeing a record is not permission to change it. An Actions column above nothing is the same redaction mark R2 forbids, so it must vanish with its actions.',
      run: function () {
        var bad = [];
        CASES().forEach(function (c) {
          var ctx = ctxOf(c), p = proj(c);
          var any = p.rows.some(function (row) { return row.actions.length > 0; });
          if (p.showActions !== any)
            bad.push('Actions column ' + (p.showActions ? 'shown with no' : 'hidden despite') + ' actions — ' + lbl(c));
          p.rows.forEach(function (row) {
            row.actions.forEach(function (a) {
              var def = FX.ROW_ACTIONS.filter(function (x) { return x.key === a.key; })[0];
              if (!def || !D.can(ctx.role, def.cap, ctx.grants))
                bad.push('offered "' + a.key + '" without capability — ' + lbl(c));
            });
          });
        });
        return bad;
      }
    },
    {
      id: 'R4-export-grant',
      title: 'R · Export requires its own grant at every role',
      why: 'Removing data from the station is never implied.',
      run: function () {
        var bad = [];
        F.ROLES.forEach(function (role) {
          var base = { role: role, destination: 'console', systemState: 'nominal' };
          var without = proj(base);
          if (without.canExport) bad.push(role + ' can export with no grant');
          if (without.rows.some(function (r) { return r.actions.some(function (a) { return a.key === 'export'; }); }))
            bad.push(role + ' has a row-level export with no grant');
          var granted = proj({ role: role, destination: 'console', systemState: 'nominal', grants: ['export'] });
          if (role !== 'guest' && !granted.canExport) bad.push(role + ' cannot export even when granted');
          if (granted.rows.length !== without.rows.length)
            bad.push(role + ' · export grant changed how many records are visible');
        });
        return bad;
      }
    },
    {
      id: 'R5-capability-grant-does-not-widen-unrelated-disclosure',
      title: 'R · A capability grant does not widen unrelated disclosure',
      why: 'Export or edit permission must not reveal extra rows or fields. An explicit access-ceiling grant may — that is what it is for — so the two travel on different inputs and are asserted separately.',
      run: function () {
        var bad = [];
        var shape = function (p) {
          return JSON.stringify({
            cols: p.columns.map(function (x) { return x.key; }),
            rows: p.rows.map(function (r) { return [r.id, r.cells.map(function (x) { return x.v; })]; })
          });
        };
        F.ROLES.forEach(function (role) {
          ['console', 'settlement'].forEach(function (dest) {
            var base = { role: role, destination: dest, systemState: 'nominal' };
            var a = proj(base);
            ['export', 'adjust', 'freeze'].forEach(function (cap) {
              var b = proj({ role: role, destination: dest, systemState: 'nominal', grants: [cap] });
              if (shape(a) !== shape(b)) bad.push(role + '/' + dest + ' · "' + cap + '" grant changed rows or columns');
            });
            /* Positive half: a ceiling grant SHOULD widen where there is room.
               Without it the rule goes inert and stops being falsifiable. */
            var ctx = ctxOf(base);
            if (ctx.ceiling < 3 && ctx.want > ctx.ceiling) {
              var lifted = proj({ role: role, destination: dest, systemState: 'nominal', ceilingGrant: 3 });
              if (shape(a) === shape(lifted)) bad.push(role + '/' + dest + ' · ceiling grant widened nothing');
            }
          });
        });
        return bad;
      }
    },
    {
      id: 'R6-state-does-not-reveal',
      title: 'R · A degraded or alert state never reveals a hidden record',
      why: 'State raises structure, not permission.',
      run: function () {
        var bad = [];
        F.ROLES.forEach(function (role) {
          ['console', 'settlement'].forEach(function (dest) {
            var base = proj({ role: role, destination: dest, systemState: 'nominal' })
                        .rows.map(function (r) { return r.id; });
            ['degraded', 'alert'].forEach(function (s) {
              proj({ role: role, destination: dest, systemState: s }).rows.forEach(function (r) {
                if (base.indexOf(r.id) === -1) bad.push(role + '/' + dest + '/' + s + ' revealed record ' + r.id);
              });
            });
          });
        });
        return bad;
      }
    },
    {
      id: 'R7-disclosure-mode-honoured',
      title: 'R · The roster honours the same three disclosure modes as the gate',
      why: 'Two packs must not disagree about what a clamp may admit.',
      run: function () {
        var bad = [];
        var cat = D.catalogueOf(D.packs.roster);
        CASES().forEach(function (c) {
          var ctx = ctxOf(c), p = proj(c);
          var mode = D.disclosureMode(ctx);
          var id = (D.packs.roster.select(ctx) || {}).hiddenNote;
          var frag = id && id !== D.NONE ? cat[id] : null;
          if (mode === 'silent' && p.withheld) bad.push('acknowledged a silent resource — ' + lbl(c));
          if (mode === 'abstract' && frag && frag.provenance !== 'domain')
            bad.push('abstract mode used a non-prose fragment — ' + lbl(c));
          if (mode === 'explicit' && frag && frag.provenance !== 'doctrine')
            bad.push('explicit mode used an unclassified note — ' + lbl(c));
          if (mode === 'abstract' && (ctx.denied || ctx.clamped) && !p.withheld)
            bad.push('abstract clamp acknowledged nothing — ' + lbl(c));
        });
        return bad;
      }
    }
  ]);
})();
