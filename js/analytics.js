/**
 * analytics.js
 * Pure data transformation functions — no DOM access.
 * Input: arrays of labeled review objects.
 * Output: computed values for the UI to render.
 */

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

export const VALID_SENTIMENTS = ["positive", "negative", "mixed"];

export const SENTIMENT_COLORS = {
  positive: "#35C88A",
  negative: "#F15B4C",
  mixed:    "#AD8DF6",
};

// The live qualitative sample is capped so Claude receives representative
// examples without excessive token usage. Population-level metrics come from
// the full dataset, not from this sample.
export const MAX_AI_SAMPLE = 60;

// ---------------------------------------------------------------------------
// Data normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a raw sentiment string to one of the three valid values.
 * Unrecognized values return "invalid" — they are never coerced to "mixed".
 * Invalid rows are excluded from all percentage calculations.
 */
export function normalizeSentiment(raw) {
  const v = String(raw == null ? "" : raw).toLowerCase().trim();
  return VALID_SENTIMENTS.includes(v) ? v : "invalid";
}

/**
 * Normalize a free-form keyword for aggregation (not display).
 * Rules: trim → lowercase → collapse whitespace → strip leading/trailing punctuation.
 * Deliberately conservative: "flight delay" and "delayed flight" are NOT merged.
 */
export function normalizeKeyword(kw) {
  return String(kw == null ? "" : kw)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[^\w]+|[^\w]+$/g, "");
}

/** Split a pipe-delimited tag string into a trimmed, non-empty array. */
export function splitTags(v) {
  return String(v == null ? "" : v)
    .split("|")
    .map(x => x.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Core metrics — each function is filter-input, data-output
// ---------------------------------------------------------------------------

/**
 * Count valid sentiment across an array of rows.
 * Returns { positive, negative, mixed, invalid, total, validTotal }
 * validTotal is the denominator for percentage calculations.
 */
export function countSentiment(rows) {
  const counts = { positive: 0, negative: 0, mixed: 0, invalid: 0 };
  rows.forEach(d => {
    const key = VALID_SENTIMENTS.includes(d.sentiment) ? d.sentiment : "invalid";
    counts[key]++;
  });
  counts.total = rows.length;
  counts.validTotal = counts.positive + counts.negative + counts.mixed;
  return counts;
}

/**
 * Top Topics: count category mentions across all rows, sorted by frequency.
 * Returns [{ name, count }] sorted desc.
 */
export function topTopics(rows, limit = 8) {
  const cc = {};
  rows.forEach(d => d.categories.forEach(c => { cc[c] = (cc[c] || 0) + 1; }));
  return Object.entries(cc)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

/**
 * Top Pain Points: category mentions in NEGATIVE rows for the selected airlines.
 * Intentionally uses all negative airline rows — independent of sentiment display
 * toggles so pain points remain visible even when the user hides negative cards.
 * Share = category count ÷ total negative reviews.
 * Returns { items: [{ name, count, share }], negTotal }
 */
export function topPainPoints(airlineRows, limit = 8) {
  const neg = airlineRows.filter(d => d.sentiment === "negative");
  const negTotal = neg.length;
  if (!negTotal) return { items: [], negTotal: 0 };

  const cc = {};
  neg.forEach(d => d.categories.forEach(c => { cc[c] = (cc[c] || 0) + 1; }));

  const items = Object.entries(cc)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({
      name,
      count,
      share: Math.round(count / negTotal * 100),
    }));

  return { items, negTotal };
}

/**
 * Tally keywords across rows by normalized key.
 * Returns Map(normalizedKey → { label, count, positive, negative, mixed })
 * Label is the cleaned display form; key is the aggregation key.
 */
export function tallyKeywords(rows) {
  const m = new Map();
  rows.forEach(d => {
    d.keywords.forEach(kw => {
      const key = normalizeKeyword(kw);
      if (!key) return;
      if (!m.has(key)) m.set(key, { label: kw.trim().toLowerCase(), count: 0, positive: 0, negative: 0, mixed: 0 });
      const e = m.get(key);
      e.count++;
      if (VALID_SENTIMENTS.includes(d.sentiment)) e[d.sentiment]++;
    });
  });
  return m;
}

/**
 * Top keyword phrases by frequency.
 * Returns [{ label, count, positive, negative, mixed }] sorted desc.
 */
export function topKeywords(rows, limit = 15) {
  return [...tallyKeywords(rows).values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/**
 * Per-airline normalized sentiment distribution for the stacked bar chart.
 * Uses all valid classified rows for the selected airlines — independent of
 * the sentiment display toggles so the chart remains a stable comparison.
 * Returns [{ name, valid, total, pPos, pMix, pNeg, cPos, cMix, cNeg }]
 * sorted by positive % descending.
 */
export function airlineSentimentBreakdown(rows) {
  const m = new Map();
  rows.forEach(d => {
    if (!m.has(d.airline)) m.set(d.airline, { total: 0, positive: 0, negative: 0, mixed: 0 });
    const e = m.get(d.airline);
    e.total++;
    if (VALID_SENTIMENTS.includes(d.sentiment)) e[d.sentiment]++;
  });

  return [...m.entries()]
    .map(([name, v]) => {
      const valid = v.positive + v.negative + v.mixed;
      return {
        name,
        valid,
        total: v.total,
        pPos: valid ? v.positive / valid : 0,
        pMix: valid ? v.mixed    / valid : 0,
        pNeg: valid ? v.negative / valid : 0,
        cPos: v.positive,
        cMix: v.mixed,
        cNeg: v.negative,
      };
    })
    .filter(x => x.valid > 0)
    .sort((a, b) => b.pPos - a.pPos || b.valid - a.valid);
}

/**
 * Deterministic aggregate statistics over an entire selection.
 * Used as the population-level input to the live AI layer.
 */
export function computeSelectionStats(rows) {
  const sent = { positive: 0, negative: 0, mixed: 0, invalid: 0 };
  const catCount = {}, kwCount = {}, airCount = {};

  rows.forEach(d => {
    const sk = VALID_SENTIMENTS.includes(d.sentiment) ? d.sentiment : "invalid";
    sent[sk]++;
    d.categories.forEach(c => { catCount[c] = (catCount[c] || 0) + 1; });
    d.keywords.forEach(k => {
      const kk = normalizeKeyword(k);
      if (kk) kwCount[kk] = (kwCount[kk] || 0) + 1;
    });
    airCount[d.airline] = (airCount[d.airline] || 0) + 1;
  });

  const classified = sent.positive + sent.negative + sent.mixed || 1;
  const topN = (obj, n) =>
    Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, count]) => ({ name, count }));

  return {
    total_reviews: rows.length,
    sentiment: { positive: sent.positive, negative: sent.negative, mixed: sent.mixed },
    sentiment_pct: {
      positive: Math.round(sent.positive / classified * 100),
      negative: Math.round(sent.negative / classified * 100),
      mixed:    Math.round(sent.mixed    / classified * 100),
    },
    unclassified: sent.invalid,
    top_topics:   topN(catCount, 8),
    top_keywords: topN(kwCount, 10),
    airlines:     topN(airCount, 10),
  };
}

/**
 * Top keywords per sentiment (for Instant Insights).
 * Returns the top `limit` normalized keyword phrases for a given sentiment.
 */
export function topKeywordsBySentiment(rows, sentiment, limit = 3) {
  const m = {};
  rows
    .filter(d => d.sentiment === sentiment)
    .forEach(d => d.keywords.forEach(k => {
      const nk = normalizeKeyword(k);
      if (nk) m[nk] = (m[nk] || 0) + 1;
    }));
  return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, limit).map(x => x[0]);
}

// ---------------------------------------------------------------------------
// Representative stratified sampling
// ---------------------------------------------------------------------------

/**
 * FNV-1a stable hash. Same input → same output, always.
 * Used to select reviews deterministically regardless of CSV row order.
 */
export function stableHash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Stable sort key derived from review_id (preferred) or content. */
export function sampleKey(d) {
  const basis = (d.review_id != null && d.review_id !== "")
    ? "id:" + d.review_id
    : "c:" + d.airline + "|" + d.sentiment + "|" + d.review;
  return stableHash(basis);
}

/** Sort an array of rows by their stable hash. Order-independent. */
function sortByKey(arr) {
  return arr.slice().sort((a, b) => {
    const ha = sampleKey(a), hb = sampleKey(b);
    return ha - hb || (a.review < b.review ? -1 : 1);
  });
}

/**
 * Largest-remainder proportional allocation.
 * Allocates `cap` slots across `groups`, proportional to sizeOf(group).
 * Returns Map(group → slots). Deterministic; never exceeds cap or group size.
 */
export function largestRemainder(groups, cap, sizeOf, keyOf) {
  const total = groups.reduce((s, g) => s + sizeOf(g), 0);
  const alloc = new Map();
  let assigned = 0;
  const rema = [];

  groups.forEach(g => {
    const exact = total ? cap * sizeOf(g) / total : 0;
    const base  = Math.min(Math.floor(exact), sizeOf(g));
    alloc.set(g, base);
    assigned += base;
    rema.push([g, exact - Math.floor(exact)]);
  });

  let left = cap - assigned;
  rema.sort((a, b) => b[1] - a[1] || sizeOf(b[0]) - sizeOf(a[0]) || (keyOf(a[0]) < keyOf(b[0]) ? -1 : 1));
  for (let i = 0; i < rema.length && left > 0; i++) {
    const g = rema[i][0];
    if (alloc.get(g) < sizeOf(g)) { alloc.set(g, alloc.get(g) + 1); left--; }
  }
  return alloc;
}

/**
 * Within a sentiment stratum: proportional airline allocation + stable-hash
 * selection. Order-independent.
 */
function pickWithinSentiment(group, slots) {
  if (group.length <= slots) return sortByKey(group);

  const byAir = new Map();
  group.forEach(d => {
    (byAir.get(d.airline) || byAir.set(d.airline, []).get(d.airline)).push(d);
  });

  const airGroups = [...byAir.entries()]
    .map(([name, arr]) => { arr.__key = name; return arr; })
    .sort((a, b) => (a.__key < b.__key ? -1 : 1));

  const alloc = largestRemainder(airGroups, slots, g => g.length, g => g.__key);
  const out = [];
  airGroups.forEach(g => {
    const n = Math.min(alloc.get(g), g.length);
    if (n > 0) out.push(...sortByKey(g).slice(0, n));
  });
  return out.slice(0, slots);
}

/**
 * Draw a representative stratified sample of up to maxSize reviews.
 * Stratified by sentiment (explicit stable order) then by airline.
 * Selection is deterministic: same records → same review_ids regardless of
 * input row ordering.
 */
export function getRepresentativeSample(rows, maxSize = MAX_AI_SAMPLE) {
  if (rows.length <= maxSize) return rows.slice();

  // Explicit stable sentiment order — never relies on Object.keys() order.
  const bySent = new Map();
  rows.forEach(d => {
    (bySent.get(d.sentiment) || bySent.set(d.sentiment, []).get(d.sentiment)).push(d);
  });
  const sentGroups = VALID_SENTIMENTS
    .filter(s => bySent.has(s))
    .map(s => { const a = bySent.get(s); a.__key = s; return a; });

  // Guarantee ≥1 slot per present sentiment so minorities aren't dropped.
  const guaranteed = sentGroups.length;
  const rest       = Math.max(0, maxSize - guaranteed);
  const restAlloc  = largestRemainder(sentGroups, rest, g => g.length, g => g.__key);

  const out = []; let used = 0;
  sentGroups.forEach(g => {
    let slots = Math.min(1 + restAlloc.get(g), g.length);
    slots = Math.min(slots, maxSize - used);
    used += slots;
    out.push(...pickWithinSentiment(g, slots));
  });
  return out.slice(0, maxSize);
}
