import numpy as np

from forecasting.evaluation import calculate_metrics, stockout_expiry_simulation


def test_smape_is_zero_when_actual_and_prediction_are_both_zero() -> None:
    metrics = calculate_metrics(np.array([0.0, 2.0]), np.array([0.0, 2.0]))

    assert metrics == {"mae": 0.0, "rmse": 0.0, "smape": 0.0}


def test_simulation_reports_stockout_when_demand_exceeds_forecasted_supply() -> None:
    simulation = stockout_expiry_simulation(
        actual=np.array([20.0, 20.0]),
        predicted=np.array([1.0, 1.0]),
        training_mean=0.0,
        weekly=False,
    )

    assert simulation["simulated_stockout_units"] == 38.0
    assert simulation["simulated_order_units"] == 2.0


def test_weekly_simulation_counts_remaining_stock_as_expired_at_day_90() -> None:
    simulation = stockout_expiry_simulation(
        actual=np.zeros(13),
        predicted=np.zeros(13),
        training_mean=10.0,
        weekly=True,
    )

    assert simulation["simulated_expired_units"] == 20.0


def test_simulation_does_not_count_remaining_stock_as_expired_before_day_90() -> None:
    simulation = stockout_expiry_simulation(
        actual=np.zeros(12),
        predicted=np.zeros(12),
        training_mean=10.0,
        weekly=True,
    )

    assert simulation["simulated_expired_units"] == 0.0
