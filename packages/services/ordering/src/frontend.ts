import { Hono } from 'hono';
import { createIntakeApp, type IntakeDeps } from './intake.js';

/**
 * Order-tracking frontend (SDD §2, sprint S2) — the Uber/Amazon order-status UX.
 *
 * Server-rendered HTML (the repo's frontend convention — cf. apps/freeside-operator-dash),
 * mounted ON TOP of the intake routes so the placement form and the tracking poll are
 * same-origin (no CORS). JetStream stays server-side (SDD §13 M-9): the browser only ever
 * polls `GET /v1/orders/:id` through the authenticated intake.
 *
 *   GET /            placement form  → POST /v1/orders → shows order_id + a track link (S2-T1)
 *   GET /track/:id   live tracking   → polls GET /v1/orders/:id, renders the
 *                    placed→routing→producing→fulfilled timeline + the AuditOutput aggregate (S2-T2)
 *
 * The tracking view renders the aggregate GENERICALLY (iterates the `output.aggregate` object)
 * so the Ordering presentation layer stays decoupled from the audit aggregate's internals (EVANS).
 */
export function createFrontendApp(deps: IntakeDeps): Hono {
  const app = new Hono();

  // Mount the intake API (POST /v1/orders, GET /v1/orders/:id) under the same origin.
  app.route('/', createIntakeApp(deps));

  app.get('/', (c) => c.html(FORM_PAGE));
  app.get('/track/:id', (c) => c.html(trackPage(c.req.param('id'))));

  return app;
}

const STYLE = `
  :root { color-scheme: dark; }
  body { font: 15px/1.5 system-ui, sans-serif; background: #0b0d10; color: #e6e6e6; margin: 0; padding: 2rem; }
  .wrap { max-width: 640px; margin: 0 auto; }
  h1 { font-size: 1.3rem; } label { display: block; margin: .6rem 0 .2rem; color: #9aa4b2; font-size: .85rem; }
  input { width: 100%; padding: .55rem .7rem; box-sizing: border-box; background: #14181d; border: 1px solid #2a323c;
          border-radius: 8px; color: #e6e6e6; }
  button { margin-top: 1rem; padding: .6rem 1.1rem; background: #3b82f6; border: 0; border-radius: 8px; color: #fff;
           font-weight: 600; cursor: pointer; }
  .steps { display: flex; gap: .5rem; margin: 1.5rem 0; }
  .step { flex: 1; text-align: center; padding: .5rem .25rem; border-radius: 8px; background: #14181d; border: 1px solid #222;
          color: #6b7280; font-size: .8rem; text-transform: capitalize; }
  .step.done { background: #16361f; border-color: #2f6b3f; color: #7ee29a; }
  .step.current { background: #1e3a5f; border-color: #3b82f6; color: #cfe3ff; font-weight: 700; }
  .step.failed { background: #3a1e1e; border-color: #6b2f2f; color: #f0a0a0; }
  .card { background: #14181d; border: 1px solid #222; border-radius: 10px; padding: 1rem; margin-top: 1rem; }
  .kv { display: flex; justify-content: space-between; padding: .25rem 0; border-bottom: 1px solid #1c2228; }
  .kv:last-child { border-bottom: 0; } .kv .k { color: #9aa4b2; } code { color: #cfe3ff; }
  a { color: #60a5fa; } .muted { color: #6b7280; font-size: .85rem; }
`;

const FORM_PAGE = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Place an order</title>
<meta name="viewport" content="width=device-width, initial-scale=1"><style>${STYLE}</style></head>
<body><div class="wrap">
  <h1>Place an order — access-risk-audit</h1>
  <p class="muted">Internal order intake. Fill the inputs and place; you'll get an order id to track.</p>
  <form id="f">
    <label>Placed by</label><input name="placed_by" value="operator:demo" required>
    <label>Chain ID</label><input name="chain" value="1" inputmode="numeric" required>
    <label>Contract (0x…40 hex)</label><input name="contract" placeholder="0x…" required>
    <label>Snapshot date (YYYY-MM-DD)</label><input name="snapshot_date" placeholder="2026-06-01" required>
    <label>Threshold (optional)</label><input name="threshold" type="number" value="1">
    <button type="submit">Place order</button>
  </form>
  <div id="out"></div>
</div>
<script>
  var f = document.getElementById('f'), out = document.getElementById('out');
  f.addEventListener('submit', function (e) {
    e.preventDefault();
    var fd = new FormData(f);
    var inputs = { chain: fd.get('chain'), contract: fd.get('contract'), snapshot_date: fd.get('snapshot_date') };
    var th = fd.get('threshold'); if (th) inputs.threshold = Number(th);
    var body = { product: 'access-risk-audit', placed_by: fd.get('placed_by'), inputs: inputs };
    out.innerHTML = '<p class="muted">Placing…</p>';
    fetch('/v1/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) { out.innerHTML = '<div class="card">Rejected: <code>' + JSON.stringify(res.j) + '</code></div>'; return; }
        var id = res.j.order_id;
        out.innerHTML = '<div class="card">Order placed: <code>' + id + '</code><br>' +
          '<a href="/track/' + encodeURIComponent(id) + '">Track this order →</a></div>';
      })
      .catch(function (err) { out.innerHTML = '<div class="card">Error: ' + err + '</div>'; });
  });
</script></body></html>`;

function trackPage(id: string): string {
  // The order id is the only injected value — encoded via JSON.stringify so it can't break out of the script.
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Order ${escapeHtml(id)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1"><style>${STYLE}</style></head>
<body><div class="wrap">
  <h1>Order status</h1>
  <p class="muted">Order <code>${escapeHtml(id)}</code> · <a href="/">place another</a></p>
  <div class="steps" id="steps"></div>
  <div id="detail"></div>
</div>
<script>
  var ORDER_ID = ${JSON.stringify(id)};
  var STEPS = ['placed', 'routing', 'producing', 'fulfilled'];
  var stepsEl = document.getElementById('steps'), detailEl = document.getElementById('detail');

  function renderSteps(state) {
    stepsEl.innerHTML = '';
    var failed = state === 'failed';
    var idx = STEPS.indexOf(state);
    for (var i = 0; i < STEPS.length; i++) {
      var cls = 'step';
      if (failed) { cls += i === 0 ? ' done' : ''; }
      else if (i < idx) cls += ' done';
      else if (i === idx) cls += ' current';
      var div = document.createElement('div');
      div.className = cls; div.textContent = STEPS[i];
      stepsEl.appendChild(div);
    }
    if (failed) {
      var d = document.createElement('div'); d.className = 'step failed'; d.textContent = 'failed';
      stepsEl.appendChild(d);
    }
  }

  function kv(k, v) {
    return '<div class="kv"><span class="k">' + k + '</span><code>' + v + '</code></div>';
  }

  function renderDetail(o) {
    var html = '';
    if (o.state === 'fulfilled' && o.output) {
      html += '<div class="card"><strong>Result</strong>' + kv('result_ref', o.result_ref || '');
      var agg = o.output.aggregate || {};
      for (var key in agg) {
        if (Object.prototype.hasOwnProperty.call(agg, key)) {
          var val = agg[key];
          html += kv(key, typeof val === 'object' ? JSON.stringify(val) : String(val));
        }
      }
      html += '</div>';
    } else if (o.state === 'failed' && o.refusal) {
      html += '<div class="card"><strong>Refused</strong>' + kv('code', o.refusal.code) + kv('reason', o.refusal.reason) + '</div>';
    } else if (o.resolved_buildings && o.resolved_buildings.length) {
      html += '<div class="card"><strong>Routing</strong>';
      for (var i = 0; i < o.resolved_buildings.length; i++) {
        var b = o.resolved_buildings[i];
        html += kv(b.capability, b.building + ' (' + b.source + ')');
      }
      html += '</div>';
    }
    detailEl.innerHTML = html;
  }

  function poll() {
    fetch('/v1/orders/' + encodeURIComponent(ORDER_ID))
      .then(function (r) { if (r.status === 404) throw new Error('not found'); return r.json(); })
      .then(function (o) {
        renderSteps(o.state); renderDetail(o);
        if (o.state !== 'fulfilled' && o.state !== 'failed') setTimeout(poll, 1000);
      })
      .catch(function (err) { detailEl.innerHTML = '<div class="card">Error: ' + err.message + '</div>'; });
  }
  poll();
</script></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
