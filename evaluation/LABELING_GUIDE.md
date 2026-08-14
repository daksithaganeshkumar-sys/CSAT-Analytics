# Labeling Guide — Human Ground Truth

This guide is for creating the human-reviewed ground truth used to benchmark the
AI labels. Follow it consistently so the evaluation is defensible.

**Blind labeling.** Fill in `human_labeling_sample.csv` only. The AI's answers
are kept in a separate file (`evaluation_predictions.csv`) on purpose — **do not
open it while labeling**, so your judgments aren't anchored to the model's.

---

## Workflow

```bash
cd evaluation
pip install -r requirements.txt

# 1. create the blinded sample (reproducible)
python create_evaluation_sample.py --size 150 --seed 42 --input ../reviews_final.csv

# 2. label human_labeling_sample.csv by hand (see columns below)

# 3. score
python evaluate_labels.py
```

Step 3 prints the metrics, writes `results.md` (paste into the README), and
writes `disagreements.csv` (every row where AI and human sentiment differ).

---

## Columns to fill in `human_labeling_sample.csv`

### `human_sentiment`  (required)

Exactly one of: `positive`, `negative`, `mixed`.

- **positive** — predominantly praise or satisfaction.
- **negative** — predominantly dissatisfaction or complaint.
- **mixed** — contains *meaningful* positive **and** negative feedback.

Rules:
- `mixed` is a genuine "both" case, not a bucket for uncertainty. If a review
  leans one way with only a minor caveat, label the direction it leans.
- Judge the customer's overall experience, not individual sentences.

### `human_categories`  (recommended)

Zero or more categories from the controlled list, **pipe-separated**, exact
spelling — e.g. `Baggage | Delays & Punctuality`.

Controlled categories:
`Seat Comfort`, `Legroom`, `Staff Service`, `Food & Beverages`,
`Inflight Entertainment`, `Cleanliness`, `Boarding & Check-in`,
`Delays & Punctuality`, `Baggage`, `Value for Money`,
`Booking & Customer Service`, `Lounge`, `Cabin Condition`, `Premium Economy`.

Rules: tag only what the review actually discusses; leave blank if none apply;
never invent labels outside the list.

### Summary rubric (optional but valuable)

Score the AI's summary for this review. To do this you'll need to see the AI
summary — score these columns **after** you've decided sentiment/categories, so
the summary doesn't influence those. Use `1` for yes, `0` for no.

- `summary_faithful` — every claim in the summary is supported by the review.
- `summary_captures_main_point` — the primary issue or praise is present.
- `summary_has_unsupported_information` — the summary adds facts/context/advice
  NOT in the review. **Here `1` is bad; `0` is good.**

A summary "passes" only if faithful = 1, captures main point = 1, and unsupported
info = 0. The script reports the pass rate.

### `reviewer_notes`  (optional)

Anything worth recording — ambiguous cases, disagreements, edge cases.

---

## Methodology notes (be transparent in the README)

- **Sample size.** 150 is recommended; even 50 gives a useful signal if you note
  the size. Small samples produce noisy per-class and per-category numbers —
  report them as indicative, not definitive.
- **Reproducibility.** The sample is drawn with a fixed `--seed`; record the seed
  and size alongside results.
- **Single annotator.** If only one person labels, there's no inter-annotator
  agreement measure; state that as a limitation.
- **Stratification caveat.** The sampler stratifies by the AI's own sentiment
  label (for class coverage only). This affects which rows are *seen*, not the
  ground-truth labels or per-class scoring, but it should be disclosed.
