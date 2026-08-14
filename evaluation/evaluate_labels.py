"""
evaluate_labels.py
==================
Benchmark the AI labels against human ground truth. Joins the two files created
by create_evaluation_sample.py on review_id and reports:

  SENTIMENT (single-label):
    - accuracy
    - per-class precision / recall / F1 (positive, negative, mixed)
    - macro and weighted F1
    - confusion matrix
  CATEGORIES (multi-label, pipe-delimited):
    - micro / macro / weighted precision, recall, F1
    - exact-match (subset) accuracy
    - per-category report
  SUMMARY RUBRIC (only if the human filled the rubric columns):
    - % faithful, % captures main point, % free of unsupported info, % pass-all

It also writes:
  disagreements.csv  -> every row where AI and human sentiment differ
  results.md         -> a copy-pasteable results report

No numbers are hard-coded. If the human columns are still blank, the script
says so and stops rather than inventing results.

Usage:
  python evaluate_labels.py
"""

import csv
import sys

try:
    from sklearn.metrics import (
        accuracy_score, precision_recall_fscore_support,
        classification_report, confusion_matrix,
    )
    from sklearn.preprocessing import MultiLabelBinarizer
except ImportError:
    sys.exit("scikit-learn is required. Install with:  pip install -r requirements.txt")

SENTIMENTS = ["positive", "negative", "mixed"]
LABELS_CSV = "human_labeling_sample.csv"
PREDS_CSV = "evaluation_predictions.csv"


def load(path):
    with open(path, newline="", encoding="utf-8") as f:
        return {r["review_id"]: r for r in csv.DictReader(f)}


def split_cats(s):
    return [c.strip() for c in (s or "").split("|") if c.strip()]


def main():
    human = load(LABELS_CSV)
    preds = load(PREDS_CSV)

    ids = [rid for rid in human
           if (human[rid].get("human_sentiment") or "").strip() and rid in preds]
    if not ids:
        print("No human labels found yet.")
        print(f"Fill the human_* columns in {LABELS_CSV}, then re-run.")
        return

    out = []  # lines for results.md
    def emit(line=""):
        print(line)
        out.append(line)

    emit(f"# Evaluation results\n")
    emit(f"Evaluated **{len(ids)}** of {len(human)} sampled reviews that have human labels.\n")

    # ---------------- SENTIMENT ----------------
    y_true = [human[i]["human_sentiment"].strip().lower() for i in ids]
    y_pred = [(preds[i].get("ai_sentiment") or "").strip().lower() for i in ids]

    acc = accuracy_score(y_true, y_pred)
    p, r, f, _ = precision_recall_fscore_support(
        y_true, y_pred, labels=SENTIMENTS, average=None, zero_division=0)
    macro = precision_recall_fscore_support(
        y_true, y_pred, labels=SENTIMENTS, average="macro", zero_division=0)
    weighted = precision_recall_fscore_support(
        y_true, y_pred, labels=SENTIMENTS, average="weighted", zero_division=0)

    emit("## Sentiment (single-label)\n")
    emit(f"- Accuracy: **{acc:.3f}**")
    emit(f"- Macro F1: **{macro[2]:.3f}**  ·  Weighted F1: **{weighted[2]:.3f}**\n")
    emit("| class | precision | recall | F1 |")
    emit("|---|---|---|---|")
    for i, c in enumerate(SENTIMENTS):
        emit(f"| {c} | {p[i]:.3f} | {r[i]:.3f} | {f[i]:.3f} |")
    emit("")

    cm = confusion_matrix(y_true, y_pred, labels=SENTIMENTS)
    emit("Confusion matrix (rows = human truth, cols = AI predicted):\n")
    emit("| truth \\ pred | " + " | ".join(SENTIMENTS) + " |")
    emit("|---|" + "---|" * len(SENTIMENTS))
    for i, c in enumerate(SENTIMENTS):
        emit(f"| {c} | " + " | ".join(str(int(x)) for x in cm[i]) + " |")
    emit("")

    # ---------------- CATEGORIES (multi-label) ----------------
    # only score categories where the human supplied them
    cat_ids = [i for i in ids if (human[i].get("human_categories") or "").strip()]
    if cat_ids:
        gt = [split_cats(human[i]["human_categories"]) for i in cat_ids]
        pr = [split_cats(preds[i].get("ai_categories")) for i in cat_ids]
        mlb = MultiLabelBinarizer()
        mlb.fit(gt + pr)
        GT = mlb.transform(gt)
        PR = mlb.transform(pr)

        exact = accuracy_score(GT, PR)  # subset accuracy = exact match
        emit("## Categories (multi-label)\n")
        for avg in ("micro", "macro", "weighted"):
            mp, mr, mf, _ = precision_recall_fscore_support(
                GT, PR, average=avg, zero_division=0)
            emit(f"- {avg.capitalize()}: precision {mp:.3f} · recall {mr:.3f} · F1 {mf:.3f}")
        emit(f"- Exact-match (subset) accuracy: **{exact:.3f}**\n")

        rep = classification_report(GT, PR, target_names=mlb.classes_,
                                    zero_division=0, output_dict=True)
        emit("| category | precision | recall | F1 | support |")
        emit("|---|---|---|---|---|")
        for c in mlb.classes_:
            d = rep.get(c, {})
            emit(f"| {c} | {d.get('precision',0):.3f} | {d.get('recall',0):.3f} "
                 f"| {d.get('f1-score',0):.3f} | {int(d.get('support',0))} |")
        emit("")
    else:
        emit("## Categories\n\n_No human category labels provided — skipped._\n")

    # ---------------- SUMMARY RUBRIC ----------------
    rub_ids = [i for i in ids if (human[i].get("summary_faithful") or "").strip()]
    if rub_ids:
        def rate(col, good="1"):
            n = sum(1 for i in rub_ids if (human[i].get(col) or "").strip() == good)
            return n, n / len(rub_ids)
        f_n, f_p = rate("summary_faithful", "1")
        m_n, m_p = rate("summary_captures_main_point", "1")
        u_n, u_p = rate("summary_has_unsupported_information", "0")  # 0 = good
        passall = sum(1 for i in rub_ids if
                      (human[i].get("summary_faithful") or "").strip() == "1"
                      and (human[i].get("summary_captures_main_point") or "").strip() == "1"
                      and (human[i].get("summary_has_unsupported_information") or "").strip() == "0")
        emit("## Summary rubric ({} scored)\n".format(len(rub_ids)))
        emit(f"- Factually faithful: {f_n}/{len(rub_ids)} = **{f_p:.3f}**")
        emit(f"- Captures main point: {m_n}/{len(rub_ids)} = **{m_p:.3f}**")
        emit(f"- Free of unsupported info: {u_n}/{len(rub_ids)} = **{u_p:.3f}**")
        emit(f"- Passes all three: {passall}/{len(rub_ids)} = **{passall/len(rub_ids):.3f}**\n")
    else:
        emit("## Summary rubric\n\n_No rubric scores provided — skipped._\n")

    # ---------------- DISAGREEMENTS ----------------
    with open("disagreements.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["review_id", "human_sentiment", "ai_sentiment",
                    "human_categories", "ai_categories", "Reviews"])
        n_dis = 0
        for i in ids:
            if human[i]["human_sentiment"].strip().lower() != (preds[i].get("ai_sentiment") or "").strip().lower():
                n_dis += 1
                w.writerow([i, human[i]["human_sentiment"], preds[i].get("ai_sentiment", ""),
                            human[i].get("human_categories", ""), preds[i].get("ai_categories", ""),
                            human[i].get("Reviews", "")])
    emit(f"Wrote disagreements.csv ({n_dis} sentiment disagreements).")

    with open("results.md", "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")
    print("\nWrote results.md")


if __name__ == "__main__":
    main()
