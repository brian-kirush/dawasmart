import { getAuthenticatedContext } from "./auth-session.js";

const form = document.querySelector("#adjustment-form");
const statusMessage = document.querySelector("#adjustment-status");
const batchSelect = document.querySelector("#adjustment-batch");
const quantityInput = document.querySelector("#quantity-change");
const reasonInput = document.querySelector("#adjustment-reason");
const submitButton = document.querySelector("#save-adjustment");
const preview = document.querySelector("#adjustment-preview");
const adjustmentRows = document.querySelector("#adjustment-rows");
const adjustmentCount = document.querySelector("#adjustment-count");
const batchById = new Map();
const medicineById = new Map();

function showStatus(message, style = "alert-info") {
  statusMessage.hidden = false;
  statusMessage.className = `alert ${style}`;
  statusMessage.textContent = message;
}

function appendCell(row, value) {
  const cell = document.createElement("td");
  cell.textContent = value || "—";
  row.append(cell);
}

function medicineName(medicineId) {
  const medicine = medicineById.get(medicineId);
  if (!medicine) return "Archived or unavailable medicine";
  return [medicine.generic_name, medicine.strength].filter(Boolean).join(" · ");
}

function batchLabel(batch) {
  const medicine = medicineById.get(batch.medicine_id);
  const label = [
    medicine && medicine.generic_name,
    medicine && medicine.strength,
    `Batch ${batch.batch_number}`,
    `${batch.quantity_on_hand} ${medicine?.dispensing_unit || "units"} on hand`,
    `expires ${batch.expiry_date}`,
  ].filter(Boolean).join(" · ");
  return label;
}

async function fetchBatches(client, pharmacyId) {
  const batches = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client.from("batches")
      .select("id, medicine_id, batch_number, expiry_date, quantity_on_hand")
      .eq("pharmacy_id", pharmacyId)
      .order("expiry_date", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    batches.push(...data);
    if (data.length < pageSize) return batches;
  }
}

async function fetchMedicines(client, pharmacyId, medicineIds) {
  const medicines = [];
  for (let index = 0; index < medicineIds.length; index += 500) {
    const ids = medicineIds.slice(index, index + 500);
    const { data, error } = await client.from("medicines")
      .select("id, generic_name, strength, dispensing_unit")
      .eq("pharmacy_id", pharmacyId)
      .in("id", ids);
    if (error) throw error;
    medicines.push(...data);
  }
  return medicines;
}

function renderBatchOptions(batches, selectedBatchId) {
  batchSelect.replaceChildren(new Option(
    batches.length ? "Choose a batch" : "No batches available",
    "",
  ));
  for (const batch of batches) {
    batchSelect.add(new Option(batchLabel(batch), batch.id));
  }
  batchSelect.disabled = batches.length === 0;
  if (batches.some((batch) => batch.id === selectedBatchId)) {
    batchSelect.value = selectedBatchId;
  }
  quantityInput.disabled = batches.length === 0;
  reasonInput.disabled = batches.length === 0;
  updatePreview();
}

function renderHistory(adjustments) {
  if (adjustments.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.textContent = "No stock adjustments have been recorded.";
    row.append(cell);
    adjustmentRows.replaceChildren(row);
    adjustmentCount.textContent = "0 adjustments";
    return;
  }

  const dateFormat = new Intl.DateTimeFormat("en-KE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Nairobi",
  });
  const rows = adjustments.map((adjustment) => {
    const row = document.createElement("tr");
    const batch = batchById.get(adjustment.batch_id);
    const change = Number(adjustment.quantity_change);
    appendCell(row, dateFormat.format(new Date(adjustment.created_at)));
    appendCell(row, batch ? medicineName(batch.medicine_id) : "Unavailable");
    appendCell(row, batch ? batch.batch_number : "Unavailable");
    appendCell(row, change > 0 ? `+${change}` : String(change));
    appendCell(row, adjustment.reason);
    return row;
  });
  adjustmentRows.replaceChildren(...rows);
  adjustmentCount.textContent =
    `${adjustments.length} recent adjustment${adjustments.length === 1 ? "" : "s"}`;
}

function updatePreview() {
  const batch = batchById.get(batchSelect.value);
  if (!batch) {
    preview.textContent = "Select a batch to see its current stock.";
    submitButton.disabled = true;
    return;
  }

  const unit = medicineById.get(batch.medicine_id)?.dispensing_unit || "units";
  const change = Number(quantityInput.value);
  if (!Number.isSafeInteger(change) || change === 0) {
    preview.textContent =
      `Current stock: ${batch.quantity_on_hand} ${unit}. Enter a non-zero whole number change.`;
    submitButton.disabled = true;
    return;
  }
  const projected = batch.quantity_on_hand + change;
  if (projected < 0) {
    preview.textContent = `This change would leave negative stock in ${unit}.`;
    submitButton.disabled = true;
    return;
  }
  if (projected > 2147483647) {
    preview.textContent = `The resulting quantity is too large for ${unit}.`;
    submitButton.disabled = true;
    return;
  }

  preview.textContent =
    `Current stock: ${batch.quantity_on_hand} ${unit}. After adjustment: ${projected} ${unit}.`;
  submitButton.disabled = false;
}

function adjustmentErrorMessage(error) {
  const messages = {
    PROFILE_REQUIRED: "Your account has no pharmacy profile.",
    ROLE_NOT_ALLOWED: "Your role does not allow stock adjustments.",
    INVALID_ADJUSTMENT: "Enter a non-zero whole number and a reason of 1–500 characters.",
    BATCH_UNAVAILABLE: "That batch is unavailable for your pharmacy.",
    INSUFFICIENT_STOCK: "This adjustment would make stock negative.",
  };
  if (error.code === "PGRST202") {
    return "Stock adjustments are not enabled yet. Apply the stock-adjustment migration, then reload this page.";
  }
  return messages[error.message] ||
    "Could not adjust stock. Check the batch, quantity change, and reason.";
}

async function loadPage(context) {
  const pharmacyId = context.profile.pharmacy_id;
  const selectedBatchId = batchSelect.value;
  const [batches, adjustmentResult] = await Promise.all([
    fetchBatches(context.client, pharmacyId),
    context.client.from("stock_adjustments")
      .select("id, batch_id, quantity_change, reason, created_at")
      .eq("pharmacy_id", pharmacyId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(100),
  ]);
  if (adjustmentResult.error) throw adjustmentResult.error;

  batchById.clear();
  for (const batch of batches) batchById.set(batch.id, batch);
  const medicineIds = [...new Set(batches.map((batch) => batch.medicine_id))];
  const medicines = await fetchMedicines(context.client, pharmacyId, medicineIds);
  medicineById.clear();
  for (const medicine of medicines) medicineById.set(medicine.id, medicine);

  renderBatchOptions(batches, selectedBatchId);
  renderHistory(adjustmentResult.data);
  return batches.length;
}

async function saveAdjustment(context) {
  submitButton.disabled = true;
  statusMessage.hidden = true;
  const batch = batchById.get(batchSelect.value);
  const quantityChange = Number(quantityInput.value);
  const reason = reasonInput.value.trim();
  if (!batch || !Number.isSafeInteger(quantityChange) || quantityChange === 0 || !reason) {
    updatePreview();
    return;
  }

  try {
    const { data, error } = await context.client.rpc("adjust_stock", {
      p_batch_id: batch.id,
      p_quantity_change: quantityChange,
      p_reason: reason,
    });
    if (error) throw error;

    quantityInput.value = "";
    reasonInput.value = "";
    showStatus(
      `Stock adjusted from ${data.quantity_before} to ${data.quantity_after} units.`,
      "alert-success",
    );
    try {
      await loadPage(context);
    } catch (error) {
      console.error("Adjustment saved, but the history could not refresh:", error);
      showStatus(
        "The adjustment was saved, but the page could not refresh. Reload to see the new stock.",
        "alert-warning",
      );
    }
  } catch (error) {
    console.error("Could not adjust stock:", error);
    showStatus(adjustmentErrorMessage(error), "alert-danger");
    updatePreview();
  }
}

async function preparePage() {
  try {
    const context = await getAuthenticatedContext();
    if (!context) return;
    document.querySelector("#adjustment-dataset-note").hidden =
      context.pharmacy.dataset_kind !== "synthetic";
    batchSelect.addEventListener("change", updatePreview);
    quantityInput.addEventListener("input", updatePreview);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void saveAdjustment(context);
    });
    const batchesCount = await loadPage(context);
    if (batchesCount === 0) {
      preview.textContent = "Receive a batch before adjusting stock.";
    }
  } catch (error) {
    console.error("Could not load stock adjustments:", error);
    statusMessage.hidden = false;
    statusMessage.className = "alert alert-danger";
    statusMessage.textContent =
      "Could not load stock adjustments. Check your Supabase connection and pharmacy access.";
    adjustmentCount.textContent = "Unavailable";
  }
}

void preparePage();
