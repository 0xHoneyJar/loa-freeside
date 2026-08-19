/* Freeside — REVIEW FRAME LOADER
   Shared by the three Doctrine review cards. Each card declares its contexts;
   this file builds the tiles, computes each badge from doctrine.js rather than
   trusting a typed number, and loads the Design Components a few at a time.

   Two things make this fiddly, and both are loading concerns rather than design
   ones. Every frame is a real DC page pulling React, the runtime, the compiled
   bundle and the doctrine files — seventeen at once never settled. And a DC that
   mounts before its own doctrine scripts arrive renders the template's static
   markup with every projected hole empty, then has no reason to render again.

   So the loader is self-healing: it pushes props on a slow tick until the frame
   reports real content, and sweeps any frame still empty later on. Pushing the
   same props twice is a no-op, which is what makes that safe. */
(function () {
  'use strict';
  var LIMIT = 3;
  var READY_CHARS = 60;
  var GIVE_UP_MS = 25000;
  var queue = [];
  var jobs = [];
  var active = 0;

  function pump() {
    while (active < LIMIT && queue.length) start(queue.shift());
  }

  function rendered(frame) {
    try {
      var b = frame.contentDocument && frame.contentDocument.body;
      return !!b && b.innerText.replace(/\s+/g, ' ').trim().length > READY_CHARS;
    } catch (e) { return false; }
  }

  function push(job) {
    var w = job.frame.contentWindow;
    if (!w || !w.FreesideDoctrine || !w.FreesideDoctrine.packs[job.pack]) return false;
    var rn = w.__dcRootName && w.__dcRootName();
    if (!rn || rn === 'Root') return false;
    w.__dcSetProps(rn, job.props);
    return true;
  }

  function start(job) {
    active++;
    var t0 = Date.now();
    var timer = setInterval(function () {
      var ok = false;
      try { ok = push(job) && rendered(job.frame); } catch (e) {}
      if (ok || Date.now() - t0 > GIVE_UP_MS) { clearInterval(timer); release(); }
    }, 500);
    job.frame.src = job.src;
  }
  function release() { active--; pump(); }

  /* Late sweeps. A frame that lost the race while three others were loading is
     re-pushed rather than left showing an empty template. */
  function sweep() {
    jobs.forEach(function (job) { if (!rendered(job.frame)) { try { push(job); } catch (e) {} } });
  }
  [14000, 22000, 32000].forEach(function (t) { setTimeout(sweep, t); });

  function axesLine(ctx, props) {
    var bits = ['ceiling ' + ctx.ceiling, 'depth ' + ctx.depth, 'floor ' + ctx.floor, 'exposure ' + ctx.exposure];
    if (props.exportGranted) bits.push('grant export');
    if (ctx.denied) bits.push('denied');
    else if (ctx.clamped) bits.push('clamped');
    return bits.join('  \u00b7  ');
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function render(opts) {
    var D = window.FreesideDoctrine;
    var host = document.getElementById(opts.host);
    if (!D || !host) return;

    opts.tiles.forEach(function (t) {
      var props = t.props;
      var dest = props.destination || opts.destination;
      var state = props.systemState || 'nominal';
      var ctx = D.resolve({
        role: props.role, destination: dest, systemState: state,
        grants: props.exportGranted ? ['export'] : []
      });

      var tile = el('figure', 'tile');
      var head = el('figcaption', 'stack-8');
      var row = el('div', 'row-8');
      row.appendChild(el('span', 'tag', ctx.level.name + ' ' + ctx.exposure));
      var who = props.role + ' \u00b7 ' + dest + ' \u00b7 ' + state + (props.exportGranted ? ' \u00b7 +export' : '');
      row.appendChild(el('span', 'lab', who));
      head.appendChild(row);
      head.appendChild(el('div', 'axes', axesLine(ctx, props)));
      head.appendChild(el('p', null, t.note));

      var frame = el('div', 'frame');
      frame.style.height = t.h + 'px';
      var f = document.createElement('iframe');
      f.setAttribute('title', who);
      frame.appendChild(f);

      tile.appendChild(head);
      tile.appendChild(frame);
      host.appendChild(tile);

      var job = { frame: f, src: opts.src, pack: opts.pack, props: props };
      jobs.push(job);
      queue.push(job);
    });

    pump();
  }

  /* Page-height readout, so the card's declared viewport can be checked against
     what it actually renders. */
  function measure() {
    var m = document.getElementById('measure');
    if (m) m.textContent = 'page height ' + document.documentElement.scrollHeight + 'px';
  }
  window.addEventListener('load', function () { setTimeout(measure, 1500); });
  setTimeout(measure, 5000);

  window.FreesideReview = { render: render };
})();
