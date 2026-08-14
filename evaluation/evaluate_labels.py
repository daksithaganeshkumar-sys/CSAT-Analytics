"""
evaluate_labels.py
==================
Compare Claude's predicted labels against human ground truth and report metrics.
Reads:
  human_labeling_sample.csv  (gt_sentiment, gt_categories filled in by a human)
  ai_predictions.csv         (Claude's sentiment, categories for the same rows)

Reports:
  Sentiment: accuracy, per-class precision/recall/F1, macro-F1, confusion matrix.
  Categories (multi-label): micro P/R/F1, macro P/R/F1, exact-match accuracy,
                            per-category P/R/F1.

No numbers are hard-coded anywhere; everything is computed from the two files.
If ground-truth rows are still blank, the script says so and stops — it will
not invent results.

Usage:
  python evaluate_labels.py
"""

import csv
from collections import defaultdict

SENTIMENTS = ["positive", "negative", "mixed"]


def load(path):
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def split_cats(s):
    return {c.strip() for c in (s or "").split("|") if c.strip()}


def prf(tp, fp, fn):
    p = tp / (tp + fp) if (tp + fp) else 0.0
    r = tp / (tp + fn) if (tp + fn) else 0.0
    f = 2 * p * r / (p + r) if (p + r) else 0.0
    return p, r, f


def evaluate_sentiment(pairs):
    """pairs: list of (gt, pred) sentiment strings."""
    n = len(pairs)
    correct = sum(1 for gt, pr in pairs if gt == pr)
    print(f"\n=== SENTIMENT ({n} labeled rows) ===")
    print(f"Accuracy: {correct}/{n} = {correct / n:.3f}")

    # confusion matrix
    labels = SENTIMENTS
    cm = {g: {p: 0 for p in labels} for g in labels}
    for gt, pr in pairs:
        if gt in cm and pr in cm[gt]:
            cm[gt][pr] += 1
    print("\nConfusion matrix (rows = truth, cols = predicted):")
    print("            " + "".join(f"{p[:8]:>10}" for p in labels))
    for g in labels:
        print(f"{g:>10}  " + "".join(f"{cm[g][p]:>10}" for p in labels))

    # per-class precision/recall/F1
    print("\nPer-class:")
    macro = []
    for c in labels:
        tp = sum(1 for gt, pr in pairs if gt == c and pr == c)
        fp = sum(1 for gt, pr in pairs if gt != c and pr == c)
        fn = sum(1 for gt, pr in pairs if gt == c and pr != c)
        p, r, f = prf(tp, fp, fn)
        macro.append(f)
        print(f"  {c:>9}  P={p:.3f}  R={r:.3f}  F1={f:.3f}")
    print(f"Macro-F1: {sum(macro) / len(macro):.3f}")


def evaluate_categories(rows):
    """rows: list of (gt_set, pred_set) for each labeled review."""
    n = len(rows)
    print(f"\n=== CATEGORIES — multi-label ({n} labeled rows) ===")

    # micro (pool all label decisions)
    micro_tp = micro_fp = micro_fn = 0
    exact = 0
    per_cat = defaultdict(lambda: [0, 0, 0])  # cat -> [tp, fp, fn]
    for gt, pred in rows:
        if gt == pred:
            exact += 1
        for c in pred & gt:
            micro_tp += 1; per_cat[c][0] += 1
        for c in pred - gt:
            micro_fp += 1; per_cat[c][1] += 1
        for c in gt - pred:
            micro_fn += 1; per_cat[c][2] += 1

    mp, mr, mf = prf(micro_tp, micro_fp, micro_fn)
    print(f"Micro  P={mp:.3f}  R={mr:.3f}  F1={mf:.3f}")

    # macro (average per-category F1)
    macro_f = []
    for c, (tp, fp, fn) in per_cat.items():
        _, _, f = prf(tp, fp, fn)
        macro_f.append(f)
    if macro_f:
        print(f"Macro  F1={sum(macro_f) / len(macro_f):.3f}  (over {len(macro_f)} categories seen)")
    print(f"Exact-match accuracy: {exact}/{n} = {exact / n:.3f}")

    print("\nPer-category:")
    for c in sorted(per_cat):
        tp, fp, fn = per_cat[c]
        p, r, f = prf(tp, fp, fn)
        print(f"  {c:<28} P={p:.3f}  R={r:.3f}  F1={f:.3f}  (support={tp + fn})")


def main():
    human = {r["review_id"]: r for r in load("human_labeling_sample.csv")}
    preds = {r["review_id"]: r for r in load("ai_predictions.csv")}

    # only rows where a human actually filled in ground truth
    labeled = [rid for rid, r in human.items() if (r.get("gt_sentiment") or "").strip()]
    if not labeled:
        print("No ground-truth labels found yet.")
        print("Fill gt_sentiment (and gt_categories) in human_labeling_sample.csv, then re-run.")
        return

    print(f"Evaluating {len(labeled)} of {len(human)} sampled rows that have ground truth.")

    sent_pairs = []
    cat_rows = []
    for rid in labeled:
        h, p = human[rid], preds.get(rid, {})
        gt_s = h["gt_sentiment"].strip().lower()
        pr_s = (p.get("sentiment") or "").strip().lower()
        sent_pairs.append((gt_s, pr_s))
        # categories only evaluated if the annotator supplied them
        if (h.get("gt_categories") or "").strip():
            cat_rows.append((split_cats(h["gt_categories"]), split_cats(p.get("categories"))))

    evaluate_sentiment(sent_pairs)
    if cat_rows:
        evaluate_categories(cat_rows)
    else:
        print("\n(No gt_categories provided — skipping category metrics.)")


if __name__ == "__main__":
    main()
