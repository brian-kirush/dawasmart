import { getAuthenticatedContext } from "./auth-session.js";

const form = document.querySelector("#sale-form");
const linesElement = document.querySelector("#sale-lines");
const statusMessage = document.querySelector("#sale-status");
const addLineButton = document.querySelector("#add-sale-line");
const submitButton = document.querySelector("#record-sale");
const saleTotal = document.querySelector("#sale-total");
const recentSales = document.querySelector("#recent-sales");
const saleCount = document.querySelector("#sale-count");
const currency = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
});
let context;
let medicines = [];
let stockByMedicine = new Map();

function nairobiDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function showStatus(message, style = "alert-info") {
  statusMessage.hidden = false;
  statusMessage.className = `alert ${style}`;
  statusMessage.textContent = message;
}

function makeCell(value) {
  const cell = document.createElement("td");
  cell.textContent = value;
  return cell;
}

function medicineLabel(medicine) {
  return [medicine.generic_name, medicine.strength].filter(Boolean).join(" · ");
}

function addSaleLine() {
  const row = document.createElement("tr");
  const medicineCell = document.createElement("td");
  const medicineSelect = document.createElement("select");
  const stockCell = document.createElement("td");
  const quantityCell = document.createElement("td");
  const quantityInput = document.createElement("input");
  const priceCell = document.createElement("td");
  const priceInput = document.createElement("input");
  const totalCell = document.createElement("td");
  const removeCell = document.createElement("td");
  const removeButton = document.createElement("button");

  medicineSelect.className = "form-select";
  medicineSelect.setAttribute("aria-label", "Medicine");
  medicineSelect.required = true;
  medicineSelect.add(new Option("Choose a medicine", ""));
  for (const medicine of medicines) {
    medicineSelect.add(new Option(medicineLabel(medicine), medicine.id));
  }

  quantityInput.className = "form-control";
  quantityInput.type = "number";
  quantityInput.min = "1";
  quantityInput.step = "1";
  quantityInput.value = "1";
  quantityInput.required = true;
  quantityInput.setAttribute("aria-label", "Quantity");

  priceInput.className = "form-control";
  priceInput.type = "number";
  priceInput.min = "0";
  priceInput.step = "0.01";
  priceInput.required = true;
  priceInput.setAttribute("aria-label", "Unit price in Kenyan shillings");

  removeButton.className = "btn btn-sm btn-outline-secondary";
  removeButton.type = "button";
  removeButton.textContent = "Remove";
  removeButton.setAttribute("aria-label", "Remove sale item");
  removeButton.addEventListener("click", () => {
    row.remove();
    updateTotal();
  });

  medicineCell.append(medicineSelect);
  quantityCell.append(quantityInput);
  priceCell.append(priceInput);
  removeCell.append(removeButton);
  row.append(medicineCell, stockCell, quantityCell, priceCell, totalCell, removeCell);

  const updateLine = () => {
    const available = stockByMedicine.get(medicineSelect.value) || 0;
    stockCell.textContent = String(available);
    const quantity = Number(quantityInput.value);
    const price = Number(priceInput.value);
    totalCell.textContent = Number.isFinite(quantity * price)
      ? currency.format(quantity * price)
      : currency.format(0);
    updateTotal();
  };
  medicineSelect.addEventListener("change", updateLine);
  quantityInput.addEventListener("input", updateLine);
  priceInput.addEventListener("input", updateLine);
  linesElement.append(row);
  updateLine();
}

function updateTotal() {
  const sum = [...linesElement.rows].reduce((total, row) => {
    const quantity = Number(row.querySelector('[aria-label="Quantity"]').value);
    const price = Number(
      row.querySelector('[aria-label="Unit price in Kenyan shillings"]').value,
    );
    return total + (Number.isFinite(quantity * price) ? quantity * price : 0);
  }, 0);
  saleTotal.textContent = currency.format(sum);
}

function renderRecentSales(sales, items) {
  if (sales.length === 0) {
    const row = document.createElement("tr");
    const cell = makeCell("No receipts recorded yet.");
    cell.colSpan = 4;
    row.append(cell);
    recentSales.replaceChildren(row);
    return;
  }

  const totals = new Map();
  for (const item of items) {
    totals.set(
      item.sale_id,
      (totals.get(item.sale_id) || 0) + Number(item.quantity) * Number(item.unit_price),
    );
  }

  const rows = sales.map((sale) => {
    const row = document.createElement("tr");
    const dateCell = makeCell(new Date(sale.sold_at).toLocaleString("en-KE", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Africa/Nairobi",
    }));
    const actionCell = document.createElement("td");
    const link = document.createElement("a");
    link.className = "btn btn-sm btn-outline-success";
    link.href = `./receipt.html?id=${encodeURIComponent(sale.id)}`;
    link.textContent = "View receipt";
    actionCell.append(link);
    row.append(
      makeCell(sale.receipt_number),
      dateCell,
      makeCell(currency.format(totals.get(sale.id) || 0)),
      actionCell,
    );
    return row;
  });
  recentSales.replaceChildren(...rows);
}

async function loadRecentSales() {
  const pharmacyId = context.profile.pharmacy_id;
  const { data: sales, error: salesError } = await context.client
    .from("sales")
    .select("id, receipt_number, sold_at")
    .eq("pharmacy_id", pharmacyId)
    .eq("sale_type", "sale")
    .order("sold_at", { ascending: false })
    .limit(10);
  if (salesError) throw salesError;

  let items = [];
  if (sales.length) {
    const { data, error } = await context.client
      .from("sale_items")
      .select("sale_id, quantity, unit_price")
      .eq("pharmacy_id", pharmacyId)
      .in("sale_id", sales.map((sale) => sale.id));
    if (error) throw error;
    items = data;
  }
  renderRecentSales(sales, items);
  saleCount.textContent = sales.length === 1
    ? "1 recent receipt"
    : `${sales.length} recent receipts`;
}

async function loadPage() {
  const pharmacyId = context.profile.pharmacy_id;
  const [medicineResult, batchResult] = await Promise.all([
    context.client.from("medicines")
      .select("id, generic_name, strength")
      .eq("pharmacy_id", pharmacyId)
      .eq("is_active", true)
      .order("generic_name"),
    context.client.from("batches")
      .select("medicine_id, quantity_on_hand")
      .eq("pharmacy_id", pharmacyId)
      .gte("expiry_date", nairobiDate())
      .gt("quantity_on_hand", 0),
  ]);
  if (medicineResult.error) throw medicineResult.error;
  if (batchResult.error) throw batchResult.error;

  medicines = medicineResult.data;
  stockByMedicine = new Map();
  for (const batch of batchResult.data) {
    stockByMedicine.set(
      batch.medicine_id,
      (stockByMedicine.get(batch.medicine_id) || 0) + batch.quantity_on_hand,
    );
  }

  linesElement.replaceChildren();
  addLineButton.disabled = medicines.length === 0;
  submitButton.disabled = medicines.length === 0;
  addSaleLine();
  await loadRecentSales();
}

function saleErrorMessage(error) {
  const errors = {
    INVALID_SALE_ITEMS: "Enter a valid medicine, whole-number quantity, and price.",
    MEDICINE_UNAVAILABLE: "A selected medicine is inactive or unavailable.",
    INSUFFICIENT_STOCK: "There is not enough unexpired stock to complete this sale.",
    ROLE_NOT_ALLOWED: "Your role does not allow recording sales.",
    PROFILE_REQUIRED: "Your account has no pharmacy profile.",
  };
  return errors[error.message] ||
    "Could not complete the sale. Check the information and try again.";
}

async function recordSale(event) {
  event.preventDefault();
  submitButton.disabled = true;
  statusMessage.hidden = true;
  try {
    const items = [...linesElement.rows].map((row) => ({
      medicine_id: row.querySelector("select").value,
      quantity: Number(row.querySelector('[aria-label="Quantity"]').value),
      unit_price: Number(
        row.querySelector('[aria-label="Unit price in Kenyan shillings"]').value,
      ),
    }));
    if (items.some((item) =>
      !item.medicine_id ||
      !Number.isInteger(item.quantity) ||
      item.quantity <= 0 ||
      !Number.isFinite(item.unit_price) ||
      item.unit_price < 0
    )) {
      showStatus("Enter a medicine, a whole-number quantity, and a valid price.", "alert-danger");
      return;
    }

    const { data, error } = await context.client.rpc("record_sale", {
      p_items: items,
    });
    if (error) throw error;
    window.location.assign(`./receipt.html?id=${encodeURIComponent(data.sale_id)}`);
  } catch (error) {
    console.error("Could not record sale:", error);
    showStatus(saleErrorMessage(error), "alert-danger");
  } finally {
    submitButton.disabled = false;
  }
}

async function preparePage() {
  try {
    context = await getAuthenticatedContext();
    if (!context) return;
    form.addEventListener("submit", (event) => void recordSale(event));
    addLineButton.addEventListener("click", addSaleLine);
    await loadPage();
  } catch (error) {
    console.error("Could not load sales:", error);
    showStatus(
      "Could not load medicines or receipts. Check your Supabase connection and pharmacy access.",
      "alert-danger",
    );
    saleCount.textContent = "Unavailable";
  }
}

if (form) {
  void preparePage();
}
