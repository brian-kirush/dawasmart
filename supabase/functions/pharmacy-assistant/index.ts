import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function respond(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status, headers: corsHeaders });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function adminClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    throw new Error("Assistant backend is not configured.");
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function verifyUser(
  client: SupabaseClient,
  authorization: string,
): Promise<{ id: string; pharmacyId: string; fullName: string; role: string }> {
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("AUTH_REQUIRED");

  const {
    data: { user },
    error,
  } = await client.auth.getUser(token);
  if (error || !user) throw new Error("AUTH_REQUIRED");

  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("id, pharmacy_id, full_name, role, is_active")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile || !profile.is_active) throw new Error("PROFILE_REQUIRED");
  return {
    id: profile.id,
    pharmacyId: profile.pharmacy_id,
    fullName: profile.full_name,
    role: profile.role,
  };
}

function intentFor(
  question: string,
):
  | "low_stock"
  | "expiry"
  | "recommendations"
  | "sales"
  | "forecast"
  | "clinical"
  | "general" {
  const text = question.toLowerCase();
  if (
    /diagnos|symptom|dose|dosage|treat|medic(ine)? should|which drug|patient/i
      .test(text)
  ) {
    return "clinical";
  }
  if (/expir|expiry|expire|shelf life/i.test(text)) return "expiry";
  if (/recommend|reorder|purchase|supplier|order/i.test(text)) {
    return "recommendations";
  }
  if (/sale|sell|receipt|revenue|transaction/i.test(text)) return "sales";
  if (/forecast|demand|predict|model/i.test(text)) return "forecast";
  if (/stock|inventory|low|out of stock|batches/i.test(text)) {
    return "low_stock";
  }
  return "general";
}

function medicineLabel(medicine: Record<string, unknown>): string {
  return [medicine.generic_name, medicine.strength].filter(Boolean).join(" ");
}

async function lowStockData(client: SupabaseClient, pharmacyId: string) {
  const { data: medicines, error: medicineError } = await client
    .from("medicines")
    .select("id, generic_name, strength, form, dispensing_unit, is_active")
    .eq("pharmacy_id", pharmacyId)
    .eq("is_active", true);
  if (medicineError) throw medicineError;

  const { data: batches, error: batchError } = await client
    .from("batches")
    .select("medicine_id, quantity_on_hand")
    .eq("pharmacy_id", pharmacyId)
    .gt("expiry_date", new Date().toISOString().slice(0, 10));
  if (batchError) throw batchError;

  const totals = new Map<string, number>();
  for (const batch of batches || []) {
    totals.set(
      batch.medicine_id,
      (totals.get(batch.medicine_id) || 0) + Number(batch.quantity_on_hand),
    );
  }
  return (medicines || []).map((medicine) => ({
    medicine: medicineLabel(medicine),
    unit: medicine.dispensing_unit,
    quantity: totals.get(medicine.id) || 0,
  })).sort((a, b) => a.quantity - b.quantity).slice(0, 10);
}

async function expiryData(client: SupabaseClient, pharmacyId: string) {
  const today = new Date();
  const horizon = new Date(today);
  horizon.setUTCDate(horizon.getUTCDate() + 90);
  const { data, error } = await client
    .from("batches")
    .select(
      "batch_number, expiry_date, quantity_on_hand, medicine_id, medicines(generic_name, strength, dispensing_unit)",
    )
    .eq("pharmacy_id", pharmacyId)
    .gt("quantity_on_hand", 0)
    .gte("expiry_date", today.toISOString().slice(0, 10))
    .lte("expiry_date", horizon.toISOString().slice(0, 10))
    .order("expiry_date", { ascending: true })
    .limit(15);
  if (error) throw error;
  return (data || []).map((row) => ({
    medicine: medicineLabel(
      row.medicines as unknown as Record<string, unknown>,
    ),
    batch: row.batch_number,
    expiry_date: row.expiry_date,
    quantity: Number(row.quantity_on_hand),
  }));
}

async function salesData(client: SupabaseClient, pharmacyId: string) {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 30);
  const { data, error } = await client
    .from("sale_items")
    .select(
      "quantity, unit_price, medicines(generic_name, strength), sales(sold_at, sale_type)",
    )
    .eq("pharmacy_id", pharmacyId)
    .limit(500);
  if (error) throw error;

  const items = (data || []).filter((item) => {
    const sale = item.sales as unknown as Record<string, unknown> | null;
    return typeof sale?.sold_at === "string" &&
      String(sale.sold_at) >= since.toISOString();
  });
  const salesCount = new Set(
    items.map((item) => {
      const sale = item.sales as unknown as Record<string, unknown> | null;
      return sale?.sold_at;
    }).filter((value) => typeof value === "string"),
  ).size;
  const revenue = items.reduce(
    (total, item) => total + Number(item.quantity) * Number(item.unit_price),
    0,
  );
  const units = items.reduce((total, item) => total + Number(item.quantity), 0);
  return {
    period_days: 30,
    sales_count: salesCount,
    units_sold: units,
    value_kes: Number(revenue.toFixed(2)),
  };
}

async function recommendationData(client: SupabaseClient, pharmacyId: string) {
  const { data, error } = await client
    .from("reorder_recommendations")
    .select(
      "status, recommended_quantity, modified_quantity, recommendation_date, explanation, medicines(generic_name, strength, dispensing_unit)",
    )
    .eq("pharmacy_id", pharmacyId)
    .in("status", ["pending", "accepted", "modified"])
    .order("recommendation_date", { ascending: false })
    .limit(15);
  if (error) throw error;
  return (data || []).map((row) => ({
    medicine: medicineLabel(
      row.medicines as unknown as Record<string, unknown>,
    ),
    status: row.status,
    quantity: row.modified_quantity ?? row.recommended_quantity,
    recommendation_date: row.recommendation_date,
  }));
}

async function forecastData(client: SupabaseClient, pharmacyId: string) {
  const { data: run, error: runError } = await client
    .from("forecast_runs")
    .select(
      "id, created_at, model_name, training_start, training_end, dataset_kind",
    )
    .eq("pharmacy_id", pharmacyId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (runError) throw runError;
  if (!run) return { available: false };

  const { data: results, error: resultError } = await client
    .from("forecast_results")
    .select(
      "predicted_demand, forecast_date, medicines(generic_name, strength)",
    )
    .eq("pharmacy_id", pharmacyId)
    .eq("forecast_run_id", run.id)
    .order("forecast_date", { ascending: true })
    .limit(28);
  if (resultError) throw resultError;

  const totals = new Map<string, number>();
  for (const row of results || []) {
    const name = medicineLabel(
      row.medicines as unknown as Record<string, unknown>,
    );
    totals.set(name, (totals.get(name) || 0) + Number(row.predicted_demand));
  }
  return {
    available: true,
    created_at: run.created_at,
    model: run.model_name,
    dataset_kind: run.dataset_kind,
    medicine_totals: [...totals.entries()].map(([medicine, units]) => ({
      medicine,
      predicted_28_day_units: Number(units.toFixed(3)),
    })).slice(0, 15),
  };
}

async function pharmacyFacts(
  client: SupabaseClient,
  pharmacyId: string,
  intent: ReturnType<typeof intentFor>,
): Promise<Record<string, unknown>> {
  if (intent === "low_stock") {
    return {
      threshold_note:
        "Sorted by available unexpired stock; no configured stock threshold.",
      medicines: await lowStockData(client, pharmacyId),
    };
  }
  if (intent === "expiry") {
    return { expiring_within_90_days: await expiryData(client, pharmacyId) };
  }
  if (intent === "sales") {
    return { recent_sales: await salesData(client, pharmacyId) };
  }
  if (intent === "recommendations") {
    return { recommendations: await recommendationData(client, pharmacyId) };
  }
  if (intent === "forecast") {
    return { forecast: await forecastData(client, pharmacyId) };
  }
  return {
    summary:
      "This assistant can answer questions about stock, expiry, sales, forecasts, and reorder recommendations.",
  };
}

function fallbackAnswer(
  intent: ReturnType<typeof intentFor>,
  facts: Record<string, unknown>,
): string {
  if (intent === "low_stock") {
    const rows = facts.medicines as Array<Record<string, unknown>>;
    if (!rows?.length) {
      return "No active medicines or usable unexpired stock records were found.";
    }
    return "Lowest available unexpired stock:\n" +
      rows.map((row) =>
        `- ${row.medicine}: ${row.quantity} ${row.unit || "units"}`
      ).join("\n") +
      "\nThis ranking is not based on a configured low-stock threshold.";
  }
  if (intent === "expiry") {
    const rows = facts.expiring_within_90_days as Array<
      Record<string, unknown>
    >;
    if (!rows?.length) {
      return "No batches with stock are expiring within the next 90 days.";
    }
    return "Batches expiring within 90 days:\n" +
      rows.map((row) =>
        `- ${row.medicine}, batch ${row.batch}: ${row.quantity} units, expires ${row.expiry_date}`
      ).join("\n");
  }
  if (intent === "sales") {
    const row = facts.recent_sales as Record<string, unknown>;
    return `In the last ${row.period_days} days, ${row.sales_count} sale records contain ${row.units_sold} units sold with a recorded value of KES ${row.value_kes}.`;
  }
  if (intent === "recommendations") {
    const rows = facts.recommendations as Array<Record<string, unknown>>;
    if (!rows?.length) {
      return "There are no pending or active reorder recommendations.";
    }
    return "Latest active reorder recommendations:\n" +
      rows.map((row) =>
        `- ${row.medicine}: ${row.quantity} units, ${row.status}, dated ${row.recommendation_date}`
      ).join("\n");
  }
  if (intent === "forecast") {
    const forecast = facts.forecast as Record<string, unknown>;
    if (!forecast.available) {
      return "No forecast run is currently recorded for this pharmacy.";
    }
    const rows = forecast.medicine_totals as Array<Record<string, unknown>>;
    return `Latest ${forecast.dataset_kind} forecast used ${forecast.model}. 28-day totals:\n` +
      (rows?.map((row) =>
        `- ${row.medicine}: ${row.predicted_28_day_units} units`
      ).join("\n") || "- No medicine results.");
  }
  return "I can help with stock, expiry risk, recent sales, forecasts, and reorder recommendations.";
}

async function callProvider(
  question: string,
  intent: string,
  facts: Record<string, unknown>,
): Promise<string | null> {
  const apiKey = Deno.env.get("LLM_API_KEY");
  if (!apiKey) return null;
  const endpoint = Deno.env.get("LLM_API_URL") ||
    "https://api.openai.com/v1/chat/completions";
  const model = Deno.env.get("LLM_MODEL") || "gpt-4o-mini";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        {
          role: "system",
          content: [
            "You are DawaSmart's inventory and forecasting assistant.",
            "Answer only from supplied pharmacy facts. Do not invent numbers or supplier claims.",
            "Do not diagnose, prescribe, recommend dosages, or replace a pharmacist.",
            "Never state that an order was placed or approve a clinical decision.",
            "Keep the answer concise and useful. The user sees data for their own pharmacy only.",
          ].join(" "),
        },
        { role: "user", content: JSON.stringify({ question, intent, facts }) },
      ],
    }),
  });
  if (!response.ok) return null;
  const result = await response.json();
  const content = result?.choices?.[0]?.message?.content;
  return typeof content === "string" && content.trim()
    ? content.trim().slice(0, 3000)
    : null;
}

async function logAssistant(
  client: SupabaseClient,
  profile: Awaited<ReturnType<typeof verifyUser>>,
  question: string,
  answer: string,
  status: "answered" | "unavailable" | "refused",
  toolsUsed: string[],
  responseTimeMs: number,
) {
  await client.from("assistant_logs").insert({
    pharmacy_id: profile.pharmacyId,
    user_id: profile.id,
    question,
    answer,
    tools_used: toolsUsed,
    status,
    response_time_ms: responseTimeMs,
  });
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return respond({ error: "Method not allowed." }, 405);
  }

  const started = Date.now();
  let client: SupabaseClient;
  let profile: Awaited<ReturnType<typeof verifyUser>>;
  try {
    client = adminClient();
    profile = await verifyUser(
      client,
      request.headers.get("authorization") || "",
    );
  } catch (error) {
    const status = error instanceof Error && error.message === "AUTH_REQUIRED"
      ? 401
      : 403;
    return respond({
      error: "Authentication or pharmacy profile verification failed.",
    }, status);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return respond({ error: "Invalid request body." }, 400);
  }
  if (!isRecord(body) || typeof body.question !== "string") {
    return respond({ error: "A question is required." }, 400);
  }

  const question = body.question.trim();
  if (!question || question.length > 1000) {
    return respond(
      { error: "The question must contain 1 to 1000 characters." },
      400,
    );
  }

  const intent = intentFor(question);
  if (intent === "clinical") {
    const answer =
      "I cannot diagnose, recommend medicines or doses, or provide patient-specific clinical advice. Please consult a pharmacist or licensed clinician.";
    await logAssistant(
      client,
      profile,
      question,
      answer,
      "refused",
      [],
      Date.now() - started,
    );
    return respond({ answer, status: "refused" });
  }

  try {
    const facts = await pharmacyFacts(client, profile.pharmacyId, intent);
    const toolsUsed = [intent];
    let answer = await callProvider(question, intent, facts);
    let status: "answered" | "unavailable" = "answered";
    if (!answer) {
      answer = fallbackAnswer(intent, facts);
    }
    await logAssistant(
      client,
      profile,
      question,
      answer,
      status,
      toolsUsed,
      Date.now() - started,
    );
    return respond({ answer, status });
  } catch (error) {
    console.error("Pharmacy assistant query failed:", error);
    const answer =
      "I could not retrieve the pharmacy data needed to answer safely.";
    await logAssistant(client, profile, question, answer, "unavailable", [
      intent,
    ], Date.now() - started);
    return respond({ answer, status: "unavailable" }, 502);
  }
});
