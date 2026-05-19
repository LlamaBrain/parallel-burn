// Embedded OBS browser-source HTML — also the local-dashboard view.
//
// Renders the headline parallelism number prominently, then a small
// grid of secondary metrics: today's burn, wall clock (merged), temporal
// span, session-context, token in/out, cache hit rate, streak, and the
// subsidy multiplier. Auto-reconnects via `EventSource` (ADR-0005).
//
// LlamaBrain visual identity: near-black background, monospace, soft
// orange accent (#e8a04f).

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
    padding: 24px 32px;
    min-width: 520px;
    max-width: 720px;
    box-shadow: 0 10px 40px rgba(0,0,0,0.4);
  }
  .header {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 12px;
    color: var(--dim);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin-bottom: 16px;
  }
  .header .dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 8px var(--accent);
  }
  .hero {
    display: flex;
    align-items: baseline;
    gap: 12px;
    padding: 8px 0 14px;
    border-bottom: 1px solid var(--card-border);
    margin-bottom: 14px;
  }
  .hero .ratio {
    font-size: 56px;
    font-weight: 700;
    color: var(--accent);
    letter-spacing: -0.01em;
  }
  .hero .label {
    font-size: 14px;
    color: var(--dim);
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px 24px;
  }
  .metric {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: baseline;
    padding: 6px 0;
    border-bottom: 1px dashed rgba(255,255,255,0.05);
  }
  .metric .label { color: var(--dim); font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
  .metric .value { font-size: 18px; font-weight: 600; }
  .metric .sub { color: var(--dim); font-size: 11px; margin-left: 6px; }
  .footer {
    margin-top: 14px;
    padding-top: 10px;
    border-top: 1px solid var(--card-border);
    font-size: 11px;
    color: var(--dim);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .live-dot {
    display: inline-block;
    width: 6px; height: 6px;
    border-radius: 50%;
    background: var(--good);
    margin-right: 6px;
    vertical-align: middle;
  }
  .live-dot.disconnected { background: var(--bad); }
  .stale { color: var(--warn); }
  .warming { opacity: 0.55; }
</style>
</head>
<body>
<div class="card" id="card">
  <div class="header">
    <span class="dot"></span>
    <span>ParallelBurn — <span id="date">—</span></span>
    <span style="flex:1"></span>
    <span id="warming-tag" style="display:none;color:var(--warn)">warming…</span>
  </div>

  <div class="hero">
    <div class="ratio" id="compression">—</div>
    <div class="label">× parallelism · context ÷ merged wall</div>
  </div>

  <div class="grid">
    <div class="metric">
      <span class="label">today list-price</span>
      <span class="value" id="cost">—</span>
    </div>
    <div class="metric">
      <span class="label">cache hit</span>
      <span class="value" id="cache-hit">—</span>
    </div>
    <div class="metric">
      <span class="label">session-context</span>
      <span class="value" id="context">—</span>
    </div>
    <div class="metric" id="row-wall">
      <span class="label" id="wall-label">wall (merged)</span>
      <span class="value" id="wall">—</span>
    </div>
    <div class="metric" id="row-span">
      <span class="label">temporal span</span>
      <span class="value" id="span">—</span>
    </div>
    <div class="metric">
      <span class="label">sessions</span>
      <span class="value" id="sessions">—</span>
    </div>
    <div class="metric">
      <span class="label">tokens in</span>
      <span class="value" id="tokens-in">—</span>
    </div>
    <div class="metric">
      <span class="label">tokens out</span>
      <span class="value" id="tokens-out">—</span>
    </div>
    <div class="metric">
      <span class="label">cache writes</span>
      <span class="value" id="cache-writes">—</span>
    </div>
    <div class="metric">
      <span class="label">cache reads</span>
      <span class="value" id="cache-reads">—</span>
    </div>
    <div class="metric">
      <span class="label">cache rate</span>
      <span class="value" id="cache-rate">—</span>
    </div>
    <div class="metric">
      <span class="label">streak</span>
      <span class="value" id="streak">—<span class="sub" id="longest"></span></span>
    </div>
  </div>

  <div class="footer">
    <span><span class="live-dot" id="live-dot"></span><span id="status">connecting…</span></span>
    <span id="pricing">pricing —</span>
  </div>
</div>

<script>
  (function () {
    var els = {
      card: document.getElementById('card'),
      warming: document.getElementById('warming-tag'),
      date: document.getElementById('date'),
      compression: document.getElementById('compression'),
      cost: document.getElementById('cost'),
      cacheHit: document.getElementById('cache-hit'),
      context: document.getElementById('context'),
      rowWall: document.getElementById('row-wall'),
      wall: document.getElementById('wall'),
      wallLabel: document.getElementById('wall-label'),
      rowSpan: document.getElementById('row-span'),
      span: document.getElementById('span'),
      sessions: document.getElementById('sessions'),
      tokensIn: document.getElementById('tokens-in'),
      tokensOut: document.getElementById('tokens-out'),
      cacheWrites: document.getElementById('cache-writes'),
      cacheReads: document.getElementById('cache-reads'),
      cacheRate: document.getElementById('cache-rate'),
      streak: document.getElementById('streak'),
      longest: document.getElementById('longest'),
      status: document.getElementById('status'),
      liveDot: document.getElementById('live-dot'),
      pricing: document.getElementById('pricing'),
    };

    var EQUALITY_TOLERANCE_MS = 60 * 1000; // 1 minute

    function fmtRatio(r) { return (isFinite(r) && r > 0) ? r.toFixed(1) + '×' : '—'; }
    function fmtUsd(n) { return isFinite(n) ? '$' + n.toFixed(2) : '$—'; }
    function fmtDuration(ms) {
      if (!isFinite(ms) || ms <= 0) return '0m';
      var totalMin = Math.floor(ms / 60000);
      var h = Math.floor(totalMin / 60);
      var m = totalMin % 60;
      return h > 0 ? h + 'h ' + m + 'm' : m + 'm';
    }
    function fmtCount(n) {
      if (!isFinite(n) || n < 0) return '—';
      if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
      if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
      if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
      return String(Math.round(n));
    }

    function render(snap) {
      var a = snap.aggregate;
      els.card.classList.toggle('warming', !!snap.warming);
      els.warming.style.display = snap.warming ? '' : 'none';
      els.date.textContent = snap.date || '—';
      els.compression.textContent = fmtRatio(a.compressionRatio);
      els.cost.textContent = fmtUsd(a.totalCostUsd);
      els.cacheHit.textContent = isFinite(a.cacheHitPercent) && a.cacheHitPercent >= 0
        ? a.cacheHitPercent.toFixed(1) + '%'
        : '—';
      els.context.textContent = fmtDuration(a.sessionContextMs);
      // Collapse the wall and span rows when they're essentially equal —
      // a continuous-overlap day has nothing to differentiate, so show
      // one row labeled "wall · span (continuous)" and hide the other.
      var wallMs = a.wallClockWindowMs || 0;
      var spanMs = a.spanMs || 0;
      var continuous = wallMs > 0 && Math.abs(wallMs - spanMs) <= EQUALITY_TOLERANCE_MS;
      if (continuous) {
        els.wallLabel.innerHTML = 'wall · span<span class="sub">continuous</span>';
        els.wall.textContent = fmtDuration(wallMs);
        els.rowSpan.style.display = 'none';
      } else {
        els.wallLabel.textContent = 'wall (merged)';
        els.wall.textContent = fmtDuration(wallMs);
        els.rowSpan.style.display = '';
        els.span.textContent = fmtDuration(spanMs);
      }
      els.sessions.textContent = String(a.sessions ? a.sessions.length : 0);
      els.tokensIn.textContent = fmtCount(a.inputTokens);
      els.tokensOut.textContent = fmtCount(a.outputTokens);
      els.cacheWrites.textContent = fmtCount(a.cacheWriteTokens);
      els.cacheReads.textContent = fmtCount(a.cacheReadTokens);
      els.cacheRate.textContent = fmtRatio(a.cacheDisciplineRatio);
      els.streak.innerHTML = String(snap.streak) + '<span class="sub" id="longest"> / ' + String(snap.longestStreak || 0) + ' best</span>';
      var staleClass = snap.pricingStale ? 'stale' : '';
      var staleNote = snap.pricingStale ? ' (STALE)' : '';
      els.pricing.innerHTML = '<span class="' + staleClass + '">pricing ' + (snap.pricingAsOf || '—') + staleNote + '</span>';
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
        try { var snap = JSON.parse(e.data); render(snap); setConnected(true); }
        catch (err) {}
      };
    }

    fetch('/api/today').then(function (r) { return r.json(); }).then(render).catch(function () {});
    start();
  })();
</script>
</body>
</html>`;
