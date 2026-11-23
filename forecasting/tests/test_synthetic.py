from datetime import date

from forecasting.data import generate_synthetic_history


def test_synthetic_history_is_repeatable_and_stays_within_requested_dates() -> None:
    medicines = [{
        "id": "test-medicine",
        "therapeutic_class": "Analgesic",
        "demand_pattern": "acute",
    }]

    first = generate_synthetic_history(
        medicines,
        start_date=date(2024, 1, 1),
        end_date=date(2024, 1, 10),
    )
    second = generate_synthetic_history(
        medicines,
        start_date=date(2024, 1, 1),
        end_date=date(2024, 1, 10),
    )

    assert first == second
    assert len(first) == 10
    assert {row["date"] for row in first} == {
        date(2024, 1, day) for day in range(1, 11)
    }
