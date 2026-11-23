from __future__ import annotations

import hashlib
from datetime import date, timedelta
from typing import Any

import holidays
import numpy as np
import pandas as pd
from supabase import Client, create_client

PAGE_SIZE = 1000


def create_supabase_client(url: str, key: str) -> Client:
    return create_client(url, key)


def fetch_all(
    client: Client,
    table: str,
    columns: str,
    filters: list[tuple[str, str, Any]] | None = None,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        query = client.table(table).select(columns)
        for method, column, value in filters or []:
            query = getattr(query, method)(column, value)
        response = query.order("id").range(offset, offset + PAGE_SIZE - 1).execute()
        page = response.data or []
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            return rows
        offset += PAGE_SIZE


def load_pharmacy_history(
    client: Client,
    pharmacy_id: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    sales = fetch_all(
        client,
        "sales",
        "id, sold_at, sale_type",
        [
            ("eq", "pharmacy_id", pharmacy_id),
            ("eq", "sale_type", "sale"),
        ],
    )
    sale_types = {sale["id"]: sale["sale_type"] for sale in sales}
    sale_dates = {}
    for sale in sales:
        sold_at = pd.Timestamp(sale["sold_at"])
        if sold_at.tzinfo is not None:
            sold_at = sold_at.tz_convert("Africa/Nairobi")
        sale_dates[sale["id"]] = sold_at.date()
    sale_items = fetch_all(
        client,
        "sale_items",
        "sale_id, medicine_id, quantity",
        [("eq", "pharmacy_id", pharmacy_id)],
    )
    daily_totals: dict[tuple[str, date], int] = {}
    for item in sale_items:
        sale_id = item["sale_id"]
        if sale_id not in sale_types:
            continue
        key = (item["medicine_id"], sale_dates[sale_id])
        daily_totals[key] = daily_totals.get(key, 0) + int(item["quantity"])

    history: list[dict[str, Any]] = [
        {"medicine_id": medicine_id, "date": sold_date, "quantity": quantity}
        for (medicine_id, sold_date), quantity in daily_totals.items()
    ]
    return sales, history


def generate_synthetic_history(
    medicines: list[dict[str, Any]],
    end_date: date | None = None,
    start_date: date = date(2022, 1, 1),
) -> list[dict[str, Any]]:
    final_date = end_date or (date.today() - timedelta(days=1))
    if final_date < start_date:
        return []

    year_set = range(start_date.year, final_date.year + 1)
    kenya_holidays = holidays.country_holidays("KE", years=year_set)
    all_dates = pd.date_range(start_date, final_date, freq="D")
    generated: list[dict[str, Any]] = []
    weekday_weights = np.array([0.95, 1.05, 1.1, 1.1, 1.15, 1.25, 0.8])

    for medicine in medicines:
        digest = hashlib.sha256(medicine["id"].encode("utf-8")).digest()
        rng = np.random.default_rng(int.from_bytes(digest[:8], "big"))
        chronic = medicine.get("demand_pattern") == "chronic"
        therapeutic_class = (medicine.get("therapeutic_class") or "").lower()
        base_rate = 2.8 if chronic else 1.15
        if "rehydration" in therapeutic_class:
            base_rate *= 0.7
        series_offset = rng.uniform(0.75, 1.3)

        for timestamp in all_dates:
            current_date = timestamp.date()
            seasonal = 1.0 + 0.12 * np.sin(
                2 * np.pi * (timestamp.dayofyear - 20) / 365.25
            )
            rainy = timestamp.month in (3, 4, 5, 10, 11, 12)
            rain_factor = 1.25 if rainy and (
                "respiratory" in therapeutic_class
                or "analgesic" in therapeutic_class
            ) else 1.05 if rainy else 1.0
            holiday_factor = 0.72 if current_date in kenya_holidays else 1.0
            mean_demand = (
                base_rate
                * series_offset
                * seasonal
                * rain_factor
                * holiday_factor
                * weekday_weights[timestamp.dayofweek]
            )

            if chronic:
                quantity = int(rng.poisson(mean_demand))
            elif rng.random() < 0.24:
                quantity = int(rng.poisson(max(mean_demand * 2.2, 1)))
            else:
                quantity = 0
            generated.append({
                "medicine_id": medicine["id"],
                "date": current_date,
                "quantity": quantity,
            })
    return generated


def kenya_holiday_dates(start: date, end: date) -> dict[date, str]:
    if end < start:
        return {}
    calendar = holidays.country_holidays("KE", years=range(start.year, end.year + 1))
    return {
        holiday_date: name
        for holiday_date, name in calendar.items()
        if start <= holiday_date <= end
    }
