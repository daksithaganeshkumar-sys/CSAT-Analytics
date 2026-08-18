/**
 * charts.js
 * All chart and visualization rendering. Receives computed data objects
 * from analytics.js and updates the DOM. No business-logic calculations here.
 */

import { SENTIMENT_COLORS, VALID_SENTIMENTS, tallyKeywords, airlineSentimentBreakdown } from "./analytics.js";

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Escape a string for safe innerHTML insertion. */
function esc(t) {
  return String(t == null ? "" : t).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

/** Create a muted empty-state message element. */
function emptyMsg(text) {
  const div = document.createElement("div");
  div.className = "empty-msg";
  div.textContent = text;
  return div;
}

// ---------------------------------------------------------------------------
// Overall Sentiment bar (sidebar)
// ---------------------------------------------------------------------------

/**
 * Render the "Overall Sentiment — Selected Airlines" stacked bar.
 * Uses all valid classified rows for selected airlines — independent of
 * the sentiment display toggles.
 */
export function renderSentimentMix(byAirline, mixbarEl, mixlegendEl) {
  const validCount = byAirline.filter(d => VALID_SENTIMENTS.includes(d.sentiment)).length || 1;

  if (!byAirline.length) {
    VALID_SENTIMENTS.forEach(s => {
      const seg = mixbarEl.querySelector(`[data-s="${s}"]`);
      if (seg) seg.style.width = "0%";
    });
    mixlegendEl.innerHTML = "";
    const em = document.createElement("div");
    em.className = "empty-msg";
    em.style.padding = "4px 0";
    em.textContent = "Select at least one airline to view sentiment.";
    mixlegendEl.appendChild(em);
    return;
  }

  mixlegendEl.innerHTML = "";
  VALID_SENTIMENTS.forEach(s => {
    const n   = byAirline.filter(d => d.sentiment === s).length;
    const pct = n / validCount * 100;
    const seg = mixbarEl.querySelector(`[data-s="${s}"]`);
    if (seg) seg.style.width = pct + "%";

    const row = document.createElement("div");
    row.className = "row";
    const dot = document.createElement("span"); dot.className = "dot"; dot.style.background = SENTIMENT_COLORS[s];
    const nm  = document.createElement("span"); nm.style.textTransform = "capitalize"; nm.textContent = s;
    const pc  = document.createElement("span"); pc.className = "pct"; pc.textContent = Math.round(pct) + "%";
    row.appendChild(dot); row.appendChild(nm); row.appendChild(pc);
    mixlegendEl.appendChild(row);
  });
}

// ---------------------------------------------------------------------------
// Top Topics (sidebar)
// ---------------------------------------------------------------------------

export function renderTopTopics(topics, catsEl) {
  catsEl.innerHTML = "";
  if (!topics.length) {
    const li = document.createElement("li");
    li.className = "empty-msg";
    li.textContent = "No topic labels are available for these reviews.";
    catsEl.appendChild(li);
    return;
  }
  const maxCount = topics[0].count;
  topics.forEach(({ name, count }, i) => {
    const li    = document.createElement("li");
    const rank  = document.createElement("span"); rank.className = "rank"; rank.textContent = i + 1;
    const nm    = document.createElement("span"); nm.style.cssText = "flex:0 0 auto;min-width:0"; nm.textContent = name;
    const track = document.createElement("span"); track.className = "track";
    const fill  = document.createElement("span"); fill.className = "fill"; fill.style.width = (count / maxCount * 100) + "%";
    track.appendChild(fill);
    const cnt = document.createElement("span"); cnt.className = "cnt"; cnt.textContent = count;
    li.appendChild(rank); li.appendChild(nm); li.appendChild(track); li.appendChild(cnt);
    catsEl.appendChild(li);
  });
}

// ---------------------------------------------------------------------------
// Top Pain Points (sidebar)
// ---------------------------------------------------------------------------

export function renderPainPoints({ items, negTotal }, painEl, painSubEl) {
  painSubEl.textContent = negTotal
    ? `Negative feedback across the selected airlines (${negTotal.toLocaleString()} negative reviews).`
    : "Negative feedback across the selected airlines.";

  painEl.innerHTML = "";
  if (!negTotal) {
    const li = document.createElement("li");
    li.className = "empty-msg";
    li.textContent = "No negative reviews in the current airline selection.";
    painEl.appendChild(li);
    return;
  }
  if (!items.length) {
    const li = document.createElement("li");
    li.className = "empty-msg";
    li.textContent = "Negative reviews in this selection do not have topic labels.";
    painEl.appendChild(li);
    return;
  }

  const maxN = items[0].count;
  items.forEach(({ name, count, share }, i) => {
    const li    = document.createElement("li");
    const rank  = document.createElement("span"); rank.className = "rank"; rank.textContent = i + 1;
    const nm    = document.createElement("span"); nm.style.cssText = "flex:0 0 auto;min-width:0"; nm.textContent = name;
    const track = document.createElement("span"); track.className = "track";
    const fill  = document.createElement("span"); fill.className = "fill";
    fill.style.cssText = `width:${count / maxN * 100}%;background:linear-gradient(90deg,var(--neg),#f7897d)`;
    track.appendChild(fill);
    const cnt = document.createElement("span"); cnt.className = "pcnt"; cnt.textContent = count.toLocaleString();
    const sh  = document.createElement("span"); sh.className = "share"; sh.textContent = share + "%";
    li.appendChild(rank); li.appendChild(nm); li.appendChild(track); li.appendChild(cnt); li.appendChild(sh);
    li.title = `${name}: ${count.toLocaleString()} negative reviews (${share}% of negative)`;
    painEl.appendChild(li);
  });
}

// ---------------------------------------------------------------------------
// Top Keywords bar chart
// ---------------------------------------------------------------------------

/** Build one horizontal bar row for the keyword chart. */
function kwBarRow(label, parts, total, maxTotal) {
  const row   = document.createElement("div"); row.className = "bar-row";
  const lab   = document.createElement("div"); lab.className = "bar-label"; lab.textContent = label; lab.title = label;
  const track = document.createElement("div"); track.className = "bar-track";
  const scale = maxTotal > 0 ? total / maxTotal : 0;
  VALID_SENTIMENTS.forEach(s => {
    if (parts[s] > 0) {
      const seg = document.createElement("div"); seg.className = "seg";
      seg.style.background = SENTIMENT_COLORS[s];
      seg.style.width = (parts[s] / total * 100 * scale) + "%";
      track.appendChild(seg);
    }
  });
  const cnt = document.createElement("div"); cnt.className = "bar-count"; cnt.textContent = total.toLocaleString();
  row.appendChild(lab); row.appendChild(track); row.appendChild(cnt);
  return row;
}

export function renderKwChart(keywords, kwChartEl, hasRows) {
  kwChartEl.innerHTML = "";
  if (!keywords.length) {
    kwChartEl.appendChild(emptyMsg(
      hasRows
        ? "No keyword labels are available for these reviews."
        : "No reviews match these filters."
    ));
    return;
  }
  const max  = keywords[0].count;
  const frag = document.createDocumentFragment();
  keywords.forEach(it => frag.appendChild(kwBarRow(it.label, it, it.count, max)));
  kwChartEl.appendChild(frag);
}

// ---------------------------------------------------------------------------
// Sentiment by Airline — normalized 100% stacked bars
// ---------------------------------------------------------------------------

const airTooltipEl = () => document.getElementById("airTooltip");

function showAirTooltip(it, rowEl) {
  const t = airTooltipEl(); if (!t) return;
  t.innerHTML = "";
  const tn = document.createElement("div"); tn.className = "tt-air"; tn.textContent = it.name; t.appendChild(tn);
  [["positive", it.pPos], ["mixed", it.pMix], ["negative", it.pNeg]].forEach(([s, f]) => {
    const tr  = document.createElement("div"); tr.className = "tt-row";
    const dot = document.createElement("span"); dot.className = "tt-dot"; dot.style.background = SENTIMENT_COLORS[s];
    const nm  = document.createElement("span"); nm.style.textTransform = "capitalize"; nm.textContent = s;
    const val = document.createElement("span"); val.className = "tt-val"; val.textContent = Math.round(f * 100) + "%";
    tr.appendChild(dot); tr.appendChild(nm); tr.appendChild(val); t.appendChild(tr);
  });
  const ct = document.createElement("div"); ct.className = "tt-count";
  ct.textContent = it.valid.toLocaleString() + " classified reviews";
  t.appendChild(ct);
  const r = rowEl.getBoundingClientRect();
  t.style.left = Math.min(r.right + 10, window.innerWidth - 200) + "px";
  t.style.top  = Math.max(8, r.top + r.height / 2 - 50) + "px";
  t.style.opacity = "1"; t.removeAttribute("aria-hidden");
}

function hideAirTooltip() {
  const t = airTooltipEl();
  if (t) { t.style.opacity = "0"; t.setAttribute("aria-hidden", "true"); }
}

function normBar(it) {
  const row = document.createElement("div");
  row.className = "bar-row";
  row.setAttribute("tabindex", "0");
  row.setAttribute("aria-label",
    `${it.name}: ${Math.round(it.pPos * 100)}% positive, ` +
    `${Math.round(it.pMix * 100)}% mixed, ` +
    `${Math.round(it.pNeg * 100)}% negative. ` +
    `${it.valid.toLocaleString()} classified reviews.`
  );

  const lab   = document.createElement("div"); lab.className = "bar-label"; lab.textContent = it.name;
  const track = document.createElement("div"); track.className = "bar-track";
  [["positive", it.pPos], ["mixed", it.pMix], ["negative", it.pNeg]].forEach(([s, frac]) => {
    if (frac > 0) {
      const seg = document.createElement("div"); seg.className = "seg";
      seg.style.background = SENTIMENT_COLORS[s];
      seg.style.width = (frac * 100) + "%";
      track.appendChild(seg);
    }
  });
  const cnt = document.createElement("div"); cnt.className = "bar-count";
  cnt.textContent = Math.round(it.pPos * 100) + "%";

  row.addEventListener("mouseenter", () => showAirTooltip(it, row));
  row.addEventListener("mouseleave", hideAirTooltip);
  row.addEventListener("focus",      () => showAirTooltip(it, row));
  row.addEventListener("blur",       hideAirTooltip);

  row.appendChild(lab); row.appendChild(track); row.appendChild(cnt);
  return row;
}

export function renderAirChart(airlineData, airChartEl) {
  airChartEl.innerHTML = "";
  if (!airlineData.length) {
    airChartEl.appendChild(emptyMsg("No classified reviews match these filters."));
    return;
  }
  const frag = document.createDocumentFragment();
  airlineData.forEach(it => frag.appendChild(normBar(it)));
  airChartEl.appendChild(frag);
}

// ---------------------------------------------------------------------------
// Visualization tab switching
// ---------------------------------------------------------------------------

export function initVizTabs(vizHintEl, hints, onCloudTab) {
  document.querySelectorAll(".viz-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".viz-tab").forEach(b => {
        b.classList.remove("on");
        b.setAttribute("aria-selected", "false");
      });
      document.querySelectorAll(".viz-pane").forEach(p => p.classList.remove("on"));
      btn.classList.add("on");
      btn.setAttribute("aria-selected", "true");
      document.getElementById("pane-" + btn.dataset.v).classList.add("on");
      vizHintEl.textContent = hints[btn.dataset.v] || "";
      if (btn.dataset.v === "cloud") onCloudTab();
    });
  });
}

// ---------------------------------------------------------------------------
// Word Cloud
// ---------------------------------------------------------------------------

let cloudBuilt = false;
let cloudTimer  = null;

export function resetCloud() {
  cloudBuilt = false;
}

export function scheduleCloud(rows, cloudEl, cloudEmptyEl, wordMetaRef) {
  clearTimeout(cloudTimer);
  cloudTimer = setTimeout(() => buildCloud(rows, cloudEl, cloudEmptyEl, wordMetaRef), 400);
}

function buildCloud(rows, cloudEl, cloudEmptyEl, wordMetaRef) {
  // Rebuild word meta for tooltip use
  wordMetaRef.clear();
  rows.forEach(d => {
    d.keywords.forEach(kw => {
      const { normalizeKeyword: nk } = { normalizeKeyword: k => k.trim().toLowerCase() };
      const key = kw.trim().toLowerCase();
      if (!key) return;
      if (!wordMetaRef.has(key)) wordMetaRef.set(key, { label: kw.trim().toLowerCase(), count: 0, positive: 0, negative: 0, mixed: 0 });
      const m = wordMetaRef.get(key); m.count++;
      if (VALID_SENTIMENTS.includes(d.sentiment)) m[d.sentiment]++;
    });
  });

  const list = [...wordMetaRef.values()].sort((a, b) => b.count - a.count).slice(0, 42).map(m => [m.label, m.count]);
  const empty = !list.length;
  cloudEmptyEl.classList.toggle("on", empty);
  if (empty) {
    const ctx = cloudEl.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, cloudEl.width, cloudEl.height);
    return;
  }
  if (typeof WordCloud === "undefined") return;

  const w = cloudEl.parentElement.clientWidth || 500;
  cloudEl.width  = w;
  cloudEl.height = Math.round(w * 0.52);

  WordCloud(cloudEl, {
    list,
    gridSize:       Math.max(8, Math.round(w / 48)),
    weightFactor:   n => Math.max(13, Math.min(44, n * 2.2)),
    fontFamily:     "Inter, system-ui, sans-serif",
    fontWeight:     "600",
    color:          (_word, weight) => weight > 100 ? "#0f5c73" : weight > 45 ? "#167c8d" : "#4b6473",
    rotateRatio:    0,
    backgroundColor: "#ffffff",
    drawOutOfBound: false,
    shrinkToFit: true,
  });
  cloudBuilt = true;
}

export function isCloudBuilt()  { return cloudBuilt; }
export function markCloudBuilt() { cloudBuilt = true; }
