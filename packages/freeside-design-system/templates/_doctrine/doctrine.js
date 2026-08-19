/* Freeside — DOCTRINE ENGINE
   ═══════════════════════════════════════════════════════════════════════════
   THIS IS A PRESENTATION DOCTRINE, NOT A SECURITY BOUNDARY.

   Everything below decides what a permitted viewer is SHOWN. It does not decide
   what they are permitted to receive. Rows, cells, counts, pagination metadata,
   aggregates and exports must be filtered or authorised on the server before
   the payload reaches the client. Omitting a node from the DOM, dropping a
   column, or hiding an element with CSS is not access control — the data is
   still in the response, and the response is readable.
   ═══════════════════════════════════════════════════════════════════════════

   Owns: the fragment catalogue contract, exposure resolution, disclosure,
   capability, the reason→disposition collapse, the pack registry, the audit.

   Does NOT own: product copy (each template ships copy.js), the case matrix
   (fixtures.js), or the assertions (tests.js + per-pack checks.js).

   ── CATALOGUE, THEN SELECTION ─────────────────────────────────────────────
   A pack declares its fragments ONCE, at module scope, with intrinsic policy
   and no access to ctx. A selector then returns fragment IDs for a context —
   never a constructed fragment.

   That split is what makes the policy tests non-vacuous. When a branch built its
   own fragment inline, `min` could be derived from the same `ctx.exposure` the
   branch was keyed on, so the guard could not fail by construction. A catalogued
   fragment's minimum is a fact about its wording, fixed before any context
   exists, and every fragment is forced through decide() at every exposure
   regardless of which branch would have chosen it.

     kind          prose | datum | action | label     — what it IS
     provenance    doctrine | domain                  — where it CAME FROM
     minExposure   0..3                               — when it may be SHOWN
     existence     public | conditional | secret      — when it may be ADMITTED
     existenceAt   0..3                               — ceiling at which a
                                                        conditional existence
                                                        may be acknowledged
     capability    null | 'export' | …                — what you must HOLD
     plain         string | null                      — actions only: the label
                                                        that survives below the
                                                        minimum

   ── ACTIONS SIT ON FOUR AXES ──────────────────────────────────────────────
   Availability and presentation are separate concerns:

     role + capability   whether the action may be PERFORMED
     resource existence  whether it may be OFFERED at all
     exposure            the SPECIFICITY of its label and explanation
     destination         resolves its OWN exposure under the access ceiling

   So availability must not depend on exposure alone, while presentation may be
   exposure-governed. An operator standing on a Terrace page is entitled to open
   operations; the label reaching for Service vocabulary is not. Such an action
   declares `plain` — a low-exposure label that preserves the offer — and
   dispose() renders that instead of withdrawing the action. Capability and
   existence still withdraw it, because those are the availability axes.

   ── EVERY CHANNEL IS A DISCLOSURE CHANNEL ─────────────────────────────────
   Text, numerals, geometry, ordering, colour, animation, accessibility metadata
   and DOM structure are all representations of the same facts, and each must
   stay within the precision the level permits. A bar whose width is the reading
   states the reading. The rule is not that only text discloses; it is that every
   channel is quantized to what the level may know.

   ── DISPOSITION, NOT REASON ───────────────────────────────────────────────
   decide() keeps the exact internal reason FOR THE AUDIT ONLY. Packs and
   templates receive a public disposition: render | fallback | omit. For a
   fragment whose existence may not be acknowledged, missing capability,
   insufficient exposure and true absence all collapse to the SAME disposition,
   so a refusal cannot be differenced into an enumeration oracle. The collapse is
   the default inside one function, never a branch a pack opts into. */
(function () {
  'use strict';

  var CEILING = { guest: 0, member: 1, operator: 2, principal: 3 };
  var DEPTH = { arrival: 0, account: 1, console: 2, settlement: 3 };
  var FLOOR = { nominal: 0, degraded: 2, alert: 3 };

  var LEVELS = [
    { n: 0, name: 'Terrace', register: 'light', pair: 'resort' },
    { n: 1, name: 'Atrium', register: 'light', pair: 'garden' },
    { n: 2, name: 'Service', register: 'deep', pair: 'systems' },
    { n: 3, name: 'Ledger', register: 'deep', pair: 'vice' }
  ];

  var MACHINE_AT = 2;
  var KINDS = ['prose', 'datum', 'action', 'label'];
  var EXISTENCE = ['public', 'conditional', 'secret'];
  var PROVENANCE = ['doctrine', 'domain'];
  var DISPOSITIONS = ['render', 'fallback', 'omit'];

  /* A selector says "nothing here" with this, never with a bare null — an
     explicit none is checkable, a missing key is a typo. */
  var NONE = '\u0000none';

  /* ── FRAGMENT DECLARATION ──────────────────────────────────────────────────
     Declaration only. No ctx is in scope by construction. */
  function declare(spec) {
    spec = spec || {};
    return {
      __frag: true,
      value: spec.value == null ? null : String(spec.value),
      kind: spec.kind || 'prose',
      provenance: spec.provenance || 'domain',
      minExposure: spec.min != null ? spec.min : (spec.minExposure != null ? spec.minExposure : 0),
      existence: spec.existence || 'public',
      existenceAt: spec.existenceAt,
      capability: spec.capability || null,
      /* Actions only. A label safe at the bottom of the ladder, preserving the
         offer when the specific wording sits above the viewer. An action that
         carries a minimum must carry this too, or its availability would be
         exposure-gated — which is what A7 forbids. */
      plain: spec.plain == null ? null : String(spec.plain),
      /* A catalogued value is static, because policy must be decidable before any
        context exists. A few machine labels legitimately carry context integers
        ("ceiling 2"), so a fragment may declare the placeholders it fills. Only
        the NUMBERS substitute; kind, provenance, minimum and existence are all
        still fixed at declaration. Filling below Service is impossible by
        construction, since every filling fragment carries a machine floor. */
      fill: spec.fill || null,
      /* Marks a fragment that exists only to be projected out of band by the
         canary test. Never reachable from a production selector. */
      canary: !!spec.canary
    };
  }
  function kindDeclarer(kind, provenance, minFloor) {
    return function (value, opts) {
      opts = opts || {};
      var min = opts.min != null ? opts.min : 0;
      return declare({
        value: value, kind: opts.kind || kind,
        provenance: provenance || opts.provenance,
        min: minFloor != null ? Math.max(min, minFloor) : min,
        existence: opts.existence, existenceAt: opts.existenceAt,
        capability: opts.capability, plain: opts.plain, fill: opts.fill, canary: opts.canary
      });
    };
  }
  var prose = kindDeclarer('prose');
  var datum = kindDeclarer('datum');
  var action = kindDeclarer('action');
  var label = kindDeclarer('label');
  /* Doctrine metadata: provenance fixed, floor pinned at Service — it carries
     the ladder's own vocabulary. May sit higher, never lower. */
  var meta = kindDeclarer('label', 'doctrine', MACHINE_AT);
  function secret(value, opts) {
    opts = opts || {};
    return declare({
      value: value, kind: opts.kind || 'datum', provenance: 'domain',
      min: opts.min != null ? opts.min : MACHINE_AT,
      existence: 'secret', capability: opts.capability, canary: opts.canary
    });
  }
  function isFrag(x) { return !!(x && x.__frag === true); }

  /* ── RESOURCES + CAPABILITIES ──────────────────────────────────────────── */
  var RESOURCES = {
    arrival:    { label: 'the terrace', existence: 'public',      existenceAt: 0 },
    account:    { label: 'your record', existence: 'public',      existenceAt: 0 },
    console:    { label: 'the console', existence: 'public',      existenceAt: 0 },
    settlement: { label: 'settlement',  existence: 'conditional', existenceAt: 2 }
  };

  var CAPABILITY = {
    guest:     [],
    member:    ['view:self'],
    operator:  ['view:all', 'adjust'],
    principal: ['view:all', 'adjust', 'freeze']
  };
  var SEPARATELY_GRANTED = ['export'];

  function capabilities(role, grants) {
    var base = (CAPABILITY[role] || []).slice();
    (grants || []).forEach(function (g) { if (base.indexOf(g) === -1) base.push(g); });
    return base;
  }
  function can(role, cap, grants) { return capabilities(role, grants).indexOf(cap) !== -1; }

  var AGENCY = {
    guest:     { blocked: ['Ask at the desk', 'Back to the terrace'], open: ['Continue', 'Back to the terrace'] },
    member:    { blocked: ['Request access', 'Sign out'],             open: ['Continue', 'Sign out'] },
    operator:  { blocked: ['Request elevation', 'Sign out'],          open: ['Continue', 'Sign out'] },
    principal: { blocked: ['Open on record', 'Sign out'],             open: ['Continue', 'Sign out'] }
  };
  function actionsFor(ctx, agency) {
    var table = agency || AGENCY;
    var set = table[ctx.role] || AGENCY[ctx.role] || AGENCY.guest;
    return ctx.denied ? set.blocked : set.open;
  }

  /* ── RESOLUTION ────────────────────────────────────────────────────────────
     exposure = min(access ceiling, max(depth baseline, state floor))
     `ceilingGrant` is the only legitimate widening; capability grants never
     touch the ceiling. */
  function resolve(input) {
    input = input || {};
    var role = input.role || 'guest';
    var destination = input.destination || 'arrival';
    var systemState = input.systemState || 'nominal';
    var base = CEILING[role] != null ? CEILING[role] : 0;
    var ceiling = input.ceilingGrant != null ? Math.max(base, input.ceilingGrant) : base;
    var depth = DEPTH[destination] != null ? DEPTH[destination] : 0;
    var floor = FLOOR[systemState] != null ? FLOOR[systemState] : 0;
    var want = Math.max(depth, floor);
    var exposure = Math.min(ceiling, want);
    return {
    /* Domain data a fixture may vary independently of role, depth and state.
       Lets a pack's own case list exercise readings and record shapes without
       inventing a fourth dial. */
      data: input.data || {},
      role: role, destination: destination, systemState: systemState,
      grants: input.grants || [], ceilingGrant: input.ceilingGrant,
      baseCeiling: base, ceiling: ceiling,
      depth: depth, floor: floor, want: want, exposure: exposure,
      level: LEVELS[exposure],
      denied: depth > ceiling,
      clamped: depth <= ceiling && want > ceiling,
      machine: exposure >= MACHINE_AT
    };
  }

  /* An action's destination resolves its OWN exposure, under the same access
     ceiling. Offering the console from the terrace neither carries Terrace into
     the console nor lifts the ceiling on arrival: the destination is resolved,
     never inherited from the page that offered it. */
  function destinationExposure(ctx, destination) {
    var depth = DEPTH[destination] != null ? DEPTH[destination] : 0;
    return Math.min(ctx.ceiling, Math.max(depth, ctx.floor));
  }

  /* ── DISCLOSURE ──────────────────────────────────────────────────────────
     Existence is judged against the CEILING (what you are permitted to know),
     never the resolved exposure (what this screen happens to show). */
  function existenceKnown(existence, existenceAt, ceiling) {
    if (existence === 'secret') return false;
    if (existence === 'conditional') return ceiling >= (existenceAt != null ? existenceAt : MACHINE_AT);
    return true;
  }
  function disclosureFor(ctx, res) {
    if (!res) return 'none';
    if (!existenceKnown(res.existence, res.existenceAt, ctx.ceiling)) return 'silent';
    return ctx.machine ? 'explicit' : 'abstract';
  }
  function disclosureMode(ctx) {
    if (!ctx.denied && !ctx.clamped) return 'none';
    return disclosureFor(ctx, RESOURCES[ctx.destination] || RESOURCES.arrival);
  }

  /* ── DECIDE — internal, audit-facing ──────────────────────────────────────
     Returns the EXACT reason. Only the engine and the test suite see this.
     Capability is evaluated before exposure: holding no grant is a different
     failure from standing too low, and the audit wants to know which. */
  function decide(frag, ctx) {
    if (!isFrag(frag)) return { allow: false, reason: 'unclassified' };
    if (frag.value == null) return { allow: false, reason: 'absent' };
    if (frag.capability && !can(ctx.role, frag.capability, ctx.grants))
      return { allow: false, reason: 'capability' };
    if (frag.minExposure > ctx.exposure) return { allow: false, reason: 'exposure' };
    return { allow: true, reason: 'ok', value: frag.value };
  }

  /* ── THE COLLAPSE — public, pack-facing ───────────────────────────────────
     One function, default-safe. Existence policy converts the internal reason
     into a disposition. When a fragment's existence may not be acknowledged,
     EVERY refusal reason maps to 'omit' — capability, exposure and absence are
     indistinguishable downstream, which is the security property. A pack cannot
     opt out of the collapse because a pack never sees the reason. */
  function dispose(frag, ctx, opts) {
    opts = opts || {};
    var d = decide(frag, ctx);
    if (d.allow) return { disposition: 'render', value: d.value };

    var acknowledgeable = isFrag(frag) && existenceKnown(
      frag.existence,
      frag.existenceAt != null ? frag.existenceAt : frag.minExposure,
      ctx.ceiling
    );
    /* Not acknowledgeable → omit, whatever the reason. No fallback either: a
       fallback in the slot is itself an acknowledgment that the slot exists. */
    if (!acknowledgeable) return { disposition: 'omit' };
    /* Presentation degrades; availability does not. An action refused ONLY for
       exposure keeps its offer and loses its specific wording — the plain label
       renders in place of the catalogued one. Capability and existence still
       withdraw the action outright, since those decide whether it may be
       performed and whether it may be admitted to exist. */
    if (frag.kind === 'action' && frag.plain && d.reason === 'exposure')
      return { disposition: 'render', value: frag.plain, degraded: true };
    return { disposition: opts.required ? 'fallback' : 'omit' };
  }

  /* ── VIOLATIONS ──────────────────────────────────────────────────────────
     The internal reason lands here and nowhere else. */
  var violations = [];
  function violation(pack, field, ctx, why, detail) {
    violations.push({ pack: pack, field: field, exposure: ctx.exposure, why: why, detail: detail || '' });
  }

  /* ── PACK REGISTRY ─────────────────────────────────────────────────────── */
  var packs = {};
  var CHECKS = [];
  function registerPack(p) { packs[p.id] = p; return p; }
  function registerChecks(list) { list.forEach(function (c) { CHECKS.push(c); }); }

  function catalogueOf(pack) { return pack.catalogue || {}; }

  /* Selector → IDs. An unknown ID is a structural fault, recorded and treated as
     none; it must never silently render. */
  function selectionFor(pack, ctx) {
    var sel = (pack.select ? pack.select(ctx) : {}) || {};
    var cat = catalogueOf(pack);
    var out = {}, f;
    for (f in pack.fields) {
      var id = sel[f];
      if (id == null) { out[f] = { id: NONE, frag: null, unknown: false, missing: true }; continue; }
      if (id === NONE) { out[f] = { id: NONE, frag: null, unknown: false, missing: false }; continue; }
      if (!Object.prototype.hasOwnProperty.call(cat, id)) {
        out[f] = { id: id, frag: null, unknown: true, missing: false };
        continue;
      }
      out[f] = { id: id, frag: cat[id], unknown: false, missing: false };
    }
    out.__extras = sel;
    return out;
  }

  function renderField(packId, field, spec, pick, ctx, fills) {
    var fb = function () {
      return typeof spec.fallback === 'function' ? spec.fallback(ctx) : spec.fallback;
    };
    if (pick.unknown) {
      violation(packId, field, ctx, 'unknown fragment id', pick.id);
      return spec.required ? fb() : null;
    }
    if (pick.missing) {
      violation(packId, field, ctx, 'selector returned no id (use D.NONE)', '');
      return spec.required ? fb() : null;
    }
    if (pick.id === NONE) {
      if (spec.required) { violation(packId, field, ctx, 'required field selected none', ''); return fb(); }
      return null;
    }
    var d = dispose(pick.frag, ctx, { required: spec.required });
    if (d.disposition === 'render') {
      var filled = fillValue(pick.frag, d.value, ctx, fills);
      if (filled.bad.length) violation(packId, field, ctx, 'undeclared fill placeholder', filled.bad.join(','));
      return filled.text;
    }
    /* The reason is recorded for the audit and discarded from the output. */
    violation(packId, field, ctx, 'required field refused: ' + decide(pick.frag, ctx).reason, pick.id);
    return d.disposition === 'fallback' ? fb() : null;
  }

  function project(packId, ctx) {
    var pack = packs[packId];
    if (!pack) return {};
    var picks = selectionFor(pack, ctx);
    var fills = pack.fills ? pack.fills(ctx) : null;
    var out = {}, f, k;
    for (f in pack.fields) out[f] = renderField(pack.id, f, pack.fields[f], picks[f], ctx, fills);
    /* View models and non-field extras. A pack computes these from ctx and from
       dispositions — never from a reason, which it cannot reach. */
    var extras = pack.view ? pack.view(ctx, out) : {};
    for (k in extras) if (!(k in pack.fields)) out[k] = extras[k];
    return out;
  }

  /* Full detail for the test suite only. */
  function inspect(packId, ctx) {
    var pack = packs[packId];
    if (!pack) return { picks: {}, out: {}, decisions: {}, dispositions: {} };
    var picks = selectionFor(pack, ctx);
    var decisions = {}, dispositions = {}, f;
    for (f in pack.fields) {
      var p = picks[f];
      decisions[f] = p && p.frag ? decide(p.frag, ctx) : { allow: false, reason: p && p.unknown ? 'unknown' : 'none' };
      dispositions[f] = p && p.frag ? dispose(p.frag, ctx, { required: pack.fields[f].required }).disposition
                                    : (pack.fields[f].required ? 'fallback' : 'omit');
    }
    return { picks: picks, out: project(packId, ctx), decisions: decisions, dispositions: dispositions, pack: pack };
  }

  /* ── SECONDARY LINT — advisory, never a verdict, no digit rule ─────────── */
  var LINT_WORDS = /\bexposure\b|\bceiling\b|\bbaseline\b|\bclamped?\b|\bresolved at\b/i;
  function lint(s) { return typeof s === 'string' && LINT_WORDS.test(s); }

  /* ── FILL ────────────────────────────────────────────────────────────────
     Post-decision substitution of context integers into a declared fragment.
     Placeholders must be declared on the fragment AND known here; anything else
     is a structural fault rather than a silent literal brace in the UI. */
  var FILLABLE = ['role', 'ceiling', 'exposure', 'want', 'depth', 'floor', 'destination', 'systemState', 'level'];
  /* The ladder counting itself: numeric levels, plus the level NAME, which is
     ladder vocabulary. These may only fill at Service and above. `role`,
     `destination` and `systemState` are names the viewer already holds and carry
     no floor of their own. */
  var LADDER_FILL = ['ceiling', 'exposure', 'want', 'depth', 'floor', 'level'];
  function fillValue(frag, value, ctx, extra) {
    if (!frag.fill || !frag.fill.length) return { text: value, bad: [] };
    var bad = [];
    var text = String(value).replace(/\{(\w+)\}/g, function (m, key) {
      if (frag.fill.indexOf(key) === -1) { bad.push(key); return m; }
      /* Context integers come from ctx and are floor-guarded at declaration. A
         pack may supply its own counted values through fills(ctx) — the roster's
         visible-row count is the case. Those are NOT context keys, so they carry
         no floor of their own and cannot smuggle the ladder's own counting. */
      if (FILLABLE.indexOf(key) !== -1) return key === 'level' ? ctx.level.name : String(ctx[key]);
      if (extra && Object.prototype.hasOwnProperty.call(extra, key)) return String(extra[key]);
      bad.push(key);
      return m;
    });
    return { text: text, bad: bad };
  }

  function casesFor(pack) { return pack.cases || (window.FreesideFixtures && window.FreesideFixtures.MATRIX) || []; }

  function sweep(fn) {
    Object.keys(packs).forEach(function (id) {
      var pack = packs[id];
      casesFor(pack).forEach(function (c) {
        var ctx = resolve(c);
        var i = inspect(id, ctx);
        fn(pack, ctx, i.picks, i.out, c, i.decisions, i.dispositions);
      });
    });
  }

  function audit() {
    violations.length = 0;
    sweep(function () {});
    var recorded = violations.slice();

    var results = CHECKS.map(function (c) {
      var failures;
      try { failures = c.run(recorded) || []; }
      catch (err) { failures = ['check threw: ' + ((err && err.message) || err)]; }
      return { id: c.id, title: c.title, why: c.why, pass: failures.length === 0, failures: failures };
    });

    var advisories = [];
    sweep(function (pack, ctx, picks, out) {
      Object.keys(pack.fields).forEach(function (f) {
        var p = picks[f];
        if (p && p.frag && p.frag.provenance === 'doctrine') return;
        if (lint(out[f])) advisories.push(pack.id + ' · ' + f + ' — "' + out[f] + '"');
      });
    });

    var caseCount = Object.keys(packs).reduce(function (n, id) { return n + casesFor(packs[id]).length; }, 0);
    var fragCount = Object.keys(packs).reduce(function (n, id) { return n + Object.keys(catalogueOf(packs[id])).length; }, 0);

    return {
      results: results, advisories: advisories,
      pass: results.every(function (r) { return r.pass; }) && recorded.length === 0,
      cases: caseCount, fragments: fragCount, packs: Object.keys(packs),
      checks: CHECKS.length, recorded: recorded
    };
  }

  window.FreesideDoctrine = {
    CEILING: CEILING, DEPTH: DEPTH, FLOOR: FLOOR, LEVELS: LEVELS, MACHINE_AT: MACHINE_AT,
    KINDS: KINDS, EXISTENCE: EXISTENCE, PROVENANCE: PROVENANCE, DISPOSITIONS: DISPOSITIONS, NONE: NONE,
    RESOURCES: RESOURCES, CAPABILITY: CAPABILITY, SEPARATELY_GRANTED: SEPARATELY_GRANTED, AGENCY: AGENCY,
    declare: declare, prose: prose, datum: datum, action: action, label: label,
    meta: meta, secret: secret, isFrag: isFrag,
    resolve: resolve, decide: decide, dispose: dispose,
    disclosureMode: disclosureMode, disclosureFor: disclosureFor, existenceKnown: existenceKnown,
    capabilities: capabilities, can: can, actionsFor: actionsFor,
    destinationExposure: destinationExposure,
    registerPack: registerPack, registerChecks: registerChecks,
    catalogueOf: catalogueOf, selectionFor: selectionFor, casesFor: casesFor,
    FILLABLE: FILLABLE, LADDER_FILL: LADDER_FILL, fillValue: fillValue,
    project: project, inspect: inspect, sweep: sweep, packs: packs, CHECKS: CHECKS,
    audit: audit, lint: lint, violations: violations
  };
})();
