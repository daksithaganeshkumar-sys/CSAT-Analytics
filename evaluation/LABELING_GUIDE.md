# Labeling Guide — Human Ground Truth

This guide is for creating the human-reviewed ground truth used to benchmark the
AI labels. Follow it consistently so the evaluation is defensible.

**Important:** label from the review text alone. Do **not** look at the AI's
predictions while labeling — they are kept in a separate file (`ai_predictions.csv`)
specifically so they can't anchor your judgment.

## Workflow

1. Generate the sample:
   ```bash
   python create_evaluation_sample.py --input ../reviews_final.csv --n 150 --seed 42
   ```
2. Open `human_labeling_sample.csv` and fill in two columns for each row:
   - `gt_sentiment`
   - `gt_categories` (optional but recommended)
3. Run the evaluation:
   ```bash
   python evaluate_labels.py
   ```

## Sentiment — `gt_sentiment`

Enter exactly one of: `positive`, `negative`, `mixed`.

- **positive** — the review is predominantly praise or satisfaction.
- **negative** — the review is predominantly dissatisfaction or complaint.
- **mixed** — the review contains *meaningful* positive **and** negative feedback.

Rules:
- `mixed` is a genuine "both" case, not a place to put uncertain reviews. If a
  review leans one way, choose that way even if there's a minor caveat.
- Judge the customer's overall experience, not individual sentences.

## Categories — `gt_categories`

Enter zero or more categories from the controlled list below, **pipe-separated**,
e.g. `Baggage | Delays & Punctuality`. Use the exact spelling.

Controlled categories:
`Seat Comfort`, `Legroom`, `Staff Service`, `Food & Beverages`,
`Inflight Entertainment`, `Cleanliness`, `Boarding & Check-in`,
`Delays & Punctuality`, `Baggage`, `Value for Money`,
`Booking & Customer Service`, `Lounge`, `Cabin Condition`, `Premium Economy`.

Rules:
- Only tag a category the review actually discusses.
- Leave blank if the review discusses none of them.
- Don't invent categories outside the list.

## Summary rubric (optional qualitative check)

If you also want to assess the AI summaries, score each on three yes/no criteria.
This is a manual rubric — record the scores in your own sheet; the metrics script
covers sentiment and categories only.

1. **Factually faithful** — every claim in the summary is supported by the review.
2. **Captures the main point** — the primary issue or praise is present.
3. **No unsupported information** — no added facts, context, or recommendations.

A summary "passes" only if all three are yes. Report the pass rate (e.g. "42/50
summaries passed all three criteria") — again, only after actually scoring them.

## Reproducibility

The sample is drawn with a fixed `--seed`, so anyone can regenerate the exact
same rows. Record the seed and sample size you used alongside your results.
