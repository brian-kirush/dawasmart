import { getAuthenticatedContext } from "./auth-session.js";

const tableBody = document.querySelector("#medicine-rows");
const statusMessage = document.querySelector("#medicine-status");
const previewNote = document.querySelector("#medicine-preview-note");
const medicineCount = document.querySelector("#medicine-count");
let authenticatedContext;

function createCell(value) {
  const cell = document.createElement("td");
  cell.textContent = value || "—";
  return cell;
}

function renderEmptyState() {
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  const content = document.createElement("div");
  const heading = document.createElement("h3");
  const description = document.createElement("p");

  cell.colSpan = 6;
  content.className = "table-empty-state";
  heading.textContent = "No medicines in this pharmacy yet";
  description.textContent =
    "Add a medicine to begin building this pharmacy’s catalogue.";
  content.append(heading, description);
  cell.append(content);
  row.append(cell);
  tableBody.replaceChildren(row);
}

function renderMedicines(medicines, isAdministrator) {
  if (medicines.length === 0) {
    renderEmptyState();
    return;
  }

  const rows = medicines.map((medicine) => {
    const row = document.createElement("tr");
    const medicineName = [
      medicine.generic_name,
      medicine.strength,
    ].filter(Boolean).join(" · ");

    row.append(
      createCell(medicineName),
      createCell(medicine.sku),
      createCell(medicine.dosage_form),
      createCell(medicine.therapeutic_class),
      createCell(
        medicine.demand_pattern === "unknown"
          ? "Not classified"
          : medicine.demand_pattern,
      ),
    );

    const actions = document.createElement("td");
    if (isAdministrator) {
      const archiveButton = document.createElement("button");
      archiveButton.className = "btn btn-sm btn-outline-secondary";
      archiveButton.type = "button";
      archiveButton.textContent = "Archive";
      archiveButton.setAttribute(
        "aria-label",
        `Archive ${medicine.generic_name}`,
      );
      archiveButton.dataset.archiveId = medicine.id;
      archiveButton.dataset.medicineName = medicine.generic_name;
      actions.append(archiveButton);
    } else {
      actions.textContent = "—";
    }
    row.append(actions);
    return row;
  });

  tableBody.replaceChildren(...rows);
}

async function archiveMedicine(button) {
  const medicineName = button.dataset.medicineName;
  if (
    !window.confirm(
      `Archive ${medicineName}? It will leave the active list, but historical records will be retained.`,
    )
  ) {
    return;
  }

  button.disabled = true;
  try {
    const { error } = await authenticatedContext.client
      .from("medicines")
      .update({ is_active: false })
      .eq("id", button.dataset.archiveId)
      .eq("pharmacy_id", authenticatedContext.profile.pharmacy_id)
      .select("id")
      .single();

    if (error) throw error;

    button.closest("tr").remove();
    statusMessage.className = "alert alert-success";
    statusMessage.hidden = false;
    statusMessage.textContent =
      `${medicineName} archived. Historical records are retained.`;
    const activeCount = tableBody.querySelectorAll("tr").length;
    medicineCount.textContent =
      activeCount === 1 ? "1 active medicine" : `${activeCount} active medicines`;
    if (activeCount === 0) renderEmptyState();
  } catch (error) {
    console.error("Could not archive medicine:", error);
    statusMessage.className = "alert alert-danger";
    statusMessage.hidden = false;
    statusMessage.textContent =
      error.code === "42501"
        ? "Your role does not allow archiving medicines."
        : "Could not archive this medicine. It may already be archived or unavailable.";
    button.disabled = false;
  }
}

async function loadMedicines() {
  try {
    const context = await getAuthenticatedContext();
    if (!context) return;
    authenticatedContext = context;

    const isAdministrator = context.profile.role === "administrator";
    document.querySelectorAll("[data-admin-only]").forEach((element) => {
      element.hidden = !isAdministrator;
    });

    const { data, error } = await context.client
      .from("medicines")
      .select(
        "id, sku, generic_name, strength, dosage_form, therapeutic_class, demand_pattern",
      )
      .eq("pharmacy_id", context.profile.pharmacy_id)
      .eq("is_active", true)
      .order("generic_name", { ascending: true });

    if (error) throw error;

    renderMedicines(data, isAdministrator);
    medicineCount.textContent =
      data.length === 1 ? "1 active medicine" : `${data.length} active medicines`;
    previewNote.hidden = true;
  } catch (error) {
    console.error("Could not load medicines:", error);
    statusMessage.hidden = false;
    statusMessage.textContent =
      "Could not load medicines. Check the Supabase connection and your pharmacy access.";
    previewNote.hidden = true;
  }
}

if (tableBody) {
  tableBody.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest("[data-archive-id]");
    if (!button || !authenticatedContext) return;
    void archiveMedicine(button);
  });
  void loadMedicines();
}
