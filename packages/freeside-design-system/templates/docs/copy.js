/* Docs — DOMAIN COPY PACK (chrome only)
   Long-form reading at exposure 1, the Atrium.

   THE BOUNDARY. Doctrine governs strings that describe SYSTEM STATE — what is
   happening, how much you may see, what you may do. An article's prose is
   authored content: the same words for every reader, carrying no state, so it
   lives as template markup and a consumer overwrites it directly. This pack
   projects the chrome that DOES vary.

   The test for a new string: does its content depend on role, depth or state? If
   yes it is catalogued and selected. If no it is authored copy in the template. */
(function () {
  var D = window.FreesideDoctrine;
  if (!D) return;
  var prose = D.prose, label = D.label, act = D.action, meta = D.meta, NONE = D.NONE;

  var AGENCY = {
    guest:     { open: ['Ask at the desk', 'Back to the terrace'],  blocked: ['Ask at the desk', 'Back to the terrace'] },
    member:    { open: ['Your standing', 'Ask at the desk'],        blocked: ['Request access', 'Your standing'] },
    /* At account and console an operator's ceiling covers the depth, so they are
       never denied here and no selector can reach a blocked label. */
    operator:  { open: ['Open the console', 'Your standing'],       blocked: ['Open the console', 'Your standing'] },
    principal: { open: ['Open the console', 'Freeze scoring'],      blocked: ['Open the console', 'Freeze scoring'] }
  };

  var CATALOGUE = {
    'aud.guests':          label('For guests on the terrace'),
    'aud.members':         label('For members', { min: 1 }),
    'aud.operators':       label('For operators · internal', { min: 2 }),

    'access.guest':        prose('Sections describing member standing are summarised here and detailed in your account once you have one.'),
    'access.member':       prose('Everything in this document applies to your own record. Operator procedure is summarised, not detailed.', { min: 1 }),
    'access.operator':     prose('Operator procedure in full. Settlement arithmetic is documented separately and is not included here.', { min: 2 }),

    'standing.attended':   prose('Parts of this document describe systems that are being attended to. The procedure below is unchanged.'),
    'standing.diagAt':     meta('A system is degraded. Procedure below is current; diagnostic detail is at {level}.',
                                { kind: 'prose', fill: ['level'] }),

    'act.askDesk':         act('Ask at the desk'),
    'act.backToTerrace':   act('Back to the terrace'),
    'act.standing':        act('Your standing'),
    'act.requestAccess':   act('Request access'),
    'act.console':         act('Open the console'),
    'act.freeze':          act('Freeze scoring', { capability: 'freeze' }),

    'rev.current':         label('Current'),
    'rev.numbered':        meta('rev 14 · epoch 41'),
    'stamp.house':         label('Tessier-Ashpool'),
    'stamp.logged':        meta('epoch 41 · {role}', { fill: ['role'] }),

    'canary.ledgerOnly':   prose('Settlement arithmetic: 4.2% to the house on every leg.', { min: 3, canary: true })
  };

  var ACTIONS = {
    'Ask at the desk': 'act.askDesk', 'Back to the terrace': 'act.backToTerrace',
    'Your standing': 'act.standing', 'Request access': 'act.requestAccess',
    'Open the console': 'act.console',
    'Freeze scoring': 'act.freeze'
  };

  D.registerPack({
    id: 'docs',
    agency: AGENCY,
    actionFields: ['primaryLabel', 'secondaryLabel'],
    catalogue: CATALOGUE,

    cases: (function () {
      var F = window.FreesideFixtures;
      if (!F) return [];
      var out = [];
      F.ROLES.forEach(function (role) {
        F.STATES.forEach(function (systemState) {
          out.push({ role: role, destination: 'account', systemState: systemState });
          out.push({ role: role, destination: 'console', systemState: systemState });
        });
      });
      return out;
    })(),

    fields: {
      audience:       { required: true,  fallback: 'For everyone on the station' },
      standingNote:   { required: false, fallback: null },
      accessNote:     { required: true,  fallback: 'Everything in this document applies to your account.' },
      primaryLabel:   { required: true,  fallback: function (ctx) { return D.actionsFor(ctx, AGENCY)[0]; } },
      secondaryLabel: { required: true,  fallback: function (ctx) { return D.actionsFor(ctx, AGENCY)[1]; } },
      stamp:          { required: true,  fallback: 'Tessier-Ashpool' },
      revision:       { required: true,  fallback: 'Current' }
    },

    select: function (ctx) {
      var machine = ctx.machine;
      var atrium = ctx.exposure >= 1;
      var mode = D.disclosureMode(ctx);
      var actions = D.actionsFor(ctx, AGENCY);

      var standing = NONE;
      if (mode === 'explicit') standing = 'standing.diagAt';
      else if (mode === 'abstract') standing = 'standing.attended';

      return {
        audience: machine ? 'aud.operators' : (atrium ? 'aud.members' : 'aud.guests'),
        standingNote: standing,
        accessNote: machine ? 'access.operator' : (atrium ? 'access.member' : 'access.guest'),
        primaryLabel: ACTIONS[actions[0]] || NONE,
        secondaryLabel: ACTIONS[actions[1]] || NONE,
        stamp: machine ? 'stamp.logged' : 'stamp.house',
        revision: machine ? 'rev.numbered' : 'rev.current'
      };
    },

    view: function (ctx, out) {
      return {
        register: ctx.level.register,
        pair: ctx.level.pair,
        exposureNum: ctx.exposure,
        hasStanding: out.standingNote != null,
        showRules: ctx.exposure >= 1
      };
    }
  });
})();
