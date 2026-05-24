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
    color-scheme: dark;
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
  .date-picker {
    background: transparent;
    color: var(--fg);
    border: 1px solid var(--card-border);
    border-radius: 4px;
    padding: 1px 6px;
    font-family: inherit;
    font-size: 12px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .date-picker:focus {
    outline: none;
    border-color: var(--accent);
  }
  .date-picker::-webkit-calendar-picker-indicator {
    filter: invert(0.7);
    cursor: pointer;
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
  /* Dim the card while a date pick is in flight. A cold past-day fetch
     hits the aggregator and can take many seconds; this gives the
     operator immediate feedback that the click registered. */
  .loading { opacity: 0.6; transition: opacity 120ms ease-out; }
  /* Day strip — one dot per recent day, filled if ParallelBurn has data
     for that date. Compact answer to "which days are worth picking"
     given that <input type="date"> can't be styled per-day. */
  .day-strip {
    display: flex;
    gap: 4px;
    align-items: center;
    padding: 4px 0 12px;
    margin-bottom: 4px;
    border-bottom: 1px solid var(--card-border);
  }
  .day-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: rgba(255,255,255,0.06);
    border: 1px solid transparent;
    cursor: pointer;
    padding: 0;
    flex-shrink: 0;
    transition: transform 80ms ease-out, background 120ms ease-out;
  }
  .day-dot.active { background: var(--accent); }
  .day-dot.selected {
    border-color: var(--fg);
    transform: scale(1.25);
  }
  .day-dot:hover { transform: scale(1.4); }
  .day-strip-spacer { flex: 1; }
  .day-strip-label {
    font-size: 10px;
    color: var(--dim);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin-right: 8px;
  }
</style>
</head>
<body>
<div class="card" id="card">
  <div class="header">
    <span class="dot"></span>
    <span>ParallelBurn —</span>
    <input type="date" id="date-picker" class="date-picker" />
    <span style="flex:1"></span>
    <span id="warming-tag" style="display:none;color:var(--warn)">warming…</span>
  </div>

  <div class="day-strip" id="day-strip">
    <span class="day-strip-label">last 30d</span>
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
    <span><span id="version" class="version">v—</span> · <span id="pricing">pricing —</span></span>
  </div>
</div>

<script>
  (function () {
    var els = {
      card: document.getElementById('card'),
      warming: document.getElementById('warming-tag'),
      datePicker: document.getElementById('date-picker'),
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
      version: document.getElementById('version'),
      dayStrip: document.getElementById('day-strip'),
    };

    var DAY_STRIP_LENGTH = 30;
    var activeDates = {}; // object-as-set: date string -> true

    var EQUALITY_TOLERANCE_MS = 60 * 1000; // 1 minute

    function fmtRatio(r) { return (isFinite(r) && r > 0) ? r.toFixed(1) + '×' : '—'; }
    // Cache hit lives near saturation on healthy days. Plain toFixed(1)
    // collapses 99.94 → 100.0, hiding drift across the saturation line.
    // For values ≥ 99 we widen to two decimals so 99.94 stays distinct
    // from 100.00; below that, one decimal is enough resolution.
    function fmtCacheHit(p) {
      if (p >= 99) return p.toFixed(2) + '%';
      return p.toFixed(1) + '%';
    }
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
      // If this snapshot reports sessions for its date, light up the
      // corresponding dot right away — beats waiting for the 60-second
      // /api/active-dates poll to catch up on the first session of a
      // fresh day.
      if (a && a.sessions && a.sessions.length > 0 && snap.date && !activeDates[snap.date]) {
        activeDates[snap.date] = true;
        renderDayStrip();
      }
      els.card.classList.toggle('warming', !!snap.warming);
      els.warming.style.display = snap.warming ? '' : 'none';
      els.compression.textContent = fmtRatio(a.compressionRatio);
      els.cost.textContent = fmtUsd(a.totalCostUsd);
      els.cacheHit.textContent = isFinite(a.cacheHitPercent) && a.cacheHitPercent >= 0
        ? fmtCacheHit(a.cacheHitPercent)
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
      if (typeof snap.streak === 'number') {
        els.streak.innerHTML = String(snap.streak) + '<span class="sub" id="longest"> / ' + String(snap.longestStreak || 0) + ' best</span>';
      } else {
        els.streak.innerHTML = '—<span class="sub" id="longest"></span>';
      }
      var staleClass = snap.pricingStale ? 'stale' : '';
      var staleNote = snap.pricingStale ? ' (STALE)' : '';
      els.pricing.innerHTML = '<span class="' + staleClass + '">pricing ' + (snap.pricingAsOf || '—') + staleNote + '</span>';
      els.version.textContent = snap.pburnVersion ? 'v' + snap.pburnVersion : 'v—';
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

    function todayStr() {
      var d = new Date();
      var y = d.getFullYear();
      var m = String(d.getMonth() + 1).padStart(2, '0');
      var day = String(d.getDate()).padStart(2, '0');
      return y + '-' + m + '-' + day;
    }

    var selectedDate = todayStr();
    els.datePicker.value = selectedDate;
    els.datePicker.max = selectedDate;

    function shiftDateStr(base, deltaDays) {
      var parts = base.split('-');
      var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      d.setDate(d.getDate() + deltaDays);
      var y = d.getFullYear();
      var m = String(d.getMonth() + 1).padStart(2, '0');
      var day = String(d.getDate()).padStart(2, '0');
      return y + '-' + m + '-' + day;
    }

    function renderDayStrip() {
      // Keep the label, drop any prior dots.
      var dots = els.dayStrip.querySelectorAll('.day-dot');
      for (var k = 0; k < dots.length; k += 1) els.dayStrip.removeChild(dots[k]);
      var today = todayStr();
      // Oldest on the left, today on the right.
      for (var i = DAY_STRIP_LENGTH - 1; i >= 0; i -= 1) {
        var dateStr = shiftDateStr(today, -i);
        var dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'day-dot';
        if (activeDates[dateStr]) dot.classList.add('active');
        if (dateStr === selectedDate) dot.classList.add('selected');
        dot.title = dateStr + (activeDates[dateStr] ? '' : ' (no data)');
        dot.setAttribute('data-date', dateStr);
        dot.addEventListener('click', onDotClick);
        els.dayStrip.appendChild(dot);
      }
    }

    function onDotClick(ev) {
      var picked = ev.currentTarget.getAttribute('data-date');
      if (!picked || picked === selectedDate) return;
      selectedDate = picked;
      els.datePicker.value = picked;
      fetchSelected();
      renderDayStrip();
    }

    function refreshActiveDates() {
      fetch('/api/active-dates').then(function (r) { return r.json(); }).then(function (j) {
        if (!j || !j.dates || !j.dates.length) return;
        activeDates = {};
        for (var i = 0; i < j.dates.length; i += 1) activeDates[j.dates[i]] = true;
        // Constrain the picker so the operator can't wander off into
        // pre-data prehistory. Today remains the upper bound.
        els.datePicker.min = j.dates[0];
        renderDayStrip();
      }).catch(function () {});
    }

    var inflight = null;
    function fetchSelected() {
      var url = (selectedDate === todayStr())
        ? '/api/today'
        : '/api/day?date=' + encodeURIComponent(selectedDate);
      // Cancel any prior fetch — the user has moved on. AbortController
      // means the stale response can't sneak in and clobber the current
      // one after a fast date-pick toggle.
      if (inflight && typeof inflight.abort === 'function') inflight.abort();
      inflight = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var pickedAt = selectedDate;
      els.card.classList.add('loading');
      fetch(url, inflight ? { signal: inflight.signal } : undefined)
        .then(function (r) { return r.json(); })
        .then(function (snap) {
          if (!snap || snap.date !== pickedAt) return;
          if (pickedAt !== selectedDate) return;
          els.card.classList.remove('loading');
          render(snap);
        })
        .catch(function () {
          if (pickedAt === selectedDate) els.card.classList.remove('loading');
        });
    }

    els.datePicker.addEventListener('change', function () {
      var v = els.datePicker.value;
      if (!v) return;
      selectedDate = v;
      fetchSelected();
      renderDayStrip();
    });

    function start() {
      var es = new EventSource('/events');
      es.onopen = function () { setConnected(true); };
      es.onerror = function () { setConnected(false); };
      es.onmessage = function (e) {
        try {
          var snap = JSON.parse(e.data);
          // SSE only pushes today's snapshot; ignore while a past day is selected.
          if (snap.date === selectedDate) render(snap);
          setConnected(true);
        } catch (err) {}
      };
    }

    // Initial paint so the strip isn't empty during the first request.
    renderDayStrip();
    refreshActiveDates();
    // Refresh the active-dates set every minute — the server-side cache
    // already serves stale-but-bounded data for that long, so the
    // overlay can poll on the same cadence without doing extra work.
    setInterval(refreshActiveDates, 60 * 1000);
    fetchSelected();
    start();
  })();
</script>
</body>
</html>`;
