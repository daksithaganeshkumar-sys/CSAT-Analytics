"""
create_evaluation_sample.py
===========================
Draw a reproducible, stratified evaluation sample and split it into TWO files:

  human_labeling_sample.csv   -> what you fill in. Human-label columns are BLANK
                                 and come FIRST; the AI's answers are NOT in this
                                 file, so you label without seeing them (blinded).
  evaluation_predictions.csv  -> the AI's labels for the same review_ids, kept
                                 aside. evaluate_labels.py joins the two on review_id.

Sampling is stratified by (ai_sentiment x airline) using a fixed seed, so the
sample isn't dominated by one class or one carrier and is fully reproducible.

Note on methodology: stratification uses the AI's *own* sentiment labels for
COVERAGE only (so each class is represented). This does not copy AI labels into
the ground truth and does not bias per-class scoring, but it is documented as a
limitation in LABELING_GUIDE.md / results.md.

Usage:
  python create_evaluation_sample.py --size 150 --seed 42 --input ../reviews_final.csv
"""

import argparse
import csv
import random
from collections import defaultdict

# Columns the human fills in (blank), placed FIRST for blind labeling.
HUMAN_COLUMNS = [
    "human_sentiment",                      # positive | negative | mixed
    "human_categories",                     # pipe-separated, exact taxonomy labels
    "summary_faithful",                     # 1 = yes, 0 = no
    "summary_captures_main_point",          # 1 = yes, 0 = no
    "summary_has_unsupported_information",  # 1 = yes (bad), 0 = no (good)
    "reviewer_notes",                       # free text, optional
]


def stratified_sample(rows, size, seed):
    """Allocate the sample across (sentiment, airline) strata proportional to
    each stratum's share of the data, with a reproducible seed."""
    rng = random.Random(seed)
    strata = defaultdict(list)
    for r in rows:
        strata[(r.get("sentiment", ""), r.get("Airline", ""))].append(r)

    total = len(rows)
    keys = sorted(strata)                       # deterministic order (not dict order)
    picked, allocated = [], 0
    for i, k in enumerate(keys):
        group = strata[k]
        if i == len(keys) - 1:
            slots = size - allocated            # last stratum absorbs the remainder
        else:
            slots = round(size * len(group) / total)
        slots = max(0, min(slots, len(group)))
        allocated += slots
        picked.extend(rng.sample(group, slots))
    rng.shuffle(picked)
    return picked[:size]


def main():
    ap = argparse.ArgumentParser(description="Create a blinded evaluation sample.")
    ap.add_argument("--input", default="../reviews_final.csv",
                    help="labeled CSV with review_id, Airline, Reviews, sentiment, categories, summary")
    ap.add_argument("--size", type=int, default=150, help="target sample size")
    ap.add_argument("--seed", type=int, default=42, help="reproducible random seed")
    args = ap.parse_args()

    with open(args.input, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    sample = stratified_sample(rows, args.size, args.seed)

    # 1) Blinded human-labeling file: review context + BLANK human columns first.
    #    Deliberately does NOT include the AI's sentiment/categories/summary,
    #    so the annotator can't be anchored by them.
    label_cols = ["review_id", "Airline", "Reviews"] + HUMAN_COLUMNS
    with open("human_labeling_sample.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=label_cols)
        w.writeheader()
        for r in sample:
            row = {c: "" for c in label_cols}
            row["review_id"] = r["review_id"]
            row["Airline"] = r["Airline"]
            row["Reviews"] = r["Reviews"]
            w.writerow(row)

    # 2) Prediction file kept aside: AI outputs for the same review_ids.
    pred_cols = ["review_id", "ai_sentiment", "ai_categories", "ai_summary"]
    with open("evaluation_predictions.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=pred_cols)
        w.writeheader()
        for r in sample:
            w.writerow({
                "review_id": r["review_id"],
                "ai_sentiment": r.get("sentiment", ""),
                "ai_categories": r.get("categories", ""),
                "ai_summary": r.get("summary", ""),
            })

    print(f"Wrote human_labeling_sample.csv  ({len(sample)} rows, human columns blank).")
    print(f"Wrote evaluation_predictions.csv ({len(sample)} rows, AI labels kept aside).")
    print("Label the human_* columns (do NOT open the predictions file), then run evaluate_labels.py.")


if __name__ == "__main__":
    main()
