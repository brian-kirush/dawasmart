from __future__ import annotations

from datetime import date
from typing import Any

import numpy as np
import pandas as pd

from forecasting.data import kenya_holiday_dates

DAILY_LAGS = (1, 2, 3, 7, 14, 21, 28, 30, 60, 90)
ROLLING_WINDOWS = (7, 14, 28)


def daily_series(
    records: list[dict[str, Any]],
    medicine_id: str,
    start: date | None = None,
    end: date | None = None,
) -> pd.Series:
    selected = [record for record in records if record["medicine_id"] == medicine_id]
    if not selected:
        return pd.Series(dtype=float, name="demand")
    frame = pd.DataFrame(selected)
    frame["date"] = pd.to_datetime(frame["date"])
    series = frame.groupby("date")["quantity"].sum().sort_index()
    first = pd.Timestamp(start) if start else series.index.min()
    last = pd.Timestamp(end) if end else series.index.max()
    if first > last:
        return pd.Series(dtype=float, name="demand")
    index = pd.date_range(first, last, freq="D")
    series = series.reindex(index, fill_value=0).astype(float)
    series.name = "demand"
    return series


def cap_iqr_outliers(series: pd.Series) -> pd.Series:
    if series.empty:
        return series.astype(float)
    q1 = float(series.quantile(0.25))
    q3 = float(series.quantile(0.75))
    if q3 == q1:
        return series.clip(lower=0).astype(float)
    upper = q3 + 1.5 * (q3 - q1)
    return series.clip(lower=0, upper=max(upper, 0)).astype(float)


def prepare_series(
    series: pd.Series,
    decision_end: date | None = None,
) -> tuple[pd.Series, str]:
    if series.empty:
        return series, "daily"
    daily = series.asfreq("D", fill_value=0).astype(float)
    decision_series = daily
    if decision_end is not None:
        training_observations = daily[daily.index.date <= decision_end]
        if not training_observations.empty:
            decision_series = training_observations
    if float((decision_series == 0).mean()) > 0.30:
        weekly = daily.resample("W-SUN").sum().astype(float)
        weekly.name = "demand"
        return weekly, "weekly"
    return daily, "daily"


def feature_categories(
    medicines: list[dict[str, Any]],
) -> tuple[list[str], list[str]]:
    classes = sorted({
        str(medicine.get("therapeutic_class") or "unknown").lower()
        for medicine in medicines
    })
    patterns = ["acute", "chronic", "unknown"]
    return classes or ["unknown"], patterns


def is_weekly_series(series: pd.Series) -> bool:
    if series.index.freqstr and series.index.freqstr.startswith(("W", "7D")):
        return True
    if len(series.index) < 2:
        return False
    differences = np.diff(series.index.asi8) / 86_400_000_000_000
    return float(np.median(differences)) >= 6


def feature_frame(
    series: pd.Series,
    medicine: dict[str, Any],
    categories: tuple[list[str], list[str]],
) -> pd.DataFrame:
    if series.empty:
        return pd.DataFrame()
    dates = pd.DatetimeIndex(series.index)
    result = pd.DataFrame(index=dates)
    for lag in DAILY_LAGS:
        result[f"lag_{lag}"] = series.shift(lag)
    shifted = series.shift(1)
    for window in ROLLING_WINDOWS:
        rolling = shifted.rolling(window=window, min_periods=window)
        result[f"rolling_mean_{window}"] = rolling.mean()
        result[f"rolling_std_{window}"] = rolling.std().fillna(0)
        result[f"rolling_sum_{window}"] = rolling.sum()

    result["day_of_week"] = dates.dayofweek
    result["day_of_month"] = dates.day
    result["month"] = dates.month
    result["week_of_year"] = dates.isocalendar().week.astype(int).to_numpy()
    result["is_weekend"] = (dates.dayofweek >= 5).astype(int)
    result["is_rainy_season"] = dates.month.isin((3, 4, 5, 10, 11, 12)).astype(int)

    holiday_map = kenya_holiday_dates(dates.min().date(), dates.max().date())
    if is_weekly_series(series):
        result["is_holiday"] = [
            int(any(
                day in holiday_map
                for day in pd.date_range(timestamp - pd.Timedelta(days=6), timestamp, freq="D").date
            ))
            for timestamp in dates
        ]
    else:
        result["is_holiday"] = [int(timestamp.date() in holiday_map) for timestamp in dates]

    class_categories, pattern_categories = categories
    medicine_class = str(medicine.get("therapeutic_class") or "unknown").lower()
    medicine_pattern = str(medicine.get("demand_pattern") or "unknown").lower()
    for category in class_categories:
        result[f"class_{category}"] = int(medicine_class == category)
    for category in pattern_categories:
        result[f"pattern_{category}"] = int(medicine_pattern == category)
    return result.replace([np.inf, -np.inf], np.nan)
