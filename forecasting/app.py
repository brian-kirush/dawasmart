from __future__ import annotations

import hmac
import logging
import os

from fastapi import FastAPI, Header, HTTPException

from forecasting.config import Settings
from forecasting.service import run_forecasts

logger = logging.getLogger(__name__)
app = FastAPI(title="DawaSmart Forecasting Service", version="0.1.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/forecast/run")
def run_forecast(authorization: str | None = Header(default=None)) -> dict[str, object]:
    try:
        settings = Settings.from_env()
    except ValueError as error:
        logger.error("Forecasting service configuration is incomplete: %s", error)
        raise HTTPException(status_code=503, detail="Forecasting service is not configured.") from error

    expected = f"Bearer {settings.forecast_api_token}"
    if authorization is None or not hmac.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="Unauthorized.")

    try:
        return run_forecasts(settings)
    except Exception as error:
        logger.exception("Forecasting run failed.")
        raise HTTPException(
            status_code=500,
            detail="Forecasting run failed. Check the service logs.",
        ) from error


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "forecasting.app:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8000")),
    )
