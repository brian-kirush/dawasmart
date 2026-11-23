from __future__ import annotations

import math
import re
from collections.abc import Sequence

SAFETY_STOCK_Z_SCORE = 1.65
FORECAST_HORIZON_DAYS = 28
MAX_STOCK_QUANTITY = 2_147_483_647


def calculate_reorder(
    daily_forecast: Sequence[float],
    daily_rmse: float,
    lead_time_days: int,
    available_stock: int,
) -> dict[str, int | float | str]:
    if len(daily_forecast) != FORECAST_HORIZON_DAYS:
        raise ValueError("A reorder calculation requires exactly 28 daily forecasts.")
    if not math.isfinite(daily_rmse) or daily_rmse < 0:
        raise ValueError("Daily forecast RMSE must be a finite non-negative value.")
    if not 1 <= lead_time_days <= 365:
        raise ValueError("Supplier lead time must be between 1 and 365 days.")
    if not 0 <= available_stock <= MAX_STOCK_QUANTITY:
        raise ValueError("Available stock is outside the supported integer range.")

    daily_values = [float(value) for value in daily_forecast]
    if any(not math.isfinite(value) or value < 0 for value in daily_values):
        raise ValueError("Daily forecasts must be finite non-negative values.")

    forecast_demand = sum(daily_values)
    forecast_average = forecast_demand / FORECAST_HORIZON_DAYS
    lead_time_demand = sum(daily_values[:lead_time_days])
    if lead_time_days > FORECAST_HORIZON_DAYS:
        lead_time_demand += (
            lead_time_days - FORECAST_HORIZON_DAYS
        ) * forecast_average
    if not math.isfinite(forecast_demand) or not math.isfinite(lead_time_demand):
        raise ValueError("Forecast demand exceeds the supported numeric range.")

    safety_stock_value = (
        SAFETY_STOCK_Z_SCORE * daily_rmse * math.sqrt(lead_time_days)
    )
    if not math.isfinite(safety_stock_value):
        raise ValueError("Safety stock exceeds the supported numeric range.")
    safety_stock = math.ceil(safety_stock_value)
    reorder_point = math.ceil(lead_time_demand) + safety_stock
    target_stock = reorder_point + math.ceil(forecast_demand)
    if target_stock > MAX_STOCK_QUANTITY:
        raise ValueError("The forecast reorder target exceeds the supported quantity.")

    cumulative_demand = 0.0
    days_until_reorder = 0
    projected_stock_at_order = available_stock
    if available_stock < target_stock and available_stock > reorder_point:
        for day_index, demand in enumerate(daily_values):
            projected_stock = available_stock - cumulative_demand
            if projected_stock <= reorder_point or projected_stock - demand <= reorder_point:
                days_until_reorder = day_index
                projected_stock_at_order = projected_stock
                break
            cumulative_demand += demand
        else:
            raise ValueError("The forecast does not reach the calculated reorder point.")

    return {
        "forecast_demand_28_days": round(forecast_demand, 3),
        "lead_time_demand": round(lead_time_demand, 3),
        "safety_stock": safety_stock,
        "reorder_point": reorder_point,
        "target_stock": target_stock,
        "available_stock": available_stock,
        "projected_stock_at_order": round(projected_stock_at_order, 3),
        "days_until_reorder": days_until_reorder,
        "reorder_date_method": "daily forecast",
        "recommended_quantity": max(
            math.ceil(target_stock - projected_stock_at_order),
            0,
        ),
        "lead_time_extension_method": (
            "28-day forecast average"
            if lead_time_days > FORECAST_HORIZON_DAYS
            else "daily forecast"
        ),
    }


def validate_explanation_numbers(
    explanation: str,
    allowed_numbers: set[str],
) -> bool:
    if re.search(
        r"\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|"
        r"eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|"
        r"eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|"
        r"eighty|ninety|hundred|thousand|million|billion|first|second|third)\b",
        explanation,
        re.IGNORECASE,
    ):
        return False
    mentioned_numbers = re.findall(r"(?<![\w.])-?\d+(?:\.\d+)?(?![\w.])", explanation)
    return all(number in allowed_numbers for number in mentioned_numbers)


def explanation_number_tokens(facts: dict[str, object]) -> set[str]:
    source = " ".join(str(value) for value in facts.values())
    tokens = set(re.findall(r"(?<![\w.])-?\d+(?:\.\d+)?(?![\w.])", source))
    for token in tuple(tokens):
        value = float(token)
        if value.is_integer():
            tokens.add(str(int(value)))
    return tokens
