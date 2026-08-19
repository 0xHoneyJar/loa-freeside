/* Degraded + alert states — DOMAIN COPY PACK
   One incident, rendered honestly at every level:

     severity    tracks STATE     — "degraded" and "offline" are different words
     specificity tracks EXPOSURE  — how much of the machine is described
     agency      tracks ROLE      — what you are offered to do about it

   Severity words carry no floor, because severity is not a disclosure: a guest
   during an alert is told plainly that a system is offline. What carries a floor
   is the machine detail underneath it. */
(function () {
  var D = window.FreesideDoctrine;
  if (!D) return;
  var prose = D.prose, label = D.label, act = D.action, meta = D.meta, datum = D.datum, NONE = D.NONE;

  var AGENCY = {
    guest:     { open: ['Back to the terrace', 'Ask at the desk'],  blocked: ['Ask at the desk', 'Back to the terrace'] },
    member:    { open: ['Your standing', 'Ask at the desk'],        blocked: ['Ask at the desk', 'Your standing'] },
    operator:  { open: ['Acknowledge', 'Open the runbook'],         blocked: ['Request elevation', 'Open the runbook'] },
    principal: { open: ['Acknowledge', 'Freeze scoring'],           blocked: ['Acknowledge', 'Freeze scoring'] }
  };

  var CATALOGUE = {
    'eyebrow.allSystems':  label('All systems'),
    'eyebrow.degraded':    label('Degraded'),
    'eyebrow.alert':       label('Alert'),

    'head.running':        prose('Everything is running'),
    'head.nominalAll':     prose('Nominal across all systems', { min: 2 }),
    'head.oneDegraded':    prose('A system is degraded'),
    'head.oneOffline':     prose('A system is offline'),
    'head.ingestDegraded': prose('Ingest degraded · scores holding', { min: 2 }),
    'head.ingestOffline':  prose('Ingest offline · epoch held', { min: 2 }),

    'body.gardensOpen':    prose('The gardens are open and everything you came for is running.'),
    'body.allIngesting':   prose('All dimensions ingesting. Last epoch closed clean and settlement is current.', { min: 2 }),
    'body.behindPlain':    prose('One of the scoring systems is running behind. Your standing is accurate as of its last update.'),
    'body.offlinePlain':   prose('One of the scoring systems is offline. Nothing about your standing has changed while it is down.'),
    'body.behindMachine':  prose('The onchain dimension is ingesting behind schedule. Scores hold at their last committed value while it catches up.', { min: 2 }),
    'body.offlineMachine': prose('The onchain dimension has stopped ingesting. Scores hold at their last committed value and epoch close is held. Nothing is being written.', { min: 2 }),

    'impact.nothingNeeded':prose('Nothing needs your attention.'),
    'impact.noOpenItems':  prose('No open items.', { min: 2 }),
    'impact.recordAccurate':prose('Your record is accurate and nothing you rely on has changed.'),
    'impact.writesPaused': prose('Reads are consistent. Writes are paused, so no record can drift while this is open.', { min: 2 }),

    'recovery.next':       label('What happens next'),
    'recovery.machine':    label('Recovery', { min: 2 }),

    'since.open':          meta('Open 41 min · epoch 41 open'),
    'since.held':          meta('Open 41 min · epoch 41 held'),

    'act.backToTerrace':   act('Back to the terrace'),
    'act.askDesk':         act('Ask at the desk'),
    'act.standing':        act('Your standing'),
    'act.acknowledge':     act('Acknowledge'),
    'act.runbook':         act('Open the runbook'),
    'act.requestElevation':act('Request elevation'),
    'act.freeze':          act('Freeze scoring', { capability: 'freeze' }),

    'stamp.house':         label('Tessier-Ashpool'),
    'stamp.logged':        meta('epoch 41 · {role} · logged', { fill: ['role'] }),

    'canary.ledgerOnly':   datum('2,292.00 unallocated across 4 pools', { min: 3, canary: true })
  };

  var ACTIONS = {
    'Back to the terrace': 'act.backToTerrace', 'Ask at the desk': 'act.askDesk',
    'Your standing': 'act.standing', 'Acknowledge': 'act.acknowledge',
    'Open the runbook': 'act.runbook', 'Request elevation': 'act.requestElevation',
    'Freeze scoring': 'act.freeze'
  };

  /* One incident, described at four depths. Filtered by exposure, never
     rewritten — one source of truth for a plan different people see less of. */
  var STEPS = [
    { min: 0, line: 'Nothing is required of you.' },
    { min: 1, line: 'Your record is accurate and will not be adjusted by this.' },
    { min: 2, line: 'Onchain dimension ingest is behind. Scores hold at their last committed value.' },
    { min: 2, line: 'Epoch close is held until ingest catches up or is waived by a principal.' },
    { min: 3, line: 'Settlement is paused: 2,292.00 unallocated across 4 pools.' },
    { min: 3, line: 'Waiving ingest attributes the epoch to you and cannot be reversed here.' }
  ];

  D.registerPack({
    id: 'degraded-states',
    agency: AGENCY,
    actionFields: ['primaryLabel', 'secondaryLabel'],
    catalogue: CATALOGUE,

    fields: {
      eyebrow:        { required: true,  fallback: 'Notice' },
      headline:       { required: true,  fallback: 'A system is being attended to' },
      body:           { required: true,  fallback: 'Nothing you rely on has changed. Someone is on it.' },
      impactNote:     { required: true,  fallback: 'Your record is unaffected.' },
      recoveryTitle:  { required: true,  fallback: 'What happens next' },
      sinceLabel:     { required: false, fallback: null },
      primaryLabel:   { required: true,  fallback: function (ctx) { return D.actionsFor(ctx, AGENCY)[0]; } },
      secondaryLabel: { required: true,  fallback: function (ctx) { return D.actionsFor(ctx, AGENCY)[1]; } },
      stamp:          { required: true,  fallback: 'Tessier-Ashpool' }
    },

    select: function (ctx) {
      var machine = ctx.machine;
      var alert = ctx.systemState === 'alert';
      var nominal = ctx.systemState === 'nominal';
      var actions = D.actionsFor(ctx, AGENCY);

      return {
        eyebrow: nominal ? 'eyebrow.allSystems' : (alert ? 'eyebrow.alert' : 'eyebrow.degraded'),
        headline: nominal
          ? (machine ? 'head.nominalAll' : 'head.running')
          : machine ? (alert ? 'head.ingestOffline' : 'head.ingestDegraded')
          : (alert ? 'head.oneOffline' : 'head.oneDegraded'),
        body: nominal
          ? (machine ? 'body.allIngesting' : 'body.gardensOpen')
          : machine ? (alert ? 'body.offlineMachine' : 'body.behindMachine')
          : (alert ? 'body.offlinePlain' : 'body.behindPlain'),
        impactNote: nominal
          ? (machine ? 'impact.noOpenItems' : 'impact.nothingNeeded')
          : (machine ? 'impact.writesPaused' : 'impact.recordAccurate'),
        recoveryTitle: machine ? 'recovery.machine' : 'recovery.next',
        sinceLabel: machine ? (alert ? 'since.held' : 'since.open') : NONE,
        primaryLabel: ACTIONS[actions[0]] || NONE,
        secondaryLabel: ACTIONS[actions[1]] || NONE,
        stamp: machine ? 'stamp.logged' : 'stamp.house'
      };
    },

    view: function (ctx, out) {
      var machine = ctx.machine;
      var alert = ctx.systemState === 'alert';
      var nominal = ctx.systemState === 'nominal';
      var steps = STEPS.filter(function (s) { return s.min <= ctx.exposure; })
                       .map(function (s) { return { line: s.line }; });
      return {
        register: ctx.level.register,
        pair: ctx.level.pair,
        exposureNum: ctx.exposure,
        levelBadge: machine ? ctx.exposure + ' · ' + ctx.level.name : '',
        steps: steps,
        hasSteps: steps.length > 0,
        showSince: out.sinceLabel != null,
        /* Severity as three literal branches, never a colour hole. */
        sevNominal: nominal,
        sevDegraded: !nominal && !alert,
        sevAlert: alert,
        showMetrics: machine,
        metrics: machine ? [
          { k: 'Records holding', v: '4,182' },
          { k: 'Behind by', v: alert ? '—' : '41 min' },
          { k: 'Writes', v: 'paused' }
        ] : []
      };
    }
  });
})();
