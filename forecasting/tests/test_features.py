from datetime import date, timedelta

import pandas as pd

from forecasting.features import (
    cap_iqr_outliers,
    daily_series,
    feature_categories,
    feature_frame,
    prepare_series,
)


def test_daily_series_fills_missing_dates_with_zero() -> None:
    records = [
        {"medicine_id": "med-1", "date": date(2024, 1, 1), "quantity": 2},
        {"medicine_id": "med-1", "date": date(2024, 1, 3), "quantity": 3},
    ]

    series = daily_series(records, "med-1")

    assert series.tolist() == [2.0, 0.0, 3.0]


def test_prepare_series_aggregates_when_zero_days_exceed_thirty_percent() -> None:
    index = pd.date_range("2024-01-01", periods=14, freq="D")
    series = pd.Series([1, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0, 0, 0, 0], index=index)

    aggregated, frequency = prepare_series(series)

    assert frequency == "weekly"
    assert int(aggregated.sum()) == int(series.sum())


def test_aggregation_decision_uses_training_period_only() -> None:
    index = pd.date_range("2024-01-01", periods=28, freq="D")
    series = pd.Series([2] * 14 + [0] * 14, index=index, dtype=float)

    aggregated, frequency = prepare_series(series, decision_end=date(2024, 1, 14))

    assert frequency == "daily"
    assert len(aggregated) == 28


def test_cap_iqr_outliers_limits_extreme_daily_value() -> None:
    index = pd.date_range("2024-01-01", periods=20, freq="D")
    values = [1] * 5 + [2] * 5 + [3] * 5 + [4] * 4 + [1000]
    series = pd.Series(values, index=index, dtype=float)

    capped = cap_iqr_outliers(series)

    assert capped.max() == 5.5


def test_cap_iqr_preserves_demand_when_more_than_half_the_days_are_zero() -> None:
    index = pd.date_range("2024-01-01", periods=20, freq="D")
    series = pd.Series([0.0] * 19 + [8.0], index=index)

    capped = cap_iqr_outliers(series)

    assert capped.iloc[-1] == 8
    assert capped.sum() == 8


def test_feature_frame_uses_only_previous_demand_for_lags() -> None:
    index = pd.date_range("2024-01-01", periods=120, freq="D")
    series = pd.Series(range(120), index=index, dtype=float)
    medicine = {"therapeutic_class": "Analgesic", "demand_pattern": "acute"}
    categories = feature_categories([medicine])

    frame = feature_frame(series, medicine, categories)

    assert frame.iloc[-1]["lag_1"] == 118
    assert frame.iloc[-1]["rolling_sum_7"] == sum(range(112, 119))


def test_daily_series_can_fill_through_a_requested_end_date() -> None:
    records = [
        {"medicine_id": "med-1", "date": date(2024, 1, 1), "quantity": 1},
    ]

    series = daily_series(
        records,
        "med-1",
        end=date(2024, 1, 1) + timedelta(days=2),
    )

    assert series.tolist() == [1.0, 0.0, 0.0]
