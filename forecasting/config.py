from __future__ import annotations

import os
from dataclasses import dataclass
from uuid import UUID

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    supabase_service_key: str
    forecast_api_token: str
    model_dir: str
    forecast_pharmacy_id: str | None = None

    @classmethod
    def from_env(cls) -> "Settings":
        supabase_url = os.getenv("SUPABASE_URL", "").strip()
        supabase_service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
        forecast_api_token = os.getenv("FORECAST_API_TOKEN", "").strip()
        forecast_pharmacy_id = os.getenv("FORECAST_PHARMACY_ID", "").strip() or None
        if not supabase_url:
            raise ValueError("SUPABASE_URL is required.")
        if not supabase_service_key:
            raise ValueError("SUPABASE_SERVICE_ROLE_KEY is required.")
        if not forecast_api_token:
            raise ValueError("FORECAST_API_TOKEN is required.")
        if forecast_pharmacy_id:
            try:
                UUID(forecast_pharmacy_id)
            except ValueError as error:
                raise ValueError("FORECAST_PHARMACY_ID must be a valid UUID.") from error
        return cls(
            supabase_url=supabase_url.rstrip("/"),
            supabase_service_key=supabase_service_key,
            forecast_api_token=forecast_api_token,
            model_dir=os.getenv("FORECAST_MODEL_DIR", "forecasting/artifacts/models"),
            forecast_pharmacy_id=forecast_pharmacy_id,
        )
