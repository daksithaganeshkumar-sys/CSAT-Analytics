/**
 * app.js
 * Application entry point. Owns:
 *   - DOM element references
 *   - Application state (loaded data, filter selections)
 *   - CSV loading and schema validation
 *   - Event listeners for all interactive controls
 *   - Main update() orchestration loop
 *   - Review card rendering and batching
 *   - Data-quality status display
 */

import {
  VALID_SENTIMENTS,
  normalizeSentiment,
  normalizeKeyword,
  splitTags,
  topTopics,
  topPainPoints,
  airlineSentimentBreakdown,
  topKeywords,
} from "./analytics.js";

import {
  renderSentimentMix,
  renderTopTopics,
  renderPainPoints,
  renderKwChart,
  renderAirChart,
  initVizTabs,
  scheduleCloud,
  resetCloud,
} from "./charts.js";

import { buildInstantInsights, askAI, WORKER_URL } from "./ai.js";

// ---------------------------------------------------------------------------
// DOM references (all populated at DOMContentLoaded)
// ---------------------------------------------------------------------------

const el = {};

function cacheElements() {
  const $ = id => document.getElementById(id);
  Object.assign(el, {
    uploader:    $("uploader"),
    fileInput:   $("fileInput"),
    dash:        $("dash"),
    err:         $("err"),
    dqNote:      $("dqNote"),
    airChips:    $("airChips"),
    airSel:      $("airSel"),
    allAir:      $("allAir"),
    noneAir:     $("noneAir"),
    reviewCount: $("reviewCount"),
    mixbar:      $("mixbar"),
    mixlegend:   $("mixlegend"),
    cats:        $("catsList"),
    pain:        $("painList"),
    painSub:     $("painSub"),
    kwChart:     $("kwChart"),
    airChart:    $("airChart"),
    vizHint:     $("vizHint"),
    cloud:       $("cloud"),
    cloudEmpty:  $("cloudEmpty"),
    reviewsList: $("reviewsList"),
    reviewsEmpty:$("reviewsEmpty"),
    showMore:    $("showMore"),
    aiBtn:       $("aiBtn"),
    aiOut:       $("aiOut"),
    aiLiveBtn:   $("aiLiveBtn"),
  });
}

// ---------------------------------------------------------------------------
// Application state
// ---------------------------------------------------------------------------

let DATA         = [];       // all ingested rows
let airlines     = [];       // unique airline names (sorted)
let selectedAirlines = new Set();
let selectedSentiments = new Set(VALID_SENTIMENTS);
let dataQuality  = null;     // reported by ingest
let lastFiltered = [];       // used by Instant Insights + Ask AI
let wordMeta     = new Map();// keyword → { label, count, pos, neg, mix } for cloud tooltip
let aiActive     = false;    // true = Instant Insights auto-refreshes on filter change

// Review list pagination
const BATCH  = 30;
let reviewRows  = [];
let reviewShown = 0;

// Visualization hint text
const VIZ_HINTS = {
  keywords: "bar length = mentions · color = sentiment",
  airlines: "each bar = 100% of that airline\u2019s valid reviews (all sentiment, not affected by the sentiment toggles) · sorted by positive %",
  cloud:    "hover a word for its sentiment split",
};

// ---------------------------------------------------------------------------
// CSV ingestion and validation
// ---------------------------------------------------------------------------

/** Case-tolerant column lookup across common naming variants. */
function pick(row, names) {
  for (const n of names) { if (row[n] != null) return row[n]; }
  return null;
}

/**
 * Ingest Papa-parsed rows into the DATA array.
 * Validates required columns, normalizes sentiment, preserves review_id.
 * Skips rows with no airline or no review text.
 */
function ingest(rows) {
  const headerKeys = rows.length ? Object.keys(rows[0]) : [];
  const hasCol = names => names.some(n => headerKeys.includes(n));

  // Required column check
  const missing = [];
  if (!hasCol(["Reviews", "reviews", "Review"]))   missing.push("Reviews");
  if (!hasCol(["sentiment", "Sentiment"]))          missing.push("sentiment");
  if (!hasCol(["Airline", "airline"]))              missing.push("Airline");
  if (missing.length) {
    el.err.textContent =
      "This file is missing required column" + (missing.length > 1 ? "s" : "") +
      ": " + missing.join(", ") +
      ". Expected a labeled reviews file with Airline, Reviews and sentiment.";
    return;
  }

  const clean = []; let invalidSent = 0, skipped = 0;
  for (const r of rows) {
    const airline = pick(r, ["Airline", "airline"]);
    const sentRaw = pick(r, ["sentiment", "Sentiment"]);
    const rev     = pick(r, ["Reviews", "reviews", "Review"]);
    if (airline == null || String(rev == null ? "" : rev).trim() === "") { skipped++; continue; }

    const sentiment = normalizeSentiment(sentRaw);
    if (sentiment === "invalid") invalidSent++;

    const rid = pick(r, ["review_id", "Review_ID", "id", "ID"]);
    clean.push({
      review_id:  rid != null && String(rid).trim() !== "" ? String(rid).trim() : null,
      airline:    String(airline).trim(),
      sentiment,
      keywords:   splitTags(pick(r, ["keywords", "Keywords"])),
      categories: splitTags(pick(r, ["categories", "Categories"])),
      review:     String(rev == null ? "" : rev).trim(),
      summary:    String(pick(r, ["summary", "Summary"]) || "").trim(),
    });
  }

  if (!clean.length) {
    el.err.textContent = "No usable rows found. Each row needs an Airline and review text.";
    return;
  }

  DATA         = clean;
  dataQuality  = { total: clean.length + skipped, usable: clean.length, invalidSent, skipped };
  airlines     = [...new Set(clean.map(d => d.airline))].sort();
  selectedAirlines.clear();
  airlines.forEach(a => selectedAirlines.add(a));

  buildAirChips();
  el.uploader.style.display = "none";
  el.dash.classList.add("on");
  renderDataQualityNote();
  update();
}

// ---------------------------------------------------------------------------
// Data quality display
// ---------------------------------------------------------------------------

function renderDataQualityNote() {
  if (!el.dqNote || !dataQuality) return;
  const q   = dataQuality;
  const classified = (q.usable || 0) - (q.invalidSent || 0);
  const parts = [q.usable.toLocaleString() + " loaded", classified.toLocaleString() + " classified"];

  if (q.invalidSent > 0) {
    parts.push(q.invalidSent.toLocaleString() + " unclassified");
    el.dqNote.classList.add("warn");
    el.dqNote.title = "Unclassified rows are excluded from sentiment percentages.";
  } else {
    el.dqNote.classList.remove("warn");
    el.dqNote.removeAttribute("title");
  }
  if (q.skipped > 0) parts.push(q.skipped.toLocaleString() + " skipped (no review text)");
  el.dqNote.textContent = parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Airline filter chips
// ---------------------------------------------------------------------------

function buildAirChips() {
  el.airChips.innerHTML = "";
  airlines.forEach(a => {
    const c = document.createElement("button");
    c.className = "chip on";
    c.type      = "button";
    c.textContent = a;
    c.setAttribute("aria-pressed", "true");
    c.addEventListener("click", () => {
      c.classList.toggle("on");
      const on = c.classList.contains("on");
      on ? selectedAirlines.add(a) : selectedAirlines.delete(a);
      c.setAttribute("aria-pressed", on ? "true" : "false");
      update();
    });
    el.airChips.appendChild(c);
  });
  updateAirlineSelectionLabel();
}

function updateAirlineSelectionLabel() {
  el.airSel.textContent = selectedAirlines.size + " of " + airlines.length + " selected";
}

// ---------------------------------------------------------------------------
// Main update orchestration
// ---------------------------------------------------------------------------

function update() {
  updateAirlineSelectionLabel();

  // All rows for the selected airlines (for baseline analytics that are
  // intentionally independent of the display sentiment toggles).
  const airlineBaselineRows = DATA.filter(d => selectedAirlines.has(d.airline));

  // Rows further filtered by the active sentiment display toggles.
  const filteredRows = airlineBaselineRows.filter(d => selectedSentiments.has(d.sentiment));

  // "In View" count with correct singular/plural grammar
  const rc = filteredRows.length;
  el.reviewCount.childNodes[0].nodeValue = rc.toLocaleString();
  const rlbl = el.reviewCount.querySelector("small");
  if (rlbl) rlbl.textContent = rc === 1 ? " review matches your filters" : " reviews match your filters";

  // Sentiment toggle counts (show airline-baseline counts, not just display-filtered)
  VALID_SENTIMENTS.forEach(s => {
    const ct = document.getElementById("ct-" + s);
    if (ct) ct.textContent = airlineBaselineRows.filter(d => d.sentiment === s).length.toLocaleString();
  });

  if (!selectedAirlines.size) {
    // No airlines: all analytics show placeholder messages
    renderSentimentMix([], el.mixbar, el.mixlegend);
    renderTopTopics([], el.cats);
    renderPainPoints({ items: [], negTotal: 0 }, el.pain, el.painSub);
    buildReviews([]);
    lastFiltered = [];
    renderViz(airlineBaselineRows);
    if (aiActive) { el.aiOut.innerHTML = "<em>Select at least one airline to generate insights.</em>"; aiActive = false; }
    return;
  }

  // Baseline analytics: use airlineBaselineRows so they are toggle-independent
  renderSentimentMix(airlineBaselineRows, el.mixbar, el.mixlegend);
  renderTopTopics(topTopics(filteredRows), el.cats);
  renderPainPoints(topPainPoints(airlineBaselineRows), el.pain, el.painSub);

  buildReviews(filteredRows);
  lastFiltered = filteredRows;
  renderViz(airlineBaselineRows);

  if (aiActive) el.aiOut.innerHTML = buildInstantInsights(filteredRows);
}

// ---------------------------------------------------------------------------
// Visualization tabs
// ---------------------------------------------------------------------------

function renderViz(airlineBaselineRows) {
  const active = document.querySelector(".viz-tab.on");
  const pane   = active ? active.dataset.v : "keywords";

  if (pane === "keywords") {
    renderKwChart(topKeywords(lastFiltered), el.kwChart, lastFiltered.length > 0);
  } else if (pane === "airlines") {
    renderAirChart(airlineSentimentBreakdown(airlineBaselineRows), el.airChart);
  }
  // Word cloud is rendered on demand when its tab is clicked.
}

// ---------------------------------------------------------------------------
// Review cards
// ---------------------------------------------------------------------------

function buildReviews(rows) {
  reviewRows   = rows;
  reviewShown  = 0;
  el.reviewsList.innerHTML = "";
  el.reviewsEmpty.classList.toggle("on", !rows.length);
  el.showMore.style.display = rows.length > BATCH ? "block" : "none";
  renderMoreReviews();
}

function renderMoreReviews() {
  const frag = document.createDocumentFragment();
  const end  = Math.min(reviewShown + BATCH, reviewRows.length);

  for (let i = reviewShown; i < end; i++) {
    const d    = reviewRows[i];
    const card = document.createElement("div"); card.className = "rev";

    // Header: airline + sentiment badge + optional summary toggle
    const top   = document.createElement("div"); top.className = "rev-top";
    const air   = document.createElement("span"); air.className = "rev-air";   air.textContent = d.airline;
    const badge = document.createElement("span"); badge.className = "rev-badge"; badge.dataset.s = d.sentiment; badge.textContent = d.sentiment;
    top.appendChild(air); top.appendChild(badge);

    if (d.summary) {
      const btn = document.createElement("button");
      btn.className  = "rev-sum-btn"; btn.type = "button"; btn.textContent = "Show summary";
      top.appendChild(btn);
    }
    card.appendChild(top);

    // AI classification chips (categories + keywords)
    if ((d.categories && d.categories.length) || (d.keywords && d.keywords.length)) {
      const chips = document.createElement("div"); chips.className = "rev-chips";
      (d.categories || []).forEach(c => {
        const ch = document.createElement("span"); ch.className = "chip-cat"; ch.textContent = c; chips.appendChild(ch);
      });
      (d.keywords || []).slice(0, 6).forEach(k => {
        const ch = document.createElement("span"); ch.className = "chip-kw"; ch.textContent = k; chips.appendChild(ch);
      });
      card.appendChild(chips);
    }

    // AI summary (collapsed by default)
    if (d.summary) {
      const sumBox = document.createElement("div"); sumBox.className = "rev-summary";
      const lbl    = document.createElement("span"); lbl.className = "lbl"; lbl.textContent = "AI summary";
      sumBox.appendChild(lbl); sumBox.appendChild(document.createTextNode(d.summary));
      card.appendChild(sumBox);
    }

    // Original review text
    const body = document.createElement("div"); body.className = "rev-body";
    body.textContent = d.review || "(no review text in this file)";
    card.appendChild(body);

    frag.appendChild(card);
  }

  el.reviewsList.appendChild(frag);
  reviewShown = end;
  el.showMore.style.display = reviewShown < reviewRows.length ? "block" : "none";
}

// ---------------------------------------------------------------------------
// Summary toggle (delegated from reviewsList)
// ---------------------------------------------------------------------------

function initSummaryToggle() {
  el.reviewsList.addEventListener("click", e => {
    const btn = e.target.closest(".rev-sum-btn");
    if (!btn) return;
    const rev = btn.closest(".rev");
    const box = rev.querySelector(".rev-summary");
    if (!box) return;
    const open = box.classList.toggle("on");
    btn.textContent = open ? "Hide summary" : "Show summary";
  });
}

// ---------------------------------------------------------------------------
// Word cloud tooltip (hover word → show sentiment breakdown)
// ---------------------------------------------------------------------------

function initCloudTooltip() {
  const tooltip = document.getElementById("tooltip");
  if (!tooltip) return;

  document.addEventListener("wordcloudstop", () => {
    document.querySelectorAll("#cloud span").forEach(span => {
      span.addEventListener("mouseenter", ev => {
        const item = ev.target.dataset.wc;
        if (!item) return;
        const m = wordMeta.get(item);
        if (!m) { tooltip.style.opacity = "0"; return; }
        tooltip.textContent = "";
        const tw = document.createElement("div"); tw.className = "tw"; tw.textContent = m.label; tooltip.appendChild(tw);
        [["Positive", "positive", m.positive], ["Negative", "negative", m.negative], ["Mixed", "mixed", m.mixed]].forEach(([lab, s, val]) => {
          const tr  = document.createElement("div"); tr.className = "tr";
          const dot = document.createElement("span"); dot.className = "dot"; dot.style.background = SENTIMENT_COLORS[s] || "#888";
          const b   = document.createElement("b"); b.textContent = val;
          tr.appendChild(dot); tr.appendChild(document.createTextNode(lab + " ")); tr.appendChild(b);
          tooltip.appendChild(tr);
        });
        tooltip.style.left  = (ev.clientX + 16) + "px";
        tooltip.style.top   = (ev.clientY - 10) + "px";
        tooltip.style.opacity = "1";
      });
      span.addEventListener("mouseleave", () => { tooltip.style.opacity = "0"; });
    });
  });
}

// ---------------------------------------------------------------------------
// File loading
// ---------------------------------------------------------------------------

function loadFile(file) {
  el.err.textContent = "";
  Papa.parse(file, {
    header:          true,
    skipEmptyLines:  true,
    encoding:        "UTF-8",
    complete: res  => ingest(res.data),
    error:    err  => { el.err.textContent = "Could not read the file: " + err.message; },
  });
}

/**
 * Auto-load the bundled `reviews_final.csv` from the repo root.
 * This is what makes the GitHub Pages demo immediately useful.
 */
async function autoLoadBundledCSV() {
  try {
    const res = await fetch("reviews_final.csv");
    if (!res.ok) return; // silently skip — user can upload manually
    const text = await res.text();
    const result = Papa.parse(text, { header: true, skipEmptyLines: true });
    ingest(result.data);
  } catch (_) {
    // Network unavailable or file not found — dashboard shows the uploader.
  }
}

// ---------------------------------------------------------------------------
// Sample data (built-in demo)
// ---------------------------------------------------------------------------

// A small representative inline sample for quick demo / offline testing.
// Kept minimal — the real data comes from reviews_final.csv.
function SAMPLE() {
  return [
    { Airline:"Aurora Air", Reviews:"The flight was delayed 3 hours and no explanation was given. Baggage also lost.",
      sentiment:"negative", categories:"Delays & Punctuality|Baggage", keywords:"flight delay|lost baggage|poor communication", summary:"3-hour delay with no explanation; baggage lost." },
    { Airline:"Aurora Air", Reviews:"Incredible service. The crew was attentive and the food was delicious.",
      sentiment:"positive", categories:"Staff Service|Food & Beverages", keywords:"excellent service|great food|attentive crew", summary:"Outstanding crew and food quality." },
    { Airline:"Aurora Air", Reviews:"Seats were comfortable but boarding was chaotic. Food was decent.",
      sentiment:"mixed", categories:"Seat Comfort|Boarding & Check-in|Food & Beverages", keywords:"comfortable seats|chaotic boarding|decent food", summary:"Comfortable seats but disorganised boarding." },
    { Airline:"Meridian", Reviews:"Rude staff at check-in and cramped seats. Never flying again.",
      sentiment:"negative", categories:"Staff Service|Seat Comfort", keywords:"rude staff|cramped seats|poor experience", summary:"Rude check-in staff and uncomfortable seats." },
    { Airline:"Meridian", Reviews:"Smooth flight, on time, friendly cabin crew. Would fly again.",
      sentiment:"positive", categories:"Staff Service|Delays & Punctuality", keywords:"on time|friendly crew|smooth flight", summary:"Punctual and friendly cabin service." },
  ].map((r, i) => ({ ...r, review_id: String(i), Airline: r.Airline, Reviews: r.Reviews }));
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------

function initEvents() {
  // Drag-and-drop upload
  const up = el.uploader;
  up.addEventListener("dragover",  e => { e.preventDefault(); up.classList.add("drag"); });
  up.addEventListener("dragleave", ()  => up.classList.remove("drag"));
  up.addEventListener("drop",      e  => { e.preventDefault(); up.classList.remove("drag"); if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); });

  el.fileInput.addEventListener("change", e => { if (e.target.files[0]) loadFile(e.target.files[0]); });

  // Sample data button
  document.getElementById("sampleBtn").addEventListener("click", () => ingest(SAMPLE()));

  // Airline all / none
  el.allAir.addEventListener("click",  () => {
    airlines.forEach(a => selectedAirlines.add(a));
    document.querySelectorAll("#airChips .chip").forEach(c => { c.classList.add("on"); c.setAttribute("aria-pressed", "true"); });
    update();
  });
  el.noneAir.addEventListener("click", () => {
    selectedAirlines.clear();
    document.querySelectorAll("#airChips .chip").forEach(c => { c.classList.remove("on"); c.setAttribute("aria-pressed", "false"); });
    update();
  });

  // Sentiment toggles
  document.querySelectorAll(".sent").forEach(btn => {
    btn.addEventListener("click", () => {
      btn.classList.toggle("on");
      const on = btn.classList.contains("on");
      on ? selectedSentiments.add(btn.dataset.s) : selectedSentiments.delete(btn.dataset.s);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      update();
    });
  });

  // Visualization tabs
  initVizTabs(el.vizHint, VIZ_HINTS, () => {
    if (!wordMeta.size) scheduleCloud(lastFiltered, el.cloud, el.cloudEmpty, wordMeta);
  });

  // Show More
  el.showMore.addEventListener("click", renderMoreReviews);

  // Instant Insights
  el.aiBtn.addEventListener("click", () => {
    if (!selectedAirlines.size) {
      el.aiOut.innerHTML = "<em>Select at least one airline to generate insights.</em>";
      return;
    }
    aiActive = true;
    el.aiOut.innerHTML = buildInstantInsights(lastFiltered);
  });

  // Ask AI (live Worker)
  el.aiLiveBtn.addEventListener("click", () => {
    if (!selectedAirlines.size) {
      el.aiOut.innerHTML = "<em>Select at least one airline before asking AI about this view.</em>";
      return;
    }
    askAI(lastFiltered, filterLabel(), el.aiOut, el.aiLiveBtn);
  });

  // Debounced resize
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (el.dash.classList.contains("on")) update();
    }, 250);
  });
}

function filterLabel() {
  const a = selectedAirlines.size === airlines.length ? "all airlines" : [...selectedAirlines].join(", ");
  return a + " (" + [...selectedSentiments].join("/") + ")";
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  initSummaryToggle();
  initCloudTooltip();
  initEvents();
  autoLoadBundledCSV();
});
