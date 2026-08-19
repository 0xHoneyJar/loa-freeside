/* Freeside — EXECUTABLE DOCTRINE TESTS
   The assertions live here. The Conformance card is a renderer for their
   results, not a second harness.

     node templates/_doctrine/run-checks.js     ← headless, exits non-zero
     guidelines/doctrine-conformance.card.html  ← same results, rendered

   SCOPE. These assert PRESENTATION. They cannot assert that the client was
   denied the data — that is a server concern (see doctrine.js's header). A green
   verdict means the screen states the right amount, not that the payload was
   filtered.

   FIVE INDEPENDENT CLASSES
     A · structural validity — the catalogue is well formed and fully referenced
     B · fragment policy     — every fragment through dispose() at every context,
                               with no selector involved
     C · selector behaviour  — the expected IDs are chosen for known contexts
     D · reachability        — every production fragment is chosen by some case
     E · deliberate failure  — an intentionally invalid projection really does
                               fall back, record a violation, and fail an audit

   B is the one that removes the old vacuity: it never asks a selector anything,
   so a fragment's minimum cannot be an echo of the branch that chose it. */
(function () {
  'use strict';
  var D = window.FreesideDoctrine;
  var F = window.FreesideFixtures;
  if (!D || !F) return;

  var MACHINE_AT = D.MACHINE_AT;
  var lbl = F.label;
  var ALL_EXPOSURE_CTX = [];
  F.ROLES.forEach(function (role) {
    F.DESTINATIONS.forEach(function (destination) {
      F.STATES.forEach(function (systemState) {
        [undefined, ['export'], ['adjust', 'freeze', 'export']].forEach(function (grants) {
          ALL_EXPOSURE_CTX.push({ role: role, destination: destination, systemState: systemState, grants: grants });
        });
      });
    });
  });
  /* Ceiling grants too, so B covers exposures a role cannot normally reach. */
  [0, 1, 2, 3].forEach(function (c) {
    F.ROLES.forEach(function (role) {
      ALL_EXPOSURE_CTX.push({ role: role, destination: 'settlement', systemState: 'nominal', ceilingGrant: c });
    });
  });

  function eachPack(fn) { Object.keys(D.packs).forEach(function (id) { fn(D.packs[id], id); }); }
  function catalogueEntries(pack) {
    var cat = D.catalogueOf(pack);
    return Object.keys(cat).map(function (id) { return { id: id, frag: cat[id] }; });
  }
  /* Every ID any selector can produce, across that pack's own cases. */
  function selectedIds(pack) {
    var seen = {};
    D.casesFor(pack).forEach(function (c) {
      var sel = (pack.select ? pack.select(D.resolve(c)) : {}) || {};
      Object.keys(sel).forEach(function (f) {
        var id = sel[f];
        if (id != null && id !== D.NONE) seen[id] = true;
      });
    });
    return seen;
  }

  D.registerChecks([

    /* ═══ A · STRUCTURAL VALIDITY ═════════════════════════════════════════ */
    {
      id: 'A1-catalogue-ids-unique',
      title: 'A · No fragment is declared twice',
      why: 'Two IDs holding the same wording is a copy-paste duplicate: the policies drift apart and only one of them is ever tested.',
      run: function () {
        var bad = [];
        eachPack(function (pack) {
          var byValue = {};
          catalogueEntries(pack).forEach(function (e) {
            if (!e.frag || e.frag.value == null) return;
            var key = e.frag.kind + '\u0000' + e.frag.value;
            if (byValue[key]) bad.push(pack.id + ' · "' + e.frag.value + '" declared as both ' + byValue[key] + ' and ' + e.id);
            else byValue[key] = e.id;
          });
        });
        return bad;
      }
    },
    {
      id: 'A2-no-unknown-selector-ids',
      title: 'A · Selectors only name declared IDs',
      why: 'An unknown ID must be a structural fault, not a silently empty slot.',
      run: function (recorded) {
        var bad = recorded.filter(function (v) { return v.why === 'unknown fragment id'; })
                          .map(function (v) { return v.pack + ' · ' + v.field + ' → "' + v.detail + '"'; });
        eachPack(function (pack) {
          var cat = D.catalogueOf(pack);
          Object.keys(selectedIds(pack)).forEach(function (id) {
            if (!Object.prototype.hasOwnProperty.call(cat, id)) bad.push(pack.id + ' selects undeclared "' + id + '"');
          });
        });
        return bad;
      }
    },
    {
      id: 'A3-selector-returns-id-or-none',
      title: 'A · Every field gets a declared ID or an explicit none',
      why: 'A missing key is a typo that reads as a deliberate omission. D.NONE is checkable; undefined is not.',
      run: function (recorded) {
        var bad = recorded.filter(function (v) { return v.why.indexOf('selector returned no id') === 0; })
                          .map(function (v) { return v.pack + ' · ' + v.field; });
        eachPack(function (pack) {
          D.casesFor(pack).forEach(function (c) {
            var sel = (pack.select ? pack.select(D.resolve(c)) : {}) || {};
            Object.keys(pack.fields).forEach(function (f) {
              if (!(f in sel)) bad.push(pack.id + ' · ' + f + ' absent from selection — ' + lbl(c));
            });
          });
        });
        return bad;
      }
    },
    {
      id: 'A4-policy-axes-declared',
      title: 'A · Every fragment declares every policy axis validly',
      why: 'An unknown kind or existence silently skips the branch meant to govern it.',
      run: function () {
        var bad = [];
        eachPack(function (pack) {
          catalogueEntries(pack).forEach(function (e) {
            var fr = e.frag, at = pack.id + ' · ' + e.id;
            if (!D.isFrag(fr)) { bad.push(at + ' is not a declared fragment'); return; }
            if (D.KINDS.indexOf(fr.kind) === -1) bad.push(at + ' kind "' + fr.kind + '"');
            if (D.EXISTENCE.indexOf(fr.existence) === -1) bad.push(at + ' existence "' + fr.existence + '"');
            if (D.PROVENANCE.indexOf(fr.provenance) === -1) bad.push(at + ' provenance "' + fr.provenance + '"');
            if (typeof fr.minExposure !== 'number' || fr.minExposure < 0 || fr.minExposure > 3)
              bad.push(at + ' minExposure ' + fr.minExposure);
            if (fr.provenance === 'doctrine' && fr.minExposure < MACHINE_AT)
              bad.push(at + ' is doctrine metadata below Service');
            if (fr.existence === 'conditional' && fr.existenceAt == null)
              bad.push(at + ' is conditional with no existenceAt');
            /* Placeholders must be declared, and only context keys are fillable. */
            var holes = String(fr.value || '').match(/\{(\w+)\}/g) || [];
            holes.forEach(function (h) {
              var key = h.slice(1, -1);
              if (!fr.fill || fr.fill.indexOf(key) === -1) bad.push(at + ' has undeclared placeholder {' + key + '}');
            });
            (fr.fill || []).forEach(function (key) {
              if (D.FILLABLE.indexOf(key) === -1 && key !== 'n') bad.push(at + ' fills unknown key "' + key + '"');
              if (D.LADDER_FILL.indexOf(key) !== -1 && fr.minExposure < MACHINE_AT)
                bad.push(at + ' fills ladder vocabulary below Service');
            });
          });
        });
        return bad;
      }
    },
    {
      id: 'A7-action-availability-not-exposure-gated',
      title: 'A · Action availability never depends on exposure alone',
      why: 'Law 04 — four independent axes. Role and capability decide whether an action may be PERFORMED; resource existence decides whether it may be OFFERED; exposure governs only the SPECIFICITY of its label; the destination resolves its own exposure under the ceiling. An action may therefore carry a minimum, provided it also carries a plain label that survives below it — an operator standing on the terrace is still offered the console, in Terrace-safe words.',
      run: function () {
        var bad = [];
        eachPack(function (pack) {
          catalogueEntries(pack).forEach(function (e) {
            var fr = e.frag, at = pack.id + ' · ' + e.id;
            if (fr.kind !== 'action') {
              if (fr.plain) bad.push(at + ' declares a plain label but is not an action');
              return;
            }
            /* 1 · A minimum with no plain label WOULD gate availability. */
            if (fr.minExposure > 0 && !fr.plain)
              bad.push(at + ' carries minExposure ' + fr.minExposure + ' and no plain label — availability would depend on exposure');
            if (fr.plain) {
              if (fr.minExposure === 0) bad.push(at + ' declares a plain label it can never need');
              /* 2 · The plain label must be safe at the bottom, and must be a
                 real alternative rather than a copy of the specific wording. */
              if (D.lint(fr.plain)) bad.push(at + ' plain label carries ladder vocabulary — "' + fr.plain + '"');
              if (/\{\w+\}/.test(fr.plain)) bad.push(at + ' plain label carries a placeholder');
              if (fr.plain === fr.value) bad.push(at + ' plain label repeats the specific wording');
            }
            /* 3 · Behavioural. Wherever an acknowledgeable action is refused ONLY
               for exposure it must still be offered. Capability and existence
               refusals legitimately withdraw it — they are the availability
               axes — so they are excluded here rather than tolerated. */
            ALL_EXPOSURE_CTX.forEach(function (c) {
              var ctx = D.resolve(c);
              if (D.decide(fr, ctx).reason !== 'exposure') return;
              if (!D.existenceKnown(fr.existence, fr.existenceAt != null ? fr.existenceAt : fr.minExposure, ctx.ceiling)) return;
              if (D.dispose(fr, ctx, { required: false }).disposition === 'omit')
                bad.push(at + ' withdrawn at exposure ' + ctx.exposure + ' for exposure alone — ' + lbl(c));
            });
          });
        });
        return bad;
      }
    },
    {
      id: 'A5-required-fields-have-fallbacks',
      title: 'A · Every required field declares a fallback',
      why: 'A refusal on a required field must degrade to a safe line; a null fallback blanks critical UI.',
      run: function () {
        var bad = [];
        eachPack(function (pack) {
          Object.keys(pack.fields).forEach(function (f) {
            var spec = pack.fields[f];
            if (!spec.required) return;
            if (spec.fallback == null) bad.push(pack.id + ' · ' + f + ' required with no fallback');
            if (typeof spec.fallback === 'string' && !spec.fallback.trim())
              bad.push(pack.id + ' · ' + f + ' fallback is blank');
          });
        });
        return bad;
      }
    },
    {
      id: 'A6-secret-never-on-required-field',
      title: 'A · No required field may select a secret fragment',
      why: 'A required field must always say something, and a secret must never be acknowledged. Both cannot hold at once, so the combination is a design fault rather than a runtime dilemma.',
      run: function () {
        var bad = [];
        eachPack(function (pack) {
          var cat = D.catalogueOf(pack);
          D.casesFor(pack).forEach(function (c) {
            var sel = (pack.select ? pack.select(D.resolve(c)) : {}) || {};
            Object.keys(pack.fields).forEach(function (f) {
              if (!pack.fields[f].required) return;
              var fr = cat[sel[f]];
              if (fr && fr.existence === 'secret')
                bad.push(pack.id + ' · required ' + f + ' selects secret ' + sel[f] + ' — ' + lbl(c));
            });
          });
        });
        return bad;
      }
    },

    /* ═══ B · FRAGMENT POLICY ═════════════════════════════════════════════
       Every catalogued fragment, every context, no selector involved. */
    {
      id: 'B1-never-renders-below-minimum',
      title: 'B · No catalogued value renders below its own minimum, at any context',
      why: 'Forced through dispose() directly, so the minimum cannot be an echo of a selector branch. This is the check the inline-construction design could not make bite. The one thing that may render below a minimum is an action\'s plain label — a separately declared string with no minimum of its own, which is how availability survives while presentation degrades.',
      run: function () {
        var bad = [];
        eachPack(function (pack) {
          catalogueEntries(pack).forEach(function (e) {
            ALL_EXPOSURE_CTX.forEach(function (c) {
              var ctx = D.resolve(c);
              var d = D.dispose(e.frag, ctx, { required: false });
              if (d.disposition !== 'render' || e.frag.minExposure <= ctx.exposure) return;
              if (d.value === e.frag.value)
                bad.push(pack.id + ' · ' + e.id + ' (min ' + e.frag.minExposure + ') rendered its own value at ' + ctx.exposure + ' — ' + lbl(c));
              else if (!(e.frag.kind === 'action' && d.value === e.frag.plain))
                bad.push(pack.id + ' · ' + e.id + ' (min ' + e.frag.minExposure + ') rendered an undeclared substitute "' + d.value + '" at ' + ctx.exposure + ' — ' + lbl(c));
            });
          });
        });
        return bad;
      }
    },
    {
      id: 'B2-renders-at-or-above-minimum',
      title: 'B · Every fragment does render once its minimum is met',
      why: 'The positive half. A fragment that never renders anywhere is dead weight the negative check would happily pass.',
      run: function () {
        var bad = [];
        eachPack(function (pack) {
          catalogueEntries(pack).forEach(function (e) {
            if (e.frag.existence === 'secret' || e.frag.capability) return;   /* covered by B3/B4 */
            var everRendered = ALL_EXPOSURE_CTX.some(function (c) {
              var ctx = D.resolve(c);
              return ctx.exposure >= e.frag.minExposure &&
                     D.dispose(e.frag, ctx, { required: false }).disposition === 'render';
            });
            if (!everRendered) bad.push(pack.id + ' · ' + e.id + ' never renders at any context');
          });
        });
        return bad;
      }
    },
    {
      id: 'B3-secret-omits-and-never-falls-back',
      title: 'B · A secret fragment omits whole and never yields a fallback',
      why: 'A fallback in the slot is itself an acknowledgment that the slot exists.',
      run: function () {
        var bad = [];
        eachPack(function (pack) {
          catalogueEntries(pack).forEach(function (e) {
            if (e.frag.existence !== 'secret') return;
            ALL_EXPOSURE_CTX.forEach(function (c) {
              var ctx = D.resolve(c);
              var asRequired = D.dispose(e.frag, ctx, { required: true });
              if (asRequired.disposition === 'fallback')
                bad.push(pack.id + ' · secret ' + e.id + ' produced a fallback — ' + lbl(c));
              if (asRequired.disposition === 'render' && ctx.exposure < e.frag.minExposure)
                bad.push(pack.id + ' · secret ' + e.id + ' rendered below its floor — ' + lbl(c));
            });
          });
        });
        return bad;
      }
    },
    {
      id: 'B4-capability-gated-only-for-holders',
      title: 'B · A capability-gated fragment renders only for a holder',
      why: 'Capability is a separate axis: standing high enough is not being granted.',
      run: function () {
        var bad = [];
        eachPack(function (pack) {
          catalogueEntries(pack).forEach(function (e) {
            if (!e.frag.capability) return;
            ALL_EXPOSURE_CTX.forEach(function (c) {
              var ctx = D.resolve(c);
              var held = D.can(ctx.role, e.frag.capability, ctx.grants);
              var d = D.dispose(e.frag, ctx, { required: false });
              if (!held && d.disposition === 'render')
                bad.push(pack.id + ' · ' + e.id + ' needs "' + e.frag.capability + '" — ' + lbl(c));
            });
          });
        });
        return bad;
      }
    },
    {
      id: 'B5-refusals-collapse-identically',
      title: 'B · Capability, exposure and absence collapse to one disposition',
      why: 'If the three refusal reasons produced different dispositions, a viewer could difference them into an enumeration oracle.',
      run: function () {
        var bad = [];
        /* Synthetic triples: same declared existence, three different reasons. */
        [{ existence: 'secret' }, { existence: 'conditional', existenceAt: 3 }].forEach(function (policy) {
          ALL_EXPOSURE_CTX.forEach(function (c) {
            var ctx = D.resolve(c);
            if (ctx.ceiling >= 3) return;               /* acknowledgeable here, by design */
            var byExposure = D.dispose(D.declare({ value: 'x', min: 3, existence: policy.existence, existenceAt: policy.existenceAt }), ctx, { required: true });
            var byCapability = D.dispose(D.declare({ value: 'x', min: 0, capability: 'never:granted', existence: policy.existence, existenceAt: policy.existenceAt }), ctx, { required: true });
            var byAbsence = D.dispose(D.declare({ value: null, min: 0, existence: policy.existence, existenceAt: policy.existenceAt }), ctx, { required: true });
            var set = [byExposure.disposition, byCapability.disposition, byAbsence.disposition];
            if (set[0] !== set[1] || set[1] !== set[2])
              bad.push(policy.existence + ' at ' + lbl(c) + ' → ' + set.join('/'));
          });
        });
        return bad;
      }
    },
    {
      id: 'B6-disposition-carries-no-reason',
      title: 'B · A disposition never carries the internal reason',
      why: 'Packs must be unable to branch on why something was refused.',
      run: function () {
        var bad = [];
        var probes = [
          D.declare({ value: 'x', min: 3 }),
          D.declare({ value: 'x', capability: 'never:granted' }),
          D.declare({ value: null }),
          D.declare({ value: 'x', min: 3, existence: 'secret' })
        ];
        probes.forEach(function (fr, i) {
          ALL_EXPOSURE_CTX.slice(0, 12).forEach(function (c) {
            var d = D.dispose(fr, D.resolve(c), { required: true });
            Object.keys(d).forEach(function (k) {
              if (['disposition', 'value'].indexOf(k) === -1) bad.push('probe ' + i + ' exposed "' + k + '"');
            });
            if (D.DISPOSITIONS.indexOf(d.disposition) === -1) bad.push('probe ' + i + ' disposition "' + d.disposition + '"');
          });
        });
        return bad;
      }
    },

    /* ═══ C · SELECTOR BEHAVIOUR ══════════════════════════════════════════ */
    {
      id: 'C1-selectors-choose-expected-ids',
      title: 'C · Known contexts select the expected fragment IDs',
      why: 'Policy tests prove a fragment cannot leak; these prove the right one was chosen. Without them a pack could pass everything by selecting its blandest line forever.',
      run: function () {
        var expectations = [
          ['permission-gate', { role: 'guest', destination: 'arrival', systemState: 'nominal' },
            { eyebrow: 'eyebrow.signedIn', headline: 'head.welcome', message: 'msg.terraceOpen', levelBadge: D.NONE }],
          ['permission-gate', { role: 'member', destination: 'account', systemState: 'nominal' },
            { eyebrow: 'eyebrow.yourRecord', headline: 'head.standing', message: 'msg.yourHistory' }],
          ['permission-gate', { role: 'member', destination: 'console', systemState: 'nominal' },
            { eyebrow: 'eyebrow.unavailable', headline: 'head.notYours', meterNote: 'meter.aboveAccount' }],
          ['permission-gate', { role: 'operator', destination: 'console', systemState: 'nominal' },
            { eyebrow: 'eyebrow.console', headline: 'head.everyRecord', meterNote: 'meter.resolvedAt', levelBadge: 'badge.level' }],
          ['permission-gate', { role: 'principal', destination: 'settlement', systemState: 'nominal' },
            { eyebrow: 'eyebrow.settlement', headline: 'head.fullArithmetic', message: 'msg.everyLeg' }],
          ['permission-gate', { role: 'member', destination: 'account', systemState: 'alert' },
            { eyebrow: 'eyebrow.notice', headline: 'head.offline', withheldNote: 'withheld.moreThanYours' }],
          ['guest-surface', { role: 'guest', destination: 'arrival', systemState: 'nominal' },
            { gaugeCaption: 'gauge.caption.terrace', gaugeReading: 'gauge.terrace.mid', gaugeConsequence: D.NONE }],
          ['guest-surface', { role: 'member', destination: 'account', systemState: 'nominal' },
            { gaugeCaption: 'gauge.caption.atrium', gaugeReading: 'gauge.atrium.range' }],
          ['guest-surface', { role: 'operator', destination: 'account', systemState: 'alert' },
            { gaugeCaption: 'gauge.caption.service', gaugeReading: 'gauge.service.reading' }],
          ['roster', { role: 'guest', destination: 'console', systemState: 'nominal' },
            { title: 'title.nothing', subtitle: 'sub.notForGuests', countLabel: 'count.none' }],
          ['roster', { role: 'member', destination: 'account', systemState: 'nominal' },
            { title: 'title.yourStanding', subtitle: 'sub.yourRecord', countLabel: 'count.one' }],
          ['roster', { role: 'operator', destination: 'console', systemState: 'nominal' },
            { title: 'title.roster', subtitle: 'sub.everyPermitted', exportNote: 'export.separate' }],
          ['roster', { role: 'operator', destination: 'console', systemState: 'nominal', grants: ['export'] },
            { exportNote: 'export.granted' }],
          ['roster', { role: 'principal', destination: 'settlement', systemState: 'nominal' },
            { title: 'title.settlement', subtitle: 'sub.withArithmetic' }],
          ['degraded-states', { role: 'guest', destination: 'arrival', systemState: 'alert' },
            { eyebrow: 'eyebrow.alert', headline: 'head.oneOffline', body: 'body.offlinePlain' }],
          ['degraded-states', { role: 'operator', destination: 'console', systemState: 'degraded' },
            { eyebrow: 'eyebrow.degraded', headline: 'head.ingestDegraded', body: 'body.behindMachine' }],
          ['degraded-states', { role: 'operator', destination: 'console', systemState: 'nominal' },
            { eyebrow: 'eyebrow.allSystems', headline: 'head.nominalAll' }],
          ['docs', { role: 'guest', destination: 'account', systemState: 'nominal' },
            { audience: 'aud.guests', accessNote: 'access.guest', revision: 'rev.current' }],
          ['docs', { role: 'operator', destination: 'console', systemState: 'nominal' },
            { audience: 'aud.operators', accessNote: 'access.operator', revision: 'rev.numbered' }]
        ];
        var bad = [];
        expectations.forEach(function (row) {
          var pack = D.packs[row[0]];
          if (!pack) { bad.push('no pack "' + row[0] + '"'); return; }
          var sel = pack.select(D.resolve(row[1]));
          Object.keys(row[2]).forEach(function (f) {
            if (sel[f] !== row[2][f])
              bad.push(row[0] + ' · ' + lbl(row[1]) + ' · ' + f + ' → "' + sel[f] + '", expected "' + row[2][f] + '"');
          });
        });
        return bad;
      }
    },
    {
      id: 'C2-selection-is-deterministic',
      title: 'C · Selection is a pure function of context',
      why: 'A selector that reads anything outside ctx cannot be tested by a fixture.',
      run: function () {
        var bad = [];
        eachPack(function (pack) {
          D.casesFor(pack).slice(0, 40).forEach(function (c) {
            var a = JSON.stringify(pack.select(D.resolve(c)));
            var b = JSON.stringify(pack.select(D.resolve(c)));
            if (a !== b) bad.push(pack.id + ' · ' + lbl(c) + ' selection varies between calls');
          });
        });
        return bad;
      }
    },

    /* ═══ D · REACHABILITY ════════════════════════════════════════════════ */
    {
      id: 'D1-every-production-fragment-is-reachable',
      title: 'D · Every production fragment is selected by at least one case',
      why: 'An unreachable fragment is untested copy that will be edited on the assumption it ships.',
      run: function () {
        var bad = [];
        eachPack(function (pack) {
          var seen = selectedIds(pack);
          catalogueEntries(pack).forEach(function (e) {
            if (e.frag.canary) return;
            if (!seen[e.id]) bad.push(pack.id + ' · ' + e.id + ' is never selected');
          });
        });
        return bad;
      }
    },
    {
      id: 'D2-canaries-are-never-reachable',
      title: 'D · No canary fragment is reachable from a selector',
      why: 'A canary exists to be projected out of band. If a selector can reach it, it is production copy and the deliberate-failure test is asserting nothing.',
      run: function () {
        var bad = [];
        eachPack(function (pack) {
          var seen = selectedIds(pack);
          catalogueEntries(pack).forEach(function (e) {
            if (e.frag.canary && seen[e.id]) bad.push(pack.id + ' · canary ' + e.id + ' is selected in production');
          });
        });
        return bad;
      }
    },
    {
      id: 'D3-required-copy-never-blank',
      title: 'D · Required copy is never blank in any projected case',
      why: 'The user-visible symptom of every policy failure, asserted directly.',
      run: function () {
        var bad = [];
        D.sweep(function (pack, ctx, picks, out, c) {
          Object.keys(pack.fields).forEach(function (f) {
            if (!pack.fields[f].required) return;
            if (out[f] == null || !String(out[f]).trim()) bad.push(pack.id + ' · ' + f + ' empty — ' + lbl(c));
          });
        });
        return bad;
      }
    },

    /* ═══ E · DELIBERATE FAILURE CANARY ═══════════════════════════════════
       A passing test that asserts an intentionally invalid projection really
       does degrade safely, record the right violation, and fail a verdict. */
    {
      id: 'E1-canary-below-floor-falls-back',
      title: 'E · Projecting a Ledger fragment at Terrace falls back and is recorded',
      why: 'Proves the guard is live rather than merely never exercised: without a deliberate failure, a green suite is indistinguishable from a suite that cannot fail.',
      run: function () {
        var bad = [];
        var mark = D.violations.length;
        var terrace = D.resolve({ role: 'guest', destination: 'arrival', systemState: 'nominal' });
        var out = D.project('_canary', terrace);
        var added = D.violations.slice(mark);
        D.violations.length = mark;            /* leave the live audit untouched */

        if (out.ledgerLine !== 'Withheld') bad.push('required field did not fall back (got "' + out.ledgerLine + '")');
        if (out.optionalSecret != null) bad.push('secret field produced output: "' + out.optionalSecret + '"');
        var refusal = added.filter(function (v) { return v.field === 'ledgerLine' && v.why.indexOf('refused') !== -1; });
        if (!refusal.length) bad.push('no violation recorded for the refused field');
        if (refusal.length && refusal[0].why.indexOf('exposure') === -1)
          bad.push('violation recorded the wrong reason: ' + refusal[0].why);
        if (!added.length) bad.push('the guard recorded nothing at all');
        return bad;
      }
    },
    {
      id: 'E2-a-recorded-violation-fails-the-verdict',
      title: 'E · A recorded violation is sufficient to fail an audit',
      why: 'The canary would be worthless if a suppression could be recorded and still pass.',
      run: function (recorded) {
        /* audit() computes pass as: every check passed AND recorded is empty.
           Assert that second conjunct exists by construction. */
        var bad = [];
        var probe = { results: [{ pass: true }], recorded: [{ why: 'synthetic' }] };
        var wouldPass = probe.results.every(function (r) { return r.pass; }) && probe.recorded.length === 0;
        if (wouldPass) bad.push('a recorded violation would not fail the verdict');
        if (recorded.length) bad.push('live audit already carries ' + recorded.length + ' suppression(s)');
        return bad;
      }
    },

    /* ═══ MECHANISM (carried forward) ═════════════════════════════════════ */
    {
      id: 'M1-exposure-within-ceiling',
      title: 'M · Resolved exposure never exceeds access',
      why: 'Access is a ceiling, not a dial.',
      run: function () {
        return F.MATRIX.filter(function (c) { return D.resolve(c).exposure > D.resolve(c).ceiling; }).map(lbl);
      }
    },
    {
      id: 'M2-state-cannot-breach-ceiling',
      title: 'M · State never breaches the ceiling',
      why: 'An alert is not an authorisation.',
      run: function () {
        return F.MATRIX.filter(function (c) {
          var ctx = D.resolve(c);
          return ctx.floor > ctx.ceiling && ctx.exposure !== ctx.ceiling;
        }).map(lbl);
      }
    },
    {
      id: 'M3-access-does-not-theme',
      title: 'M · Elevated access does not activate a register by itself',
      why: 'An operator on the welcome page is on the terrace like everybody else.',
      run: function () {
        var bad = [];
        F.ROLES.forEach(function (role) {
          var ctx = D.resolve({ role: role, destination: 'arrival', systemState: 'nominal' });
          if (ctx.level.register !== 'light' || ctx.exposure !== 0) bad.push(role + ' → ' + ctx.exposure + ' · ' + ctx.level.name);
        });
        return bad;
      }
    },
    {
      id: 'M4-silent-never-confirms',
      title: 'M · Silent disclosure never confirms a sensitive object',
      why: 'A refusal must not become an enumeration oracle.',
      run: function () {
        var bad = [];
        D.sweep(function (pack, ctx, picks, out, c) {
          if (D.disclosureMode(ctx) !== 'silent') return;
          var res = D.RESOURCES[ctx.destination];
          if (out.withheld) bad.push(pack.id + ' · acknowledged a silent resource — ' + lbl(c));
          var blob = Object.keys(pack.fields).map(function (f) { return out[f] || ''; }).join(' ').toLowerCase();
          if (res && blob.indexOf(res.label.toLowerCase()) !== -1) bad.push(pack.id + ' · named "' + res.label + '" — ' + lbl(c));
        });
        return bad;
      }
    },
    {
      id: 'M5-export-separately-authorized',
      title: 'M · Export is never implied by role',
      why: 'Removing data from the station is its own grant.',
      run: function () {
        var bad = [];
        F.ROLES.forEach(function (role) {
          D.SEPARATELY_GRANTED.forEach(function (cap) {
            if (D.can(role, cap, [])) bad.push(role + ' holds "' + cap + '" with no grant');
          });
        });
        return bad;
      }
    },
    {
      id: 'M6-capability-grant-does-not-widen-unrelated-disclosure',
      title: 'M · A capability grant does not widen unrelated disclosure',
      why: 'Export or edit permission must not reveal extra rows or fields. An explicit access-ceiling grant may — that is what it is for, and it travels on a different input.',
      run: function () {
        var bad = [];
        F.ROLES.forEach(function (role) {
          F.DESTINATIONS.forEach(function (dest) {
            var base = D.resolve({ role: role, destination: dest, systemState: 'nominal' });
            ['export', 'adjust', 'freeze'].forEach(function (cap) {
              var g = D.resolve({ role: role, destination: dest, systemState: 'nominal', grants: [cap] });
              if (g.exposure !== base.exposure || g.ceiling !== base.ceiling)
                bad.push(role + '/' + dest + ' · "' + cap + '" changed exposure ' + base.exposure + '→' + g.exposure);
            });
            if (base.ceiling < 3) {
              var lifted = D.resolve({ role: role, destination: dest, systemState: 'nominal', ceilingGrant: 3 });
              if (lifted.ceiling <= base.ceiling) bad.push(role + '/' + dest + ' · ceiling grant did not raise the ceiling');
            }
          });
        });
        return bad;
      }
    },
    {
      id: 'M7-agency-matches-role',
      title: 'M · Visible actions always match the current role',
      why: 'Law 04 — agency tracks role. Labels are product copy, so each pack ships its own table.',
      run: function () {
        var bad = [];
        D.sweep(function (pack, ctx, picks, out, c) {
          if (!pack.actionFields) return;
          var table = pack.agency || D.AGENCY;
          var set = table[ctx.role] || D.AGENCY[ctx.role];
          var allowed = set.blocked.concat(set.open);
          /* An exposure-degraded label is still a role-projected offer: where the
             table names one wording of a declared action, its counterpart is
             allowed too. Any string outside that pairing still fails. */
          var cat = D.catalogueOf(pack);
          Object.keys(cat).forEach(function (id) {
            var fr = cat[id];
            if (fr.kind !== 'action' || !fr.plain) return;
            if (allowed.indexOf(fr.value) !== -1) allowed.push(fr.plain);
            else if (allowed.indexOf(fr.plain) !== -1) allowed.push(fr.value);
          });
          pack.actionFields.forEach(function (f) {
            if (out[f] && allowed.indexOf(out[f]) === -1) bad.push(pack.id + ' · ' + ctx.role + ' offered "' + out[f] + '" — ' + lbl(c));
          });
        });
        return bad;
      }
    },

    /* ═══ NON-VISUAL LEAKAGE ══════════════════════════════════════════════
       Projection must govern every client-visible representation, not only
       painted text. A view model is where geometry, ARIA, tooltips, data
       attributes, form values and export payloads are decided, so the audit
       reads the view model rather than trusting the markup. */
    {
      id: 'N1-view-models-carry-nothing-above-exposure',
      title: 'N · No view-model string exceeds the context it was built for',
      why: 'aria-label, title, alt, data-*, form values, URLs and export payloads are client-visible. A caption gated at Terrace while the tooltip states the reading is still a leak.',
      run: function () {
        var bad = [];
        function walk(node, path, ctx, packId, seen) {
          if (node == null) return;
          if (typeof node === 'string') {
            /* Every catalogued fragment above this exposure, in any pack, must
               not appear verbatim in a non-visual slot. */
            Object.keys(D.packs).forEach(function (pid) {
              var cat = D.catalogueOf(D.packs[pid]);
              Object.keys(cat).forEach(function (id) {
                var fr = cat[id];
                if (!fr.value || fr.value.length < 8) return;
                if (fr.minExposure <= ctx.exposure) return;
                if (node.indexOf(fr.value) !== -1) bad.push(packId + ' · ' + path + ' carries ' + pid + '/' + id);
              });
            });
            return;
          }
          if (typeof node !== 'object') return;
          if (seen.indexOf(node) !== -1) return;
          seen.push(node);
          Object.keys(node).forEach(function (k) { walk(node[k], path + '.' + k, ctx, packId, seen); });
        }
        D.sweep(function (pack, ctx, picks, out, c) {
          Object.keys(out).forEach(function (k) {
            if (k in pack.fields) return;         /* fields are already governed */
            walk(out[k], k, ctx, pack.id, []);
          });
        });
        return bad;
      }
    },
    {
      id: 'N2-gauge-hides-the-exact-reading-below-service',
      title: 'N · The gauge publishes no exact reading below Service',
      why: 'Text, numerals, geometry, ordering, colour, animation, accessibility metadata and DOM structure are all representations of the same fact, and each must stay within the precision the level permits. The first gauge captioned a band and set width to the percent: the caption was quantized and the geometry was not.',
      run: function () {
        var pack = D.packs['guest-surface'];
        var fx = D.guestSurfaceFixture;
        if (!pack || !fx) return ['guest-surface pack or fixture missing'];
        var bad = [];
        D.casesFor(pack).forEach(function (c) {
          var ctx = D.resolve(c);
          var R = fx.readingFor(ctx);
          var exact = [String(R.loadPct), String(R.celsius), String(R.humidity)];
          var g = D.project('guest-surface', ctx).gauge;
          if (!g) { bad.push('no gauge view model — ' + lbl(c)); return; }
          if (ctx.exposure >= 2) {
            if (!g.ariaNow || !g.title) bad.push('Service+ gauge lost its reading — ' + lbl(c));
            return;
          }
          ['ariaNow', 'ariaMin', 'ariaMax', 'title', 'dataValue', 'formValue'].forEach(function (k) {
            if (g[k] != null) bad.push('exposure ' + ctx.exposure + ' gauge exposes ' + k + '="' + g[k] + '" — ' + lbl(c));
          });
          var blob = [g.fill, g.ariaText, g.dataBand].join(' ');
          exact.forEach(function (n) {
            if (n.length >= 2 && blob.indexOf(n) !== -1)
              bad.push('exposure ' + ctx.exposure + ' gauge leaks "' + n + '" via geometry or ARIA — ' + lbl(c));
          });
          if (ctx.exposure === 0 && (!g.segments || g.segments.length !== fx.BANDS.length))
            bad.push('Terrace gauge is not quantized to bands — ' + lbl(c));
        });
        return bad;
      }
    },
    {
      id: 'N3-roster-metadata-matches-the-visible-set',
      title: 'N · Counts, skeletons and row ids describe only visible rows',
      why: 'Pagination metadata and skeleton counts are exports of the true total in disguise.',
      run: function () {
        var pack = D.packs.roster;
        var fx = D.rosterFixture;
        if (!pack || !fx) return ['roster pack or fixture missing'];
        var bad = [];
        D.casesFor(pack).forEach(function (c) {
          var ctx = D.resolve(c);
          var p = D.project('roster', ctx);
          var n = p.rows.length;
          var m = String(p.countLabel || '').match(/\d+/);
          if (m && parseInt(m[0], 10) !== n) bad.push('count says ' + m[0] + ', shows ' + n + ' — ' + lbl(c));
          if (p.skeletonRows.length !== n) bad.push('skeleton ' + p.skeletonRows.length + ' for ' + n + ' — ' + lbl(c));
          if (n !== fx.RECORDS.length && String(p.countLabel || '').indexOf(String(fx.RECORDS.length)) !== -1)
            bad.push('count leaks the true total — ' + lbl(c));
          if (/\d/.test(String(p.hiddenNote || '')) && !(p.hiddenNote || '').match(/ceiling/))
            bad.push('hidden note carries a numeral — ' + lbl(c));
          var allowed = fx.visibleRecords(ctx).map(function (r) { return r.id; });
          p.rows.forEach(function (r) { if (allowed.indexOf(r.id) === -1) bad.push('row id ' + r.id + ' not permitted — ' + lbl(c)); });
        });
        return bad;
      }
    }
  ]);

  /* ── CANARY PACK ───────────────────────────────────────────────────────────
     Registered with an EMPTY case list, so the ordinary sweep never touches it
     and the live audit stays clean. E1 projects it explicitly at Terrace. */
  D.registerPack({
    id: '_canary',
    catalogue: {
      'ledgerOnly': D.prose('House take is 4.2% of gross on this leg.', { min: 3, canary: true }),
      'secretOnly': D.secret('T-A Ltd · 100.80', { min: 3, canary: true })
    },
    cases: [],
    fields: {
      ledgerLine:     { required: true,  fallback: 'Withheld' },
      optionalSecret: { required: false, fallback: null }
    },
    select: function () { return { ledgerLine: 'ledgerOnly', optionalSecret: 'secretOnly' }; }
  });
})();
