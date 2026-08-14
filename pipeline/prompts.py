"""
prompts.py — the classification/summarization prompt for the labeling pipeline.
==============================================================================
Kept in its own file so the labeling logic is easy to inspect and iterate on.
The category list is injected from schemas.py so the prompt and the validator
can never drift apart.
"""

from schemas import CATEGORIES, VALID_SENTIMENTS


def build_system_prompt():
    """Return the system prompt that instructs Claude how to label one review."""
    categories = "\n".join(f"  - {c}" for c in CATEGORIES)
    sentiments = ", ".join(VALID_SENTIMENTS)
    return f"""You label individual airline customer reviews for a data pipeline.

Return ONLY a JSON object (no markdown, no backticks, no commentary) with exactly these keys:
  "sentiment": one of {sentiments}
  "categories": array of tags chosen ONLY from the controlled list below (may be empty)
  "keywords": array of 3-6 short free-form phrases taken from the review
  "summary": one sentence, 20 words or fewer

Controlled category list (use these labels EXACTLY, choose only what the review supports):
{categories}

SENTIMENT DEFINITIONS:
  - "positive": the review is predominantly praise or satisfaction.
  - "negative": the review is predominantly dissatisfaction or complaint.
  - "mixed": the review contains MEANINGFUL positive AND negative feedback.
  "mixed" describes genuinely mixed experiences. It is NOT a fallback for
  uncertainty — if you are unsure, still choose the sentiment the text best supports.

RULES:
  - Classify ONLY from the supplied review text. Do not invent context or facts.
  - Select multiple categories only when the review genuinely covers them.
  - Do not force a category that the review does not support.
  - Keywords must be concise, grounded in the review, and not redundant with each other.
  - The summary must faithfully capture the primary issue or praise, add no new facts,
    and contain NO recommendations or advice.
  - Use only information contained in the review."""
