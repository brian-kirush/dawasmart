import { getAuthenticatedContext } from "./auth-session.js";

const statusMessage = document.querySelector("#recommendation-status");
const updatedLabel = document.querySelector("#recommendation-updated");
const datasetNote = document.querySelector("#recommendation-dataset-note");
const emptyState = document.querySelector("#recommendation-empty");
const content = document.querySelector("#recommendation-content");
const summary = document.querySelector("#recommendation-summary");
const recommendationRows = document.querySelector("#recommendation-rows");
const recommendationCount = document.querySelector("#recommendation-count");
const quantityFormat = new Intl.NumberFormat("en-KE", {
  maximumFractionDigits: 3,
});

function showStatus(message, style = "alert-danger") {
  statusMessage.hidden = false;
  statusMessage.className = `alert ${style}`;
  statusMessage.textContent = message;
}

function showEmptyState(title, message) {
  document.querySelector("#recommendation-empty-title").textContent = title;
  document.querySelector("#recommendation-empty-message").textContent = message;
  emptyState.hidden = false;
  summary.hidden = true;
  content.hidden = true;
  updatedLabel.textContent = "No recommendations";
}

function appendCell(row, value) {
  const cell = document.createElement("td");
  cell.textContent = value || "—";
  row.append(cell);
  return cell;
}

function medicineName(medicine) {
  if (!medicine) return "Archived or unavailable medicine";
  return [medicine.generic_name, medicine.strength].filter(Boolean).join(" ");
}

function decisionLabel(status, modifiedQuantity, unit) {
  if (status === "modified") {
    return `Modified to ${quantityFormat.format(modifiedQuantity)} ${unit}`;
  }
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function addDecisionControls(cell, recommendation, context) {
  if (recommendation.status !== "pending") {
    cell.textContent = decisionLabel(
      recommendation.status,
      recommendation.modified_quantity,
      recommendation.dispensing_unit,
    );
    return;
  }

  const controls = document.createElement("div");
  controls.className = "d-flex flex-column gap-2";
  const input = document.createElement("input");
  input.className = "form-control form-control-sm";
  input.type = "number";
  input.min = "0";
  input.max = "2147483647";
  input.step = "1";
  input.value = String(recommendation.recommended_quantity);
  input.setAttribute(
    "aria-label",
    `Modified quantity for ${recommendation.medicine_name}`,
  );

  const feedback = document.createElement("span");
  feedback.className = "small text-secondary";
  feedback.setAttribute("role", "status");
  feedback.setAttribute("aria-live", "polite");

  const modifyButton = document.createElement("button");
  modifyButton.className = "btn btn-outline-success btn-sm";
  modifyButton.type = "button";
  modifyButton.textContent = "Save modified quantity";
  modifyButton.addEventListener("click", () => {
    void saveDecision(
      context,
      recommendation.id,
      "modified",
      input,
      modifyButton,
      feedback,
    );
  });

  const acceptButton = document.createElement("button");
  acceptButton.className = "btn btn-primary btn-sm";
  acceptButton.type = "button";
  acceptButton.textContent = "Accept suggestion";
  acceptButton.addEventListener("click", () => {
    void saveDecision(
      context,
      recommendation.id,
      "accepted",
      input,
      acceptButton,
      feedback,
    );
  });

  const dismissButton = document.createElement("button");
  dismissButton.className = "btn btn-outline-secondary btn-sm";
  dismissButton.type = "button";
  dismissButton.textContent = "Dismiss";
  dismissButton.addEventListener("click", () => {
    void saveDecision(
      context,
      recommendation.id,
      "dismissed",
      input,
      dismissButton,
      feedback,
    );
  });

  controls.append(input, modifyButton, acceptButton, dismissButton, feedback);
  cell.append(controls);
}

async function saveDecision(
  context,
  recommendationId,
  decision,
  quantityInput,
  button,
  feedback,
) {
  let modifiedQuantity = null;
  if (decision === "modified") {
    modifiedQuantity = Number(quantityInput.value);
    if (
      !Number.isSafeInteger(modifiedQuantity)
      || modifiedQuantity < 0
      || modifiedQuantity > 2147483647
    ) {
      feedback.textContent = "Enter a whole number from 0 to 2,147,483,647.";
      feedback.className = "small text-danger";
      quantityInput.focus();
      return;
    }
  }

  const controlButtons = button.parentElement.querySelectorAll("button");
  controlButtons.forEach((controlButton) => {
    controlButton.disabled = true;
  });
  feedback.textContent = "Saving decision…";
  feedback.className = "small text-secondary";
  try {
    const { error } = await context.client.rpc("decide_reorder_recommendation", {
      p_recommendation_id: recommendationId,
      p_decision: decision,
      p_modified_quantity: modifiedQuantity,
    });
    if (error) throw error;
    showStatus(
      "Decision recorded. No purchase order was placed.",
      "alert-success",
    );
  } catch (error) {
    console.error("Could not save recommendation decision:", error);
    const message = error.message || "";
    if (message.includes("RECOMMENDATION_ALREADY_DECIDED")) {
      feedback.textContent = "This recommendation was already decided. Reload the page.";
    } else if (message.includes("PGRST202")) {
      feedback.textContent =
        "Recommendation decisions are not enabled yet. Apply the recommendations migration.";
    } else {
      feedback.textContent =
        "Could not save this decision. Check your pharmacy access and try again.";
    }
    feedback.className = "small text-danger";
    controlButtons.forEach((controlButton) => {
      controlButton.disabled = false;
    });
    return;
  }

  try {
    await loadRecommendations(context);
  } catch (error) {
    console.error("Decision saved, but recommendations did not refresh:", error);
    showStatus(
      "The decision was saved, but the page could not refresh. Reload to see the updated status.",
      "alert-warning",
    );
  }
}

async function fetchMedicines(client, pharmacyId, medicineIds) {
  if (medicineIds.length === 0) return [];
  const { data, error } = await client.from("medicines")
    .select("id, generic_name, strength, dispensing_unit")
    .eq("pharmacy_id", pharmacyId)
    .in("id", medicineIds);
  if (error) throw error;
  return data;
}

async function fetchSuppliers(client, pharmacyId, supplierIds) {
  if (supplierIds.length === 0) return [];
  const { data, error } = await client.from("suppliers")
    .select("id, name")
    .eq("pharmacy_id", pharmacyId)
    .in("id", supplierIds);
  if (error) throw error;
  return data;
}

function renderRecommendations(recommendations, medicines, suppliers, context) {
  const medicineById = new Map(medicines.map((medicine) => [medicine.id, medicine]));
  const supplierById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
  const rows = recommendations.map((recommendation) => {
    const medicine = medicineById.get(recommendation.medicine_id);
    const supplier = supplierById.get(recommendation.supplier_id);
    const unit = medicine?.dispensing_unit || "units";
    recommendation.medicine_name = medicineName(medicine);
    recommendation.dispensing_unit = unit;
    const rationale = recommendation.rationale || {};
    const row = document.createElement("tr");

    appendCell(row, medicineName(medicine));
    appendCell(row, supplier?.name || "Unavailable supplier");
    appendCell(row, `${recommendation.lead_time_days} days`);
    appendCell(
      row,
      `${quantityFormat.format(Number(rationale.available_stock || 0))} ${unit}`,
    );
    appendCell(
      row,
      `${quantityFormat.format(Number(rationale.forecast_demand_28_days || 0))} ${unit}`,
    );
    appendCell(row, `${recommendation.safety_stock} ${unit}`);
    appendCell(row, `${recommendation.recommended_quantity} ${unit}`);
    appendCell(row, recommendation.recommendation_date);
    appendCell(row, recommendation.explanation);
    addDecisionControls(row.insertCell(), recommendation, context);
    return row;
  });
  recommendationRows.replaceChildren(...rows);
}

async function loadRecommendations(context) {
  const pharmacyId = context.profile.pharmacy_id;
  const { data: run, error: runError } = await context.client
    .from("forecast_runs")
    .select("id, dataset_kind, created_at, horizon_days")
    .eq("pharmacy_id", pharmacyId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (runError) throw runError;
  if (!run) {
    showEmptyState(
      "No forecast run yet",
      "Run the Python forecasting service first. Recommendations are generated only from saved forecast results.",
    );
    return;
  }
  datasetNote.hidden = run.dataset_kind !== "synthetic";

  const { data: recommendations, error: recommendationError } =
    await context.client.from("reorder_recommendations")
      .select(
        "id, medicine_id, supplier_id, lead_time_days, recommendation_date, recommended_quantity, safety_stock, rationale, explanation, status, modified_quantity",
      )
      .eq("pharmacy_id", pharmacyId)
      .eq("forecast_run_id", run.id)
      .order("recommended_quantity", { ascending: false })
      .order("medicine_id", { ascending: true });
  if (recommendationError) throw recommendationError;
  if (recommendations.length === 0) {
    showEmptyState(
      "No reorder suggestions for this run",
      "Recommendations require a supplier on a medicine batch and a configured lead time. If these are set, current stock may already meet the forecast target.",
    );
    return;
  }

  const medicineIds = [...new Set(recommendations.map((item) => item.medicine_id))];
  const supplierIds = [
    ...new Set(recommendations.map((item) => item.supplier_id).filter(Boolean)),
  ];
  const [medicines, suppliers] = await Promise.all([
    fetchMedicines(context.client, pharmacyId, medicineIds),
    fetchSuppliers(context.client, pharmacyId, supplierIds),
  ]);
  const pendingCount = recommendations.filter(
    (recommendation) => recommendation.status === "pending",
  ).length;

  renderRecommendations(recommendations, medicines, suppliers, context);
  document.querySelector("#recommendation-pending-count").textContent =
    String(pendingCount);
  document.querySelector("#recommendation-run-date").textContent =
    new Intl.DateTimeFormat("en-KE", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Africa/Nairobi",
    }).format(new Date(run.created_at));
  document.querySelector("#recommendation-source").textContent =
    `Source: forecast run saved ${new Intl.DateTimeFormat("en-KE", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Africa/Nairobi",
    }).format(new Date(run.created_at))}.`;
  recommendationCount.textContent =
    `${recommendations.length} suggestion${recommendations.length === 1 ? "" : "s"}`;
  updatedLabel.textContent = `Run saved ${new Intl.DateTimeFormat("en-KE", {
    dateStyle: "medium",
    timeZone: "Africa/Nairobi",
  }).format(new Date(run.created_at))}`;
  emptyState.hidden = true;
  summary.hidden = false;
  content.hidden = false;
}

async function preparePage() {
  try {
    const context = await getAuthenticatedContext();
    if (!context) return;
    await loadRecommendations(context);
  } catch (error) {
    console.error("Could not load reorder recommendations:", error);
    showStatus(
      "Could not load recommendations. Check the migration, forecast data, and pharmacy access.",
    );
    updatedLabel.textContent = "Unavailable";
  }
}

void preparePage();
