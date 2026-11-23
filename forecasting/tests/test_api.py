from fastapi.testclient import TestClient

import forecasting.app as forecast_app
from forecasting.app import app


def test_forecast_endpoint_requires_service_token(monkeypatch) -> None:
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "server-secret")
    monkeypatch.setenv("FORECAST_API_TOKEN", "test-token")

    response = TestClient(app).post("/forecast/run")

    assert response.status_code == 401


def test_forecast_endpoint_runs_with_valid_service_token(monkeypatch) -> None:
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "server-secret")
    monkeypatch.setenv("FORECAST_API_TOKEN", "test-token")
    monkeypatch.setattr(
        forecast_app,
        "run_forecasts",
        lambda settings: {"forecast_runs_created": 1},
    )

    response = TestClient(app).post(
        "/forecast/run",
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 200
    assert response.json() == {"forecast_runs_created": 1}
