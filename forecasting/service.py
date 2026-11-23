from __future__ import annotations

import logging
import os
from datetime import date, timedelta
from pathlib import Path
from typing import Any
from uuid import uuid4

import joblib
import pandas as pd
from supabase import Client

from forecasting.config import Settings
from forecasting.data import (
    create_supabase_client,
    fetch_all,
    generate_synthetic_history,
    load_pharmacy_history,
)
from forecasting.evaluation import evaluate_series
from forecasting.features import (
    cap_iqr_outliers,
    daily_series,
    feature_categories,
    prepare_series,
)
from forecasting.models import fit_estimator, forecast
from forecasting.recommendations import (
    calculate_reorder,
    explanation_number_tokens,
    validate_explanation_numbers,
)

logger = logging.getLogger(__name__)


def _nairobi_today() -> date:
    return pd.Timestamp.now(tz="Africa/Nairobi").date()


def _future_result_rows(
    pharmacy_id: str,
    medicine_id: str,
    run_id: str,
    predictions: pd.Series,
    weekly: bool,
    today: date | None = None,
) -> list[dict[str, Any]]:
    forecast_start = today or _nairobi_today()
    daily_predictions: list[float] = []
    if weekly:
        for prediction in predictions.to_numpy(dtype=float):
            daily_predictions.extend([max(float(prediction) / 7, 0)] * 7)
    else:
        daily_predictions = [max(float(value), 0) for value in predictions.to_numpy()]
    daily_predictions = daily_predictions[:28]
    while len(daily_predictions) < 28:
        daily_predictions.append(0.0)
    return [
        {
            "pharmacy_id": pharmacy_id,
            "medicine_id": medicine_id,
            "forecast_run_id": run_id,
            "forecast_date": (forecast_start + timedelta(days=index)).isoformat(),
            "predicted_demand": round(value, 3),
            "lower_bound": None,
            "upper_bound": None,
        }
        for index, value in enumerate(daily_predictions)
    ]


def _save_model(
    settings: Settings,
    pharmacy_id: str,
    medicine_id: str,
    model_name: str,
    fitted_model: Any,
) -> None:
    path = Path(settings.model_dir) / pharmacy_id / f"{medicine_id}-{model_name}.joblib"
    path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(fitted_model, path)


def _recommendation_explanation(
    client: Client,
    facts: dict[str, Any],
) -> str:
    response = client.functions.invoke(
        "recommendation-explanation",
        {"body": facts},
    )
    data = response.data
    if not isinstance(data, dict):
        raise ValueError("Recommendation explanation function returned invalid data.")
    explanation = data.get("explanation")
    if not isinstance(explanation, str) or not explanation.strip():
        raise ValueError("Recommendation explanation function returned no explanation.")

    normalized = explanation.strip()
    if not validate_explanation_numbers(
        normalized,
        explanation_number_tokens(facts),
    ):
        logger.warning(
            "Recommendation explanation mentioned figures outside its stored facts; "
            "using the raw stored values for %s.",
            facts["medicine_name"],
        )
        return (
            f"For {facts['medicine_name']}, the {facts['target_stock']} "
            f"{facts['dispensing_unit']} target uses "
            f"{facts['forecast_demand_28_days']} predicted for 28 days plus "
            f"{facts['lead_time_demand']} expected during the "
            f"{facts['lead_time_days']}-day lead time and "
            f"{facts['safety_stock']} safety-stock units; "
            f"{facts['available_stock']} are currently available, so review "
            f"the suggested {facts['recommended_quantity']} "
            f"{facts['dispensing_unit']} with a pharmacist."
        )
    return normalized


def _build_recommendations(
    client: Client,
    pharmacy_id: str,
    run_id: str,
    dataset_kind: str,
    today: date,
    evaluated: list[dict[str, Any]],
    forecast_rows_by_medicine: dict[str, list[dict[str, Any]]],
    batches: list[dict[str, Any]],
    suppliers: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    suppliers_by_id = {supplier["id"]: supplier for supplier in suppliers}
    latest_supplier_by_medicine: dict[str, tuple[str, str]] = {}
    for batch in batches:
        supplier_id = batch.get("supplier_id")
        if not supplier_id:
            continue
        medicine_id = batch["medicine_id"]
        created_at = str(batch.get("created_at") or "")
        latest = latest_supplier_by_medicine.get(medicine_id)
        if latest is None or created_at > latest[1]:
            latest_supplier_by_medicine[medicine_id] = (supplier_id, created_at)

    batches_by_medicine: dict[str, list[dict[str, Any]]] = {}
    for batch in batches:
        batches_by_medicine.setdefault(batch["medicine_id"], []).append(batch)

    recommendations: list[dict[str, Any]] = []
    skipped: list[dict[str, str]] = []
    for item in evaluated:
        medicine_id = item["medicine_id"]
        selected_supplier = latest_supplier_by_medicine.get(medicine_id)
        if selected_supplier is None:
            skipped.append({
                "medicine_id": medicine_id,
                "reason": "No supplier is recorded on a batch for this medicine.",
            })
            continue

        supplier_id = selected_supplier[0]
        supplier = suppliers_by_id.get(supplier_id)
        if not supplier or not supplier.get("is_active"):
            skipped.append({
                "medicine_id": medicine_id,
                "reason": "The most recently used supplier is unavailable.",
            })
            continue
        lead_time_days = supplier.get("lead_time_days")
        if lead_time_days is None:
            skipped.append({
                "medicine_id": medicine_id,
                "reason": "Configure this supplier's lead time before generating recommendations.",
            })
            continue

        medicine_batches = batches_by_medicine.get(medicine_id, [])
        available_stock = sum(
            int(batch["quantity_on_hand"])
            for batch in medicine_batches
            if batch["expiry_date"] >= today.isoformat()
        )
        forecast_rows = forecast_rows_by_medicine[medicine_id]
        daily_forecast = [
            float(row["predicted_demand"])
            for row in forecast_rows
        ]
        weekly_scale = 7 if item["frequency"] == "weekly" else 1
        daily_rmse = float(item["evaluation"]["test"]["rmse"]) / weekly_scale
        calculation = calculate_reorder(
            daily_forecast,
            daily_rmse,
            int(lead_time_days),
            available_stock,
        )
        quantity = int(calculation["recommended_quantity"])
        if quantity == 0:
            continue

        recommendation_date = (
            today + timedelta(days=int(calculation["days_until_reorder"]))
        ).isoformat()
        medicine = item["medicine"]
        facts: dict[str, Any] = {
            "medicine_name": " ".join(
                value for value in (medicine["generic_name"], medicine.get("strength")) if value
            ),
            "dispensing_unit": medicine["dispensing_unit"],
            "recommendation_date": recommendation_date,
            "dataset_kind": dataset_kind,
            "forecast_demand_28_days": calculation["forecast_demand_28_days"],
            "lead_time_demand": calculation["lead_time_demand"],
            "safety_stock": calculation["safety_stock"],
            "target_stock": calculation["target_stock"],
            "available_stock": available_stock,
            "recommended_quantity": quantity,
            "lead_time_days": int(lead_time_days),
            "reorder_point": int(calculation["reorder_point"]),
            "projected_stock_at_order": calculation["projected_stock_at_order"],
            "days_until_reorder": int(calculation["days_until_reorder"]),
            "service_level_percent": 95,
        }
        explanation = _recommendation_explanation(client, facts)
        recommendations.append({
            "pharmacy_id": pharmacy_id,
            "medicine_id": medicine_id,
            "forecast_run_id": run_id,
            "supplier_id": supplier_id,
            "lead_time_days": int(lead_time_days),
            "recommendation_date": recommendation_date,
            "recommended_quantity": quantity,
            "safety_stock": int(calculation["safety_stock"]),
            "rationale": {
                **calculation,
                "supplier_id": supplier_id,
                "supplier_name": supplier["name"],
                "lead_time_days": int(lead_time_days),
                "generated_date": today.isoformat(),
                "daily_rmse": round(daily_rmse, 3),
                "safety_stock_service_level_percent": 95,
                "safety_stock_formula": (
                    "ceil(1.65 * daily_rmse * sqrt(lead_time_days))"
                ),
                "review_period_days": 28,
                "forecast_run_id": run_id,
                "dataset_kind": dataset_kind,
                "stock_counted_as_available": (
                    "on-hand stock in batches not expired on the recommendation date"
                ),
                "recommendation_date_semantics": (
                    "estimated date stock reaches the reorder point; not an order"
                ),
            },
            "explanation": explanation,
        })

    return recommendations, skipped


def run_forecasts(settings: Settings | None = None) -> dict[str, Any]:
    active_settings = settings or Settings.from_env()
    client = create_supabase_client(
        active_settings.supabase_url,
        active_settings.supabase_service_key,
    )
    pharmacies = fetch_all(
        client,
        "pharmacies",
        "id, dataset_kind",
        (
            [("eq", "id", active_settings.forecast_pharmacy_id)]
            if active_settings.forecast_pharmacy_id
            else None
        ),
    )
    if active_settings.forecast_pharmacy_id and not pharmacies:
        raise ValueError(
            "FORECAST_PHARMACY_ID did not match a pharmacy in the configured Supabase project."
        )
    result = {
        "pharmacies_processed": 0,
        "forecast_runs_created": 0,
        "forecast_results_written": 0,
        "recommendations_written": 0,
        "skipped_medicines": [],
        "skipped_recommendations": [],
    }

    for pharmacy in pharmacies:
        pharmacy_id = pharmacy["id"]
        medicines = fetch_all(
            client,
            "medicines",
            "id, generic_name, strength, dispensing_unit, therapeutic_class, demand_pattern",
            [
                ("eq", "pharmacy_id", pharmacy_id),
                ("eq", "is_active", True),
            ],
        )
        if not medicines:
            logger.info("Skipping pharmacy %s: no active medicines.", pharmacy_id)
            continue

        if pharmacy["dataset_kind"] == "synthetic":
            records = generate_synthetic_history(
                medicines,
                end_date=_nairobi_today() - timedelta(days=1),
            )
        else:
            _, records = load_pharmacy_history(client, pharmacy_id)

        category_set = feature_categories(medicines)
        evaluated: list[dict[str, Any]] = []
        for medicine in medicines:
            medicine_id = medicine["id"]
            matching_records = [
                record for record in records if record["medicine_id"] == medicine_id
            ]
            if not matching_records:
                result["skipped_medicines"].append({
                    "pharmacy_id": pharmacy_id,
                    "medicine_id": medicine_id,
                    "reason": "No sales history available.",
                })
                continue

            last_history_date = _nairobi_today() - timedelta(days=1)
            first_history_date = (
                date(2022, 1, 1)
                if pharmacy["dataset_kind"] == "synthetic"
                else min(record["date"] for record in matching_records)
            )
            series = daily_series(
                matching_records,
                medicine_id,
                start=first_history_date,
                end=last_history_date,
            )
            series, frequency = prepare_series(series, decision_end=date(2024, 6, 30))
            try:
                evaluation = evaluate_series(series, medicine, medicines)
            except ValueError as error:
                result["skipped_medicines"].append({
                    "pharmacy_id": pharmacy_id,
                    "medicine_id": medicine_id,
                    "reason": str(error),
                })
                continue

            weekly = frequency == "weekly"
            forecast_steps = 4 if weekly else 28
            selected_model = evaluation["selected_model"]
            training_series = cap_iqr_outliers(series)
            predictions = forecast(
                selected_model,
                training_series,
                medicine,
                category_set,
                forecast_steps,
            )
            fitted_model = fit_estimator(
                selected_model,
                training_series,
                medicine,
                category_set,
            )
            _save_model(
                active_settings,
                pharmacy_id,
                medicine_id,
                selected_model,
                fitted_model,
            )
            evaluated.append({
                "medicine_id": medicine_id,
                "medicine": medicine,
                "model_name": selected_model,
                "series": series,
                "frequency": frequency,
                "evaluation": evaluation,
                "predictions": predictions,
            })

        if not evaluated:
            continue

        run_id = str(uuid4())
        start_date = min(item["series"].index.min().date() for item in evaluated)
        end_date = max(item["series"].index.max().date() for item in evaluated)
        metrics = {
            "horizon_days": 28,
            "dataset_kind": pharmacy["dataset_kind"],
            "methodology": {
                "train": "2022-01-01 to 2024-06-30",
                "validation": "2024-07-01 to 2024-09-30",
                "test": "2024-10-01 to 2024-12-31",
                "model_selection": "28-day rolling-origin validation, lowest sMAPE",
                "outliers": "upper IQR cap at Q3 + 1.5 * IQR",
                "inventory_simulation": (
                    "opening stock is 14 training-mean days; "
                    "forecast covers the test-period order; remaining stock "
                    "at day 90 is counted as expired"
                ),
            },
            "medicine_metrics": {
                item["medicine_id"]: item["evaluation"]
                for item in evaluated
            },
        }
        today = _nairobi_today()
        forecast_rows_by_medicine = {
            item["medicine_id"]: _future_result_rows(
                pharmacy_id,
                item["medicine_id"],
                run_id,
                item["predictions"],
                item["frequency"] == "weekly",
                today,
            )
            for item in evaluated
        }
        rows = [
            forecast_row
            for medicine_rows in forecast_rows_by_medicine.values()
            for forecast_row in medicine_rows
        ]
        run_row = {
            "id": run_id,
            "pharmacy_id": pharmacy_id,
            "dataset_kind": pharmacy["dataset_kind"],
            "model_name": "per_medicine_selection",
            "training_start": start_date.isoformat(),
            "training_end": end_date.isoformat(),
            "horizon_days": 28,
            "metrics": metrics,
        }
        client.table("forecast_runs").insert(run_row).execute()

        try:
            client.table("forecast_results").insert(rows).execute()
        except Exception:
            logger.exception(
                "Could not write forecast results for run %s; removing the empty run.",
                run_id,
            )
            client.table("forecast_runs").delete().eq("id", run_id).execute()
            raise

        batches = fetch_all(
            client,
            "batches",
            "medicine_id, supplier_id, expiry_date, quantity_on_hand, created_at",
            [("eq", "pharmacy_id", pharmacy_id)],
        )
        suppliers = fetch_all(
            client,
            "suppliers",
            "id, name, lead_time_days, is_active",
            [("eq", "pharmacy_id", pharmacy_id)],
        )
        recommendation_rows, skipped_recommendations = _build_recommendations(
            client,
            pharmacy_id,
            run_id,
            pharmacy["dataset_kind"],
            today,
            evaluated,
            forecast_rows_by_medicine,
            batches,
            suppliers,
        )
        result["skipped_recommendations"].extend(skipped_recommendations)
        if recommendation_rows:
            client.table("reorder_recommendations").insert(
                recommendation_rows
            ).execute()
            result["recommendations_written"] += len(recommendation_rows)

        result["forecast_runs_created"] += 1
        result["forecast_results_written"] += len(rows)

        result["pharmacies_processed"] += 1

    return result


def main() -> None:
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
    outcome = run_forecasts()
    logger.info("Forecast run completed: %s", outcome)


if __name__ == "__main__":
    main()
