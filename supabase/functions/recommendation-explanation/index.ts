import {
  fallbackExplanation,
  type RecommendationFacts,
} from "./explanation.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function isFacts(value: unknown): value is RecommendationFacts {
  if (!value || typeof value !== "object") return false;
  const facts = value as Record<string, unknown>;
  const numericFields = [
    "forecast_demand_28_days",
    "lead_time_demand",
    "safety_stock",
    "target_stock",
    "available_stock",
    "recommended_quantity",
    "lead_time_days",
    "reorder_point",
    "projected_stock_at_order",
    "days_until_reorder",
    "service_level_percent",
  ];
  const finiteNumbers = numericFields.every((field) => {
    const fieldValue = facts[field];
    return typeof fieldValue === "number" && Number.isFinite(fieldValue);
  });
  return typeof facts.medicine_name === "string" &&
    facts.medicine_name.length <= 200 &&
    typeof facts.dispensing_unit === "string" &&
    facts.dispensing_unit.length <= 80 &&
    typeof facts.recommendation_date === "string" &&
    (facts.dataset_kind === "synthetic" || facts.dataset_kind === "real") &&
    finiteNumbers;
}

function hasServiceRole(request: Request): boolean {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  const payload = token.split(".")[1];
  if (!payload) return false;
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    const claims: unknown = JSON.parse(decoded);
    return Boolean(
      claims &&
        typeof claims === "object" &&
        "role" in claims &&
        claims.role === "service_role",
    );
  } catch {
    return false;
  }
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return Response.json(
      { error: "Method not allowed." },
      { status: 405, headers: corsHeaders },
    );
  }
  if (!hasServiceRole(request)) {
    return Response.json(
      { error: "This function is available only to the forecasting service." },
      { status: 403, headers: corsHeaders },
    );
  }

  const value: unknown = await request.json();
  if (!isFacts(value)) {
    return Response.json(
      { error: "Invalid recommendation facts." },
      { status: 400, headers: corsHeaders },
    );
  }

  return Response.json({
    explanation: fallbackExplanation(value),
    mode: "deterministic",
  }, { headers: corsHeaders });
});
