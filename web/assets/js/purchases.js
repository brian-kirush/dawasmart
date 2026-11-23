import { getAuthenticatedContext } from "./auth-session.js";

const statusMessage = document.querySelector("#purchase-status");
const purchaseRows = document.querySelector("#purchase-rows");
const supplierRows = document.querySelector("#supplier-rows");
const currency = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
});

function appendCell(row, value) {
  const cell = document.createElement("td");
  cell.textContent = value || "—";
  row.append(cell);
}

function renderEmptyRow(tbody, columnCount, message) {
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = columnCount;
  cell.textContent = message;
  row.append(cell);
  tbody.replaceChildren(row);
}

async function fetchPurchaseItems(client, pharmacyId, purchaseIds) {
  const items = [];
  if (purchaseIds.length === 0) return items;

  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client.from("purchase_items")
      .select("purchase_id, medicine_id, quantity_ordered, quantity_received, unit_cost")
      .eq("pharmacy_id", pharmacyId)
      .in("purchase_id", purchaseIds)
      .order("purchase_id", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    items.push(...data);
    if (data.length < pageSize) return items;
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

function renderPurchases(purchases, items, suppliers, medicines) {
  if (purchases.length === 0) {
    renderEmptyRow(
      purchaseRows,
      8,
      "No purchases recorded yet. Receive a batch to create the first purchase.",
    );
    return 0;
  }

  const supplierById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
  const medicineById = new Map(medicines.map((medicine) => [medicine.id, medicine]));
  const itemsByPurchase = new Map();
  for (const item of items) {
    const purchaseItems = itemsByPurchase.get(item.purchase_id) || [];
    purchaseItems.push(item);
    itemsByPurchase.set(item.purchase_id, purchaseItems);
  }

  let totalValue = 0;
  const rows = [];
  for (const purchase of purchases) {
    const purchaseItems = itemsByPurchase.get(purchase.id) || [];
    if (purchaseItems.length === 0) {
      const row = document.createElement("tr");
      appendCell(row, purchase.purchase_number);
      appendCell(row, purchase.purchase_date);
      appendCell(row, supplierById.get(purchase.supplier_id)?.name);
      appendCell(row, "No item details");
      appendCell(row, "—");
      appendCell(row, "—");
      appendCell(row, "—");
      appendCell(row, purchase.status);
      rows.push(row);
      continue;
    }

    for (const item of purchaseItems) {
      const row = document.createElement("tr");
      const medicine = medicineById.get(item.medicine_id);
      const medicineName = [
        medicine?.generic_name,
        medicine?.strength,
      ].filter(Boolean).join(" · ");
      const lineTotal = Number(item.unit_cost) * Number(item.quantity_ordered);
      totalValue += lineTotal;

      appendCell(row, purchase.purchase_number);
      appendCell(row, purchase.purchase_date);
      appendCell(row, supplierById.get(purchase.supplier_id)?.name);
      appendCell(row, medicineName || "Archived or unavailable medicine");
      appendCell(
        row,
        `${item.quantity_received} / ${item.quantity_ordered} ${
          medicine?.dispensing_unit || ""
        }`.trim(),
      );
      appendCell(row, currency.format(Number(item.unit_cost)));
      appendCell(row, currency.format(lineTotal));
      appendCell(row, purchase.status);
      rows.push(row);
    }
  }
  purchaseRows.replaceChildren(...rows);
  return totalValue;
}

function renderSuppliers(suppliers, context) {
  if (suppliers.length === 0) {
    renderEmptyRow(supplierRows, 7, "No suppliers have been added yet.");
    return;
  }

  const rows = suppliers.map((supplier) => {
    const row = document.createElement("tr");
    appendCell(row, supplier.name);
    appendCell(row, supplier.contact_name);
    appendCell(row, supplier.phone);
    appendCell(row, supplier.email);
    appendCell(row, supplier.is_active ? "Active" : "Inactive");

    const leadTimeCell = document.createElement("td");
    const actionCell = document.createElement("td");
    const status = document.createElement("span");
    status.className = "small text-secondary";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    if (context.profile.role === "administrator") {
      const input = document.createElement("input");
      input.className = "form-control form-control-sm";
      input.type = "number";
      input.min = "1";
      input.max = "365";
      input.step = "1";
      input.value = supplier.lead_time_days ?? "";
      input.placeholder = "Required";
      input.setAttribute("aria-label", `${supplier.name} lead time in days`);
      leadTimeCell.append(input);

      const saveButton = document.createElement("button");
      saveButton.className = "btn btn-outline-success btn-sm";
      saveButton.type = "button";
      saveButton.textContent = "Save";
      saveButton.setAttribute("aria-label", `Save lead time for ${supplier.name}`);
      saveButton.addEventListener("click", () => {
        void saveSupplierLeadTime(context, supplier, input, saveButton, status);
      });
      actionCell.append(saveButton, status);
    } else {
      leadTimeCell.textContent = supplier.lead_time_days
        ? String(supplier.lead_time_days)
        : "Not set";
      actionCell.textContent = "—";
    }
    row.append(leadTimeCell, actionCell);
    return row;
  });
  supplierRows.replaceChildren(...rows);
}

async function saveSupplierLeadTime(context, supplier, input, button, status) {
  const rawValue = input.value.trim();
  const leadTimeDays = rawValue ? Number(rawValue) : null;
  if (
    leadTimeDays !== null
    && (!Number.isSafeInteger(leadTimeDays) || leadTimeDays < 1 || leadTimeDays > 365)
  ) {
    status.textContent = "Enter a whole number from 1 to 365, or clear the field.";
    status.className = "small text-danger";
    input.focus();
    return;
  }

  button.disabled = true;
  status.textContent = "Saving…";
  status.className = "small text-secondary";
  try {
    const { data, error } = await context.client.from("suppliers")
      .update({ lead_time_days: leadTimeDays })
      .eq("pharmacy_id", context.profile.pharmacy_id)
      .eq("id", supplier.id)
      .select("id, lead_time_days")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("The supplier was unavailable for this pharmacy.");

    supplier.lead_time_days = data.lead_time_days;
    input.value = data.lead_time_days ?? "";
    status.textContent = data.lead_time_days === null
      ? "Lead time cleared."
      : "Lead time saved.";
    status.className = "small text-success";
  } catch (error) {
    console.error("Could not save supplier lead time:", error);
    status.textContent =
      error.code === "42703" || error.code === "PGRST204"
        ? "Supplier lead times are not enabled. Apply the recommendations migration."
        : "Could not save lead time. Check administrator access and the connection.";
    status.className = "small text-danger";
  } finally {
    button.disabled = false;
  }
}

async function loadPurchases() {
  try {
    const context = await getAuthenticatedContext();
    if (!context) return;
    const pharmacyId = context.profile.pharmacy_id;
    document.querySelector("#purchase-dataset-note").hidden =
      context.pharmacy.dataset_kind !== "synthetic";

    const [purchaseResult, supplierResult] = await Promise.all([
      context.client.from("purchases")
        .select(
          "id, supplier_id, purchase_number, purchase_date, status, created_at",
          { count: "exact" },
        )
        .eq("pharmacy_id", pharmacyId)
        .order("purchase_date", { ascending: false })
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(100),
      context.client.from("suppliers")
        .select("id, name, contact_name, phone, email, is_active, lead_time_days")
        .eq("pharmacy_id", pharmacyId)
        .order("name", { ascending: true }),
    ]);
    if (purchaseResult.error) throw purchaseResult.error;
    if (supplierResult.error) throw supplierResult.error;

    const purchases = purchaseResult.data;
    const suppliers = supplierResult.data;
    const items = await fetchPurchaseItems(
      context.client,
      pharmacyId,
      purchases.map((purchase) => purchase.id),
    );
    const medicineIds = [...new Set(items.map((item) => item.medicine_id))];
    const medicines = await fetchMedicines(
      context.client,
      pharmacyId,
      medicineIds,
    );

    const totalValue = renderPurchases(purchases, items, suppliers, medicines);
    renderSuppliers(suppliers, context);
    document.querySelector("#purchase-count").textContent =
      Number(purchaseResult.count || 0).toLocaleString("en-KE");
    document.querySelector("#supplier-count").textContent =
      String(suppliers.filter((supplier) => supplier.is_active).length);
    document.querySelector("#latest-purchase").textContent =
      purchases[0]?.purchase_date || "—";
    document.querySelector("#purchase-value").textContent =
      currency.format(totalValue);
    document.querySelector("#purchase-list-count").textContent =
      `${purchases.length} shown`;
    if (Number(purchaseResult.count || 0) > purchases.length) {
      document.querySelector("#purchase-list-note").textContent =
        `Showing the latest ${purchases.length} of ${purchaseResult.count} purchase records.`;
    } else {
      document.querySelector("#purchase-list-note").textContent =
        `Showing all ${purchases.length} purchase records.`;
    }
  } catch (error) {
    console.error("Could not load purchases and suppliers:", error);
    statusMessage.hidden = false;
    statusMessage.textContent =
      error.code === "42703" || error.code === "PGRST204"
        ? "Supplier lead times are not enabled. Apply the recommendations migration."
        : "Could not load purchases or suppliers. Check your Supabase connection and pharmacy access.";
    document.querySelector("#purchase-list-count").textContent = "Unavailable";
  }
}

void loadPurchases();
