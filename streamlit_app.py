from __future__ import annotations

from collections import Counter
from html import escape
from pathlib import Path

import altair as alt
import pandas as pd
import streamlit as st


DATA_PATH = Path(__file__).with_name("reviews_final.csv")
SENTIMENTS = ["positive", "negative", "mixed"]
COLORS = {"positive": "#11875D", "negative": "#D94B45", "mixed": "#7656C7"}

st.set_page_config(
    page_title="AI Customer Feedback Analytics",
    page_icon="✈️",
    layout="wide",
    initial_sidebar_state="expanded",
)


@st.cache_data(show_spinner="Loading 8,100 AI-labeled airline reviews…")
def load_data(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path, low_memory=False)
    for col in ["Airline", "Reviews", "summary", "categories", "keywords", "sentiment"]:
        df[col] = df[col].fillna("").astype(str).str.strip()
    df["sentiment"] = df["sentiment"].str.lower()
    return df[df["sentiment"].isin(SENTIMENTS)].reset_index(drop=True)


def split_values(series: pd.Series) -> list[str]:
    values: list[str] = []
    for item in series:
        values.extend(part.strip() for part in str(item).split("|") if part.strip())
    return values


def frequency_frame(series: pd.Series, label: str, limit: int = 12) -> pd.DataFrame:
    return pd.DataFrame(Counter(split_values(series)).most_common(limit), columns=[label, "Mentions"])


def percentage(value: int, total: int) -> str:
    return f"{value / total:.0%}" if total else "0%"


st.markdown(
    """
    <style>
    .stApp { background: #F4F7F9; color: #172B36; }
    .block-container { max-width: 1380px; padding-top: 2.2rem; padding-bottom: 4rem; }
    h1, h2, h3 { color: #172B36; letter-spacing: -0.02em; }
    h1 { font-size: clamp(2.5rem, 5vw, 4rem) !important; line-height: 1.03 !important; }
    p, label, [data-testid="stMarkdownContainer"] { font-size: 1.02rem; }
    [data-testid="stSidebar"] { background: #FFFFFF; border-right: 1px solid #DCE5EA; }
    [data-testid="stMetric"] { background: #FFFFFF; border: 1px solid #DCE5EA; border-radius: 16px; padding: 1rem 1.15rem; box-shadow: 0 6px 20px rgba(27,55,68,.05); }
    [data-testid="stMetricLabel"] { color: #536B78; font-weight: 650; }
    [data-testid="stMetricValue"] { color: #172B36; font-weight: 750; }
    div[data-testid="stVerticalBlockBorderWrapper"] { background: #FFFFFF; border-color: #DCE5EA; border-radius: 16px; box-shadow: 0 6px 20px rgba(27,55,68,.05); }
    .eyebrow { color:#167C8D; font-size:.82rem; font-weight:800; letter-spacing:.16em; text-transform:uppercase; margin-bottom:.45rem; }
    .hero-sub { color:#536B78; font-size:1.16rem; line-height:1.6; max-width:850px; margin-bottom:1rem; }
    .pill { display:inline-block; background:#FFFFFF; border:1px solid #DCE5EA; border-radius:999px; padding:.35rem .7rem; margin:0 .35rem .35rem 0; color:#405964; font-size:.82rem; font-weight:650; }
    .review { background:#F8FAFB; border:1px solid #DCE5EA; border-radius:14px; padding:1rem 1.1rem; margin:.65rem 0; }
    .review-top { color:#172B36; font-weight:750; margin-bottom:.35rem; }
    .review-text { color:#334E5B; line-height:1.65; }
    .tag { display:inline-block; border-radius:999px; padding:.18rem .52rem; margin-right:.35rem; font-size:.75rem; font-weight:750; color:white; }
    .small-note { color:#607986; font-size:.87rem; }
    </style>
    """,
    unsafe_allow_html=True,
)

df = load_data(DATA_PATH)
airlines = sorted(df["Airline"].unique())

with st.sidebar:
    st.header("Explore the reviews")
    uploaded = st.file_uploader("Use your own labeled CSV", type="csv")
    if uploaded is not None:
        try:
            df = pd.read_csv(uploaded, low_memory=False).fillna("")
            df["sentiment"] = df["sentiment"].astype(str).str.lower().str.strip()
            airlines = sorted(df["Airline"].astype(str).unique())
            st.success(f"Loaded {len(df):,} reviews")
        except Exception as exc:
            st.error(f"That CSV could not be loaded: {exc}")

    selected_airlines = st.multiselect("Airlines", airlines, default=airlines)
    selected_sentiments = st.pills(
        "Sentiment",
        SENTIMENTS,
        default=SENTIMENTS,
        selection_mode="multi",
        format_func=str.title,
    )
    search = st.text_input("Search review text", placeholder="e.g. missed connection")
    st.caption("The included dataset is cached, so filters update without rereading the 9.3 MB CSV.")

filtered = df[
    df["Airline"].isin(selected_airlines)
    & df["sentiment"].isin(selected_sentiments or [])
].copy()
if search:
    filtered = filtered[filtered["Reviews"].astype(str).str.contains(search, case=False, na=False)]

st.markdown('<div class="eyebrow">AI Customer Feedback Analytics</div>', unsafe_allow_html=True)
st.markdown("# What flyers :green[love] and :red[can’t stand]")
st.markdown(
    '<div class="hero-sub">8,100 airline reviews transformed into structured sentiment, topics, keywords, and summaries—then explored through transparent, deterministic analytics.</div>',
    unsafe_allow_html=True,
)
st.markdown(
    '<span class="pill">8,100 reviews</span><span class="pill">10 airlines</span><span class="pill">AI-labeled</span><span class="pill">Interactive</span>',
    unsafe_allow_html=True,
)

if filtered.empty:
    st.warning("No reviews match these filters. Select an airline and at least one sentiment.")
    st.stop()

counts = filtered["sentiment"].value_counts()
m1, m2, m3, m4 = st.columns(4)
m1.metric("Reviews in view", f"{len(filtered):,}")
m2.metric("Positive", percentage(int(counts.get("positive", 0)), len(filtered)))
m3.metric("Negative", percentage(int(counts.get("negative", 0)), len(filtered)))
m4.metric("Mixed", percentage(int(counts.get("mixed", 0)), len(filtered)))

sentiment_df = (
    filtered.groupby(["Airline", "sentiment"]).size().rename("Reviews").reset_index()
)
sentiment_df["Share"] = sentiment_df["Reviews"] / sentiment_df.groupby("Airline")["Reviews"].transform("sum")

left, right = st.columns([1.25, 1], gap="large")
with left:
    with st.container(border=True):
        st.subheader("Sentiment by airline")
        st.caption("Percent of classified reviews within each selected airline")
        chart = (
            alt.Chart(sentiment_df)
            .mark_bar(cornerRadius=3)
            .encode(
                x=alt.X("Share:Q", axis=alt.Axis(format="%"), title=None),
                y=alt.Y("Airline:N", sort="-x", title=None),
                color=alt.Color(
                    "sentiment:N",
                    scale=alt.Scale(domain=SENTIMENTS, range=[COLORS[x] for x in SENTIMENTS]),
                    legend=alt.Legend(title=None, orient="top"),
                ),
                tooltip=["Airline", "sentiment", "Reviews", alt.Tooltip("Share:Q", format=".1%")],
            )
            .properties(height=max(300, len(selected_airlines) * 35))
        )
        st.altair_chart(chart, width="stretch")

with right:
    with st.container(border=True):
        st.subheader("Top pain points")
        negative = filtered[filtered["sentiment"] == "negative"]
        pain = frequency_frame(negative["categories"], "Topic", 10)
        pain_chart = (
            alt.Chart(pain)
            .mark_bar(color=COLORS["negative"], cornerRadiusEnd=5)
            .encode(
                x=alt.X("Mentions:Q", title=None),
                y=alt.Y("Topic:N", sort="-x", title=None),
                tooltip=["Topic", "Mentions"],
            )
            .properties(height=350)
        )
        st.altair_chart(pain_chart, width="stretch")
        st.caption(f"Based on {len(negative):,} negative reviews. Reviews may contain multiple topics.")

topics_tab, keywords_tab, insights_tab = st.tabs(["Top topics", "Ranked keywords", "Instant insights"])
with topics_tab:
    topics = frequency_frame(filtered["categories"], "Topic", 15)
    st.dataframe(topics, hide_index=True, width="stretch", height=420)

with keywords_tab:
    keywords = frequency_frame(filtered["keywords"], "Keyword", 25)
    keyword_chart = (
        alt.Chart(keywords)
        .mark_bar(color="#167C8D", cornerRadiusEnd=5)
        .encode(
            x=alt.X("Mentions:Q", title="Review mentions"),
            y=alt.Y("Keyword:N", sort="-x", title=None),
            tooltip=["Keyword", "Mentions"],
        )
        .properties(height=600)
    )
    st.altair_chart(keyword_chart, width="stretch")

with insights_tab:
    topic_names = frequency_frame(filtered["categories"], "Topic", 3)["Topic"].tolist()
    praise = frequency_frame(filtered[filtered["sentiment"] == "positive"]["keywords"], "Keyword", 3)["Keyword"].tolist()
    complaints = frequency_frame(filtered[filtered["sentiment"] == "negative"]["keywords"], "Keyword", 3)["Keyword"].tolist()
    st.markdown(
        f"""
        **Overall mood:** {percentage(int(counts.get('negative', 0)), len(filtered))} negative and {percentage(int(counts.get('positive', 0)), len(filtered))} positive across {len(filtered):,} selected reviews.

        **Most discussed:** {', '.join(topic_names) or 'No labeled topics'}.

        **Customers praise:** {', '.join(praise) or 'No positive keywords'}.

        **Customers criticize:** {', '.join(complaints) or 'No negative keywords'}.
        """
    )
    st.caption("Calculated from the full filtered dataset without an additional model call.")

st.subheader("Reviews in view")
review_sort = st.selectbox("Sort reviews", ["Representative mix", "Positive first", "Negative first", "Mixed first"], label_visibility="collapsed")
order_map = {
    "Positive first": ["positive", "mixed", "negative"],
    "Negative first": ["negative", "mixed", "positive"],
    "Mixed first": ["mixed", "positive", "negative"],
}
if review_sort == "Representative mix":
    sample_parts = [group.head(7) for _, group in filtered.groupby("sentiment", sort=False)]
    reviews = pd.concat(sample_parts).sort_values("review_id").head(20)
else:
    order = order_map[review_sort]
    reviews = filtered.assign(_order=pd.Categorical(filtered["sentiment"], order, ordered=True)).sort_values("_order").head(20)

for row in reviews.itertuples():
    color = COLORS.get(row.sentiment, "#607986")
    summary = escape(str(getattr(row, "summary", "")).strip())
    categories = escape(" · ".join(split_values(pd.Series([getattr(row, "categories", "")]))))
    airline = escape(str(row.Airline))
    review_text = escape(str(row.Reviews))
    st.markdown(
        f"""
        <div class="review">
          <div class="review-top">{airline} <span class="tag" style="background:{color}">{row.sentiment.title()}</span></div>
          <div class="small-note">{categories}</div>
          <div class="review-text">{review_text}</div>
          {f'<div class="small-note"><strong>AI summary:</strong> {summary}</div>' if summary else ''}
        </div>
        """,
        unsafe_allow_html=True,
    )

st.caption(f"Showing {min(20, len(reviews))} representative reviews from {len(filtered):,} matching records.")
