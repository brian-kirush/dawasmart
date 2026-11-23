from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd
from prophet import Prophet
from sklearn.ensemble import RandomForestRegressor
from xgboost import XGBRegressor

from forecasting.data import kenya_holiday_dates
from forecasting.features import feature_frame, is_weekly_series

MODEL_NAMES = ("seasonal_naive", "random_forest", "xgboost", "prophet")


@dataclass
class FittedForecaster:
    name: str
    estimator: Any
    metadata: dict[str, Any]


def fit_estimator(
    name: str,
    history: pd.Series,
    medicine: dict[str, Any],
    categories: tuple[list[str], list[str]],
) -> FittedForecaster:
    if name == "prophet":
        return FittedForecaster(name=name, estimator=_fit_prophet(history), metadata={})
    if name == "seasonal_naive":
        return FittedForecaster(name=name, estimator=None, metadata={})

    features = feature_frame(history, medicine, categories)
    train = features.join(history.rename("target")).dropna()
    if train.empty:
        raise ValueError("Not enough history to build lag features.")
    x_train = train.drop(columns="target")
    y_train = train["target"]
    if name == "random_forest":
        estimator = RandomForestRegressor(
            n_estimators=300,
            min_samples_leaf=2,
            max_features=0.8,
            random_state=42,
            n_jobs=-1,
        )
    elif name == "xgboost":
        estimator = XGBRegressor(
            n_estimators=250,
            max_depth=4,
            learning_rate=0.05,
            subsample=0.9,
            colsample_bytree=0.9,
            objective="reg:squarederror",
            random_state=42,
            n_jobs=1,
        )
    else:
        raise ValueError(f"Unknown forecast model: {name}")
    estimator.fit(x_train, y_train)
    return FittedForecaster(
        name=name,
        estimator=estimator,
        metadata={"feature_columns": list(x_train.columns)},
    )


def forecast(
    name: str,
    history: pd.Series,
    medicine: dict[str, Any],
    categories: tuple[list[str], list[str]],
    steps: int,
) -> pd.Series:
    if steps <= 0 or history.empty:
        return pd.Series(dtype=float, name="prediction")

    if name == "prophet":
        interval = pd.Timedelta(days=7 if _is_weekly(history) else 1)
        future_dates = pd.date_range(
            history.index[-1] + interval,
            periods=steps,
            freq=interval,
        )
        model = _fit_prophet(history, future_dates[-1].date())
        future_frame = pd.DataFrame({
            "ds": future_dates,
            "rainy_season": future_dates.month.isin((3, 4, 5, 10, 11, 12)).astype(int),
        })
        prediction = model.predict(future_frame)["yhat"].to_numpy()
        return pd.Series(np.maximum(prediction, 0), index=future_dates, name="prediction")

    if name == "seasonal_naive":
        period = 52 if _is_weekly(history) else 7
        values = history.to_numpy()
        predictions = [
            float(values[-period + (index % period)])
            if len(values) >= period
            else float(values[-1])
            for index in range(steps)
        ]
        return pd.Series(
            np.maximum(predictions, 0),
            index=_future_index(history, steps),
            name="prediction",
        )

    model = fit_estimator(name, history, medicine, categories).estimator
    working = history.copy()
    predictions: list[float] = []
    for timestamp in _future_index(history, steps):
        extended = pd.concat([
            working,
            pd.Series([np.nan], index=pd.DatetimeIndex([timestamp]), name=working.name),
        ])
        row = feature_frame(extended, medicine, categories).iloc[[-1]]
        prediction = max(float(model.predict(row)[0]), 0.0)
        predictions.append(prediction)
        working.loc[timestamp] = prediction
    return pd.Series(predictions, index=_future_index(history, steps), name="prediction")


def _future_index(history: pd.Series, steps: int) -> pd.DatetimeIndex:
    interval = pd.Timedelta(days=7 if _is_weekly(history) else 1)
    return pd.date_range(
        history.index[-1] + interval,
        periods=steps,
        freq=interval,
    )


def _is_weekly(history: pd.Series) -> bool:
    return is_weekly_series(history)


def _fit_prophet(history: pd.Series, prediction_end: Any | None = None) -> Prophet:
    if len(history) < 60:
        raise ValueError("Prophet needs at least 60 observed periods.")
    dates = history.index
    holiday_end = max(dates.max().date(), prediction_end or dates.max().date())
    holidays_by_date = kenya_holiday_dates(dates.min().date(), holiday_end)
    holiday_frame = pd.DataFrame(
        [
            {"ds": pd.Timestamp(holiday_date), "holiday": name}
            for holiday_date, name in holidays_by_date.items()
        ],
        columns=["ds", "holiday"],
    )
    model = Prophet(
        holidays=holiday_frame if not holiday_frame.empty else None,
        daily_seasonality=not _is_weekly(history),
        weekly_seasonality=not _is_weekly(history),
        yearly_seasonality=True,
        seasonality_mode="multiplicative",
        uncertainty_samples=0,
    )
    model.add_regressor("rainy_season")
    training_frame = pd.DataFrame({
        "ds": dates,
        "y": history.to_numpy(),
        "rainy_season": dates.month.isin((3, 4, 5, 10, 11, 12)).astype(int),
    })
    model.fit(training_frame)
    return model
