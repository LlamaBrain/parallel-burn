// Embedded OBS browser-source HTML.
//
// Single-file: HTML + CSS + JS in one document. Subscribes to /events
// via `EventSource` (per ADR-0005, SSE-not-WebSocket). Renders the
// headline three numbers in priority order — parallelism, today's burn,
// streak — per SPEC §10 Phase 7.
//
// LlamaBrain visual identity: near-black background, monospace numerals,
// soft-orange accent (#e8a04f, ANSI 38;5;208's hex equivalent). No
// animation in v1 — static updates on each SSE event.

export const OVERLAY_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>ParallelBurn</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  :root {
    --bg: #0d0d10;
    --fg: #e6e6e6;
    --dim: #6e6e76;
    --accent: #e8a04f;
    --good: #6fcf6f;
    --warn: #e0a93a;
    --bad: #d65c5c;
    --card-bg: rgba(255,255,255,0.03);
    --card-border: rgba(255,255,255,0.07);
  }
  html, body {
    margin: 0;
    padding: 0;
    background: var(--bg);
    color: var(--fg);
    font-family: ui-monospace, "SF Mono", "JetBrains Mono", "Cascadia Mono", "Consolas", monospace;
    -webkit-font-smoothing: antialiased;
    text-rendering: geometricPrecision;
  }
  body {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 32px;
    box-sizing: border-box;
  }
  .card {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 16px;
    padding: 28px 36px;
    min-width: 360px;
    box-shadow: 0 10px 40px rgba(0,0,0,0.4);
  }
  .header {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    color: var(--dim);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    margin-bottom: 18px;
  }
  .header .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 8px var(--accent);
  }
  .row {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: baseline;
    gap: 12px;
    padding: 10px 0;
    border-bottom: 1px dashed rgba(255,255,255,0.05);
  }
  .row:last-of-type { border-bottom: none; }
  .label { color: var(--dim); font-size: 13px; }
  .value { font-size: 32px; font-weight: 600; letter-spacing: 0.01em; }
  .value.accent { color: var(--accent); font-size: 48px; }
  .unit { color: var(--dim); font-size: 14px; margin-left: 4px; }
  .footer {
    margin-top: 18px;
    padding-top: 12px;
    border-top: 1px solid var(--card-border);
    font-size: 11px;
    color: var(--dim);
    display: flex;
    justify-content: space-between;
  }
  .stale { color: var(--warn); }
  .live-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--good);
    margin-right: 6px;
    vertical-align: middle;
  }
  .live-dot.disconnected { background: var(--bad); }
</style>
</head>
<body>
<div class="card">
  <div class="header">
    <span class="dot"></span>
    <span>ParallelBurn — <span id="date">—</span></span>
  </div>
  <div class="row">
    <span class="label">parallelism</span>
    <span class="value accent" id="compression">—</span>
  </div>
  <div class="row">
    <span class="label">today</span>
    <span class="value" id="cost">—</span>
  </div>
  <div class="row">
    <span class="label">streak</span>
    <span class="value" id="streak">—<span class="unit">d</span></span>
  </div>
  <div class="row">
    <span class="label">cache discipline</span>
    <span class="value" id="cache">—</span>
  </div>
  <div class="footer">
    <span><span class="live-dot" id="live-dot"></span><span id="status">connecting…</span></span>
    <span id="pricing">pricing —</span>
  </div>
</div>
<script>
  (function () {
    var els = {
      date: document.getElementById('date'),
      compression: document.getElementById('compression'),
      cost: document.getElementById('cost'),
      streak: document.getElementById('streak'),
      cache: document.getElementById('cache'),
      status: document.getElementById('status'),
      liveDot: document.getElementById('live-dot'),
      pricing: document.getElementById('pricing'),
    };

    function fmtRatio(r) {
      if (!isFinite(r) || r <= 0) return '—';
      return r.toFixed(1) + '×';
    }
    function fmtUsd(n) {
      if (!isFinite(n)) return '$—';
      return '$' + n.toFixed(2);
    }

    function render(snap) {
      els.date.textContent = snap.date;
      els.compression.textContent = fmtRatio(snap.aggregate.compressionRatio);
      els.cost.textContent = fmtUsd(snap.aggregate.totalCostUsd);
      var streakNum = String(snap.streak);
      els.streak.innerHTML = streakNum + '<span class="unit">d</span>';
      els.cache.textContent = fmtRatio(snap.aggregate.cacheDisciplineRatio);
      var staleNote = snap.pricingStale ? ' (STALE)' : '';
      var staleClass = snap.pricingStale ? 'stale' : '';
      els.pricing.innerHTML = '<span class="' + staleClass + '">pricing ' + snap.pricingAsOf + staleNote + '</span>';
    }

    function setConnected(connected) {
      if (connected) {
        els.liveDot.classList.remove('disconnected');
        els.status.textContent = 'live';
      } else {
        els.liveDot.classList.add('disconnected');
        els.status.textContent = 'reconnecting…';
      }
    }

    function start() {
      var es = new EventSource('/events');
      es.onopen = function () { setConnected(true); };
      es.onerror = function () { setConnected(false); };
      es.onmessage = function (e) {
        try {
          var snap = JSON.parse(e.data);
          render(snap);
          setConnected(true);
        } catch (err) {}
      };
    }

    fetch('/api/today').then(function (r) { return r.json(); }).then(render).catch(function () {});
    start();
  })();
</script>
</body>
</html>`;
