import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2";
import {
  type AssistantIntent,
  extractMedicineQuestion,
  intentFor,
  type MedicineQuestion,
} from "./domain.ts";

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

function medicineLabel(medicine: Record<string, unknown>): string {
  return [medicine.generic_name, medicine.strength].filter(Boolean).join(" ");
}

async function medicineLabelFacts(
  question: MedicineQuestion,
): Promise<Record<string, unknown>> {
  const searchTerm = question.medicine.replace(/["\\]/g, "").trim();
  const query =
    `openfda.generic_name:"${searchTerm}" OR openfda.brand_name:"${searchTerm}"`;
  const url = new URL("https://api.fda.gov/drug/label.json");
  url.searchParams.set("search", query);
  url.searchParams.set("limit", "10");

  const response = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    if (response.status === 404) {
      return { found: false, searched_for: question.medicine };
    }
    throw new Error(
      `Medication label source returned HTTP ${response.status}.`,
    );
  }
  const result: unknown = await response.json();
  if (!isRecord(result) || !Array.isArray(result.results)) {
    throw new Error("Medication label source returned an invalid response.");
  }

  const expected = question.medicine.toLowerCase();
  const label = result.results.find((item: unknown) => {
    if (!isRecord(item) || !isRecord(item.openfda)) return false;
    const names = [
      ...(Array.isArray(item.openfda.generic_name)
        ? item.openfda.generic_name
        : []),
      ...(Array.isArray(item.openfda.brand_name)
        ? item.openfda.brand_name
        : []),
    ];
    return names.some((name) =>
      typeof name === "string" && name.toLowerCase() === expected
    );
  });
  if (!isRecord(label)) {
    return { found: false, searched_for: question.medicine };
  }

  const openfda = isRecord(label.openfda) ? label.openfda : {};
  const labelText = label[question.topic];
  const extracted = Array.isArray(labelText)
    ? labelText.filter((text): text is string => typeof text === "string")
      .join(" ").slice(0, 4000)
    : "";
  const setId = Array.isArray(openfda.spl_set_id)
    ? openfda.spl_set_id.find((value): value is string =>
      typeof value === "string" &&
      /^[0-9a-f-]{36}$/i.test(value)
    )
    : undefined;

  return {
    found: Boolean(extracted),
    searched_for: question.medicine,
    topic: question.topic,
    matching_label_product: Array.isArray(openfda.brand_name)
      ? openfda.brand_name[0]
      : question.medicine,
    manufacturer: Array.isArray(openfda.manufacturer_name)
      ? openfda.manufacturer_name[0]
      : null,
    label_effective_date: label.effective_time ?? null,
    label_excerpt: extracted,
    source: setId
      ? {
        title: "U.S. FDA medication label on DailyMed",
        url:
          `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${setId}`,
      }
      : {
        title: "U.S. FDA drug label database",
        url: "https://open.fda.gov/apis/drug/label/",
      },
    source_disclaimer:
      "U.S. product label data; labels vary by product and country. The source warns that its structured data is not validated for medical-care decisions.",
  };
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
  intent: AssistantIntent,
  question: string,
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
  if (intent === "medicine_info") {
    const medicationQuestion = extractMedicineQuestion(question);
    if (medicationQuestion) {
      return {
        medication_reference: await medicineLabelFacts(medicationQuestion),
      };
    }
  }
  return {
    summary:
      "This assistant can answer questions about stock, expiry, sales, forecasts, and reorder recommendations.",
  };
}

function fallbackAnswer(
  intent: AssistantIntent,
  facts: Record<string, unknown>,
): string {
  if (intent === "medicine_info") {
    const reference = facts.medication_reference as
      | Record<string, unknown>
      | undefined;
    if (!reference?.found) {
      return `I could not find a matching U.S. FDA label for "${
        reference?.searched_for || "that medicine"
      }". Try the active ingredient name, or ask a pharmacist to verify the exact product.`;
    }
    return `I found a matching U.S. product label for ${reference.matching_label_product}, but a safe plain-language summary is unavailable right now. Open the source label and confirm it matches the product you have.`;
  }
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
  intent: AssistantIntent,
  facts: Record<string, unknown>,
): Promise<string | null> {
  const apiKey = Deno.env.get("LLM_API_KEY");
  if (!apiKey) return null;
  const endpoint = Deno.env.get("LLM_API_URL") ||
    "https://api.openai.com/v1/chat/completions";
  const model = Deno.env.get("LLM_MODEL") || "gpt-4o-mini";
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      signal: AbortSignal.timeout(15000),
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
              "For pharmacy questions, answer only from supplied pharmacy facts. For medicine_info, answer only from the supplied U.S. FDA label excerpt.",
              "Do not invent facts, numbers, label contents, or sources.",
              "Never diagnose, prescribe, recommend or calculate a dose, judge whether a medicine is safe for a person, or apply general information to an individual.",
              "Do not call an effect common or frequent unless the supplied label says so. Do not tell a user to start, stop, or change a medicine.",
              "For medicine_info, give brief general educational information, state that labels vary by product and country, and tell the user to verify with a pharmacist.",
              "Never state that an order was placed or approve a clinical decision.",
              "Keep the answer concise and useful. The user sees data for their own pharmacy only.",
            ].join(" "),
          },
          {
            role: "user",
            content: JSON.stringify({
              question: intent === "medicine_info"
                ? extractMedicineQuestion(question)
                : question,
              intent,
              facts,
            }),
          },
        ],
      }),
    });
    if (!response.ok) {
      console.error(`Language model returned HTTP ${response.status}.`);
      return null;
    }
    const result = await response.json();
    const content = result?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) return null;
    const answer = content.trim().slice(0, 3000);
    if (
      intent === "medicine_info" &&
      (/\b\d+(?:\.\d+)?\s*(?:mg|mcg|micrograms?|milligrams?|ml|mL|tablets?|capsules?)\b/i
        .test(answer) ||
        /\b(?:take|give|use)\s+\d+\b/i.test(answer))
    ) return null;
    return answer;
  } catch (error) {
    console.error(
      "Language model request failed; using a grounded fallback.",
      error,
    );
    return null;
  }
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
  if (intent === "greeting") {
    const answer =
      "Hello! I can help with pharmacy stock, expiry, sales, forecasts, reorder suggestions, and general medicine information. What would you like to know?";
    await logAssistant(
      client,
      profile,
      question,
      answer,
      "answered",
      [],
      Date.now() - started,
    );
    return respond({ answer, status: "answered", ai_status: "not_needed" });
  }
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
    const facts = await pharmacyFacts(
      client,
      profile.pharmacyId,
      intent,
      question,
    );
    const toolsUsed = [intent];
    let answer = await callProvider(question, intent, facts);
    const status: "answered" | "unavailable" = "answered";
    const aiStatus = !Deno.env.get("LLM_API_KEY")
      ? "not_configured"
      : answer
      ? "available"
      : "unavailable";
    if (!answer) {
      answer = fallbackAnswer(intent, facts);
    }
    const reference = facts.medication_reference as
      | Record<string, unknown>
      | undefined;
    const safetyNotice = intent === "medicine_info"
      ? [
        "General information only—not a diagnosis or personal treatment advice. This U.S. label may differ from the product registered in Kenya. Verify the exact product with a pharmacist; for personal symptoms, pregnancy, children, or emergencies, consult a qualified clinician.",
        reference?.source_disclaimer,
      ].filter((value): value is string => typeof value === "string")
        .join(" ")
      : undefined;
    const loggedAnswer = safetyNotice ? `${answer}\n\n${safetyNotice}` : answer;
    await logAssistant(
      client,
      profile,
      question,
      loggedAnswer,
      status,
      toolsUsed,
      Date.now() - started,
    );
    const sources = reference?.source ? [reference.source] : [];
    const serviceNotice = aiStatus === "not_configured"
      ? "Language model not configured; showing a direct data-based response."
      : aiStatus === "unavailable"
      ? "Language model unavailable; showing a direct data-based response."
      : undefined;
    return respond({
      answer,
      status,
      ai_status: aiStatus,
      safety_notice: safetyNotice,
      service_notice: serviceNotice,
      sources,
    });
  } catch (error) {
    console.error("Pharmacy assistant query failed:", error);
    const answer =
      "I could not retrieve the pharmacy data needed to answer. Check that the pharmacy-assistant Edge Function and required database migrations are deployed, then review its Supabase function logs.";
    await logAssistant(client, profile, question, answer, "unavailable", [
      intent,
    ], Date.now() - started);
    return respond({
      answer,
      error: "Pharmacy data query failed.",
      status: "unavailable",
    }, 502);
  }
});
