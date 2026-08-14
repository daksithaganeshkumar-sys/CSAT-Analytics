"""
create_evaluation_sample.py
===========================
Draw a reproducible, stratified sample of labeled reviews and export a
human-labeling file. The AI's predicted labels are kept in a *separate*
prediction file (keyed by review_id); the labeling file the human fills in
has BLANK ground-truth columns, so the annotator is not anchored by Claude's
answer while labeling.

Outputs:
  human_labeling_sample.csv   -> annotator fills sentiment/categories (blank)
  ai_predictions.csv          -> Claude's labels for the same review_ids (kept aside)

Usage:
  python create_evaluation_sample.py --input ../reviews_final.csv --n 150 --seed 42
"""

import argparse
import csv
import random
from collections import defaultdict

# Ground-truth columns the human fills in. Kept blank in the labeling file.
GT_COLUMNS = ["gt_sentiment", "gt_categories"]


def stratified_sample(rows, n, seed):
    """Sample n rows, allocating slots to each sentiment proportional to its
    share of the dataset, with a reproducible seed."""
    rng = random.Random(seed)
    by_sent = defaultdict(list)
    for r in rows:
        by_sent[r.get("sentiment", "")].append(r)

    total = len(rows)
    picked = []
    keys = sorted(by_sent)  # deterministic order (not dict insertion order)
    allocated = 0
    for i, s in enumerate(keys):
        group = by_sent[s]
        if i == len(keys) - 1:
            slots = n - allocated                      # last group absorbs remainder
        else:
            slots = round(n * len(group) / total)
        slots = max(0, min(slots, len(group)))
        allocated += slots
        picked.extend(rng.sample(group, slots))
    rng.shuffle(picked)
    return picked


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", default="../reviews_final.csv")
    ap.add_argument("--n", type=int, default=150, help="sample size (100-200 recommended)")
    ap.add_argument("--seed", type=int, default=42, help="reproducible seed")
    args = ap.parse_args()

    with open(args.input, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    sample = stratified_sample(rows, args.n, args.seed)

    # Human labeling file: review context + BLANK ground-truth columns.
    label_cols = ["review_id", "Airline", "Reviews"] + GT_COLUMNS
    with open("human_labeling_sample.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=label_cols)
        w.writeheader()
        for r in sample:
            w.writerow({
                "review_id": r["review_id"],
                "Airline": r["Airline"],
                "Reviews": r["Reviews"],
                "gt_sentiment": "",          # human fills: positive|negative|mixed
                "gt_categories": "",         # human fills: pipe-separated, e.g. "Baggage | Delays & Punctuality"
            })

    # AI predictions file: kept separate so it can't anchor the annotator.
    pred_cols = ["review_id", "sentiment", "categories"]
    with open("ai_predictions.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=pred_cols)
        w.writeheader()
        for r in sample:
            w.writerow({
                "review_id": r["review_id"],
                "sentiment": r.get("sentiment", ""),
                "categories": r.get("categories", ""),
            })

    print(f"Wrote human_labeling_sample.csv ({len(sample)} rows, blank ground truth).")
    print(f"Wrote ai_predictions.csv ({len(sample)} rows, AI labels kept aside).")
    print("Next: fill gt_sentiment and gt_categories in human_labeling_sample.csv,")
    print("      then run evaluate_labels.py.")


if __name__ == "__main__":
    main()
