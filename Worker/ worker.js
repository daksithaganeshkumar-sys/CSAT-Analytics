/**
 * worker.js — Cloudflare Worker proxy that keeps the Anthropic API key secret.
 * ===========================================================================
 * The public dashboard cannot hold the key (anyone could read it from page
 * source), so the browser calls this instead. This runs on Cloudflare, reads
 * the key from a secret (env.ANTHROPIC_API_KEY — never written in this file),
 * calls Claude, and returns only the text.
 *
 *   Flow:  browser  ->  this Worker (has the key)  ->  Anthropic  ->  back
 *
 * SETUP (Cloudflare dashboard, no terminal needed):
 *   1. Create a Worker, paste this whole file in, Deploy.
 *   2. Settings -> Variables and Secrets -> add a SECRET named
 *      ANTHROPIC_API_KEY with your sk-ant-... key. Deploy again.
 *   3. Copy the Worker URL into WORKER_URL in the dashboard (index.html).
 *
 * PAYLOAD CONTRACT (P0.5): the dashboard sends deterministic aggregate stats
 * computed over the FULL current selection, PLUS a representative stratified
 * sample of review texts. The prompt below tells Claude to treat these
 * differently — counts come from aggregates, not from the sample — so the
 * model never implies it read every selected review.
 */

const ALLOWED_ORIGIN = "https://daksithaganeshkumar-sys.github.io";

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "POST") return json({ error: "Send a POST request." }, 405, cors);

    try {
      const body = await request.json();
      const selection = body.selection || {};
      const sampleObj = body.sample || {};
      const sampleReviews = Array.isArray(sampleObj.reviews) ? sampleObj.reviews : [];
      const filters = body.filters || "the current selection";

      // Backward-compatible fallback: if an old client still sends {reviews:[...]}
      // treat those as the sample and skip aggregates.
      const legacy = !body.selection && Array.isArray(body.reviews) ? body.reviews : null;
      const sample = (legacy || sampleReviews)
        .slice(0, 80)
        .map((r, i) => `${i + 1}. [${r.sentiment || "?"}${r.airline ? ", " + r.airline : ""}] ${String(r.text || "").slice(0, 500)}`)
        .join("\n");

      const stats = legacy ? null : JSON.stringify(selection, null, 2);

      const prompt = buildPrompt({ filters, stats, sample, sampleSize: (legacy || sampleReviews).length, total: selection.total_reviews });

      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 600,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      const data = await resp.json();
      if (!resp.ok) return json({ error: data.error?.message || "Anthropic error" }, 502, cors);

      let text = (data.content?.[0]?.text || "").replace(/```json|```/g, "").trim();
      let parsed = null;
      try { parsed = JSON.parse(text); } catch (_) {}
      if (parsed && (parsed.praise || parsed.mood || parsed.complaints)) {
        return json({ sections: parsed }, 200, cors);
      }
      return json({ summary: text || "No summary returned." }, 200, cors);
    } catch (e) {
      return json({ error: String(e) }, 500, cors);
    }
  },
};

function buildPrompt({ filters, stats, sample, sampleSize, total }) {
  // P0.6: explicit separation of population aggregates vs qualitative sample,
  // with anti-hallucination / anti-overclaim constraints.
  const header =
    `You are a customer-feedback analyst summarising airline reviews for the selection: ${filters}.\n\n`;

  const evidence = stats
    ? `AGGREGATE METRICS — these are computed deterministically over ALL ${total} reviews in the selection. ` +
      `Treat every count, percentage, and ranking here as ground truth for the whole population:\n${stats}\n\n` +
      `REPRESENTATIVE SAMPLE — the following ${sampleSize} review excerpts were drawn by stratified sampling ` +
      `(by sentiment and airline) to illustrate the aggregate metrics. They are a QUALITATIVE sample, ` +
      `not the full population. Use them for themes, wording, and examples only:\n${sample}\n\n`
    : `REVIEW EXCERPTS (sample):\n${sample}\n\n`;

  const rules =
    `RULES:\n` +
    `- Base all counts, frequencies, and rankings on the AGGREGATE METRICS, never on the sample size.\n` +
    `- Do NOT claim or imply you read every review; you read aggregates plus a representative sample.\n` +
    `- Use only information supported by the metrics and excerpts. Do not invent statistics or facts.\n` +
    `- Do not claim causality or trends over time (no temporal data is provided).\n\n`;

  const format =
    `Reply with ONLY a JSON object (no markdown, no backticks) in exactly this shape:\n` +
    `{"mood":"one sentence on overall sentiment, grounded in the aggregate percentages",` +
    `"praise":"1-2 sentences on what customers value, tied to top topics/keywords",` +
    `"complaints":"1-2 sentences on the main pain points, tied to the evidence"}`;

  return header + evidence + rules + format;
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}
