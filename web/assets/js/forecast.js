import { getAuthenticatedContext } from "./auth-session.js";

const statusMessage = document.querySelector("#forecast-status");
const updatedLabel = document.querySelector("#forecast-updated");
const datasetNote = document.querySelector("#forecast-dataset-note");
const emptyState = document.querySelector("#forecast-empty");
const content = document.querySelector("#forecast-content");
const medicinePicker = document.querySelector("#forecast-medicine");
const tableRows = document.querySelector("#forecast-rows");
const quantityFormat = new Intl.NumberFormat("en-KE", {
  maximumFractionDigits: 3,
});
const modelLabels = {
  seasonal_naive: "Seasonal baseline",
  random_forest: "Random Forest",
  xgboost: "XGBoost",
  prophet: "Prophet",
};

let chart;
let forecastByMedicine = new Map();
let medicineById = new Map();
let metricsByMedicine = {};

function nairobiDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatRunDate(dateString) {
  return new Intl.DateTimeFormat("en-KE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Nairobi",
  }).format(new Date(dateString));
}

function showEmptyState(title, message) {
  document.querySelector("#forecast-empty-title").textContent = title;
  document.querySelector("#forecast-empty-message").textContent = message;
  emptyState.hidden = false;
  content.hidden = true;
  updatedLabel.textContent = "No forecast";
}

async function fetchForecastResults(client, pharmacyId, runId) {
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client.from("forecast_results")
      .select("medicine_id, forecast_date, predicted_demand")
      .eq("pharmacy_id", pharmacyId)
      .eq("forecast_run_id", runId)
      .order("medicine_id", { ascending: true })
      .order("forecast_date", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < pageSize) return rows;
  }
}

async function fetchMedicines(client, pharmacyId, medicineIds) {
  const medicines = [];
  for (let index = 0; index < medicineIds.length; index += 500) {
    const batch = medicineIds.slice(index, index + 500);
    const { data, error } = await client.from("medicines")
      .select("id, generic_name, strength, dispensing_unit")
      .eq("pharmacy_id", pharmacyId)
      .in("id", batch);
    if (error) throw error;
    medicines.push(...data);
  }
  return medicines;
}

function modelName(medicineId) {
  const name = metricsByMedicine[medicineId]?.selected_model;
  return modelLabels[name] || "Not recorded";
}

function medicineName(medicineId) {
  const medicine = medicineById.get(medicineId);
  if (!medicine) return "Archived or unavailable medicine";
  return [medicine.generic_name, medicine.strength].filter(Boolean).join(" ");
}

function renderTable(medicineIds) {
  const rows = medicineIds.map((medicineId) => {
    const values = forecastByMedicine.get(medicineId);
    const total = values.reduce(
      (sum, item) => sum + Number(item.predicted_demand),
      0,
    );
    const row = document.createElement("tr");
    const cells = [
      medicineName(medicineId),
      modelName(medicineId),
      `${quantityFormat.format(total)} ${medicineById.get(medicineId)?.dispensing_unit || ""}`.trim(),
      `${quantityFormat.format(total / values.length)} per day`,
    ];
    for (const value of cells) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    }
    return row;
  });
  tableRows.replaceChildren(...rows);
}

function renderChart(medicineId) {
  const records = forecastByMedicine.get(medicineId);
  const medicine = medicineById.get(medicineId);
  const name = medicineName(medicineId);
  const unit = medicine?.dispensing_unit || "units";
  document.querySelector("#forecast-chart-title").textContent =
    `Daily predicted demand: ${name}`;
  document.querySelector("#forecast-chart-subtitle").textContent =
    `Predicted ${unit} per day. Source: Supabase forecast results.`;

  if (typeof Chart !== "function") {
    throw new Error("Chart.js did not load. Check your internet connection and reload.");
  }
  if (chart) chart.destroy();
  chart = new Chart(document.querySelector("#forecast-chart"), {
    type: "line",
    data: {
      labels: records.map((item) => item.forecast_date),
      datasets: [{
        label: `Predicted demand (${unit})`,
        data: records.map((item) => Number(item.predicted_demand)),
        borderColor: "#176b51",
        backgroundColor: "rgb(23 107 81 / 12%)",
        fill: true,
        tension: 0.25,
        pointRadius: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: "index" },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (context) =>
              `${quantityFormat.format(context.parsed.y)} ${unit}`,
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          title: { display: true, text: `Predicted demand (${unit})` },
        },
      },
    },
  });
}

async function loadForecast() {
  try {
    const context = await getAuthenticatedContext();
    if (!context) return;
    const pharmacyId = context.profile.pharmacy_id;
    const { data: run, error: runError } = await context.client
      .from("forecast_runs")
      .select("id, dataset_kind, model_name, created_at, horizon_days, metrics")
      .eq("pharmacy_id", pharmacyId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (runError) throw runError;
    if (!run) {
      showEmptyState(
        "No forecast run yet",
        "This page is connected to Supabase, but no forecast run has been saved. The Python service must complete a run before results appear here.",
      );
      return;
    }

    const results = await fetchForecastResults(
      context.client,
      pharmacyId,
      run.id,
    );
    if (results.length === 0) {
      showEmptyState(
        "No forecast results in the latest run",
        "The latest run has no saved results. Check the forecasting service logs before running it again.",
      );
      return;
    }

    const medicineIds = [...new Set(results.map((item) => item.medicine_id))];
    const medicines = await fetchMedicines(
      context.client,
      pharmacyId,
      medicineIds,
    );
    medicineById = new Map(medicines.map((medicine) => [medicine.id, medicine]));
    metricsByMedicine = run.metrics?.medicine_metrics || {};
    forecastByMedicine = new Map();
    for (const item of results) {
      const medicineResults = forecastByMedicine.get(item.medicine_id) || [];
      medicineResults.push(item);
      forecastByMedicine.set(item.medicine_id, medicineResults);
    }

    const sortedMedicineIds = [...forecastByMedicine.keys()].sort((left, right) =>
      medicineName(left).localeCompare(medicineName(right), "en"),
    );
    const dates = results.map((item) => item.forecast_date).sort();
    const windowStart = dates[0];
    const windowEnd = dates[dates.length - 1];
    const uniqueModels = [...new Set(sortedMedicineIds.map(modelName))];
    const options = sortedMedicineIds.map((medicineId) => {
      const option = document.createElement("option");
      option.value = medicineId;
      option.textContent = medicineName(medicineId);
      return option;
    });
    medicinePicker.replaceChildren(...options);
    medicinePicker.addEventListener("change", () => {
      renderChart(medicinePicker.value);
    });

    datasetNote.hidden = run.dataset_kind !== "synthetic";
    document.querySelector("#forecast-medicine-count").textContent =
      String(sortedMedicineIds.length);
    document.querySelector("#forecast-horizon").textContent =
      `${run.horizon_days} days`;
    document.querySelector("#forecast-window").textContent =
      `${windowStart} – ${windowEnd}`;
    document.querySelector("#forecast-model").textContent =
      uniqueModels.length === 1 ? uniqueModels[0] : "Multiple";
    document.querySelector("#forecast-source").textContent =
      `Source: Supabase forecast results · run saved ${formatRunDate(run.created_at)}.`;
    document.querySelector("#forecast-run-label").textContent =
      run.dataset_kind === "synthetic" ? "Synthetic run" : "Latest run";
    document.querySelector("#forecast-updated").textContent =
      `Run saved ${formatRunDate(run.created_at)}`;
    renderTable(sortedMedicineIds);
    emptyState.hidden = true;
    content.hidden = false;

    const staleMessage = document.querySelector("#forecast-stale");
    staleMessage.hidden = windowEnd >= nairobiDate();
    staleMessage.textContent =
      `This forecast window ended on ${windowEnd}; it is historical and needs a new service run before use as a current forecast.`;
    renderChart(medicinePicker.value);
  } catch (error) {
    console.error("Could not load forecast data:", error);
    statusMessage.hidden = false;
    statusMessage.textContent =
      error instanceof Error && error.message.startsWith("Chart.js")
        ? error.message
        : "Could not load forecasts. Check your Supabase connection and pharmacy access.";
    updatedLabel.textContent = "Unavailable";
  }
}

void loadForecast();
