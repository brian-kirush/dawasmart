import { getAuthenticatedContext } from "./auth-session.js";

const medicineForm = document.querySelector("#medicine-form");
const formStatus = document.querySelector("#medicine-form-status");
const saveButton = document.querySelector("#save-medicine");

function showStatus(message, style = "alert-info") {
  formStatus.hidden = false;
  formStatus.className = `alert ${style}`;
  formStatus.textContent = message;
}

async function prepareForm() {
  try {
    const context = await getAuthenticatedContext();
    if (!context) return;

    if (context.profile.role !== "administrator") {
      medicineForm.hidden = true;
      showStatus("Only an administrator can add medicines.", "alert-warning");
      return;
    }

    saveButton.disabled = false;
    medicineForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void saveMedicine(context);
    });
  } catch (error) {
    console.error("Could not prepare the medicine form:", error);
    showStatus(
      error.message.startsWith("Supabase is not configured.")
        ? error.message
        : "Could not verify your pharmacy role. Try again or contact an administrator.",
      "alert-danger",
    );
  }
}

async function saveMedicine(context) {
  saveButton.disabled = true;
  formStatus.hidden = true;

  try {
    const values = new FormData(medicineForm);
    const textValue = (name) => String(values.get(name) ?? "").trim();
    const sku = textValue("sku");
    const genericName = textValue("generic_name");
    const dispensingUnit = textValue("dispensing_unit");

    if (!sku || !genericName || !dispensingUnit) {
      showStatus("SKU, generic name, and dispensing unit are required.", "alert-danger");
      return;
    }

    const { error } = await context.client.from("medicines").insert({
      pharmacy_id: context.profile.pharmacy_id,
      sku,
      generic_name: genericName,
      brand_name: textValue("brand_name") || null,
      strength: textValue("strength") || null,
      dosage_form: textValue("dosage_form") || null,
      dispensing_unit: dispensingUnit,
      therapeutic_class: textValue("therapeutic_class") || null,
      demand_pattern: textValue("demand_pattern"),
    });

    if (error) throw error;

    showStatus("Medicine added.", "alert-success");
    window.location.assign("./medicines.html");
  } catch (error) {
    console.error("Could not save medicine:", error);
    const message = error.code === "23505"
      ? "That SKU is already in use at this pharmacy."
      : error.code === "42501"
        ? "Your role does not allow adding medicines."
        : "Could not save the medicine. Check the details and try again.";
    showStatus(message, "alert-danger");
  } finally {
    saveButton.disabled = false;
  }
}

if (medicineForm) {
  saveButton.disabled = true;
  void prepareForm();
}
