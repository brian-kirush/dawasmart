from __future__ import annotations

from datetime import date, timedelta
from typing import Any

import numpy as np
import pandas as pd

from forecasting.features import (
    cap_iqr_outliers,
    feature_categories,
    is_weekly_series,
)
from forecasting.models import MODEL_NAMES, forecast

TRAIN_START = date(2022, 1, 1)
TRAIN_END = date(2024, 6, 30)
VALIDATION_START = date(2024, 7, 1)
VALIDATION_END = date(2024, 9, 30)
TEST_START = date(2024, 10, 1)
TEST_END = date(2024, 12, 31)
HORIZON_DAYS = 28


def calculate_metrics(actual: np.ndarray, predicted: np.ndarray) -> dict[str, float]:
    if len(actual) == 0 or len(actual) != len(predicted):
        raise ValueError("Actual and predicted values must have the same non-zero length.")
    error = predicted - actual
    denominator = np.abs(actual) + np.abs(predicted)
    smape_terms = np.divide(
        2 * np.abs(error),
        denominator,
        out=np.zeros_like(denominator, dtype=float),
        where=denominator != 0,
    )
    return {
        "mae": float(np.mean(np.abs(error))),
        "rmse": float(np.sqrt(np.mean(np.square(error)))),
        "smape": float(np.mean(smape_terms) * 100),
    }


def rolling_origin_evaluation(
    series: pd.Series,
    medicine: dict[str, Any],
    medicines: list[dict[str, Any]],
    model_name: str,
    start: date,
    end: date,
) -> tuple[dict[str, float], np.ndarray, np.ndarray]:
    categories = feature_categories(medicines)
    weekly = is_weekly_series(series)
    step_days = 7 if weekly else 1
    steps = HORIZON_DAYS // step_days
    origin = start
    actual_values: list[float] = []
    predicted_values: list[float] = []

    while origin <= end:
        raw_history = series[series.index.date < origin]
        if raw_history.empty:
            origin += timedelta(days=HORIZON_DAYS)
            continue
        history = cap_iqr_outliers(raw_history)
        predictions = forecast(
            model_name,
            history,
            medicine,
            categories,
            steps,
        )
        forecast_end = min(origin + timedelta(days=HORIZON_DAYS - 1), end)
        actual = series[
            (series.index.date >= origin)
            & (series.index.date <= forecast_end)
        ]
        common_dates = actual.index.intersection(predictions.index)
        actual_values.extend(actual.loc[common_dates].to_numpy(dtype=float))
        predicted_values.extend(predictions.loc[common_dates].to_numpy(dtype=float))
        origin += timedelta(days=HORIZON_DAYS)

    actual_array = np.asarray(actual_values, dtype=float)
    predicted_array = np.asarray(predicted_values, dtype=float)
    return calculate_metrics(actual_array, predicted_array), actual_array, predicted_array


def stockout_expiry_simulation(
    actual: np.ndarray,
    predicted: np.ndarray,
    training_mean: float,
    weekly: bool,
) -> dict[str, float]:
    if len(actual) == 0 or len(actual) != len(predicted):
        raise ValueError("Simulation requires aligned actual and predicted values.")
    initial_stock = max(float(training_mean) * (2 if weekly else 14), 0)
    forecast_order = max(float(np.sum(predicted)) - initial_stock, 0)
    on_hand = initial_stock + forecast_order
    stockout_units = 0.0
    expired_units = 0.0
    period_days = 7 if weekly else 1

    for index, demand in enumerate(actual):
        elapsed_days = index * period_days
        if elapsed_days >= 90:
            expired_units += on_hand
            on_hand = 0
        supplied = min(on_hand, float(demand))
        on_hand -= supplied
        stockout_units += max(float(demand) - supplied, 0)

    if len(actual) * period_days >= 90:
        expired_units += on_hand
    return {
        "simulated_stockout_units": float(stockout_units),
        "simulated_expired_units": float(expired_units),
        "assumed_initial_stock_units": float(initial_stock),
        "simulated_order_units": float(forecast_order),
    }


def evaluate_series(
    series: pd.Series,
    medicine: dict[str, Any],
    medicines: list[dict[str, Any]],
) -> dict[str, Any]:
    training = series[
        (series.index.date >= TRAIN_START)
        & (series.index.date <= TRAIN_END)
    ]
    validation = series[
        (series.index.date >= VALIDATION_START)
        & (series.index.date <= VALIDATION_END)
    ]
    test = series[
        (series.index.date >= TEST_START)
        & (series.index.date <= TEST_END)
    ]
    weekly = is_weekly_series(series)
    minimum_training_periods = 120 if weekly else 180
    if len(training) < minimum_training_periods or validation.empty or test.empty:
        raise ValueError("History does not cover the required train/validation/test periods.")

    candidates: dict[str, dict[str, Any]] = {}
    for model_name in MODEL_NAMES:
        validation_metrics, _, _ = rolling_origin_evaluation(
            series, medicine, medicines, model_name, VALIDATION_START, VALIDATION_END
        )
        candidates[model_name] = {"validation": validation_metrics}
    best_model = min(
        candidates,
        key=lambda name: (
            candidates[name]["validation"]["smape"],
            candidates[name]["validation"]["mae"],
        ),
    )
    test_metrics, test_actual, test_predictions = rolling_origin_evaluation(
        series, medicine, medicines, best_model, TEST_START, TEST_END
    )
    baseline_metrics = candidates["seasonal_naive"]["validation"]
    improvement = (
        0.0
        if baseline_metrics["smape"] == 0
        else 100 * (
            baseline_metrics["smape"] - candidates[best_model]["validation"]["smape"]
        ) / baseline_metrics["smape"]
    )
    weekly = is_weekly_series(series)
    simulation = stockout_expiry_simulation(
        test_actual,
        test_predictions,
        float(training.mean()),
        weekly,
    )
    return {
        "selected_model": best_model,
        "validation": candidates[best_model]["validation"],
        "validation_by_model": {
            name: result["validation"] for name, result in candidates.items()
        },
        "test": test_metrics,
        "baseline_validation": baseline_metrics,
        "smape_improvement_vs_baseline_percent": float(improvement),
        "simulation": simulation,
    }
