import { getAuthenticatedContext } from "./auth-session.js";

const receipt = document.querySelector("#receipt");
const receiptStatus = document.querySelector("#receipt-status");
const printButton = document.querySelector("#print-receipt");
const itemsBody = document.querySelector("#receipt-items");
const currency = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
});

function setText(selector, value) {
  document.querySelector(selector).textContent = value;
}

function showError(message) {
  receiptStatus.className = "alert alert-danger no-print";
  receiptStatus.textContent = message;
}

async function loadReceipt() {
  try {
    const context = await getAuthenticatedContext();
    if (!context) return;
    const saleId = new URLSearchParams(window.location.search).get("id");
    if (!saleId) {
      showError("This receipt link is missing its sale identifier.");
      return;
    }

    const { data: sale, error: saleError } = await context.client
      .from("sales")
      .select("id, receipt_number, sold_at, created_by")
      .eq("id", saleId)
      .eq("pharmacy_id", context.profile.pharmacy_id)
      .eq("sale_type", "sale")
      .single();
    if (saleError) throw saleError;

    const { data: items, error: itemsError } = await context.client
      .from("sale_items")
      .select("medicine_id, quantity, unit_price")
      .eq("sale_id", sale.id)
      .eq("pharmacy_id", context.profile.pharmacy_id);
    if (itemsError) throw itemsError;

    const medicineIds = [...new Set(items.map((item) => item.medicine_id))];
    const { data: medicines, error: medicinesError } = await context.client
      .from("medicines")
      .select("id, generic_name, strength, dispensing_unit")
      .eq("pharmacy_id", context.profile.pharmacy_id)
      .in("id", medicineIds);
    if (medicinesError) throw medicinesError;

    const medicineById = new Map(medicines.map((medicine) => [medicine.id, medicine]));
    const rows = items.map((item) => {
      const row = document.createElement("tr");
      const medicine = medicineById.get(item.medicine_id);
      const itemName = [
        medicine ? medicine.generic_name : "Medicine",
        medicine && medicine.strength,
      ].filter(Boolean).join(" · ");
      const amount = Number(item.quantity) * Number(item.unit_price);
      for (const value of [
        itemName,
        `${item.quantity} ${medicine ? medicine.dispensing_unit : ""}`.trim(),
        currency.format(Number(item.unit_price)),
        currency.format(amount),
      ]) {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.append(cell);
      }
      row.lastElementChild.classList.add("text-end");
      return row;
    });
    itemsBody.replaceChildren(...rows);

    const total = items.reduce(
      (sum, item) => sum + Number(item.quantity) * Number(item.unit_price),
      0,
    );
    setText("#receipt-pharmacy", context.pharmacy.name);
    setText("#receipt-number", sale.receipt_number);
    setText("#receipt-date", new Date(sale.sold_at).toLocaleString("en-KE", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Africa/Nairobi",
    }));
    setText(
      "#receipt-staff",
      sale.created_by === context.profile.id ? context.profile.full_name : "Pharmacy staff",
    );
    setText("#receipt-total", currency.format(total));
    receipt.hidden = false;
    receiptStatus.hidden = true;
    printButton.disabled = false;
    printButton.addEventListener("click", () => window.print());
  } catch (error) {
    console.error("Could not load receipt:", error);
    showError(
      "Could not load this receipt. It may not exist or you may not have access to it.",
    );
  }
}

void loadReceipt();
