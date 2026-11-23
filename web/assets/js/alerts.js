import { getAuthenticatedContext } from "./auth-session.js";

const statusMessage = document.querySelector("#alerts-status");
const alertRows = document.querySelector("#alerts-rows");
const numberFormat = new Intl.NumberFormat("en-KE");

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

function utcDayNumber(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

function daysUntil(expiryDate, today) {
  return utcDayNumber(expiryDate) - utcDayNumber(today);
}

function appendCell(row, value) {
  const cell = document.createElement("td");
  cell.textContent = value || "—";
  row.append(cell);
}

function expiryGroup(days) {
  if (days < 0) return "expired";
  if (days <= 30) return "within30";
  if (days <= 60) return "within60";
  return "within90";
}

async function fetchBatches(client, pharmacyId) {
  const batches = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client.from("batches")
      .select("id, medicine_id, batch_number, expiry_date, quantity_on_hand")
      .eq("pharmacy_id", pharmacyId)
      .gt("quantity_on_hand", 0)
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

function setSummary(group, batches) {
  const countSelector = group === "expired"
    ? "#expired-batch-count"
    : `#${group}-batches`;
  document.querySelector(countSelector).textContent =
    numberFormat.format(batches.length);
}

function renderAlerts(batches, medicines, today) {
  const medicineById = new Map(medicines.map((medicine) => [medicine.id, medicine]));
  const relevantBatches = batches
    .map((batch) => ({ ...batch, daysRemaining: daysUntil(batch.expiry_date, today) }))
    .filter((batch) => batch.daysRemaining <= 90);
  const expired = relevantBatches.filter((batch) => batch.daysRemaining < 0);
  const within30 = relevantBatches.filter((batch) =>
    batch.daysRemaining >= 0 && batch.daysRemaining <= 30
  );
  const within60 = relevantBatches.filter((batch) =>
    batch.daysRemaining > 30 && batch.daysRemaining <= 60
  );
  const within90 = relevantBatches.filter((batch) =>
    batch.daysRemaining > 60 && batch.daysRemaining <= 90
  );

  setSummary("expired", expired);
  setSummary("expiry-30", within30);
  setSummary("expiry-60", within60);
  setSummary("expiry-90", within90);

  if (relevantBatches.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 6;
    cell.textContent = "No expired or at-risk stock batches were found.";
    row.append(cell);
    alertRows.replaceChildren(row);
    document.querySelector("#alerts-count").textContent = "No alerts";
    return;
  }

  const rows = relevantBatches.map((batch) => {
    const row = document.createElement("tr");
    const medicine = medicineById.get(batch.medicine_id);
    const name = [
      medicine && medicine.generic_name,
      medicine && medicine.strength,
    ].filter(Boolean).join(" · ") || "Archived or unavailable medicine";
    const group = expiryGroup(batch.daysRemaining);
    const riskLabel = {
      expired: "Expired",
      within30: "30-day risk",
      within60: "60-day risk",
      within90: "90-day risk",
    }[group];
    const daysLabel = batch.daysRemaining < 0
      ? `${Math.abs(batch.daysRemaining)} days overdue`
      : `${batch.daysRemaining} days`;

    appendCell(row, riskLabel);
    appendCell(row, name);
    appendCell(row, batch.batch_number);
    appendCell(row, batch.expiry_date);
    appendCell(row, daysLabel);
    appendCell(
      row,
      `${numberFormat.format(Number(batch.quantity_on_hand))} ${
        medicine && medicine.dispensing_unit ? medicine.dispensing_unit : ""
      }`.trim(),
    );
    return row;
  });
  alertRows.replaceChildren(...rows);
  document.querySelector("#alerts-count").textContent =
    `${relevantBatches.length} batch${relevantBatches.length === 1 ? "" : "es"}`;
}

async function loadAlerts() {
  try {
    const context = await getAuthenticatedContext();
    if (!context) return;
    document.querySelector("#alerts-dataset-note").hidden =
      context.pharmacy.dataset_kind !== "synthetic";
    const pharmacyId = context.profile.pharmacy_id;
    const today = nairobiDate();
    const batches = await fetchBatches(context.client, pharmacyId);
    const relevantBatches = batches.filter((batch) =>
      daysUntil(batch.expiry_date, today) <= 90
    );
    const medicineIds = [...new Set(
      relevantBatches.map((batch) => batch.medicine_id),
    )];
    const medicines = await fetchMedicines(
      context.client,
      pharmacyId,
      medicineIds,
    );

    renderAlerts(relevantBatches, medicines, today);
    document.querySelector("#alerts-updated").textContent =
      `Checked ${new Intl.DateTimeFormat("en-KE", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Africa/Nairobi",
      }).format(new Date())}`;
  } catch (error) {
    console.error("Could not load expiry alerts:", error);
    statusMessage.hidden = false;
    statusMessage.textContent =
      "Could not load expiry information. Check your Supabase connection and pharmacy access.";
    document.querySelector("#alerts-updated").textContent = "Unavailable";
  }
}

void loadAlerts();
