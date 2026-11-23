export type RecommendationFacts = {
  medicine_name: string;
  dispensing_unit: string;
  recommendation_date: string;
  dataset_kind: "synthetic" | "real";
  forecast_demand_28_days: number;
  lead_time_demand: number;
  safety_stock: number;
  target_stock: number;
  available_stock: number;
  recommended_quantity: number;
  lead_time_days: number;
  reorder_point: number;
  projected_stock_at_order: number;
  days_until_reorder: number;
  service_level_percent: number;
};

export function fallbackExplanation(facts: RecommendationFacts): string {
  const datasetLabel = facts.dataset_kind === "synthetic"
    ? "For synthetic demonstration data, "
    : "";
  return `${datasetLabel}${facts.medicine_name} has ${facts.available_stock} ${facts.dispensing_unit} available against a ${facts.target_stock} ${facts.dispensing_unit} target, based on forecast demand of ${facts.forecast_demand_28_days} units over 28 days, ${facts.lead_time_demand} units during the ${facts.lead_time_days}-day supplier lead time, and ${facts.safety_stock} safety-stock units; review the suggested ${facts.recommended_quantity} ${facts.dispensing_unit} with a pharmacist.`;
}
