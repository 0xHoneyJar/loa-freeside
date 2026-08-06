/* Permission gate — DOMAIN COPY PACK
   Catalogue first: every fragment is declared once, at module scope, with policy
   that cannot see ctx. `select` then names IDs for a context. Nothing is
   constructed inline, so `min` is a fact about the wording rather than an echo
   of the branch that chose it — which is what makes the policy tests bite. */
(function () {
  var D = window.FreesideDoctrine;
  if (!D) return;
  var prose = D.prose, label = D.label, act = D.action, meta = D.meta, NONE = D.NONE;

  var AGENCY = {
    guest:     { open: ['Continue', 'Back to the terrace'], blocked: ['Ask at the desk', 'Back to the terrace'] },
    member:    { open: ['Continue', 'Sign out'],            blocked: ['Request access', 'Sign out'] },
    operator:  { open: ['Continue', 'Sign out'],            blocked: ['Request elevation', 'Sign out'] },
    /* A principal's ceiling is 3, so no destination can deny them — their blocked
       row exists only as a fallback and names nothing a selector can reach. */
    principal: { open: ['Continue', 'Sign out'],            blocked: ['Continue', 'Sign out'] }
  };

  /* ── CATALOGUE ─────────────────────────────────────────────────────────── */
  var CATALOGUE = {
    /* eyebrows */
    'eyebrow.unavailable':  label('Unavailable'),
    'eyebrow.notice':       label('Notice'),
    'eyebrow.signedIn':     label('Signed in'),
    'eyebrow.yourRecord':   label('Your record', { min: 1 }),
    'eyebrow.refused':      label('Refused', { min: 2 }),
    'eyebrow.degraded':     label('Degraded', { min: 2 }),
    'eyebrow.alert':        label('Alert', { min: 2 }),
    'eyebrow.console':      label('Console', { min: 2 }),
    'eyebrow.settlement':   label('Settlement', { min: 3, existence: 'conditional', existenceAt: 2 }),

    /* headlines */
    'head.notHere':         prose('Not available here'),
    'head.notYours':        prose('Not available to your account', { min: 1 }),
    'head.noAccess':        prose('Not open at your access', { min: 2 }),
    'head.attending':       prose('The house is attending to something'),
    'head.degraded':        prose('A system is degraded', { min: 1 }),
    'head.offline':         prose('A system is offline', { min: 1 }),
    'head.partialDiag':     prose('Partial diagnostic', { min: 2 }),
    'head.fullDiag':        prose('Full diagnostic', { min: 3 }),
    'head.welcome':         prose('Welcome back'),
    'head.standing':        prose('Standing is current', { min: 1 }),
    'head.everyRecord':     prose('Every record, every epoch', { min: 2 }),
    'head.fullArithmetic':  prose('Full arithmetic', { min: 3 }),

    /* messages — the field where a wrong branch does real damage */
    'msg.askDesk':          prose('Ask at the desk and someone will see whether it should be opened for you.'),
    'msg.recordUnaffected': prose('Your own record is unaffected, and everything you normally use is where you left it.', { min: 1 }),
    'msg.refusedRecorded':  prose('Reaching this requires access above {role}. The request was recorded and not fulfilled.',
                                  { min: 2, fill: ['role'] }),
    'msg.terraceNormal':    prose('Your access is unaffected and nothing is required of you. Service continues as normal.'),
    'msg.operatorsHaveIt':  prose('Your record is accurate and current. Attending to this sits with the operators.', { min: 1 }),
    'msg.structureToAccess':prose('Structure is shown as far as your access allows. Detail above it is withheld.', { min: 2 }),
    'msg.terraceOpen':      prose('Everything on the terrace is open to you. Nothing here needs an account.'),
    'msg.yourHistory':      prose('Score, tier and standing history for your own account.', { min: 1 }),
    'msg.operatorRoster':   prose('Full roster for operators. Changes are attributed to you and are not reversible from here.', { min: 2 }),
    'msg.everyLeg':         prose('Every leg, both counterparties, to the cent. This view is logged.', { min: 3 }),

    /* withheld acknowledgment — itself subject to disclosure */
    'withheld.keys':        prose('Some doors are not on your key. The desk will open them if they should be.'),
    'withheld.aboveYou':    prose('This sits above your account. Nothing about your own record has changed.', { min: 1 }),
    'withheld.notForGuests':prose('Some of the station is not open to guests. Nothing here needs your attention.'),
    'withheld.moreThanYours':prose('There is more to this than your account can see. It sits with the operators.', { min: 1 }),
    'withheld.refusedLayer':meta('Layer {want} withheld above ceiling {ceiling}. Recorded, not fulfilled.',
                                 { kind: 'prose', fill: ['want', 'ceiling'] }),
    'withheld.layerExists': meta('Layer {want} exists. Your ceiling is {ceiling}, so it is acknowledged and not shown.',
                                 { kind: 'prose', fill: ['want', 'ceiling'] }),

    /* meter notes */
    'meter.notOpen':        label('Not open to you'),
    'meter.aboveAccount':   label('Above your account', { min: 1 }),
    'meter.limited':        label('Limited'),
    'meter.limitedAccount': label('Limited to your account', { min: 1 }),
    'meter.open':           label('Open to you'),
    'meter.yourAccount':    label('Your account', { min: 1 }),
    'meter.refusedAt':      meta('Refused above ceiling {ceiling}', { fill: ['ceiling'] }),
    'meter.clampedAt':      meta('Clamped at ceiling {ceiling}', { fill: ['ceiling'] }),
    'meter.resolvedAt':     meta('Resolved at {exposure}', { fill: ['exposure'] }),

    /* actions — one per role per outcome */
    'act.continue':         act('Continue'),
    'act.backToTerrace':    act('Back to the terrace'),
    'act.askDesk':          act('Ask at the desk'),
    /* Actions carry NO exposure minimum. Availability is the role table plus
       capability — Law 04. An operator at arrival is legitimately offered the
       console; gating that by exposure would conflate agency with specificity. */
    'act.requestAccess':    act('Request access'),
    'act.requestElevation': act('Request elevation'),
    'act.signOut':          act('Sign out'),

    /* chrome */
    'badge.level':          meta('{exposure} · {level}', { fill: ['exposure', 'level'] }),
    'role.plain':           label('{role}', { fill: ['role'] }),
    'role.withCeiling':     meta('{role} · ceiling {ceiling}', { fill: ['role', 'ceiling'] }),
    'stamp.house':          label('Tessier-Ashpool'),
    'stamp.logged':         meta('epoch 41 · logged'),

    /* CANARY — declared, never selected. Exists so the deliberate-failure test
       can project a Ledger-floor fragment at Terrace out of band and assert the
       fallback, the recorded violation and the failed audit. */
    'canary.ledgerOnly':    prose('House take is 4.2% of gross on this leg.', { min: 3, canary: true })
  };

  var ACTIONS = {
    'Continue': 'act.continue', 'Back to the terrace': 'act.backToTerrace',
    'Ask at the desk': 'act.askDesk', 'Request access': 'act.requestAccess',
    'Request elevation': 'act.requestElevation', 'Sign out': 'act.signOut'
  };

  D.registerPack({
    id: 'permission-gate',
    agency: AGENCY,
    actionFields: ['primaryLabel', 'secondaryLabel'],
    catalogue: CATALOGUE,

    fields: {
      eyebrow:        { required: true,  fallback: 'Notice' },
      headline:       { required: true,  fallback: 'This is not available right now' },
      message:        { required: true,  fallback: 'Nothing you rely on has changed. Try again shortly, or ask at the desk.' },
      withheldNote:   { required: false, fallback: null },
      meterNote:      { required: true,  fallback: 'Limited' },
      primaryLabel:   { required: true,  fallback: function (ctx) { return D.actionsFor(ctx, AGENCY)[0]; } },
      secondaryLabel: { required: true,  fallback: function (ctx) { return D.actionsFor(ctx, AGENCY)[1]; } },
      levelBadge:     { required: false, fallback: null },
      roleLabel:      { required: true,  fallback: function (ctx) { return ctx.role; } },
      stampRight:     { required: true,  fallback: 'Tessier-Ashpool' }
    },

    /* ── SELECTION ── IDs only. Every branch keys on the context; the minimum
       lives on the fragment, so a mis-keyed branch fails the policy test. */
    select: function (ctx) {
      var mode = D.disclosureMode(ctx);
      var machine = ctx.machine;
      var deep = ctx.exposure >= 3;
      var atrium = ctx.exposure >= 1;
      var actions = D.actionsFor(ctx, AGENCY);

      /* A degraded or alert system is worth naming at Service whether or not the
         screen is clamped — severity tracks state, not the clamp. */
      var unwell = ctx.systemState !== 'nominal';
      var eyebrow = ctx.denied
        ? (machine ? 'eyebrow.refused' : 'eyebrow.unavailable')
        : (ctx.clamped || (machine && unwell))
          ? (machine ? (ctx.systemState === 'alert' ? 'eyebrow.alert' : 'eyebrow.degraded') : 'eyebrow.notice')
          : (machine ? (deep ? 'eyebrow.settlement' : 'eyebrow.console')
                     : (atrium ? 'eyebrow.yourRecord' : 'eyebrow.signedIn'));

      var headline = ctx.denied
        ? (machine ? 'head.noAccess' : (atrium ? 'head.notYours' : 'head.notHere'))
        : (ctx.clamped || (machine && unwell))
          ? (machine ? (deep ? 'head.fullDiag' : 'head.partialDiag')
             : atrium ? (ctx.systemState === 'alert' ? 'head.offline' : 'head.degraded')
             : 'head.attending')
          : (machine ? (deep ? 'head.fullArithmetic' : 'head.everyRecord')
                     : (atrium ? 'head.standing' : 'head.welcome'));

      var message = ctx.denied
        ? (machine ? 'msg.refusedRecorded' : (atrium ? 'msg.recordUnaffected' : 'msg.askDesk'))
        : ctx.clamped
          ? (machine ? 'msg.structureToAccess' : (atrium ? 'msg.operatorsHaveIt' : 'msg.terraceNormal'))
          : (machine ? (deep ? 'msg.everyLeg' : 'msg.operatorRoster')
                     : (atrium ? 'msg.yourHistory' : 'msg.terraceOpen'));

      var withheld = NONE;
      if (mode === 'explicit') withheld = ctx.denied ? 'withheld.refusedLayer' : 'withheld.layerExists';
      else if (mode === 'abstract') {
        withheld = ctx.denied
          ? (atrium ? 'withheld.aboveYou' : 'withheld.keys')
          : (atrium ? 'withheld.moreThanYours' : 'withheld.notForGuests');
      }

      var meterNote = machine
        ? (ctx.denied ? 'meter.refusedAt' : ctx.clamped ? 'meter.clampedAt' : 'meter.resolvedAt')
        : ctx.denied ? (atrium ? 'meter.aboveAccount' : 'meter.notOpen')
        : ctx.clamped ? (atrium ? 'meter.limitedAccount' : 'meter.limited')
        : (atrium ? 'meter.yourAccount' : 'meter.open');

      return {
        eyebrow: eyebrow,
        headline: headline,
        message: message,
        withheldNote: withheld,
        meterNote: meterNote,
        primaryLabel: ACTIONS[actions[0]] || NONE,
        secondaryLabel: ACTIONS[actions[1]] || NONE,
        levelBadge: machine ? 'badge.level' : NONE,
        roleLabel: machine ? 'role.withCeiling' : 'role.plain',
        stampRight: machine ? 'stamp.logged' : 'stamp.house'
      };
    },

    /* ── VIEW MODEL ── non-field extras. Reads ctx and projected output; has no
       access to a denial reason, by construction. */
    view: function (ctx, out) {
      var machine = ctx.machine;
      var mode = D.disclosureMode(ctx);
      return {
        withheld: out.withheldNote != null,
        showTrace: machine,
        disclosure: mode,
        /* The gate stands ON the surface it is refusing, so the environment
           renders at the ASKER's own level — never the destination's. The held
           panel is the door: it appears only where the mode already admits that
           handling exists, and it carries no rows, counts or shape. Silent gets
           nothing at all, because a door is itself an acknowledgment. */
        envLevel: ctx.level.name.toLowerCase(),
        heldVisible: mode === 'abstract' || mode === 'explicit',
        heldNamed: mode === 'explicit',
        register: ctx.level.register,
        pair: ctx.level.pair,
        exposureNum: ctx.exposure,
        segGranted: span(0, ctx.exposure + 1),
        segRefused: span(ctx.exposure + 1, ctx.want + 1),
        segUnasked: span(Math.max(ctx.exposure, ctx.want) + 1, 4),
        trace: machine ? [
          { k: 'depth baseline', v: ctx.destination + ' (' + ctx.depth + ')' },
          { k: 'state floor', v: ctx.systemState + ' (' + ctx.floor + ')' },
          { k: 'access ceiling', v: ctx.role + ' (' + ctx.ceiling + ')' + (ctx.ceilingGrant != null ? ' · granted' : '') },
          { k: 'disclosure', v: D.disclosureMode(ctx) },
          { k: 'resolved', v: 'min(' + ctx.ceiling + ', max(' + ctx.depth + ', ' + ctx.floor + ')) = ' + ctx.exposure + ' · ' + ctx.level.name }
        ] : []
      };
    }
  });

  function span(a, b) { var o = [], i; for (i = a; i < b; i++) o.push({ i: i }); return o; }
})();
