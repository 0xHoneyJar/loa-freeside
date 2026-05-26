/**
 * HTML renderer for the dashboard. Server-side, fully baked.
 * No browser-side JS fetches (no CORS).
 */

import type { DashState, CellProbe, ProbeStateKind, RegistryCell, IdentityApiPhase } from "./types.js";

function esc(s: string | null | undefined): string {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function stateColor(s: ProbeStateKind): string {
  return ({
    up: "#1f8a3f",
    "auth-gated": "#7c6cff",
    degraded: "#e3a008",
    scaffold: "#f97316",
    down: "#dc2626",
    unreachable: "#71717a",
  } as const)[s];
}

function cellAccent(cell: RegistryCell, probe: CellProbe | undefined): string {
  if (probe) return stateColor(probe.state);
  if (cell.runtime_state === "deployed") return "#1f8a3f";
  if (cell.runtime_state === "scaffolded") return "#e3a008";
  return "#71717a";
}

function phaseColor(p: IdentityApiPhase): string {
  if (p.status === "deployed") return "#1f8a3f";
  if (p.status === "scaffolded") return "#e3a008";
  return "#dc2626";
}

export function renderHTML(state: DashState): string {
  const probeBySlug = new Map(state.probes.map((p) => [p.slug, p]));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>🦎 freeside operator-dash</title>
<style>
  :root {
    --bg: #0a0a0b; --panel: #131316; --panel-hi: #1c1c20; --line: #262629;
    --text: #ededed; --text-dim: #9a9a9e; --accent: #f9c846; --soju: #ff6b9d;
    --mono: "SF Mono","JetBrains Mono","Fira Code",ui-monospace,monospace;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px; background: var(--bg); color: var(--text);
    font-family: -apple-system,BlinkMacSystemFont,"Inter","Segoe UI",sans-serif;
    font-size: 14px; line-height: 1.5;
  }
  header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 24px; flex-wrap: wrap; }
  header h1 { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.01em; }
  header .meta { color: var(--text-dim); font-family: var(--mono); font-size: 12px; }
  .grid { display: grid; gap: 16px; }
  .grid.two { grid-template-columns: 1fr 1fr; }
  @media (max-width: 900px) { .grid.two { grid-template-columns: 1fr; } }
  .panel {
    background: var(--panel); border: 1px solid var(--line); border-radius: 8px;
    padding: 16px;
  }
  .panel h2 {
    margin: 0 0 12px 0; font-size: 13px; font-weight: 600; letter-spacing: 0.04em;
    text-transform: uppercase; color: var(--text-dim);
  }
  .panel h2 .badge { color: var(--accent); margin-left: 6px; font-weight: 700; font-size: 11px; }
  .warning {
    background: #2a1b00; border: 1px solid #5a3a00; color: #ffb84d;
    padding: 10px 14px; border-radius: 6px; margin-bottom: 12px; font-size: 13px;
  }
  .discrepancy {
    background: #2a0010; border: 1px solid #5a0020; color: var(--soju);
    padding: 10px 14px; border-radius: 6px; margin-bottom: 12px; font-size: 13px;
    font-family: var(--mono);
  }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { color: var(--text-dim); font-weight: 500; font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; }
  td.mono { font-family: var(--mono); font-size: 12px; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 99px; font-size: 11px; font-weight: 600; letter-spacing: 0.02em; color: white; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
  .tile {
    background: var(--panel-hi); border: 1px solid var(--line); border-radius: 6px;
    padding: 12px; position: relative; overflow: hidden;
  }
  .tile .slug { font-weight: 600; margin-bottom: 4px; display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  .tile .slug .lat { color: var(--text-dim); font-family: var(--mono); font-size: 11px; font-weight: 400; }
  .tile .body { color: var(--text-dim); font-family: var(--mono); font-size: 11px; line-height: 1.5; word-break: break-all; }
  .phase {
    background: var(--panel-hi); border: 1px solid var(--line); border-radius: 6px;
    padding: 14px; margin-bottom: 10px;
  }
  .phase .row1 { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 6px; gap: 8px; }
  .phase .name { font-weight: 600; }
  .phase .goals { color: var(--accent); font-family: var(--mono); font-size: 12px; }
  .phase ul { margin: 6px 0 0; padding-left: 18px; color: var(--text-dim); font-size: 12px; }
  .phase ul li { margin: 2px 0; }
  .footer { color: var(--text-dim); font-family: var(--mono); font-size: 11px; margin-top: 24px; text-align: right; }
  details summary { cursor: pointer; color: var(--text-dim); font-size: 12px; }
  details summary:hover { color: var(--text); }
  pre.body { background: var(--bg); padding: 8px; border-radius: 4px; font-size: 11px; overflow-x: auto; margin: 4px 0 0; color: var(--text-dim); }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  form.wallet { display: flex; align-items: center; gap: 8px; margin-left: auto; }
  form.wallet input {
    background: var(--panel-hi); color: var(--text); border: 1px solid var(--line);
    border-radius: 4px; padding: 6px 10px; font-family: var(--mono); font-size: 12px;
    min-width: 320px;
  }
  form.wallet input:focus { outline: none; border-color: var(--accent); }
  form.wallet button {
    background: var(--soju); color: white; border: 0; border-radius: 4px;
    padding: 6px 14px; font-size: 12px; font-weight: 600; cursor: pointer;
    font-family: inherit;
  }
  form.wallet button:hover { opacity: 0.9; }
  form.wallet a.clear { color: var(--text-dim); font-size: 11px; text-decoration: none; padding: 0 4px; }
  form.wallet a.clear:hover { color: var(--soju); }
</style>
</head>
<body>
<header>
  <h1>🦎 freeside operator-dash</h1>
  <span class="meta">v${esc(state.generatorVersion)} · ${esc(state.generatedAt)} · inward-facing · ADR-009 §D-5</span>
  <form class="wallet" method="GET" action="/">
    <input type="text" name="wallet" placeholder="0xYourWalletAddress (Soju-lens)" value="${esc(state.sojuLens.wallet ?? "")}" pattern="0x[a-fA-F0-9]{4,}" autocomplete="off" />
    <button type="submit">🌸 lens</button>
    ${state.sojuLens.wallet ? `<a class="clear" href="/" title="clear wallet">clear</a>` : ""}
  </form>
</header>

${state.warnings.map((w) => `<div class="warning">⚠ ${esc(w)}</div>`).join("")}
${state.sojuLens.discrepancies.map((d) => `<div class="discrepancy">🌸 ${esc(d)}</div>`).join("")}

<div class="grid two">

  <div class="panel">
    <h2>identity-api · phase scoreboard <span class="badge">BERA→Soju path · G-1..G-6</span></h2>
    ${state.identityPhases.map((p) => `
      <div class="phase">
        <div class="row1">
          <span class="name">Phase ${p.phase}: ${esc(p.name)}</span>
          <span class="pill" style="background:${phaseColor(p)}">${p.status === "deployed" ? "DEPLOYED" : p.status === "scaffolded" ? "SCAFFOLDED" : "NOT BUILT"}</span>
        </div>
        <div class="goals">${esc(p.goalIds.join(" · "))}</div>
        <ul>${p.goalNotes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>
        <details>
          <summary>evidence + beads (${p.evidence.length + p.beadsRefs.length})</summary>
          <ul>
            ${p.evidence.map((e) => `<li>📡 ${esc(e)}</li>`).join("")}
            ${p.beadsRefs.map((b) => `<li>🔗 ${esc(b)}</li>`).join("")}
          </ul>
        </details>
      </div>`).join("")}
  </div>

  <div class="panel">
    <h2>🌸 soju-lens · operator identity across surfaces ${state.sojuLens.wallet ? `<span class="badge">wallet ${esc(state.sojuLens.wallet.slice(0, 6))}…${esc(state.sojuLens.wallet.slice(-4))}</span>` : ""}</h2>
    <table>
      <thead><tr><th>surface</th><th>field</th><th>observed</th><th>source</th><th>error</th></tr></thead>
      <tbody>
        ${state.sojuLens.rows.map((r) => `
          <tr>
            <td>${esc(r.surface)}</td>
            <td class="mono">${esc(r.field)}</td>
            <td class="mono" style="color:${r.observed ? "var(--text)" : "var(--text-dim)"}">${esc(r.observed) || "—"}</td>
            <td class="mono" style="color:var(--text-dim);font-size:11px">${esc(r.source)}</td>
            <td class="mono" style="color:${r.error ? "var(--soju)" : "var(--text-dim)"};font-size:11px">${esc(r.error) || "—"}</td>
          </tr>`).join("")}
      </tbody>
    </table>
    ${!state.sojuLens.wallet ? `<div style="margin-top:10px;color:var(--text-dim);font-size:12px">enable with <code style="background:var(--bg);padding:1px 6px;border-radius:3px">OPERATOR_WALLET=0xABC tsx bin/http.ts</code></div>` : ""}
  </div>

</div>

<div class="panel" style="margin-top:16px">
  <h2>federation tiles · ${state.cells.length} cells <span class="badge">registry.yaml · *-api per ADR-009 §D-2</span></h2>
  <div class="tiles">
    ${state.cells.map((cell) => {
      const probe = probeBySlug.get(cell.slug);
      const accent = cellAccent(cell, probe);
      const probeNote = probe?.note ?? (cell.deployment_url ? "no probe" : "no deployment_url");
      return `
        <div class="tile">
          <div style="position:absolute;left:0;top:0;bottom:0;width:3px;background:${accent}"></div>
          <div style="margin-left:8px">
            <div class="slug"><span>${esc(cell.slug)}</span><span class="lat">${probe?.latencyMs != null ? `${probe.latencyMs}ms` : ""}</span></div>
            <div class="body">
              <strong style="color:${accent}">${probe ? probe.state.toUpperCase().replace("-", " ") : cell.runtime_state.toUpperCase()}</strong>
              ${probe?.statusCode ? ` · HTTP ${probe.statusCode}` : ""}<br>
              ${cell.deployment_url ? `URL: <a href="${esc(cell.deployment_url)}" target="_blank">${esc(cell.deployment_url.replace(/^https?:\/\//, ""))}</a>${probe?.probedPath && probe.probedPath !== "(none)" ? ` <span style="opacity:.6">probe ${esc(probe.probedPath)}</span>` : ""}<br>` : ""}
              visibility: ${esc(cell.visibility)} · owner: ${esc(cell.owner)}<br>
              <span style="opacity:.6">${esc(probeNote)}</span>
            </div>
          </div>
        </div>`;
    }).join("")}
  </div>
</div>

<div class="footer">
  freeside operator-dash @ apps/freeside-operator-dash/ · ${esc(state.generatedAt)}
</div>

</body>
</html>`;
}
