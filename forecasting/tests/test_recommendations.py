import pytest

from forecasting.recommendations import (
    calculate_reorder,
    validate_explanation_numbers,
)


def test_calculate_reorder_uses_28_day_and_lead_time_demand() -> None:
    result = calculate_reorder([1] * 28, 2, 4, 10)

    assert result == {
        "forecast_demand_28_days": 28,
        "lead_time_demand": 4,
        "safety_stock": 7,
        "reorder_point": 11,
        "target_stock": 39,
        "available_stock": 10,
        "projected_stock_at_order": 10,
        "days_until_reorder": 0,
        "recommended_quantity": 29,
        "lead_time_extension_method": "daily forecast",
        "reorder_date_method": "daily forecast",
    }


def test_calculate_reorder_extends_long_lead_time_with_forecast_average() -> None:
    result = calculate_reorder([1] * 28, 2, 35, 80)

    assert result["lead_time_demand"] == 35
    assert result["reorder_point"] == 55
    assert result["target_stock"] == 83
    assert result["projected_stock_at_order"] == 56
    assert result["days_until_reorder"] == 24
    assert result["recommended_quantity"] == 27
    assert result["lead_time_extension_method"] == "28-day forecast average"


def test_calculate_reorder_dates_future_trigger_and_sizes_for_that_date() -> None:
    result = calculate_reorder([1] * 28, 2, 4, 20)

    assert result["reorder_point"] == 11
    assert result["days_until_reorder"] == 8
    assert result["projected_stock_at_order"] == 12
    assert result["recommended_quantity"] == 27


@pytest.mark.parametrize(
    ("daily_forecast", "daily_rmse", "lead_time_days", "available_stock"),
    [
        ([1] * 27, 1, 1, 0),
        ([1] * 28, -1, 1, 0),
        ([1] * 28, 1, 0, 0),
        ([1] * 28, 1, 1, -1),
        ([1] * 27 + [-1], 1, 1, 0),
    ],
)
def test_calculate_reorder_rejects_invalid_inputs(
    daily_forecast: list[int],
    daily_rmse: int,
    lead_time_days: int,
    available_stock: int,
) -> None:
    with pytest.raises(ValueError):
        calculate_reorder(
            daily_forecast,
            daily_rmse,
            lead_time_days,
            available_stock,
        )


def test_validate_explanation_numbers_rejects_unprovided_figures() -> None:
    allowed_numbers = {"12", "28"}

    assert validate_explanation_numbers(
        "The 12-unit buffer covers the 28-day target.",
        allowed_numbers,
    )
    assert not validate_explanation_numbers(
        "The 12-unit buffer should cover 30 days.",
        allowed_numbers,
    )
    assert not validate_explanation_numbers(
        "One extra order should cover the 12-day interval.",
        allowed_numbers,
    )
