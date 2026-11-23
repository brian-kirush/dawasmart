from datetime import date

import numpy as np
import pandas as pd
import pytest

import forecasting.service as forecasting_service
from forecasting.config import Settings

TEST_PHARMACY_ID = "11111111-1111-4111-8111-111111111111"


class FakeQuery:
    def __init__(self, client, table):
        self.client = client
        self.table = table
        self.payload = None

    def insert(self, payload):
        self.payload = payload
        return self

    def execute(self):
        self.client.writes[self.table].append(self.payload)
        return self


class FakeClient:
    def __init__(self):
        self.writes = {
            "forecast_runs": [],
            "forecast_results": [],
            "reorder_recommendations": [],
        }
        self.functions = FakeFunctions()

    def table(self, name):
        return FakeQuery(self, name)


class FakeFunctions:
    def __init__(self):
        self.calls = []

    def invoke(self, name, options):
        self.calls.append((name, options))

        class Response:
            data = {
                "explanation": (
                    "Stock is below the 39-unit target; a pharmacist makes "
                    "the final decision."
                ),
            }

        return Response()


def test_forecast_run_includes_every_medicine_selected_for_a_pharmacy(monkeypatch) -> None:
    client = FakeClient()
    medicines = [
        {
            "id": "medicine-1",
            "generic_name": "Medicine one",
            "strength": "10 mg",
            "dispensing_unit": "tablet",
            "therapeutic_class": "Analgesic",
            "demand_pattern": "acute",
        },
        {
            "id": "medicine-2",
            "generic_name": "Medicine two",
            "strength": "500 mg",
            "dispensing_unit": "capsule",
            "therapeutic_class": "Antidiabetic",
            "demand_pattern": "chronic",
        },
    ]
    history = [
        {"medicine_id": medicine["id"], "date": date(2024, 1, 1), "quantity": 1}
        for medicine in medicines
    ]
    series = pd.Series(
        [1.0, 2.0],
        index=pd.to_datetime(["2024-01-01", "2024-01-02"]),
        name="demand",
    )
    pharmacy_filters = []
    monkeypatch.setattr(
        forecasting_service,
        "create_supabase_client",
        lambda url, key: client,
    )

    def fetch_records(client, table, columns, filters=None):
        if table == "pharmacies":
            pharmacy_filters.append(filters)
            return [{"id": TEST_PHARMACY_ID, "dataset_kind": "synthetic"}]
        if table == "medicines":
            return medicines
        if table == "batches":
            return [
                {
                    "medicine_id": "medicine-1",
                    "supplier_id": "supplier-1",
                    "expiry_date": "2024-12-01",
                    "quantity_on_hand": 10,
                    "created_at": "2024-01-01T10:00:00+00:00",
                },
                {
                    "medicine_id": "medicine-1",
                    "supplier_id": "supplier-1",
                    "expiry_date": "2024-01-02",
                    "quantity_on_hand": 1000,
                    "created_at": "2023-12-01T10:00:00+00:00",
                },
                {
                    "medicine_id": "medicine-2",
                    "supplier_id": "supplier-1",
                    "expiry_date": "2024-12-01",
                    "quantity_on_hand": 100,
                    "created_at": "2024-01-01T10:00:00+00:00",
                },
            ]
        if table == "suppliers":
            return [{
                "id": "supplier-1",
                "name": "Demo supplier",
                "lead_time_days": 4,
                "is_active": True,
            }]
        raise AssertionError(f"Unexpected table requested: {table}")

    monkeypatch.setattr(forecasting_service, "fetch_all", fetch_records)
    monkeypatch.setattr(
        forecasting_service,
        "generate_synthetic_history",
        lambda medicines, end_date=None: history,
    )
    monkeypatch.setattr(forecasting_service, "daily_series", lambda *args, **kwargs: series)
    monkeypatch.setattr(
        forecasting_service,
        "prepare_series",
        lambda series, decision_end=None: (series, "daily"),
    )
    monkeypatch.setattr(
        forecasting_service,
        "evaluate_series",
        lambda series, medicine, medicines: {
            "selected_model": "seasonal_naive",
            "test": {"rmse": 2.0},
        },
    )
    monkeypatch.setattr(
        forecasting_service,
        "forecast",
        lambda *args, **kwargs: pd.Series(np.ones(28)),
    )
    monkeypatch.setattr(
        forecasting_service,
        "fit_estimator",
        lambda *args, **kwargs: object(),
    )
    monkeypatch.setattr(forecasting_service, "_save_model", lambda *args: None)
    monkeypatch.setattr(
        forecasting_service,
        "_nairobi_today",
        lambda: date(2024, 1, 3),
    )

    result = forecasting_service.run_forecasts(
        Settings(
            "https://example.supabase.co",
            "server-key",
            "api-token",
            "/tmp/models",
            TEST_PHARMACY_ID,
        )
    )

    assert pharmacy_filters == [[
        ("eq", "id", TEST_PHARMACY_ID),
    ]]
    assert result["forecast_runs_created"] == 1
    assert result["forecast_results_written"] == 56
    assert result["recommendations_written"] == 1
    assert result["skipped_recommendations"] == []
    assert len(client.writes["forecast_runs"]) == 1
    run = client.writes["forecast_runs"][0]
    assert run["model_name"] == "per_medicine_selection"
    assert set(run["metrics"]["medicine_metrics"]) == {"medicine-1", "medicine-2"}
    assert len(client.writes["forecast_results"][0]) == 56
    recommendations = client.writes["reorder_recommendations"][0]
    assert len(recommendations) == 1
    assert recommendations[0]["medicine_id"] == "medicine-1"
    assert recommendations[0]["supplier_id"] == "supplier-1"
    assert recommendations[0]["lead_time_days"] == 4
    assert recommendations[0]["recommended_quantity"] == 29
    assert recommendations[0]["safety_stock"] == 7
    assert recommendations[0]["rationale"]["available_stock"] == 10
    assert recommendations[0]["recommendation_date"] == "2024-01-03"
    assert recommendations[0]["rationale"]["generated_date"] == "2024-01-03"
    assert "pharmacist makes the final decision" in recommendations[0]["explanation"]
    assert client.functions.calls[0][0] == "recommendation-explanation"
    assert client.functions.calls[0][1]["body"]["medicine_name"] == "Medicine one 10 mg"


def test_missing_scoped_pharmacy_stops_instead_of_processing_all(monkeypatch) -> None:
    client = FakeClient()
    monkeypatch.setattr(
        forecasting_service,
        "create_supabase_client",
        lambda url, key: client,
    )
    monkeypatch.setattr(
        forecasting_service,
        "fetch_all",
        lambda client, table, columns, filters=None: [],
    )

    with pytest.raises(ValueError, match="did not match a pharmacy"):
        forecasting_service.run_forecasts(
            Settings(
                "https://example.supabase.co",
                "server-key",
                "api-token",
                "/tmp/models",
                TEST_PHARMACY_ID,
            )
        )

    assert client.writes == {
        "forecast_runs": [],
        "forecast_results": [],
        "reorder_recommendations": [],
    }
