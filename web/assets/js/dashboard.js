import { getAuthenticatedContext } from "./auth-session.js";

const statusMessage = document.querySelector("#dashboard-status");
const updatedLabel = document.querySelector("#dashboard-updated");
const datasetNote = document.querySelector("#dashboard-dataset-note");
const chartCanvas = document.querySelector("#sales-chart");
const chartEmptyState = document.querySelector("#sales-chart-empty");
let salesChart;

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

function addDays(dateString, days) {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function startOfNairobiDay(dateString) {
  return new Date(`${dateString}T00:00:00+03:00`).toISOString();
}

function setValue(selector, value) {
  document.querySelector(selector).textContent = value;
}

function renderSalesChart(sales, items, startDate, endDate) {
  const dates = Array.from({ length: 7 }, (_, index) => addDays(startDate, index));
  const totalsBySale = new Map();
  for (const item of items) {
    totalsBySale.set(
      item.sale_id,
      (totalsBySale.get(item.sale_id) || 0) +
        Number(item.quantity) * Number(item.unit_price),
    );
  }

  const dailyTotals = new Map(dates.map((date) => [date, 0]));
  let totalSales = 0;
  for (const sale of sales) {
    const date = nairobiDate(new Date(sale.sold_at));
    const amount = totalsBySale.get(sale.id) || 0;
    dailyTotals.set(date, (dailyTotals.get(date) || 0) + amount);
    totalSales += amount;
  }
  setValue(
    "#dashboard-sales-total",
    new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency: "KES",
      maximumFractionDigits: 0,
    }).format(totalSales),
  );
  chartEmptyState.hidden = sales.length > 0;

  if (typeof Chart !== "function") {
    throw new Error("Chart.js did not load. Check your internet connection and reload.");
  }
  if (salesChart) salesChart.destroy();
  salesChart = new Chart(chartCanvas, {
    type: "bar",
    data: {
      labels: dates.map((date) => new Date(`${date}T12:00:00+03:00`).toLocaleDateString(
        "en-KE",
        { day: "numeric", month: "short", timeZone: "Africa/Nairobi" },
      )),
      datasets: [{
        label: "Sales (KES)",
        data: dates.map((date) => dailyTotals.get(date)),
        backgroundColor: "#4e9671",
        borderRadius: 5,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (context) => new Intl.NumberFormat("en-KE", {
              style: "currency",
              currency: "KES",
            }).format(context.parsed.y),
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: (value) => new Intl.NumberFormat("en-KE", {
              notation: "compact",
              maximumFractionDigits: 1,
            }).format(value),
          },
        },
      },
    },
  });
  document.querySelector("#sales-chart-range").textContent =
    `${startDate} – ${endDate}`;
}

async function loadDashboard() {
  try {
    const context = await getAuthenticatedContext();
    if (!context) return;
    datasetNote.hidden = context.pharmacy.dataset_kind !== "synthetic";
    const pharmacyId = context.profile.pharmacy_id;
    const today = nairobiDate();
    const startDate = addDays(today, -6);
    const endDate = today;
    const expiryLimit = addDays(today, 90);
    const [medicineResult, batchResult, salesResult] = await Promise.all([
      context.client.from("medicines")
        .select("id", { count: "exact", head: true })
        .eq("pharmacy_id", pharmacyId)
        .eq("is_active", true),
      context.client.from("batches")
        .select("quantity_on_hand, expiry_date")
        .eq("pharmacy_id", pharmacyId)
        .gt("quantity_on_hand", 0)
        .gte("expiry_date", today),
      context.client.from("sales")
        .select("id, sold_at")
        .eq("pharmacy_id", pharmacyId)
        .eq("sale_type", "sale")
        .gte("sold_at", startOfNairobiDay(startDate))
        .lt("sold_at", startOfNairobiDay(addDays(endDate, 1)))
        .order("sold_at", { ascending: true }),
    ]);
    if (medicineResult.error) throw medicineResult.error;
    if (batchResult.error) throw batchResult.error;
    if (salesResult.error) throw salesResult.error;

    const batches = batchResult.data;
    const stockUnits = batches.reduce(
      (total, batch) => total + batch.quantity_on_hand,
      0,
    );
    const expiringUnits = batches.reduce(
      (total, batch) =>
        batch.expiry_date <= expiryLimit ? total + batch.quantity_on_hand : total,
      0,
    );
    setValue("#dashboard-medicine-count", String(medicineResult.count || 0));
    setValue("#dashboard-stock-units", stockUnits.toLocaleString("en-KE"));
    setValue("#dashboard-expiring-units", expiringUnits.toLocaleString("en-KE"));

    let saleItems = [];
    if (salesResult.data.length > 0) {
      const { data, error } = await context.client.from("sale_items")
        .select("sale_id, quantity, unit_price")
        .eq("pharmacy_id", pharmacyId)
        .in("sale_id", salesResult.data.map((sale) => sale.id));
      if (error) throw error;
      saleItems = data;
    }

    renderSalesChart(salesResult.data, saleItems, startDate, endDate);
    updatedLabel.textContent = `Updated ${new Intl.DateTimeFormat("en-KE", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Africa/Nairobi",
    }).format(new Date())}`;
  } catch (error) {
    console.error("Could not load dashboard:", error);
    statusMessage.hidden = false;
    statusMessage.textContent =
      error instanceof Error && error.message.startsWith("Chart.js")
        ? error.message
        : "Could not load dashboard data. Check your Supabase connection and pharmacy access.";
    updatedLabel.textContent = "Unavailable";
  }
}

void loadDashboard();
