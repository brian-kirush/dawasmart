import { getAuthenticatedContext } from "./auth-session.js";
import { applyTheme, loadTheme, saveTheme } from "./theme.js";

const settingsStatus = document.querySelector("#settings-status");
const pharmacyForm = document.querySelector("#pharmacy-settings-form");
const appearanceForm = document.querySelector("#appearance-form");
const pharmacyName = document.querySelector("#pharmacy-name");
const pharmacyCounty = document.querySelector("#pharmacy-county");
const datasetKind = document.querySelector("#dataset-kind-setting");
const themeChoice = document.querySelector("#theme-choice");
let context;

function setStatus(message, kind = "danger") {
  settingsStatus.className = `alert alert-${kind}`;
  settingsStatus.textContent = message;
  settingsStatus.hidden = false;
}

function displayDatasetKind(value) {
  return value === "synthetic" ? "Synthetic demonstration data" : "Real data";
}

async function loadSettings() {
  const { data, error } = await context.client
    .from("pharmacies")
    .select("name, county, country_code, dataset_kind")
    .eq("id", context.profile.pharmacy_id)
    .single();
  if (error) throw error;

  pharmacyName.value = data.name;
  pharmacyCounty.value = data.county ?? "";
  datasetKind.value = displayDatasetKind(data.dataset_kind);
  document.querySelector("#pharmacy-country").value =
    data.country_code === "KE" ? "Kenya" : data.country_code;
}

async function savePharmacy(event) {
  event.preventDefault();
  settingsStatus.hidden = true;
  const saveButton = document.querySelector("#save-pharmacy");
  saveButton.disabled = true;
  const name = pharmacyName.value.trim();
  const county = pharmacyCounty.value.trim();
  if (!name || name.length > 120 || county.length > 80) {
    setStatus("Enter a pharmacy name (up to 120 characters) and county (up to 80 characters).");
    saveButton.disabled = false;
    return;
  }

  try {
    const { data, error } = await context.client
      .from("pharmacies")
      .update({ name, county: county || null })
      .eq("id", context.profile.pharmacy_id)
      .select("name, county")
      .single();
    if (error) throw error;
    pharmacyName.value = data.name;
    pharmacyCounty.value = data.county ?? "";
    document.querySelector("#pharmacy-label").textContent = data.name;
    setStatus("Pharmacy details saved.", "success");
  } catch (error) {
    console.error("Could not update pharmacy settings:", error);
    setStatus(
      error?.code === "42501"
        ? "Only an administrator can edit pharmacy details."
        : "Could not save pharmacy details. Check your administrator access.",
    );
  } finally {
    saveButton.disabled = false;
  }
}

function saveAppearance(event) {
  event.preventDefault();
  settingsStatus.hidden = true;
  const saveButton = document.querySelector("#save-theme");
  saveButton.disabled = true;
  try {
    saveTheme(themeChoice.value);
    setStatus("Appearance preference saved in this browser.", "success");
  } catch (error) {
    console.error("Could not save appearance preference:", error);
    setStatus("Could not save the appearance preference in this browser.");
  } finally {
    saveButton.disabled = false;
  }
}

async function prepareSettings() {
  try {
    context = await getAuthenticatedContext();
    if (!context) return;
    const isAdministrator = context.profile.role === "administrator";
    document.querySelectorAll("[data-admin-only]").forEach((element) => {
      element.hidden = !isAdministrator;
    });
    document.querySelector("#pharmacy-settings-note").hidden = isAdministrator;
    pharmacyName.disabled = !isAdministrator;
    pharmacyCounty.disabled = !isAdministrator;
    pharmacyForm.addEventListener("submit", (event) => void savePharmacy(event));
    appearanceForm.addEventListener("submit", saveAppearance);
    try {
      themeChoice.value = loadTheme();
      applyTheme(themeChoice.value);
    } catch (error) {
      console.error("Could not load the saved appearance preference:", error);
      themeChoice.value = "light";
      setStatus("Could not load the saved appearance preference in this browser.", "warning");
    }
    await loadSettings();
  } catch (error) {
    console.error("Could not load settings:", error);
    setStatus("Could not load settings. Check your Supabase connection and pharmacy access.");
  }
}

void prepareSettings();
