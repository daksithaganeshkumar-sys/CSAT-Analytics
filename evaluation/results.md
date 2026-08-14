# Evaluation — Inter-Model Agreement Study

**What this measures.** These numbers report **agreement between two independent
LLMs** — the pipeline's labels (Claude) versus a second, independently-prompted
LLM (used here as a comparison annotator) — on a stratified 150-review sample
(`--size 150 --seed 42`).

**What this is NOT.** This is **not** a human-validated accuracy score. Both
label sets are model-generated, so high agreement means the models are
consistent with each other, not that either is necessarily correct. A
human-labeled evaluation is the planned next step; see Limitations.

Sample: 150 reviews, stratified by sentiment × airline, seed 42.

## Sentiment — inter-model agreement

- Overall agreement: **92.7%**
- Macro-F1: **0.897** · Weighted-F1: **0.927**

| class | precision | recall | F1 |
|---|---|---|---|
| positive | 0.981 | 0.895 | 0.936 |
| negative | 0.944 | 1.000 | 0.971 |
| mixed | 0.769 | 0.800 | 0.784 |

Confusion matrix (rows = comparison LLM, cols = pipeline/Claude):

| ↓ comp \ Claude → | positive | negative | mixed |
|---|---|---|---|
| positive | 51 | 0 | 6 |
| negative | 0 | 68 | 0 |
| mixed | 1 | 4 | 20 |

**Reading it.** The models agree strongly on positive and negative. `mixed` is
the hardest class (F1 0.784): most disagreement is a `mixed` review being pulled
toward positive or negative — the expected failure mode for sentiment.

## Categories — inter-model agreement (multi-label)

- Micro: precision 0.910 · recall 0.886 · F1 0.897
- Macro: precision 0.893 · recall 0.865 · F1 0.870
- Weighted: precision 0.917 · recall 0.886 · F1 0.894
- Exact-match (all tags identical): **0.460**

| category | precision | recall | F1 | support |
|---|---|---|---|---|
| Baggage | 0.871 | 1.000 | 0.931 | 27 |
| Boarding & Check-in | 0.925 | 0.817 | 0.867 | 60 |
| Booking & Customer Service | 0.804 | 0.925 | 0.860 | 40 |
| Cabin Condition | 0.625 | 0.833 | 0.714 | 36 |
| Cleanliness | 0.929 | 0.765 | 0.839 | 17 |
| Delays & Punctuality | 0.880 | 0.957 | 0.917 | 46 |
| Food & Beverages | 0.979 | 0.979 | 0.979 | 95 |
| Inflight Entertainment | 0.955 | 0.955 | 0.955 | 44 |
| Legroom | 0.857 | 0.857 | 0.857 | 21 |
| Lounge | 0.950 | 0.905 | 0.927 | 21 |
| Seat Comfort | 0.969 | 0.925 | 0.947 | 67 |
| Staff Service | 0.976 | 0.911 | 0.943 | 135 |
| Value for Money | 0.889 | 0.421 | 0.571 | 38 |

**Reading it.** Per-tag agreement is high, but **exact-match is only 0.460** —
the models often agree on most tags for a review while differing on one, which is
expected for multi-label tagging. Two categories stand out as low-agreement and
worth investigating: **Value for Money** (recall 0.421 — frequently tagged by one
model and not the other) and **Cabin Condition** (F1 0.714).

## Summary rubric

Not scored in this run (the `summary_*` columns were left blank). The rubric
(faithfulness / captures main point / no unsupported information) remains
available in `evaluate_labels.py` for a future human review pass.

## Limitations

- **Model-vs-model, not human-validated.** Both label sets are LLM-generated;
  this measures consistency, not correctness.
- **Single comparison annotator, single run.** No inter-human agreement; no
  repeated trials.
- **Stratified by the pipeline's own sentiment label** for class coverage, which
  affects which rows were sampled (not the scoring).
- **Next step:** a human-labeled sample to convert this from an agreement signal
  into a true accuracy measurement.
