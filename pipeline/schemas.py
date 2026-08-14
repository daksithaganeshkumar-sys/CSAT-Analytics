"""
schemas.py — controlled vocabulary and structured-output validation.
====================================================================
The labeling pipeline asks Claude for a JSON object per review. This module
defines what a *valid* object looks like and validates every model response
against it, so malformed output is caught and retried/flagged instead of
silently entering the analytics as if it were correct.

Portfolio note: the controlled category list below matches the 14 categories
actually present in reviews_final.csv, so re-running this pipeline reproduces
the same taxonomy the dashboard expects.
"""

# ---------------------------------------------------------------------------
# Controlled vocabulary
# ---------------------------------------------------------------------------
# Sentiment is a closed set. "mixed" is a real class (meaningful positive AND
# negative), never an error fallback. Invalid model output is rejected, not
# coerced into one of these.
VALID_SENTIMENTS = ("positive", "negative", "mixed")

# Controlled topic taxonomy. Aggregation in the dashboard relies on these
# fixed labels, which is what keeps topic counts reliable (unlike free-form
# keywords). This list is the source of truth and is injected into the prompt.
CATEGORIES = (
    "Seat Comfort",
    "Legroom",
    "Staff Service",
    "Food & Beverages",
    "Inflight Entertainment",
    "Cleanliness",
    "Boarding & Check-in",
    "Delays & Punctuality",
    "Baggage",
    "Value for Money",
    "Booking & Customer Service",
    "Lounge",
    "Cabin Condition",
    "Premium Economy",
)
_CATEGORY_SET = set(CATEGORIES)


class ValidationError(Exception):
    """Raised when a model response does not conform to the expected schema."""


def validate_label(obj):
    """
    Validate a single parsed label object against the schema.

    Returns a normalized dict with keys: sentiment, categories, keywords, summary.
    Raises ValidationError with a specific message if anything is wrong, so the
    caller can decide to retry or flag the row — never silently "fix" it.
    """
    if not isinstance(obj, dict):
        raise ValidationError("response is not a JSON object")

    # sentiment: must be one of the closed set
    sentiment = obj.get("sentiment")
    if sentiment not in VALID_SENTIMENTS:
        raise ValidationError(f"invalid sentiment: {sentiment!r}")

    # categories: list of strings, each from the controlled taxonomy; may be empty
    categories = obj.get("categories")
    if not isinstance(categories, list):
        raise ValidationError("categories is not a list")
    unknown = [c for c in categories if c not in _CATEGORY_SET]
    if unknown:
        raise ValidationError(f"unknown categorie(s): {unknown}")

    # keywords: list of non-empty strings
    keywords = obj.get("keywords")
    if not isinstance(keywords, list) or not all(isinstance(k, str) for k in keywords):
        raise ValidationError("keywords must be a list of strings")

    # summary: non-empty string
    summary = obj.get("summary")
    if not isinstance(summary, str) or not summary.strip():
        raise ValidationError("summary must be a non-empty string")

    return {
        "sentiment": sentiment,
        "categories": list(categories),
        "keywords": [k.strip() for k in keywords if k.strip()],
        "summary": summary.strip(),
    }
