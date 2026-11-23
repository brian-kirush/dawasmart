import { fallbackExplanation } from "./explanation.ts";

Deno.test("fallback explanation uses stored facts and pharmacist review", () => {
  const result = fallbackExplanation({
    medicine_name: "Paracetamol",
    dispensing_unit: "tablet",
    recommendation_date: "2026-11-23",
    dataset_kind: "real",
    forecast_demand_28_days: 25,
    lead_time_demand: 10,
    safety_stock: 4,
    target_stock: 39,
    available_stock: 12,
    recommended_quantity: 27,
    lead_time_days: 10,
    reorder_point: 14,
    projected_stock_at_order: 2,
    days_until_reorder: 10,
    service_level_percent: 95,
  });
  if (
    !result.includes("12 tablet") ||
    !result.includes("39 tablet") ||
    !result.includes("27 tablet") ||
    !result.includes("review") ||
    !result.includes("pharmacist")
  ) {
    throw new Error(
      "Expected the fallback to use source values and review language.",
    );
  }
  if ((result.match(/[.!?](?=\s|$)/g) || []).length !== 1) {
    throw new Error("Expected exactly one sentence.");
  }
});

Deno.test("synthetic recommendations are labeled as demonstration data", () => {
  const result = fallbackExplanation({
    medicine_name: "Example medicine",
    dispensing_unit: "pack",
    recommendation_date: "2026-11-23",
    dataset_kind: "synthetic",
    forecast_demand_28_days: 0,
    lead_time_demand: 0,
    safety_stock: 0,
    target_stock: 0,
    available_stock: 0,
    recommended_quantity: 0,
    lead_time_days: 1,
    reorder_point: 0,
    projected_stock_at_order: 0,
    days_until_reorder: 0,
    service_level_percent: 95,
  });
  if (!result.startsWith("For synthetic demonstration data,")) {
    throw new Error("Expected synthetic data to be labeled.");
  }
});
