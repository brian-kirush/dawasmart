import { getAuthenticatedContext } from "./auth-session.js";

const reportType = document.querySelector("#report-type");
const reportStatus = document.querySelector("#report-status");
const reportHead = document.querySelector("#report-head");
const reportRows = document.querySelector("#report-rows");
const reportSummary = document.querySelector("#report-summary");
const exportButton = document.querySelector("#export-csv");
const printButton = document.querySelector("#print-report");
const currency = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
});
let context;
let currentReport = { columns: [], rows: [] };

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

function dateOffset(dateString, days) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function startOfNairobiDay(dateString) {
  return new Date(`${dateString}T00:00:00+03:00`).toISOString();
}

function setText(selector, value) {
  document.querySelector(selector).textContent = value;
}

function setTable(columns, rows) {
  const headRow = document.createElement("tr");
  for (const column of columns) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = column;
    headRow.append(cell);
  }
  reportHead.replaceChildren(headRow);

  if (rows.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = columns.length;
    cell.textContent = "No records for this report.";
    row.append(cell);
    reportRows.replaceChildren(row);
  } else {
    const tableRows = rows.map((values) => {
      const row = document.createElement("tr");
      for (const value of values) {
        const cell = document.createElement("td");
        cell.textContent = String(value);
        row.append(cell);
      }
      return row;
    });
    reportRows.replaceChildren(...tableRows);
  }
  currentReport = { columns, rows };
  exportButton.disabled = false;
  printButton.disabled = false;
}

function reportSalesPeriod(kind) {
  const today = nairobiDate();
  if (kind === "daily-sales") {
    return {
      start: today,
      end: dateOffset(today, 1),
      label: `Sales for ${today}`,
      title: "Daily sales",
    };
  }
  if (kind === "weekly-sales") {
    const start = dateOffset(today, -6);
    return {
      start,
      end: dateOffset(today, 1),
      label: `${start} to ${today} (last 7 days)`,
      title: "Weekly sales",
    };
  }
  const start = `${today.slice(0, 7)}-01`;
  const [year, month] = today.split("-").map(Number);
  const end = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  return {
    start,
    end,
    label: `${start} to ${dateOffset(end, -1)} (this month)`,
    title: "Monthly sales",
  };
}

async function loadSalesReport(kind) {
  const period = reportSalesPeriod(kind);
  const pharmacyId = context.profile.pharmacy_id;
  const { data: sales, error: salesError } = await context.client.from("sales")
    .select("id, receipt_number, sold_at")
    .eq("pharmacy_id", pharmacyId)
    .eq("sale_type", "sale")
    .gte("sold_at", startOfNairobiDay(period.start))
    .lt("sold_at", startOfNairobiDay(period.end))
    .order("sold_at", { ascending: true });
  if (salesError) throw salesError;

  let items = [];
  if (sales.length > 0) {
    const { data, error } = await context.client.from("sale_items")
      .select("sale_id, medicine_id, quantity, unit_price")
      .eq("pharmacy_id", pharmacyId)
      .in("sale_id", sales.map((sale) => sale.id));
    if (error) throw error;
    items = data;
  }
  const medicineIds = [...new Set(items.map((item) => item.medicine_id))];
  let medicines = [];
  if (medicineIds.length > 0) {
    const { data, error } = await context.client.from("medicines")
      .select("id, generic_name, strength, dispensing_unit")
      .eq("pharmacy_id", pharmacyId)
      .in("id", medicineIds);
    if (error) throw error;
    medicines = data;
  }

  const saleById = new Map(sales.map((sale) => [sale.id, sale]));
  const medicineById = new Map(medicines.map((medicine) => [medicine.id, medicine]));
  let total = 0;
  let totalUnits = 0;
  const rows = items.map((item) => {
    const sale = saleById.get(item.sale_id);
    const medicine = medicineById.get(item.medicine_id);
    const lineTotal = Number(item.quantity) * Number(item.unit_price);
    total += lineTotal;
    totalUnits += item.quantity;
    const soldDate = nairobiDate(new Date(sale.sold_at));
    const name = [
      medicine ? medicine.generic_name : "Medicine",
      medicine && medicine.strength,
    ].filter(Boolean).join(" ");
    return [
      soldDate,
      sale.receipt_number,
      name,
      `${item.quantity} ${medicine ? medicine.dispensing_unit : ""}`.trim(),
      currency.format(Number(item.unit_price)),
      currency.format(lineTotal),
    ];
  });

  setText("#report-title", period.title);
  setText("#report-date-range", period.label);
  reportSummary.textContent =
    `${currency.format(total)} · ${totalUnits.toLocaleString("en-KE")} units`;
  setTable(
    ["Date", "Receipt", "Medicine", "Quantity", "Unit price", "Line total"],
    rows,
  );
}

async function loadStockReport(isExpiryReport) {
  const today = nairobiDate();
  const expiryLimit = dateOffset(today, 90);
  const pharmacyId = context.profile.pharmacy_id;
  const { data: batches, error: batchError } = await context.client.from("batches")
    .select("medicine_id, supplier_id, batch_number, expiry_date, quantity_received, quantity_on_hand, unit_cost")
    .eq("pharmacy_id", pharmacyId)
    .order("expiry_date", { ascending: true });
  if (batchError) throw batchError;

  const visibleBatches = isExpiryReport
    ? batches.filter((batch) =>
      batch.quantity_on_hand > 0 && batch.expiry_date <= expiryLimit
    )
    : batches;
  const medicineIds = [...new Set(visibleBatches.map((batch) => batch.medicine_id))];
  const supplierIds = [...new Set(
    visibleBatches.map((batch) => batch.supplier_id).filter(Boolean),
  )];
  const [medicineResult, supplierResult] = await Promise.all([
    medicineIds.length
      ? context.client.from("medicines")
        .select("id, sku, generic_name, strength")
        .eq("pharmacy_id", pharmacyId)
        .in("id", medicineIds)
      : { data: [], error: null },
    supplierIds.length
      ? context.client.from("suppliers")
        .select("id, name")
        .eq("pharmacy_id", pharmacyId)
        .in("id", supplierIds)
      : { data: [], error: null },
  ]);
  if (medicineResult.error) throw medicineResult.error;
  if (supplierResult.error) throw supplierResult.error;

  const medicineById = new Map(medicineResult.data.map((medicine) => [
    medicine.id,
    medicine,
  ]));
  const supplierById = new Map(supplierResult.data.map((supplier) => [
    supplier.id,
    supplier.name,
  ]));
  let totalUnits = 0;
  const rows = visibleBatches.map((batch) => {
    const medicine = medicineById.get(batch.medicine_id);
    const medicineName = [
      medicine ? medicine.generic_name : "Medicine",
      medicine && medicine.strength,
    ].filter(Boolean).join(" ");
    totalUnits += batch.quantity_on_hand;
    if (isExpiryReport) {
      const daysRemaining = Math.ceil(
        (new Date(`${batch.expiry_date}T00:00:00Z`) -
          new Date(`${today}T00:00:00Z`)) / 86400000,
      );
      return [
        medicineName,
        batch.batch_number,
        batch.expiry_date,
        daysRemaining < 0 ? `Expired ${Math.abs(daysRemaining)} days ago` : String(daysRemaining),
        String(batch.quantity_on_hand),
      ];
    }
    return [
      medicine ? medicine.sku : "—",
      medicineName,
      batch.batch_number,
      supplierById.get(batch.supplier_id) || "—",
      batch.expiry_date,
      String(batch.quantity_received),
      String(batch.quantity_on_hand),
      currency.format(Number(batch.unit_cost)),
    ];
  });

  setText(
    "#report-title",
    isExpiryReport ? "Expiry risk (90 days)" : "Inventory",
  );
  setText(
    "#report-date-range",
    isExpiryReport
      ? `Expired or expiring by ${expiryLimit} · ${today}`
      : `Stock snapshot · ${today}`,
  );
  reportSummary.textContent =
    `${totalUnits.toLocaleString("en-KE")} units · ${visibleBatches.length} batches`;
  setTable(
    isExpiryReport
      ? ["Medicine", "Batch", "Expiry date", "Days remaining", "Units on hand"]
      : [
        "SKU",
        "Medicine",
        "Batch",
        "Supplier",
        "Expiry date",
        "Received",
        "On hand",
        "Unit cost",
      ],
    rows,
  );
}

function csvSafe(value) {
  const text = String(value);
  const safeText = /^[\t\r ]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
}

function exportCsv() {
  const csv = [
    currentReport.columns,
    ...currentReport.rows,
  ].map((row) => row.map(csvSafe).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${reportType.value}-${nairobiDate()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

async function loadReport() {
  reportStatus.hidden = true;
  exportButton.disabled = true;
  printButton.disabled = true;
  reportSummary.textContent = "Loading…";
  try {
    const kind = reportType.value;
    if (kind.endsWith("-sales")) {
      await loadSalesReport(kind);
    } else {
      await loadStockReport(kind === "expiry");
    }
  } catch (error) {
    console.error("Could not load report:", error);
    reportStatus.hidden = false;
    reportStatus.textContent =
      "Could not load this report. Check your Supabase connection and pharmacy access.";
    reportSummary.textContent = "Unavailable";
    setTable(["Report"], []);
    exportButton.disabled = true;
    printButton.disabled = true;
  }
}

async function prepareReports() {
  try {
    context = await getAuthenticatedContext();
    if (!context) return;
    document.querySelector("#report-dataset-note").hidden =
      context.pharmacy.dataset_kind !== "synthetic";
    reportType.addEventListener("change", () => void loadReport());
    exportButton.addEventListener("click", exportCsv);
    printButton.addEventListener("click", () => window.print());
    await loadReport();
  } catch (error) {
    console.error("Could not prepare reports:", error);
    reportStatus.hidden = false;
    reportStatus.textContent =
      "Could not verify your pharmacy access. Try again or contact an administrator.";
    reportSummary.textContent = "Unavailable";
  }
}

void prepareReports();
