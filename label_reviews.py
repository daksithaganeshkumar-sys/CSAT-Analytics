"""
label_reviews.py — reproducible Claude labeling pipeline.
========================================================
Reads raw airline reviews and, for EACH review, asks Claude to return a
structured label: sentiment + controlled categories + free-form keywords +
a one-sentence summary. Each response is validated against a schema before it
is written, so malformed output is retried or flagged — never silently treated
as a valid classification.

Provenance: this is a REPRODUCIBLE IMPLEMENTATION of the project's labeling
workflow. Its controlled taxonomy matches the 14 categories present in
reviews_final.csv, but it is not guaranteed to be the exact script version
that produced that file.

Pipeline stages:  raw CSV -> Claude -> schema validation -> reviews_labeled.jsonl
                  -> join back to raw rows on review_id -> reviews_final.csv

----------------------------------------------------------------------
BEFORE YOU RUN
----------------------------------------------------------------------
1. pip install -r requirements.txt
2. Get an API key at https://console.anthropic.com and export it (never hard-code):
      macOS/Linux:  export ANTHROPIC_API_KEY="sk-ant-..."
      Windows (PS): $env:ANTHROPIC_API_KEY="sk-ant-..."
3. Provide an input CSV with at least: review_id, Airline, Reviews.
4. First run with LIMIT=5 to eyeball the output; then set LIMIT=None for all rows.
"""

import os
import json
import time
import argparse
import pandas as pd
import anthropic

from prompts import build_system_prompt
from schemas import validate_label, ValidationError

# The client reads ANTHROPIC_API_KEY from the environment automatically.
# No key is ever written in this file.
client = anthropic.Anthropic()
SYSTEM = build_system_prompt()

MODEL = "claude-haiku-4-5-20251001"   # cheap + fast; sufficient for labeling
MAX_TOKENS = 400


# ----------------------------------------------------------------------
# THE ATOM: label ONE review, with retry + schema validation.
# ----------------------------------------------------------------------
def label_review(text, max_retries=4):
    """
    Return a validated label dict for one review, or an {"error": ...} marker.

    A malformed or invalid model response is retried a few times; if it never
    validates, we return an error marker so the row can be flagged and re-tried
    on a later run rather than silently entering the dataset.
    """
    last_err = None
    for attempt in range(max_retries):
        try:
            msg = client.messages.create(
                model=MODEL,
                max_tokens=MAX_TOKENS,
                system=SYSTEM,
                messages=[{"role": "user", "content": text}],
            )
            raw = msg.content[0].text.strip()
            if raw.startswith("```"):
                raw = raw.split("```")[1].removeprefix("json").strip()
            parsed = json.loads(raw)          # may raise JSONDecodeError
            return validate_label(parsed)     # may raise ValidationError

        except (anthropic.APIStatusError, anthropic.APIConnectionError) as e:
            # transient API problem -> exponential backoff, then retry
            wait = 2 ** attempt
            print(f"  API error ({e}); retrying in {wait}s...")
            time.sleep(wait)
            last_err = f"api_error: {e}"
        except json.JSONDecodeError as e:
            last_err = f"unparseable_json: {e}"   # retry: model may format correctly next time
        except ValidationError as e:
            last_err = f"schema_invalid: {e}"     # retry: model may conform next time

    return {"error": last_err or "gave_up_after_retries"}


# ----------------------------------------------------------------------
# THE LOOP: incremental writes + resumability.
# Only SUCCESSFUL rows count as done, so re-running retries just the failures.
# ----------------------------------------------------------------------
def run(input_csv, output_jsonl="reviews_labeled.jsonl", limit=None):
    df = pd.read_csv(input_csv)
    if limit:
        df = df.head(limit)

    required = {"review_id", "Airline", "Reviews"}
    missing = required - set(df.columns)
    if missing:
        raise SystemExit(f"Input CSV is missing required column(s): {sorted(missing)}")

    done = set()
    if os.path.exists(output_jsonl):
        with open(output_jsonl) as f:
            for line in f:
                rec = json.loads(line)
                if "error" not in rec:
                    done.add(rec["review_id"])
    print(f"{len(done)} already labeled; {len(df) - len(done)} to go.")

    with open(output_jsonl, "a") as f:
        for i, row in df.iterrows():
            rid = int(row["review_id"])
            if rid in done:
                continue
            result = label_review(str(row["Reviews"]))
            result["review_id"] = rid
            f.write(json.dumps(result) + "\n")
            f.flush()                          # persist progress immediately
            if (i + 1) % 25 == 0:
                print(f"  ...{i + 1} processed")
    print("Done labeling.")


# ----------------------------------------------------------------------
# JOIN: merge validated labels back onto the raw rows by review_id.
# Lists are pipe-joined so they survive a flat CSV (matching the dashboard).
# ----------------------------------------------------------------------
def build_final_table(input_csv, labels_jsonl="reviews_labeled.jsonl",
                      out_csv="reviews_final.csv"):
    base = pd.read_csv(input_csv)
    labels = pd.read_json(labels_jsonl, lines=True)
    labels = labels.drop_duplicates(subset="review_id", keep="last")  # newest attempt wins

    for col in ("categories", "keywords"):
        if col in labels:
            labels[col] = labels[col].apply(
                lambda v: " | ".join(v) if isinstance(v, list) else ""
            )

    merged = base.merge(labels, on="review_id", how="left")
    merged.to_csv(out_csv, index=False)
    n_err = int(merged["error"].notna().sum()) if "error" in merged else 0
    print(f"Wrote {out_csv} with {len(merged)} rows ({n_err} flagged for review).")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Label airline reviews with Claude.")
    ap.add_argument("--input", default="reviews_to_process.csv",
                    help="CSV with review_id, Airline, Reviews")
    ap.add_argument("--limit", type=int, default=5,
                    help="Rows to process (use 0 for all). Start small to sanity-check.")
    args = ap.parse_args()
    limit = None if args.limit == 0 else args.limit
    run(args.input, limit=limit)
    build_final_table(args.input)
