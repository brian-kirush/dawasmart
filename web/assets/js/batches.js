import { getAuthenticatedContext } from "./auth-session.js";

const form = document.querySelector("#batch-form");
const statusMessage = document.querySelector("#batch-status");
const medicineSelect = document.querySelector("#batch-medicine");
const supplierSelect = document.querySelector("#batch-supplier");
const supplierPanel = document.querySelector("#add-supplier-panel");
const supplierNameInput = document.querySelector("#new-supplier-name");
const addSupplierButton = document.querySelector("#add-supplier");
const supplierStatus = document.querySelector("#supplier-status");
const submitButton = document.querySelector("#receive-batch");
const batchRows = document.querySelector("#batch-rows");
const batchCount = document.querySelector("#batch-count");

function showStatus(message, style = "alert-info") {
  statusMessage.hidden = false;
  statusMessage.className = `alert ${style}`;
  statusMessage.textContent = message;
}

function addOptions(select, options, placeholder, labelForOption) {
  select.replaceChildren(new Option(placeholder, ""));
  for (const option of options) {
    select.add(new Option(labelForOption(option), option.id));
  }
}

function appendCell(row, value) {
  const cell = document.createElement("td");
  cell.textContent = value || "—";
  row.append(cell);
}

function renderBatches(batches, medicines, suppliers) {
  if (batches.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 7;
    cell.textContent = "No batches have been received yet.";
    row.append(cell);
    batchRows.replaceChildren(row);
    return;
  }

  const medicineById = new Map(medicines.map((item) => [item.id, item]));
  const supplierById = new Map(suppliers.map((item) => [item.id, item]));
  const currency = new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
  });
  const rows = batches.map((batch) => {
    const row = document.createElement("tr");
    const medicine = medicineById.get(batch.medicine_id);
    const supplier = supplierById.get(batch.supplier_id);
    const medicineName = [
      medicine && medicine.generic_name,
      medicine && medicine.strength,
    ].filter(Boolean).join(" · ");

    appendCell(row, medicineName);
    appendCell(row, batch.batch_number);
    appendCell(row, supplier && supplier.name);
    appendCell(row, batch.expiry_date);
    appendCell(row, String(batch.quantity_received));
    appendCell(row, String(batch.quantity_on_hand));
    appendCell(row, currency.format(Number(batch.unit_cost)));
    return row;
  });
  batchRows.replaceChildren(...rows);
}

function errorMessage(error) {
  const knownErrors = {
    INVALID_BATCH: "Check the batch number, dates, quantity, and unit cost.",
    MEDICINE_UNAVAILABLE: "That medicine is inactive or unavailable.",
    SUPPLIER_UNAVAILABLE: "That supplier is inactive or unavailable.",
    ROLE_NOT_ALLOWED: "Your role does not allow stock receiving.",
    PROFILE_REQUIRED: "Your account has no pharmacy profile.",
  };
  if (error.code === "23505") {
    return "That batch number is already recorded for this medicine.";
  }
  return knownErrors[error.message] ||
    "Could not receive this batch. Check the details and try again.";
}

async function loadPage(context) {
  const pharmacyId = context.profile.pharmacy_id;
  const [medicineResult, supplierResult, batchResult] = await Promise.all([
    context.client.from("medicines")
      .select("id, generic_name, strength, dispensing_unit")
      .eq("pharmacy_id", pharmacyId)
      .eq("is_active", true)
      .order("generic_name"),
    context.client.from("suppliers")
      .select("id, name")
      .eq("pharmacy_id", pharmacyId)
      .eq("is_active", true)
      .order("name"),
    context.client.from("batches")
      .select("id, medicine_id, supplier_id, batch_number, expiry_date, quantity_received, quantity_on_hand, unit_cost")
      .eq("pharmacy_id", pharmacyId)
      .order("expiry_date", { ascending: true }),
  ]);
  if (medicineResult.error) throw medicineResult.error;
  if (supplierResult.error) throw supplierResult.error;
  if (batchResult.error) throw batchResult.error;

  const medicines = medicineResult.data;
  const suppliers = supplierResult.data;
  supplierPanel.hidden = context.profile.role !== "administrator";
  addOptions(
    medicineSelect,
    medicines,
    medicines.length ? "Choose a medicine" : "Add a medicine first",
    (medicine) => [
      medicine.generic_name,
      medicine.strength,
      `(${medicine.dispensing_unit})`,
    ].filter(Boolean).join(" "),
  );
  addOptions(
    supplierSelect,
    suppliers,
    suppliers.length ? "Choose a supplier" : "Add a supplier first",
    (supplier) => supplier.name,
  );
  submitButton.disabled = medicines.length === 0 || suppliers.length === 0;
  addSupplierButton.disabled = false;
  renderBatches(batchResult.data, medicines, suppliers);
  batchCount.textContent = batchResult.data.length === 1
    ? "1 batch"
    : `${batchResult.data.length} batches`;
}

async function addSupplier(context) {
  const name = supplierNameInput.value.trim();
  if (!name) {
    supplierStatus.textContent = "Enter the supplier name.";
    supplierNameInput.focus();
    return;
  }

  addSupplierButton.disabled = true;
  supplierStatus.textContent = "";
  try {
    const { data, error } = await context.client
      .from("suppliers")
      .insert({
        pharmacy_id: context.profile.pharmacy_id,
        name,
      })
      .select("id, name")
      .single();
    if (error) throw error;

    supplierSelect.add(new Option(data.name, data.id));
    supplierSelect.value = data.id;
    supplierNameInput.value = "";
    submitButton.disabled = medicineSelect.options.length < 2;
    supplierStatus.textContent = `${data.name} added and selected.`;
  } catch (error) {
    console.error("Could not add supplier:", error);
    supplierStatus.textContent = error.code === "42501"
      ? "Only an administrator can add suppliers."
      : "Could not add this supplier. Check your access and try again.";
  } finally {
    addSupplierButton.disabled = false;
  }
}

async function receiveBatch(context) {
  submitButton.disabled = true;
  statusMessage.hidden = true;
  try {
    const values = new FormData(form);
    const dateValue = (name) => String(values.get(name) || "") || null;
    const { data, error } = await context.client.rpc("receive_batch", {
      p_medicine_id: String(values.get("medicine_id")),
      p_supplier_id: String(values.get("supplier_id")),
      p_batch_number: String(values.get("batch_number")).trim(),
      p_manufacture_date: dateValue("manufacture_date"),
      p_expiry_date: dateValue("expiry_date"),
      p_quantity: Number(values.get("quantity")),
      p_unit_cost: Number(values.get("unit_cost")),
    });
    if (error) throw error;

    form.reset();
    showStatus(
      `Batch received. Purchase ${data.purchase_number} was recorded.`,
      "alert-success",
    );
  } catch (error) {
    console.error("Could not receive batch:", error);
    showStatus(errorMessage(error), "alert-danger");
    submitButton.disabled =
      medicineSelect.options.length < 2 || supplierSelect.options.length < 2;
    return;
  }

  try {
    await loadPage(context);
  } catch (error) {
    console.error("Batch was received, but the list could not be refreshed:", error);
    showStatus(
      "The batch was received, but the list could not refresh. Reload this page to see it.",
      "alert-warning",
    );
  } finally {
    submitButton.disabled =
      medicineSelect.options.length < 2 || supplierSelect.options.length < 2;
  }
}

async function preparePage() {
  try {
    const context = await getAuthenticatedContext();
    if (!context) return;
    if (context.profile.role === "administrator") {
      addSupplierButton.addEventListener("click", () => void addSupplier(context));
      supplierNameInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void addSupplier(context);
        }
      });
    }
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void receiveBatch(context);
    });
    await loadPage(context);
  } catch (error) {
    console.error("Could not load batches:", error);
    showStatus(
      "Could not load batch information. Check your Supabase connection and pharmacy access.",
      "alert-danger",
    );
    batchCount.textContent = "Unavailable";
  }
}

if (form) {
  void preparePage();
}
