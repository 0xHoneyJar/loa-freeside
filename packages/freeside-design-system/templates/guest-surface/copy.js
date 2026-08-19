/* Guest surface — DOMAIN COPY PACK
   Exposure 0, the Terrace. Paradise register, resort pair, 48 rhythm, no visible
   line, figures as prose, machinery visible but unlabelled.

   THE GAUGE. One semantic CapacityGauge with four exposure renderers, and the
   safe view model is built BEFORE render: the Terrace renderer receives only its
   qualitative band, never the exact value plus an instruction not to show it.
   That matters because the old gauge published `width:62%` at every level — the
   caption said "Comfortable, as usual" while the geometry stated the reading to
   the percent. Terrace geometry is now quantized to the band, and the exact
   value is absent from the fill width, ARIA, title, data-* and form values.
   The general rule: text, numerals, geometry, ordering, colour, animation,
   accessibility metadata and DOM structure are all representations of the same
   fact, and every one of them must stay within the precision the level permits. */
(function () {
  var D = window.FreesideDoctrine;
  if (!D) return;
  var prose = D.prose, label = D.label, act = D.action, meta = D.meta, datum = D.datum, NONE = D.NONE;

  var AGENCY = {
    guest:     { open: ['Reserve a table', 'Ask at the desk'],   blocked: ['Ask at the desk', 'Back to the terrace'] },
    member:    { open: ['Your standing', 'Reserve a table'],     blocked: ['Ask at the desk', 'Your standing'] },
    operator:  { open: ['Open the console', 'Your standing'],    blocked: ['Open the console', 'Your standing'] },
    principal: { open: ['Open the console', 'Your standing'],    blocked: ['Open the console', 'Your standing'] }
  };

  var CATALOGUE = {
    'eyebrow.arrival':      label('Arrival'),
    'eyebrow.account':      label('Your account', { min: 1 }),

    'head.shoreline':       prose('Sunlight, and a long way down'),
    'head.welcomeBack':     prose('Welcome back', { min: 1 }),
    'head.terraceOpen':     prose('The terrace is open'),

    'lede.shoreline':       prose('Freeside keeps a shoreline in orbit. The gardens are real, the light is arranged, and the machinery that makes both is in plain sight if you look for it.'),
    'lede.tableHeld':       prose('Your table is held, and your standing is current. The gardens are open as usual.', { min: 1 }),
    'lede.elsewhere':       prose('Everything you came for is running. The house is attending to something elsewhere and it does not concern the gardens.'),

    'notice.notTerrace':    prose('Something is being attended to. It is not on the terrace and nothing is required of you.'),
    'notice.recordCurrent': prose('A system is being attended to. Your record is accurate and current.', { min: 1 }),
    'notice.diagElsewhere': meta('Diagnostic detail is available at {level}. This page is not it.', { kind: 'prose', fill: ['level'] }),

    /* GAUGE CAPTIONS — one per renderer, each carrying its own floor. */
    'gauge.caption.terrace':label('Conditions on the terrace'),
    'gauge.caption.atrium':  label('Ring atmosphere', { min: 1 }),
    'gauge.caption.service': datum('Ring atmosphere, sector 4', { min: 2 }),
    'gauge.caption.ledger':  datum('Ring atmosphere, sector 4 · load-bearing', { min: 3 }),
    /* Terrace reads a BAND. The words are the whole disclosure — there is no
       exact value anywhere in this fragment or in the geometry it drives. */
    'gauge.terrace.low':     prose('Cool, and quiet at this hour'),
    'gauge.terrace.mid':     prose('Comfortable, as usual'),
    'gauge.terrace.high':    prose('Warm, and busier than usual'),
    'gauge.atrium.range':    datum('Comfortable — mid-twenties', { min: 1 }),
    'gauge.service.reading': datum('21.4 °C · 41% RH', { min: 2 }),
    'gauge.ledger.reading':  datum('21.4 °C · 41% RH · 62% of rated load', { min: 3 }),
    'gauge.ledger.consequence': datum('Holding this band costs 4.2% of ring power. Trim is charged to the resort.', { min: 3 }),

    'act.reserve':          act('Reserve a table'),
    'act.askDesk':          act('Ask at the desk'),
    /* Availability is role and capability; only the WORDING is exposure-governed.
       An operator is offered the console from the terrace either way — below
       Service the plain label preserves the offer without naming the sector. */
    'act.standing':         act('Your standing'),
    'act.console':          act('Open operations · sector 4', { min: 2, plain: 'Open the console', capability: 'view:all' }),
    'act.backToTerrace':    act('Back to the terrace'),

    /* ── SIGNS OF A LIVING ENVIRONMENT ─────────────────────────────────────
       Seven signals, each declared at four precisions. The pattern is the same
       every time: at Terrace the signal is stated as a condition you could see
       for yourself; at Atrium it is named; at Service it carries its figures;
       at Ledger it carries what it costs. No signal is invented at a higher
       level and none is contradicted at a lower one. */
    'light.terrace':        prose('The light is long and low, the way the afternoon is written'),
    'light.atrium':         prose('Late in the afternoon programme', { min: 1 }),
    'light.service':        datum('Axis at 62% output \u00b7 evening ramp begins 19:00', { min: 2 }),
    'light.ledger':         datum('Axis at 62% \u00b7 evening ramp costs 1.8% of ring power', { min: 3 }),

    'occupancy.terrace':    prose('Busier than the morning, quieter than it will be'),
    'occupancy.atrium':     prose('Comfortably attended', { min: 1 }),
    'occupancy.service':    datum('1,840 on the promenade \u00b7 61% of seated capacity', { min: 2 }),
    'occupancy.ledger':     datum('1,840 on the promenade \u00b7 61% seated \u00b7 4,200 covers booked', { min: 3 }),

    'arrivals.terrace':     prose('The induction train comes in on the hour'),
    'arrivals.atrium':      prose('Your car is held at the station until you call for it', { min: 1 }),
    'arrivals.service':     datum('Two inbound, 16:20 and 17:05 \u00b7 214 seats', { min: 2 }),
    'arrivals.ledger':      datum('Two inbound \u00b7 214 seats \u00b7 38 unsettled at the gate', { min: 3 }),

    'tonight.terrace':      prose('The lounge opens when the light turns'),
    'tonight.atrium':       prose('Bermuda Sunset lounge, from twenty hundred', { min: 1 }),
    'tonight.service':      datum('Lounge and floor staffed from 19:30 \u00b7 44 covers held', { min: 2 }),
    'tonight.ledger':       datum('Lounge take averages 4.2% of the floor', { min: 3 }),

    'work.terrace':         prose('A tender is working the water; it will be gone before dinner'),
    'work.atrium':          prose('Grounds crew on the canal until six', { min: 1 }),
    'work.service':         datum('Joint 07 routing strip live \u00b7 two crew on the canal', { min: 2 }),
    'work.ledger':          datum('Joint 07 \u00b7 scheduled, charged to the resort at 0.4%', { min: 3 }),

    'who.terrace':          prose('Guests, mostly, and the people who keep the place'),
    'who.atrium':           prose('Members and house staff on the promenade', { min: 1 }),
    'who.service':          datum('Guests 1,840 \u00b7 house 212 \u00b7 crew 46', { min: 2 }),
    'who.ledger':           datum('Guests 1,840 \u00b7 house 212 \u00b7 crew 46 \u00b7 3 under review', { min: 3 }),

    'rates.terrace':        prose('Everything on the terrace is included'),
    'rates.atrium':         prose('Table service is charged to your account', { min: 1 }),
    'rates.service':        datum('Terrace covers at no charge \u00b7 lounge from \u20AE 180', { min: 2 }),
    'rates.ledger':         datum('Lounge from \u20AE 180 \u00b7 house take 4.2% of gross', { min: 3 }),

    'sig.light':            label('The light'),
    'sig.occupancy':        label('How busy'),
    'sig.arrivals':         label('Arrivals'),
    'sig.tonight':          label('Tonight'),
    'sig.work':             label('Being seen to'),
    'sig.who':              label('Who is here'),
    'sig.rates':            label('What it costs'),

    'stamp.house':          label('Tessier-Ashpool'),
    'stamp.level':          meta('epoch 41 · {level}', { fill: ['level'] }),

    'canary.ledgerOnly':    datum('Ring load at rated capacity · trim charged to the resort', { min: 3, canary: true })
  };

  var ACTIONS = {
    'Reserve a table': 'act.reserve', 'Ask at the desk': 'act.askDesk',
    'Your standing': 'act.standing', 'Open the console': 'act.console',
    'Back to the terrace': 'act.backToTerrace'
  };

  /* The one reading this screen holds. Kept here, in the pack, and never handed
     to a renderer that is not entitled to it. */
  var READING = { celsius: 21.4, humidity: 41, loadPct: 62 };
  /* A fixture may vary the reading through ctx.data, which is how all three
     bands get exercised. Production reads the default. */
  function readingFor(ctx) {
    var d = (ctx && ctx.data) || {};
    return {
      celsius: d.celsius != null ? d.celsius : READING.celsius,
      humidity: d.humidity != null ? d.humidity : READING.humidity,
      loadPct: d.loadPct != null ? d.loadPct : READING.loadPct
    };
  }

  /* Quantized geometry. Terrace gets a band index, not a percentage — three
     positions, so the fill cannot be read back as a value. */
  var BANDS = [
    { id: 'low',  max: 33, fill: '33%', word: 'gauge.terrace.low' },
    { id: 'mid',  max: 66, fill: '66%', word: 'gauge.terrace.mid' },
    { id: 'high', max: 101, fill: '100%', word: 'gauge.terrace.high' }
  ];
  function bandFor(pct) {
    for (var i = 0; i < BANDS.length; i++) if (pct < BANDS[i].max) return BANDS[i];
    return BANDS[BANDS.length - 1];
  }
  /* Every living signal is declared at four precisions and chosen the same way.
     One function, so a signal cannot quietly acquire its own branching. */
  function signal(id, deep, machine, atrium) {
    return id + (deep ? '.ledger' : machine ? '.service' : atrium ? '.atrium' : '.terrace');
  }

  function fillList(n) {
    var o = [], i;
    for (i = 0; i < Math.max(0, n); i++) o.push({ i: i });
    return o;
  }

  D.registerPack({
    id: 'guest-surface',
    agency: AGENCY,
    actionFields: ['primaryLabel', 'secondaryLabel'],
    catalogue: CATALOGUE,

    cases: (function () {
      var out = [], r, s;
      var F = window.FreesideFixtures;
      if (!F) return [];
      F.ROLES.forEach(function (role) {
        F.STATES.forEach(function (systemState) {
          out.push({ role: role, destination: 'arrival', systemState: systemState });
          out.push({ role: role, destination: 'account', systemState: systemState });
        });
      });
      /* Reading axis — exercises every band, so the Terrace renderer is tested
         at low, mid and high rather than only at whatever today's value is. */
      [12, 62, 94].forEach(function (loadPct) {
        F.ROLES.forEach(function (role) {
          out.push({ role: role, destination: 'arrival', systemState: 'nominal', data: { loadPct: loadPct } });
        });
      });
      return out;
    })(),

    fields: {
      eyebrow:        { required: true,  fallback: 'Freeside' },
      headline:       { required: true,  fallback: 'Welcome to the terrace' },
      lede:           { required: true,  fallback: 'The gardens are open, and the view is the reason people come.' },
      noticeNote:     { required: false, fallback: null },
      gaugeCaption:   { required: true,  fallback: 'Conditions on the terrace' },
      gaugeReading:   { required: true,  fallback: 'Comfortable' },
      gaugeConsequence:{ required: false, fallback: null },
      lightNote:      { required: true,  fallback: 'The light is on its afternoon programme.' },
      occupancyNote:  { required: true,  fallback: 'Comfortably attended.' },
      arrivalsNote:   { required: true,  fallback: 'Arrivals run on the hour.' },
      tonightNote:    { required: true,  fallback: 'The lounge opens in the evening.' },
      workNote:       { required: true,  fallback: 'The grounds are being seen to.' },
      whoNote:        { required: true,  fallback: 'Guests and the people who keep the place.' },
      ratesNote:      { required: true,  fallback: 'Charges are settled with the house.' },
      lightLabel:     { required: true,  fallback: 'The light' },
      occupancyLabel: { required: true,  fallback: 'How busy' },
      arrivalsLabel:  { required: true,  fallback: 'Arrivals' },
      tonightLabel:   { required: true,  fallback: 'Tonight' },
      workLabel:      { required: true,  fallback: 'Being seen to' },
      whoLabel:       { required: true,  fallback: 'Who is here' },
      ratesLabel:     { required: true,  fallback: 'What it costs' },
      primaryLabel:   { required: true,  fallback: function (ctx) { return D.actionsFor(ctx, AGENCY)[0]; } },
      secondaryLabel: { required: true,  fallback: function (ctx) { return D.actionsFor(ctx, AGENCY)[1]; } },
      stamp:          { required: true,  fallback: 'Tessier-Ashpool' }
    },

    select: function (ctx) {
      var mode = D.disclosureMode(ctx);
      var atrium = ctx.exposure >= 1;
      var machine = ctx.machine;
      var deep = ctx.exposure >= 3;
      var actions = D.actionsFor(ctx, AGENCY);
      var band = bandFor(readingFor(ctx).loadPct);

      var notice = NONE;
      if (mode === 'explicit') notice = 'notice.diagElsewhere';
      else if (mode === 'abstract') notice = atrium ? 'notice.recordCurrent' : 'notice.notTerrace';

      return {
        eyebrow: atrium ? 'eyebrow.account' : 'eyebrow.arrival',
        headline: ctx.clamped ? 'head.terraceOpen' : (atrium ? 'head.welcomeBack' : 'head.shoreline'),
        lede: ctx.clamped ? 'lede.elsewhere' : (atrium ? 'lede.tableHeld' : 'lede.shoreline'),
        noticeNote: notice,
        gaugeCaption: deep ? 'gauge.caption.ledger' : machine ? 'gauge.caption.service'
                     : atrium ? 'gauge.caption.atrium' : 'gauge.caption.terrace',
        gaugeReading: deep ? 'gauge.ledger.reading' : machine ? 'gauge.service.reading'
                     : atrium ? 'gauge.atrium.range' : band.word,
        gaugeConsequence: deep ? 'gauge.ledger.consequence' : NONE,
        lightNote:     signal('light', deep, machine, atrium),
        occupancyNote: signal('occupancy', deep, machine, atrium),
        arrivalsNote:  signal('arrivals', deep, machine, atrium),
        tonightNote:   signal('tonight', deep, machine, atrium),
        workNote:      signal('work', deep, machine, atrium),
        whoNote:       signal('who', deep, machine, atrium),
        ratesNote:     signal('rates', deep, machine, atrium),
        lightLabel: 'sig.light', occupancyLabel: 'sig.occupancy', arrivalsLabel: 'sig.arrivals',
        tonightLabel: 'sig.tonight', workLabel: 'sig.work', whoLabel: 'sig.who', ratesLabel: 'sig.rates',
        primaryLabel: ACTIONS[actions[0]] || NONE,
        secondaryLabel: ACTIONS[actions[1]] || NONE,
        stamp: machine ? 'stamp.level' : 'stamp.house'
      };
    },

    /* ── SAFE VIEW MODEL ──────────────────────────────────────────────────────
       Built per exposure. The Terrace branch never receives READING at all, so
       there is no exact value available to leak into geometry, ARIA, a tooltip,
       a data attribute or a form value. Service and Ledger receive the precise
       reading because they are entitled to it. */
    view: function (ctx, out) {
      var R = readingFor(ctx);
      var band = bandFor(R.loadPct);
      var gauge;
      if (ctx.exposure >= 2) {
        /* Geometry is a disclosure channel like any other, so it is quantized
           here too, at 5% ticks — coarser than the figure it accompanies. The
           exact reading is stated in the text, the ARIA label, the title and
           data-value, all of which Service is entitled to. Every channel stays
           within the permitted precision; none is exempt because another one
           already carries the number. */
        var ticks = Math.round(R.loadPct / 5);
        gauge = {
          renderer: ctx.exposure >= 3 ? 'ledger' : 'service',
          fill: R.loadPct + '%',
          tickLit: fillList(ticks),
          tickDim: fillList(20 - ticks),
          ariaNow: String(R.loadPct), ariaMin: '0', ariaMax: '100',
          ariaText: R.celsius + ' degrees celsius, ' + R.humidity + '% relative humidity',
          title: R.celsius + ' °C · ' + R.humidity + '% RH',
          dataBand: band.id, dataValue: String(R.loadPct), formValue: String(R.loadPct),
          segments: null
        };
      } else if (ctx.exposure === 1) {
        /* Rounded quantity: ten steps, so the bar states a rounded figure rather
           than a width the exact reading could be read back out of. */
        var steps = Math.round(R.loadPct / 10);
        gauge = {
          renderer: 'atrium',
          fill: (steps * 10) + '%',
          stepLit: fillList(steps),
          stepDim: fillList(10 - steps),
          ariaNow: null, ariaMin: null, ariaMax: null,
          ariaText: 'Comfortable, in the middle of the range',
          title: null, dataBand: band.id, dataValue: null, formValue: null,
          segments: null
        };
      } else {
        /* Terrace: band only. Three quantized segments, no percentage anywhere. */
        gauge = {
          renderer: 'terrace',
          fill: band.fill,
          ariaNow: null, ariaMin: null, ariaMax: null,
          ariaText: 'Conditions are comfortable',
          title: null, dataBand: band.id, dataValue: null, formValue: null,
          segments: BANDS.map(function (b, i) {
            return { id: b.id, lit: i <= BANDS.indexOf(band) };
          }),
          /* Lit and dim segments as two lists, so the template renders each with a
             literal opacity instead of a style hole. The band is monotone — every
             segment up to it is lit — which is what lets the split work. */
          segLit: BANDS.slice(0, BANDS.indexOf(band) + 1).map(function (b) { return { id: b.id }; }),
          segDim: BANDS.slice(BANDS.indexOf(band) + 1).map(function (b) { return { id: b.id }; })
        };
      }
      return {
        envLevel: ctx.level.name.toLowerCase(),
        /* The crowd is a BAND, not a count, and the template carries the three
           groups with literal positions — so the marks need no style hole and
           paint with the rest of the composition. */
        crowdLow: band.id === 'low',
        crowdMid: band.id === 'mid',
        crowdHigh: band.id === 'high',
        register: ctx.level.register,
        pair: ctx.level.pair,
        exposureNum: ctx.exposure,
        hasNotice: out.noticeNote != null,
        hasConsequence: out.gaugeConsequence != null,
        showRules: ctx.exposure >= 1,
        gauge: gauge,
        gaugeIsTerrace: gauge.renderer === 'terrace',
        gaugeIsAtrium: gauge.renderer === 'atrium',
        gaugeIsMachine: ctx.exposure >= 2,
        /* Amenity lines are authored copy: identical for every reader, carrying
           no state, so they live in the template. See the boundary note in
           templates/docs/copy.js. */
        amenities: null
      };
    }
  });

  D.guestSurfaceFixture = { READING: READING, BANDS: BANDS, bandFor: bandFor, readingFor: readingFor };
})();
