# AI Customer Feedback Analytics

An AI-assisted analytics pipeline that turns thousands of open-ended airline
reviews into **structured sentiment, topics, keywords, and summaries**, then
makes those insights explorable through an interactive dashboard with an
optional live AI synthesis layer.

> This project analyzes airline **customer reviews and sentiment**. It does not
> compute a traditional CSAT survey score, and sentiment percentages here are
> not CSAT.

**Live demo:** https://daksithaganeshkumar-sys.github.io/CSAT-Analytics/

`~8,100 reviews` · `10 airlines` · `AI-labeled` · `Interactive dashboard`

---

## Problem

Airlines and analysts sit on huge volumes of unstructured written feedback.
Reading thousands of reviews by hand is slow, inconsistent, and doesn't
aggregate — you can't easily answer "what are the top pain points for Airline X"
or "how does sentiment compare across carriers." This project uses an LLM to
convert free text into consistent, structured labels, then applies ordinary
deterministic analytics on top so the results are fast, cheap, and repeatable.

## Architecture

```
Raw reviews (CSV)
      |
      v
Claude labeling (one structured JSON label per review)
      |
      v
Schema validation (reject/retry malformed output)
      |
      v
Structured labeled dataset (reviews_final.csv)
      |
      v
Deterministic analytics (filtering, %s, topic/keyword aggregation)
      |
      v
Optional live Claude synthesis (aggregates + representative sample)
```

## What the AI does vs. what normal code does

A deliberate design choice in this project is separating **cheap, reliable
deterministic analytics** from **higher-cost generative synthesis**.

**AI (offline labeling, `pipeline/`)** — Claude reads each raw review once and
returns a validated JSON label: `sentiment`, controlled `categories`, free-form
`keywords`, and a one-sentence `summary`. This is where unstructured text
becomes structured data.

**AI (live synthesis, `worker/`)** — the "Ask AI" button sends Claude
**aggregate statistics computed over the entire current selection** plus a
**representative stratified sample** of review texts, and asks for a short
qualitative summary. Claude is explicitly told the aggregates cover the whole
selection and the excerpts are only a sample, so it does not imply it read every
review.

**Normal deterministic code (the dashboard)** — everything numeric is plain
JavaScript over the labeled data: filtering by airline/sentiment, sentiment
percentages, topic aggregation, keyword aggregation, and airline comparisons.
No model call is involved in any chart or count.

## Features

- Filter by airline (multi-select) and by sentiment.
- Overall sentiment baseline for the selected airlines.
- Top topics (controlled-category aggregation across the selection).
- Keyword bar chart and an optional word-cloud view.
- Browsable review list with each review's AI summary.
- **Instant insights** — deterministic summary from the pre-generated labels.
- **Ask AI about this view** — live Claude synthesis from aggregates + a sample.
- Load the bundled dataset automatically, or upload your own CSV.

## Reliability and validation

- **Controlled labels.** Categories come from a fixed 14-item taxonomy
  (`pipeline/schemas.py`), which keeps topic aggregation consistent.
- **Structured outputs.** Every model response is parsed as JSON and validated
  against a schema (`validate_label`) before it is accepted.
- **Invalid-output handling.** Malformed or out-of-vocabulary responses are
  retried; if they still don't validate, the row is flagged with an error marker
  rather than silently entering the analytics.
- **Explicit invalid sentiment.** In the dashboard, an unrecognized sentiment
  value becomes an explicit `invalid` state and is excluded from percentages —
  it is never coerced into `mixed`.
- **Representative sampling.** The live AI layer samples reviews stratified by
  sentiment and airline (not the first N rows), so the qualitative sample isn't
  biased by file order.

## Evaluation

A human-labeled evaluation workflow is being added to benchmark the AI
classifications against manually reviewed ground truth. **No accuracy figures
are claimed yet** — this section will be updated once that evaluation has
actually been run.

## Security

- **API credentials stay server-side.** The Anthropic key is never in the
  frontend; the browser calls a Cloudflare Worker that holds the key as an
  environment secret (`env.ANTHROPIC_API_KEY`) and proxies the request.
- **No secrets in the repo.** Pipeline and Worker read the key from the
  environment; nothing is hard-coded.
- **Safe rendering of untrusted CSV.** Because users can upload their own CSV,
  dataset-derived text is rendered via `textContent` / DOM nodes rather than
  interpolated into HTML, so review/keyword/category text cannot execute script.
- **Schema validation** guards against malformed labels entering analytics.

## Dataset

Approximately **8,100 airline reviews across 10 airlines** (Air France, All
Nippon Airways, Cathay Pacific, EVA Air, Emirates, Japan Airlines, Korean Air,
Qatar Airways, Singapore Airlines, Turkish Airlines). Each row carries the
original review text plus AI-generated `sentiment`, `categories`, `keywords`,
and `summary`. The processed dataset does **not** contain a reliable date field,
so no time-series analysis is provided (see Limitations).

> Dataset attribution: the reviews originate from a public airline-review
> dataset. Add the specific source/link and its license here before sharing
> publicly.

## Limitations

- **Labels are LLM-generated** and have not yet been formally evaluated against
  human ground truth (evaluation workflow pending).
- **No temporal data** in the processed dataset, so trend/over-time analysis is
  intentionally omitted rather than fabricated.
- **Free-form keywords are fragmented** ("flight delay", "delayed flight",
  "2-hour delay" are distinct); the controlled category layer is the reliable
  aggregation signal, keywords are for discovery.
- **Live AI synthesis is sample-based** for the qualitative portion — it reads
  aggregate metrics over the full selection plus a representative text sample,
  not every selected review.

## Running locally

**Dashboard** (static — no build step):

```bash
# from the repo root
python3 -m http.server 8000
# open http://localhost:8000
```

The dashboard auto-loads `reviews_final.csv`. To analyze your own data, use the
upload option (CSV with `Airline`, `Reviews`, `sentiment`, and optionally
`categories`, `keywords`, `summary`).

**Labeling pipeline** (to reproduce the labels):

```bash
cd pipeline
pip install -r requirements.txt
export ANTHROPIC_API_KEY="sk-ant-..."      # never commit this
python label_reviews.py --input reviews_to_process.csv --limit 5   # test on 5
python label_reviews.py --input reviews_to_process.csv --limit 0   # all rows
```

**Live AI Worker** (optional): deploy `worker/worker.js` to Cloudflare Workers,
set `ANTHROPIC_API_KEY` as a Worker secret, and put the Worker URL in
`WORKER_URL` near the top of `index.html`.

## Repository structure

```
CSAT-Analytics/
├── README.md
├── index.html              # the dashboard (single-file frontend + inlined libs)
├── reviews_final.csv       # labeled dataset the dashboard loads
├── pipeline/               # reproducible Claude labeling workflow
│   ├── label_reviews.py    # main loop: label -> validate -> write -> join
│   ├── prompts.py          # classification/summarization prompt
│   ├── schemas.py          # controlled taxonomy + output validation
│   └── requirements.txt
└── worker/
    └── worker.js           # Cloudflare Worker proxy for the live AI layer
```

## A note on provenance

The files in `pipeline/` are a **reproducible implementation of the project's
labeling workflow**. They match the taxonomy and output schema present in
`reviews_final.csv`, but are not guaranteed to be the exact script version that
originally produced that file.

This project uses an LLM as part of an analytics pipeline. It does **not**
involve training a custom NLP/ML model.
