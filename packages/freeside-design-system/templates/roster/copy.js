/* Roster — DOMAIN COPY PACK + DISCLOSURE POLICY
   Mixed-sensitivity data under Exposure.

   PRESENTATION ONLY. `visibleRecords` models what the screen states; it is not
   the access check. The server must not have sent a record this viewer cannot
   see — filtering here keeps the UI honest, not the data safe.

   Copy comes from the catalogue by ID. Cells come from declared COLUMN POLICIES,
   which are fragment declarations in their own right: the policy is fixed on the
   column, the value is the record's, and the decision is the engine's. Cells go
   through D.dispose() like every other fragment, so the pack sees a disposition
   and never a reason. */
(function () {
  var D = window.FreesideDoctrine;
  if (!D) return;
  var prose = D.prose, label = D.label, datum = D.datum, secret = D.secret, meta = D.meta, NONE = D.NONE;

  var RECORDS = [
    { id: '0412', handle: 'molly.eth',     tier: 'Wintermute', score: 941, delta: 38,  signal: 'nominal', existsAt: 0, take: 100.80, party: 'T-A Ltd' },
    { id: '0088', handle: '3jane',         tier: 'Tessier',    score: 877, delta: 12,  signal: 'review',  existsAt: 0, take: 92.40,  party: 'T-A Ltd' },
    { id: '1207', handle: 'riviera',       tier: 'Flatline',   score: 742, delta: -61, signal: 'decay',   existsAt: 0, take: 61.10,  party: 'Hosaka' },
    { id: '0031', handle: 'armitage',      tier: 'Cowboy',     score: 690, delta: 4,   signal: 'nominal', existsAt: 0, take: 48.30,  party: 'T-A Ltd' },
    { id: '0002', handle: 'wintermute.op', tier: 'Wintermute', score: 932, delta: 26,  signal: 'nominal', existsAt: 2, take: 210.00, party: 'Internal' },
    { id: '0937', handle: 'cath.sprawl',   tier: 'Tessier',    score: 702, delta: 31,  signal: 'nominal', existsAt: 0, take: 55.70,  party: 'Hosaka' },
    { id: '2344', handle: 'lonny.zone',    tier: 'Tourist',    score: 218, delta: -9,  signal: 'flagged', existsAt: 2, take: 3.10,   party: 'Under review' },
    { id: '2610', handle: 'terzibash',     tier: 'Tourist',    score: 164, delta: 2,   signal: 'flagged', existsAt: 2, take: 1.20,   party: 'Under review' }
  ];

  /* Column policies. `take` and `party` are Ledger data whose EXISTENCE is
     sensitive: a redacted cell would confirm they are there, so they omit whole
     and the column omits with them. */
  var COLUMNS = [
    { key: 'handle', label: 'Member',  min: 0, align: 'left',  existence: 'public' },
    { key: 'tier',   label: 'Tier',    min: 0, align: 'left',  existence: 'public' },
    { key: 'score',  label: 'Score',   min: 1, align: 'right', existence: 'public' },
    { key: 'delta',  label: 'Δ epoch', min: 1, align: 'right', existence: 'public' },
    { key: 'signal', label: 'Signal',  min: 2, align: 'left',  existence: 'conditional', existenceAt: 2 },
    { key: 'take',   label: 'House',   min: 3, align: 'right', existence: 'secret' },
    { key: 'party',  label: 'Party',   min: 3, align: 'right', existence: 'secret' }
  ];

  var ROW_ACTIONS = [
    { key: 'open',   label: 'Open',   cap: 'view:all' },
    { key: 'adjust', label: 'Adjust', cap: 'adjust' },
    { key: 'freeze', label: 'Freeze', cap: 'freeze' },
    { key: 'export', label: 'Export', cap: 'export' }
  ];

  var CATALOGUE = {
    'title.nothing':       prose('Nothing to show'),
    'title.yourStanding':  prose('Your standing', { min: 1 }),
    'title.roster':        prose('Roster', { min: 2 }),
    'title.settlement':    prose('Roster · settlement', { min: 3, existence: 'conditional', existenceAt: 2 }),

    'sub.notForGuests':    prose('The roster is not open to guests. Nothing here needs an account.'),
    'sub.yourRecord':      prose('Your own record, as the station holds it.', { min: 1 }),
    'sub.everyPermitted':  prose('Every record you are permitted to see. Changes are attributed to you.', { min: 2 }),
    'sub.withArithmetic':  prose('Every record with its arithmetic. Both counterparties, to the cent. This view is logged.', { min: 3 }),

    'count.none':          datum('No records'),
    'count.one':           datum('1 record'),
    'count.many':          datum('{n} records', { fill: ['n'] }),

    'empty.noAccount':     prose('Nothing here needs an account.'),
    'empty.noMatch':       prose('No records match. Try a different filter.', { min: 1 }),

    'export.granted':      prose('Export is granted on this session and is recorded against your name.',
                                 { min: 2, capability: 'export' }),
    'export.separate':     prose('Export is a separate grant. Ask a principal to authorise it.', { min: 2 }),

    'hidden.notForGuests': prose('Parts of the roster are not open to guests. Nothing here needs your attention.'),
    'hidden.moreThanYours':prose('This roster holds more than your account can see. What is not shown sits with the operators.', { min: 1 }),
    'hidden.aboveCeiling': meta('Detail above ceiling {ceiling} is omitted, not redacted.', { kind: 'prose', fill: ['ceiling'] }),

    'stamp.house':         label('Tessier-Ashpool'),
    'stamp.logged':        meta('epoch 41 · {role} · logged', { fill: ['role'] }),

    'canary.ledgerOnly':   secret('House take 100.80 · T-A Ltd', { min: 3, canary: true })
  };

  /* The count is the one fragment whose value is genuinely per-context. It fills
     a declared placeholder from the VISIBLE row count, which is why the engine's
     fill list is context keys only — a count cannot be smuggled through it. */
  function countId(n) { return n === 0 ? 'count.none' : n === 1 ? 'count.one' : 'count.many'; }

  function visibleRecords(ctx) {
    return RECORDS.filter(function (r) {
      if (r.existsAt > ctx.exposure) return false;
      if (ctx.role === 'guest') return false;
      if (ctx.role === 'member') return r.id === '0412';   /* view:self */
      return true;
    });
  }

  /* A column policy plus a record becomes a fragment. Declaration is on the
     column; only the value varies. */
  function cellFragment(rec, col, ctx) {
    var v = rec[col.key];
    if (col.key === 'delta') v = (v >= 0 ? '+' : '−') + Math.abs(v);
    else if (col.key === 'take') v = v.toFixed(2);
    else if (col.key === 'score') v = ctx.exposure >= 2 ? String(v) : String(Math.round(v / 10) * 10);
    return col.existence === 'secret'
      ? secret(v, { min: col.min })
      : datum(v, { min: col.min, existence: col.existence, existenceAt: col.existenceAt });
  }

  D.registerPack({
    id: 'roster',
    catalogue: CATALOGUE,

    cases: (function () {
      var F = window.FreesideFixtures;
      if (!F) return [];
      var deep = function (c) { return c.destination === 'console' || c.destination === 'settlement'; };
      return F.withCeilingGrant(F.withCapability(F.MATRIX, 'export', deep), 3, deep);
    })(),

    fields: {
      title:      { required: true,  fallback: 'Roster' },
      subtitle:   { required: true,  fallback: 'Records you are permitted to see.' },
      countLabel: { required: true,  fallback: 'Records shown' },
      emptyLine:  { required: true,  fallback: 'Nothing to show here.' },
      exportNote: { required: false, fallback: null },
      hiddenNote: { required: false, fallback: null },
      stamp:      { required: true,  fallback: 'Tessier-Ashpool' }
    },

    /* Counted values the catalogue declares as {n}. Supplied here rather than
       baked into a fragment, and computed from the VISIBLE set only — a total
       including hidden rows would let a viewer diff it against the page. */
    fills: function (ctx) { return { n: visibleRecords(ctx).length }; },

    select: function (ctx) {
      var rows = visibleRecords(ctx);
      var machine = ctx.machine;
      var deep = ctx.exposure >= 3;
      var atrium = ctx.exposure >= 1;
      var mode = D.disclosureMode(ctx);
      var hidden = RECORDS.filter(function (r) { return r.existsAt > ctx.exposure; }).length;

      var title = ctx.role === 'guest' ? 'title.nothing'
        : deep ? 'title.settlement'
        : machine ? 'title.roster'
        : atrium ? 'title.yourStanding' : 'title.nothing';

      var subtitle = ctx.role === 'guest' ? 'sub.notForGuests'
        : deep ? 'sub.withArithmetic'
        : machine ? 'sub.everyPermitted'
        : atrium ? 'sub.yourRecord' : 'sub.notForGuests';

      var hiddenNote = NONE;
      if (hidden > 0 || ctx.denied || ctx.clamped) {
        if (mode === 'explicit') hiddenNote = 'hidden.aboveCeiling';
        else if (mode === 'abstract') hiddenNote = atrium ? 'hidden.moreThanYours' : 'hidden.notForGuests';
      }

      return {
        title: title,
        subtitle: subtitle,
        countLabel: countId(rows.length),
        emptyLine: atrium ? 'empty.noMatch' : 'empty.noAccount',
        exportNote: ctx.exposure >= 2
          ? (D.can(ctx.role, 'export', ctx.grants) ? 'export.granted' : 'export.separate')
          : NONE,
        hiddenNote: hiddenNote,
        stamp: machine ? 'stamp.logged' : 'stamp.house'
      };
    },

    view: function (ctx, out) {
      var rows = visibleRecords(ctx);
      var machine = ctx.machine;
      var canExport = D.can(ctx.role, 'export', ctx.grants);

      /* Columns resolve through the same disposition the cells do. */
      var cols = COLUMNS.filter(function (c) {
        return D.dispose(cellFragment(RECORDS[0], c, ctx), ctx).disposition === 'render';
      });

      var rowsOut = rows.map(function (rec) {
        return {
          id: rec.id,
          cells: cols.map(function (c) {
            var d = D.dispose(cellFragment(rec, c, ctx), ctx);
            return { key: c.key, v: d.disposition === 'render' ? d.value : '', right: c.align === 'right', shown: d.disposition === 'render' };
          }),
          actions: ROW_ACTIONS.filter(function (a) { return D.can(ctx.role, a.cap, ctx.grants); })
                              .map(function (a) { return { key: a.key, label: a.label }; })
        };
      });
      var showActions = rowsOut.some(function (rec) { return rec.actions.length > 0; });

      /* The count label fills from the visible set only — see fills(). */
      return {
        register: ctx.level.register,
        pair: ctx.level.pair,
        exposureNum: ctx.exposure,
        levelBadge: machine ? ctx.exposure + ' · ' + ctx.level.name : '',
        columns: cols.map(function (c) { return { key: c.key, label: c.label, right: c.align === 'right' }; }),
        rows: rowsOut,
        showActions: showActions,
        withheld: out.hiddenNote != null,
        disclosure: D.disclosureMode(ctx),
        isEmpty: rows.length === 0,
        showTable: rows.length > 0,
        canExport: canExport,
        skeletonRows: rowsOut.map(function (_, i) { return { i: i }; })
      };
    }
  });

  D.rosterFixture = {
    RECORDS: RECORDS, COLUMNS: COLUMNS, ROW_ACTIONS: ROW_ACTIONS,
    visibleRecords: visibleRecords, cellFragment: cellFragment, countId: countId
  };
})();
