# AI Customer Feedback Analytics

An AI-assisted analytics pipeline that transforms ~8,100 open-ended airline
reviews into **structured sentiment, topics, keywords, and summaries** — then
makes the results explorable through an interactive dashboard with an optional
live AI synthesis layer.

> This project analyzes customer reviews and sentiment. It does **not** compute
> a traditional CSAT survey score, and sentiment percentages here are not CSAT.

**Live demo:** https://ai-customer-feedback-analytics-hwmpvt8c5pao4gtsj6vdq3.streamlit.app/

`~8,100 reviews` · `10 airlines` · `AI-labeled` · `Interactive dashboard`

---

## Problem

Airlines collect huge volumes of unstructured customer feedback. Reading
thousands of reviews by hand is slow and inconsistent, and it makes it hard to
reliably identify recurring issues or compare sentiment across carriers. This
project uses an LLM to convert free text into consistent structured labels, then
runs ordinary deterministic analytics on top — so the results are fast, cheap,
and repeatable.

## Architecture

```
Raw customer reviews (CSV)
        |
        v
Claude labeling  (one structured JSON label per review)
        |
        v
Schema validation  (reject / retry malformed output)
        |
        v
Structured labeled dataset  (reviews_final.csv)
        |
        v
Deterministic analytics dashboard  (filters, %s, topic/keyword counts)
        |
        v
Optional live Claude synthesis  (full-selection aggregates + representative stratified sample)
```

## What the AI does vs. what normal code does

Separating **cheap, reliable deterministic analytics** from **higher-cost
generative synthesis** is a deliberate design choice in this project.

**Offline AI labeling (`pipeline/`).** Claude reads each raw review once and
returns a validated JSON label — `sentiment`, controlled `categories`, free-form
`keywords`, and a one-sentence `summary`. This is where unstructured text becomes
structured data.

**Deterministic analytics (the dashboard).** Everything numeric is plain
JavaScript over the labeled data: filtering by airline/sentiment, sentiment
percentages, topic aggregation, keyword aggregation, and airline comparisons. No
model call is involved in any chart or count.

**Live AI synthesis (`worker/`).** The "Ask AI" button sends Claude **aggregate
statistics computed over the entire current selection** plus a **representative
stratified sample** of review texts. Claude is explicitly told the aggregates
cover the whole selection and the excerpts are only a sample, so it does not
imply it read every review.

## Features

- Filter by airline (multi-select) and by sentiment.
- Overall sentiment baseline for the selected airlines.
- Top topics (controlled-category aggregation across the selection).
- Keyword bar chart and an optional word-cloud view.
- Browsable review list, each with its AI summary.
- **Instant insights** — deterministic summary from the pre-generated labels.
- **Ask AI about this view** — live Claude synthesis from aggregates + a sample.
- Auto-loads the bundled dataset, or analyze your own uploaded CSV.

## Reliability and validation

- **Controlled labels.** Categories come from a fixed 14-item taxonomy defined in
  `pipeline/schemas.py`, which keeps topic aggregation consistent.
- **Structured outputs.** Every model response is parsed as JSON and validated
  against a schema (`validate_label` in `pipeline/schemas.py`) before it is
  accepted.
- **Retries for malformed output.** Unparseable or out-of-vocabulary responses
  are retried; if they still don't validate, the row is flagged with an error
  marker rather than silently entering the analytics.
- **Explicit invalid sentiment.** In the dashboard, an unrecognized sentiment
  value becomes an explicit `invalid` state and is excluded from percentages — it
  is never coerced into `mixed`.
- **Representative stratified sampling.** For the live AI layer, Claude receives
  aggregate metrics across the full selected dataset plus a **representative
  stratified sample of up to 60 review texts** (stratified by sentiment and
  airline). Selection is deterministic and independent of CSV row order (it ranks
  records by a stable hash of `review_id`), so it isn't biased by file order. The
  60 texts provide qualitative context; they are not used to estimate the
  population percentages, which are computed deterministically over the full
  selection.

## Evaluation

The project includes a reproducible cross-model evaluation in `evaluation/`.
Claude's sentiment and category classifications are compared against independently
generated ChatGPT labels to measure agreement. The evaluation framework also
includes an LLM-as-a-judge rubric for summary faithfulness, main-point coverage,
and unsupported information, but **summary scoring was not completed in the
current run** (the summary columns were left blank).

**Current result — cross-model agreement (Claude vs. ChatGPT), not
human-ground-truth accuracy.** On a stratified 150-review sample:

- **Sentiment: 92.7% cross-model agreement** (macro-F1 0.897). Agreement is
  strongest on positive/negative; `mixed` is the hardest class (F1 0.784).
- **Categories (multi-label): micro-F1 0.897**, exact-match 0.460. Per-tag
  agreement is high; the models most often differ on a single tag. Lowest-agreement
  categories: *Value for Money* (recall 0.421) and *Cabin Condition* (F1 0.714).

**Important:** ChatGPT is an independent *model* evaluator, not human ground
truth. Both models may share biases, and high agreement does not guarantee factual
correctness. This measures **cross-model consistency, not human-validated
accuracy** — independent human annotation would be a stronger next validation step.
Full numbers and methodology are in
[`evaluation/results.md`](evaluation/results.md).

## Security

- **API credentials stay server-side.** The Anthropic key is never in the
  browser. The frontend calls a Cloudflare Worker (`worker/worker.js`) that holds
  the key as an environment secret (`env.ANTHROPIC_API_KEY`) and proxies the
  request to Claude. The Worker's URL is configured in the `WORKER_URL` constant
  near the top of `index.html`.
- **No secrets in the repo.** Pipeline and Worker both read the key from the
  environment; nothing is hard-coded.
- **Safe rendering of untrusted CSV.** Because users can upload their own file,
  dataset-derived text is rendered via `textContent` / DOM nodes rather than
  interpolated into HTML, so review/keyword/category text cannot execute script.
- **Schema validation** guards against malformed labels entering the analytics.

## Dataset

Approximately **8,100 airline reviews across 10 airlines** (Air France, All
Nippon Airways, Cathay Pacific, EVA Air, Emirates, Japan Airlines, Korean Air,
Qatar Airways, Singapore Airlines, Turkish Airlines). Each row carries the
original review text plus AI-generated `sentiment`, `categories`, `keywords`, and
`summary`. The processed dataset does not contain a reliable date field, so no
time-series analysis is provided (see Limitations).

> The processed data is derived from a publicly available airline-review dataset
> (Skytrax / AirlineQuality-style reviews). Exact source attribution and license
> will be added once the original dataset reference is confirmed.

## Limitations

- **Labels are LLM-generated** and have so far been checked only via a
  cross-model agreement study (Claude vs. ChatGPT), not against human ground
  truth; independent human annotation is the planned next validation step.
- **No temporal data** in the processed dataset, so trend/over-time analysis is
  intentionally omitted rather than fabricated.
- **Free-form keywords are fragmented** ("flight delay", "delayed flight",
  "2-hour delay" are distinct terms); the controlled category layer is the
  reliable aggregation signal, keywords are for discovery.
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
upload option (a CSV with `Airline`, `Reviews`, `sentiment`, and optionally
`categories`, `keywords`, `summary`).

**Labeling pipeline** (to reproduce the labels):

```bash
cd pipeline
pip install -r requirements.txt
export ANTHROPIC_API_KEY="sk-ant-..."          # never commit this

# --input takes a CSV with review_id, Airline, Reviews.
# --limit N processes N rows; --limit 0 processes all rows.
python label_reviews.py --input ../reviews_to_process.csv --limit 5    # test on 5
python label_reviews.py --input ../reviews_to_process.csv --limit 0    # all rows
```

> Note: the pipeline expects a raw input file (`review_id, Airline, Reviews`).
> `reviews_final.csv` in this repo is the labeled *output*; the raw input is not
> committed.

**Evaluation** (cross-model agreement with ChatGPT; supports human labeling next):

```bash
cd evaluation
python create_evaluation_sample.py --input ../reviews_final.csv --n 150 --seed 42
# For the reported cross-model run: reference labels in human_labeling_sample.csv
# were generated independently with ChatGPT (outside the repo — no automated
# ChatGPT-labeling script exists here). For a future human-annotation pass,
# fill human_sentiment and human_categories manually before running:
python evaluate_labels.py
```

**Live AI Worker** (optional): deploy `worker/worker.js` to Cloudflare Workers,
set `ANTHROPIC_API_KEY` as a Worker secret, and put the Worker URL in
`WORKER_URL` near the top of `index.html`.

## Repository structure

```
ai-customer-feedback-analytics/
├── README.md
├── index.html              # dashboard (single-file frontend + inlined libs)
├── reviews_final.csv       # labeled dataset the dashboard loads
│
├── pipeline/               # reproducible Claude labeling workflow
│   ├── label_reviews.py    # main loop: label -> validate -> write -> join
│   ├── prompts.py          # classification/summarization prompt
│   ├── schemas.py          # controlled taxonomy + output validation
│   └── requirements.txt
│
├── worker/
│   └── worker.js           # Cloudflare Worker proxy for the live AI layer
│
└── evaluation/             # cross-model (Claude-vs-ChatGPT) evaluation workflow
    ├── create_evaluation_sample.py
    ├── evaluate_labels.py
    ├── LABELING_GUIDE.md
    ├── human_labeling_sample.csv   # blank ground-truth columns, ready to label
    └── ai_predictions.csv          # AI labels for the same rows, kept aside
```

## A note on provenance

The files in `pipeline/` are a **reproducible implementation of the project's
labeling workflow**. They match the taxonomy and output schema present in
`reviews_final.csv`, but are not guaranteed to be the exact script version that
originally produced that file.

This project uses an LLM as part of an analytics pipeline. It does **not** involve
training a custom NLP/ML model.
