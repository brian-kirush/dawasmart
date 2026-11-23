import pytest

from forecasting.config import Settings


def set_required_settings(monkeypatch) -> None:
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "server-key")
    monkeypatch.setenv("FORECAST_API_TOKEN", "api-token")


def test_settings_accept_a_valid_pharmacy_scope(monkeypatch) -> None:
    set_required_settings(monkeypatch)
    monkeypatch.setenv(
        "FORECAST_PHARMACY_ID",
        "11111111-1111-4111-8111-111111111111",
    )

    settings = Settings.from_env()

    assert settings.forecast_pharmacy_id == "11111111-1111-4111-8111-111111111111"


def test_settings_reject_an_invalid_pharmacy_scope(monkeypatch) -> None:
    set_required_settings(monkeypatch)
    monkeypatch.setenv("FORECAST_PHARMACY_ID", "not-a-uuid")

    with pytest.raises(ValueError, match="FORECAST_PHARMACY_ID must be a valid UUID"):
        Settings.from_env()
