/**
 * ai.js
 * Two AI layers:
 *
 * 1. Instant Insights — deterministic synthesis from pre-generated labels.
 *    No model call. Summarizes topics and sentiment from the current selection.
 *
 * 2. Ask AI — live Claude synthesis via the Cloudflare Worker proxy.
 *    Sends: deterministic aggregate metrics (full selection) +
 *           representative stratified sample of up to 60 review texts.
 *    The Worker holds the API key; it is never in this file.
 *
 * Architecture note: population-level metrics (counts, %) come from the
 * entire filtered dataset via computeSelectionStats(). The 60-text sample
 * provides qualitative context only — it is NOT used to estimate frequencies.
 */

import {
  SENTIMENT_COLORS,
  VALID_SENTIMENTS,
  computeSelectionStats,
  getRepresentativeSample,
  MAX_AI_SAMPLE,
  topKeywordsBySentiment,
} from "./analytics.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// The Worker URL holds the Anthropic key server-side. Never put the key here.
// Update this URL after deploying the Cloudflare Worker.
export const WORKER_URL = "https://airline-ai.daksitha-ganeshkumar.workers.dev";

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Escape a string for safe innerHTML insertion. */
function esc(t) {
  return String(t == null ? "" : t).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

function listWords(a) {
  return a.length < 2 ? (a[0] || "") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1];
}

// ---------------------------------------------------------------------------
// Instant Insights (deterministic — no model call)
// ---------------------------------------------------------------------------

/**
 * Build an HTML summary string from pre-generated labels.
 * All numbers come from the full `rows` array — no sampling.
 */
export function buildInstantInsights(rows) {
  if (!rows.length) return "<em>No reviews in the current selection. Adjust the filters above.</em>";

  const n  = rows.length;
  const sc = { positive: 0, negative: 0, mixed: 0 };
  rows.forEach(d => { if (sc[d.sentiment] !== undefined) sc[d.sentiment]++; });

  const pct  = s => Math.round(sc[s] / n * 100);
  const mood = sc.positive >= sc.negative && sc.positive >= sc.mixed ? "largely positive"
             : sc.negative >= sc.positive && sc.negative >= sc.mixed ? "largely negative"
             : "mixed";

  const cat = {};
  rows.forEach(d => d.categories.forEach(c => { cat[c] = (cat[c] || 0) + 1; }));
  const topCat  = Object.entries(cat).sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => x[0]);
  const praised = topKeywordsBySentiment(rows, "positive");
  const gripes  = topKeywordsBySentiment(rows, "negative");

  // Sample reviews for illustrative quotes (one per sentiment)
  const samples = [];
  ["negative", "positive", "mixed"].forEach(s => {
    const f = rows.find(d => d.sentiment === s && d.summary);
    if (f) samples.push({ s, t: f.summary });
  });

  let h = "";
  h += `<p>Across <b>${n.toLocaleString()}</b> reviews, sentiment is <b>${mood}</b> — ${pct("positive")}% positive, ${pct("negative")}% negative, ${pct("mixed")}% mixed.</p>`;
  if (topCat.length)  h += `<p>The most-discussed topics are <b>${esc(listWords(topCat))}</b>.</p>`;
  if (praised.length) h += `<p><span class="tag pos">Praise</span>most often mentions ${esc(listWords(praised))}.</p>`;
  if (gripes.length)  h += `<p><span class="tag neg">Complaints</span>most often cite ${esc(listWords(gripes))}.</p>`;
  if (samples.length) {
    h += `<p class="ai-sub">In reviewers\u2019 words</p><ul>`;
    samples.forEach(x => { h += `<li><span class="d" style="background:${SENTIMENT_COLORS[x.s]}"></span>${esc(x.t)}</li>`; });
    h += "</ul>";
  }
  return h;
}

// ---------------------------------------------------------------------------
// Live Ask AI
// ---------------------------------------------------------------------------

let liveAIBusy = false;

/**
 * Call the Cloudflare Worker with:
 *   selection = deterministic aggregate metrics over the FULL current selection
 *   sample    = representative stratified sample of up to 60 review texts
 *
 * The sample provides qualitative context. All counts/percentages in the
 * Worker prompt come from selection, not from the sample size.
 */
export async function askAI(filteredRows, filterLabelText, aiOutEl, aiLiveBtnEl) {
  if (liveAIBusy) return; // prevent duplicate requests

  if (!WORKER_URL) {
    aiOutEl.innerHTML = "<em>Live AI isn\u2019t connected yet. Deploy the Worker, then update WORKER_URL in js/ai.js.</em>";
    return;
  }
  if (!filteredRows.length) {
    aiOutEl.innerHTML = "<em>No reviews match these filters. Adjust airlines or sentiment toggles.</em>";
    return;
  }

  liveAIBusy = true;
  const label = aiLiveBtnEl.textContent;
  aiLiveBtnEl.disabled = true;
  aiLiveBtnEl.textContent = "Thinking\u2026";
  aiLiveBtnEl.setAttribute("aria-busy", "true");

  const selection = computeSelectionStats(filteredRows);
  const rawSample = getRepresentativeSample(filteredRows, MAX_AI_SAMPLE);
  const sample    = rawSample.map(d => ({ sentiment: d.sentiment, airline: d.airline, text: (d.review || d.summary || "") }));

  // Provenance line uses actual runtime sample size
  const sampledAll   = rawSample.length >= filteredRows.length;
  const sampleDesc   = sampledAll
    ? `all ${rawSample.length} available review texts`
    : `a representative stratified sample of ${rawSample.length} review texts`;
  const provenance   = `Analysis uses aggregate metrics from all ${selection.total_reviews.toLocaleString()} selected reviews plus ${sampleDesc}.`;

  aiOutEl.innerHTML = `<em>Analyzing aggregate metrics from all ${selection.total_reviews.toLocaleString()} selected reviews plus ${sampleDesc}\u2026</em>`;

  try {
    const res  = await fetch(WORKER_URL, {
      method:  "POST",
      headers: { "content-type": "application/json" },
      body:    JSON.stringify({ selection, sample: { sample_size: sample.length, reviews: sample }, filters: filterLabelText }),
    });
    const data = await res.json();

    if (data.sections) {
      const s = data.sections;
      aiOutEl.innerHTML =
        `<div class="ai-live"><span class="tag" style="background:var(--accent)">Live</span>` +
        `<span class="ai-mood">${esc(s.mood || "")}</span></div>` +
        `<div class="ai-block pos"><span class="ai-block-lbl">What customers praise</span>${esc(s.praise || "")}</div>` +
        `<div class="ai-block neg"><span class="ai-block-lbl">What they complain about</span>${esc(s.complaints || "")}</div>` +
        `<div style="font-family:var(--mono);font-size:11px;color:var(--muted);margin-top:12px;line-height:1.5">${esc(provenance)}</div>`;
    } else if (data.summary) {
      aiOutEl.innerHTML = `<p>${esc(data.summary)}</p><div style="font-family:var(--mono);font-size:11px;color:var(--muted);margin-top:12px">${esc(provenance)}</div>`;
    } else if (data.error) {
      console.error("Worker error:", data.error);
      aiOutEl.innerHTML = "<em>The AI service returned an error. Try again in a moment.</em>";
    }
  } catch (e) {
    console.error("Ask AI error:", e);
    aiOutEl.innerHTML = "<em>The AI service couldn\u2019t be reached. Try again in a moment.</em>";
  } finally {
    liveAIBusy = false;
    aiLiveBtnEl.disabled = false;
    aiLiveBtnEl.textContent = label;
    aiLiveBtnEl.setAttribute("aria-busy", "false");
  }
}
